create table public.decision_revisions(id uuid primary key default gen_random_uuid(),scorecard_id uuid not null references public.approved_scorecards,decision_version integer not null,scores jsonb not null,weighted_total numeric not null check(weighted_total between 0 and 100),feedback text not null,reason text not null,approved_by uuid not null references auth.users,approved_at timestamptz not null default now(),appeal_id uuid references public.appeals,unique(scorecard_id,decision_version));
alter table public.decision_revisions enable row level security;
revoke all on public.decision_revisions from public,anon,authenticated;
grant select on public.decision_revisions to authenticated;
grant all on public.decision_revisions to service_role;
create policy revision_read on public.decision_revisions for select to authenticated using(exists(select 1 from approved_scorecards c where c.id=scorecard_id and can_read_scorecard(c.submission_id)));
create function public.protect_decision_history() returns trigger language plpgsql as $$begin raise exception 'Decision and appeal history is append-only';end $$;
create trigger immutable_decision_revision before update or delete on public.decision_revisions for each row execute function public.protect_decision_history();
create view public.effective_scorecards with (security_invoker=true) as
 select c.id,c.submission_id,coalesce(r.scores,c.scores) scores,coalesce(r.weighted_total,c.weighted_total) weighted_total,coalesce(r.feedback,c.feedback) feedback,coalesce(r.approved_by,c.approved_by) approved_by,coalesce(r.approved_at,c.approved_at) approved_at,coalesce(r.decision_version,c.decision_version) decision_version,c.assessment_run_id,r.id revision_id,r.reason revision_reason
 from public.approved_scorecards c left join lateral(select * from public.decision_revisions d where d.scorecard_id=c.id order by d.decision_version desc limit 1) r on true;
revoke all on public.effective_scorecards from public,anon,authenticated;
grant select on public.effective_scorecards to authenticated,service_role;
alter table public.appeals add column decision_version integer;
update public.appeals a set decision_version=c.decision_version from public.approved_scorecards c where c.id=a.scorecard_id;
alter table public.appeals alter column decision_version set not null;
create table public.appeal_updates(id uuid primary key default gen_random_uuid(),appeal_id uuid not null references public.appeals,status text not null,resolution text not null,actor_id uuid not null references auth.users,created_at timestamptz not null default now());
alter table public.appeal_updates enable row level security;
revoke all on public.appeal_updates from public,anon,authenticated;
grant select on public.appeal_updates to authenticated;
grant all on public.appeal_updates to service_role;
create policy appeal_update_read on public.appeal_updates for select to authenticated using(exists(select 1 from appeals a where a.id=appeal_id));
create trigger immutable_appeal_update before update or delete on public.appeal_updates for each row execute function public.protect_decision_history();
create or replace function public.create_appeal(scorecard_id_input uuid,reason_input text,criterion_input text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare c effective_scorecards;e events;t uuid;r rubric_versions;result_id uuid;begin perform require_verified_user();
 select ev.* into e from events ev join teams t on t.event_id=ev.id join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id join approved_scorecards a on a.submission_id=s.id where a.id=scorecard_id_input for update of ev;
 select * into c from effective_scorecards where id=scorecard_id_input;select p.team_id into t from projects p join submission_versions s on s.project_id=p.id where s.id=c.submission_id;select rv.* into r from rubric_versions rv join submission_versions s on s.rubric_id=rv.id where s.id=c.submission_id;
 if not is_team_member(t) or e.status<>'released' or e.appeals_ends_at is null or now()>e.appeals_ends_at then raise exception 'Appeal window is closed';end if;
 if length(trim(reason_input)) not between 20 and 10000 then raise exception 'Describe the issue in 20–10000 characters';end if;
 if criterion_input is not null and not exists(select 1 from jsonb_array_elements(r.criteria) x where x->>'id'=criterion_input) then raise exception 'Select a criterion from the submitted rubric';end if;
 if exists(select 1 from appeals where scorecard_id=c.id and user_id=auth.uid() and decision_version=c.decision_version) then raise exception 'You have already appealed this decision version';end if;
 insert into appeals(scorecard_id,user_id,criterion_id,reason,decision_version) values(c.id,auth.uid(),criterion_input,trim(reason_input),c.decision_version) returning id into result_id;
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,auth.uid(),'appeal.created',jsonb_build_object('appealId',result_id,'decisionVersion',c.decision_version));return result_id;end $$;
create or replace function public.resolve_appeal(appeal_id_input uuid,resolution_input text,status_input text) returns void language plpgsql security definer set search_path=public as $$
declare a appeals;e events;begin perform require_verified_user();select ev.* into e from events ev join teams t on t.event_id=ev.id join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id join approved_scorecards c on c.submission_id=s.id join appeals ap on ap.scorecard_id=c.id where ap.id=appeal_id_input for update of ev;
 if not is_event_organizer(e.id) or e.status<>'released' then raise exception 'Organizer permission for a released, active event required';end if;
 select * into a from appeals where id=appeal_id_input for update;
 if a.status not in ('open','reviewing') or status_input not in ('reviewing','resolved','declined') or length(trim(resolution_input)) not between 10 and 10000 then raise exception 'An open appeal and a clear response are required';end if;
 update appeals set status=status_input,resolution=trim(resolution_input) where id=a.id;
 insert into appeal_updates(appeal_id,status,resolution,actor_id) values(a.id,status_input,trim(resolution_input),auth.uid());
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,auth.uid(),'appeal.responded',jsonb_build_object('appealId',a.id,'status',status_input));end $$;
create function public.revise_released_scorecard(scorecard_id_input uuid,expected_version_input integer,scores_input jsonb,feedback_input text,reason_input text,appeal_id_input uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare e events;c effective_scorecards;r rubric_versions;criterion jsonb;v numeric;total numeric:=0;revision uuid;m record;n uuid;prior decision_revisions;begin perform require_verified_user();
 select ev.* into e from events ev join teams t on t.event_id=ev.id join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id join approved_scorecards a on a.submission_id=s.id where a.id=scorecard_id_input for update of ev;
 if not is_event_organizer(e.id) or e.status<>'released' then raise exception 'Organizer permission for a released, active event required';end if;
 select * into c from effective_scorecards where id=scorecard_id_input;
 if c.decision_version<>expected_version_input then
  select * into prior from decision_revisions where scorecard_id=c.id and decision_version=c.decision_version;
  if prior.decision_version=expected_version_input+1 and prior.approved_by=auth.uid() and prior.scores=scores_input and prior.feedback=trim(feedback_input) and prior.reason=trim(reason_input) and prior.appeal_id is not distinct from appeal_id_input then return prior.id;end if;
  raise exception 'Decision changed since you opened it. Refresh before revising';
 end if;
 if expected_version_input is null or jsonb_typeof(scores_input) is distinct from 'object' or length(trim(feedback_input)) not between 10 and 20000 or length(trim(reason_input)) not between 10 and 2000 then raise exception 'Complete scores, useful feedback and a public revision reason are required';end if;
 if (select count(*) from decision_revisions where scorecard_id=c.id)>=20 then raise exception 'Decision revision limit reached';end if;
 select rv.* into r from rubric_versions rv join submission_versions s on s.rubric_id=rv.id where s.id=c.submission_id;
 if (select count(*) from jsonb_object_keys(scores_input))<>jsonb_array_length(r.criteria) then raise exception 'Score every rubric criterion exactly once';end if;
 for criterion in select * from jsonb_array_elements(r.criteria) loop
  if jsonb_typeof(scores_input->(criterion->>'id')) is distinct from 'number' then raise exception 'Score every criterion';end if;
  v=(scores_input->>(criterion->>'id'))::numeric;if v<0 or v>10 then raise exception 'Scores must be between 0 and 10';end if;total=total+v*(criterion->>'weight')::numeric/10;
 end loop;
 if appeal_id_input is not null then
  perform 1 from appeals where id=appeal_id_input and scorecard_id=c.id and status in ('open','reviewing') for update;if not found then raise exception 'Select an open appeal for this scorecard';end if;
 end if;
 insert into decision_revisions(scorecard_id,decision_version,scores,weighted_total,feedback,reason,approved_by,appeal_id) values(c.id,c.decision_version+1,scores_input,round(total,2),trim(feedback_input),trim(reason_input),auth.uid(),appeal_id_input) returning id into revision;
 if appeal_id_input is not null then update appeals set status='resolved',resolution=trim(reason_input) where id=appeal_id_input;insert into appeal_updates(appeal_id,status,resolution,actor_id) values(appeal_id_input,'resolved',trim(reason_input),auth.uid());end if;
 for m in select tm.user_id,tm.team_id from team_memberships tm join projects p on p.team_id=tm.team_id join submission_versions s on s.project_id=p.id join auth.users u on u.id=tm.user_id where s.id=c.submission_id and u.email_confirmed_at is not null loop
  insert into notifications(event_id,user_id,kind,logical_key) values(e.id,m.user_id,'decision_revision','revision:'||revision||':'||m.user_id) returning id into n;
  insert into jobs(event_id,team_id,kind,payload,idempotency_key) values(e.id,m.team_id,'email',jsonb_build_object('notificationId',n,'userId',m.user_id,'scorecardId',c.id,'decisionVersion',c.decision_version+1,'revisionId',revision),'email:'||n);
 end loop;
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,auth.uid(),'decision.revised',jsonb_build_object('scorecardId',c.id,'revisionId',revision,'decisionVersion',c.decision_version+1,'appealId',appeal_id_input));return revision;end $$;
create function public.decision_history(scorecard_id_input uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare c approved_scorecards;items jsonb;begin perform require_verified_user();select * into c from approved_scorecards where id=scorecard_id_input;if c.id is null or not can_read_scorecard(c.submission_id) then raise exception 'Scorecard permission required';end if;
 select jsonb_agg(v order by (v->>'decisionVersion')::integer) into items from (select jsonb_build_object('decisionVersion',c.decision_version,'total',c.weighted_total,'scores',c.scores,'feedback',c.feedback,'reason','Original released decision','approvedAt',c.approved_at) v union all select jsonb_build_object('decisionVersion',d.decision_version,'total',d.weighted_total,'scores',d.scores,'feedback',d.feedback,'reason',d.reason,'approvedAt',d.approved_at,'appealId',d.appeal_id) from decision_revisions d where d.scorecard_id=c.id) history;return coalesce(items,'[]');end $$;
create function public.scorecard_event(scorecard_id_input uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare c approved_scorecards;e uuid;begin perform require_verified_user();select * into c from approved_scorecards where id=scorecard_id_input;if c.id is null or not can_read_scorecard(c.submission_id) then raise exception 'Scorecard permission required';end if;select t.event_id into e from teams t join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id where s.id=c.submission_id;return e;end $$;
revoke all on function public.revise_released_scorecard(uuid,integer,jsonb,text,text,uuid),public.decision_history(uuid),public.scorecard_event(uuid) from public,anon;
grant execute on function public.revise_released_scorecard(uuid,integer,jsonb,text,text,uuid),public.decision_history(uuid),public.scorecard_event(uuid) to authenticated;
create or replace function public.public_leaderboard(event_id_input uuid) returns table(event_name text,team_name text,project_title text,approved_score numeric,released_at timestamptz) language sql stable security definer set search_path=public as $$
 select e.name,t.name,p.title,a.weighted_total,e.released_at from events e join teams t on t.event_id=e.id join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id join rubric_versions r on r.id=s.rubric_id join effective_scorecards a on a.submission_id=s.id where e.id=event_id_input and e.status='released' and e.public_results order by a.weighted_total desc,tie_break_scores(a.scores,r.criteria) desc,t.name $$;

create or replace function public.export_event_results(event_id_input uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare e events;rows jsonb;stamp timestamptz:=now();begin
 perform require_verified_user();select * into e from events where id=event_id_input;
 if not is_event_organizer(e.id) then raise exception 'Organizer permission required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('team',t.name,'project',p.title,'submissionVersion',s.version,'decisionVersion',c.decision_version,'approvedTotal',c.weighted_total,'approvedScores',c.scores,'approvedFeedback',c.feedback,'approvedAt',c.approved_at,'assessmentRunId',c.assessment_run_id,'revisionReason',c.revision_reason) order by c.weighted_total desc,tie_break_scores(c.scores,r.criteria) desc,t.name),'[]') into rows from teams t join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id join rubric_versions r on r.id=s.rubric_id join effective_scorecards c on c.submission_id=s.id where t.event_id=e.id;
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,auth.uid(),'results.exported',jsonb_build_object('format','csv','rowCount',jsonb_array_length(rows),'released',e.released_at is not null));
 return jsonb_build_object('schemaVersion',1,'eventId',e.id,'eventName',e.name,'exportedAt',stamp,'released',e.released_at is not null,'rows',rows);end $$;
revoke all on function public.export_event_results(uuid) from public,anon;
grant execute on function public.export_event_results(uuid) to authenticated;


