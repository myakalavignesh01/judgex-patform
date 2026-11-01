create function public.require_verified_user() returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid();begin if u is null or not exists(select 1 from auth.users where id=u and email_confirmed_at is not null) then raise exception 'Verified sign-in required';end if;return u;end $$;

create function public.create_event(event_name text,organization_name text,event_description text default '') returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid:=require_verified_user();o uuid;e uuid;begin
 if length(trim(event_name)) not between 2 and 120 then raise exception 'Event name must contain 2–120 characters';end if;
 insert into organizations(name) values(organization_name) returning id into o;
 insert into organization_memberships values(o,u,'owner');
 insert into events(organization_id,name,description) values(o,trim(event_name),event_description) returning id into e;
 insert into event_memberships values(e,u,'organizer');
 insert into rubric_versions(event_id,criteria) values(e,'[{"id":"innovation","name":"Innovation","weight":30},{"id":"execution","name":"Technical execution","weight":30},{"id":"impact","name":"Impact & feasibility","weight":25},{"id":"presentation","name":"Presentation","weight":15}]');
 insert into audit_logs(event_id,actor_id,action) values(e,u,'event.created');return e;
end $$;

create function public.publish_event(event_id_input uuid) returns void language plpgsql security definer set search_path=public as $$
begin perform require_verified_user();if not is_event_organizer(event_id_input) then raise exception 'Organizer permission required';end if;
 update events set status='published' where id=event_id_input and status='draft';
 insert into audit_logs(event_id,actor_id,action) values(event_id_input,auth.uid(),'event.published');end $$;

create function public.join_event(code uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid:=require_verified_user();e events;begin
 select * into e from events where join_code=code for update;
 if not found or e.status<>'published' or (e.registration_ends_at is not null and now()>e.registration_ends_at) then raise exception 'Registration is unavailable';end if;
 insert into event_memberships values(e.id,u,'participant') on conflict do nothing;return e.id;end $$;

create function public.create_team(event_id_input uuid,team_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid:=require_verified_user();e events;t uuid;begin
 select * into e from events where id=event_id_input for update;
 if not is_event_member(e.id) or e.status<>'published' then raise exception 'Join an open event first';end if;
 if exists(select 1 from team_memberships where event_id=e.id and user_id=u) then raise exception 'You already belong to a team';end if;
 if (select count(*) from teams where event_id=e.id)>=e.team_limit then raise exception 'Event team limit reached';end if;
 if length(trim(team_name)) not between 2 and 80 then raise exception 'Invalid team name';end if;
 insert into teams(event_id,name,captain_id) values(e.id,trim(team_name),u) returning id into t;
 insert into team_memberships(team_id,event_id,user_id) values(t,e.id,u);insert into projects(team_id) values(t);
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,u,'team.created',jsonb_build_object('teamId',t));return t;end $$;

create function public.save_project(team_id_input uuid,title_input text,abstract_input text,repository_input text default '',architecture_input text default '') returns void language plpgsql security definer set search_path=public as $$
declare p projects;e events;begin perform require_verified_user();
 if not is_team_member(team_id_input) then raise exception 'Team membership required';end if;
 select * into p from projects where team_id=team_id_input for update;
 select ev.* into e from events ev join teams t on t.event_id=ev.id where t.id=team_id_input;
 if e.status not in ('published','evaluating') or exists(select 1 from submission_versions where project_id=p.id) then raise exception 'Submission is locked';end if;
 if e.submission_ends_at is not null and now()>e.submission_ends_at then raise exception 'Submission deadline has passed';end if;
 if repository_input<>'' and repository_input !~ '^https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$' then raise exception 'Use a GitHub HTTPS repository URL';end if;
 update projects set title=left(title_input,200),abstract=left(abstract_input,20000),repository_url=repository_input,architecture=left(architecture_input,20000),updated_at=now() where id=p.id;end $$;

create function public.lock_submission(team_id_input uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid:=require_verified_user();p projects;e events;r uuid;s uuid;content jsonb;begin
 if not is_team_member(team_id_input) then raise exception 'Team membership required';end if;
 select ev.* into e from events ev join teams t on t.event_id=ev.id where t.id=team_id_input for update of ev;
 select * into p from projects where team_id=team_id_input for update;
 if exists(select 1 from submission_versions where project_id=p.id) then raise exception 'Submission is already locked';end if;
 if e.status not in ('published','evaluating') or (e.submission_ends_at is not null and now()>e.submission_ends_at) then raise exception 'Submission window is closed';end if;
 if exists(select 1 from artifacts where team_id=team_id_input and scan_state<>'clean') then raise exception 'Complete or remove pending evidence uploads before locking';end if;
 if length(trim(p.title))<2 or length(trim(p.abstract))<30 then raise exception 'Complete title and abstract first';end if;
 select id into r from rubric_versions where event_id=e.id order by version desc limit 1;
 update rubric_versions set frozen_at=coalesce(frozen_at,now()) where id=r;
 content=to_jsonb(p);insert into submission_versions(project_id,version,content,checksum,rubric_id,locked_by) values(p.id,1,content,encode(digest(content::text,'sha256'),'hex'),r,u) returning id into s;
 update artifacts set submission_id=s where team_id=team_id_input and submission_id is null;
 insert into evidence_items(submission_id,source,content) values(s,'project.abstract',p.abstract);
 if p.architecture<>'' then insert into evidence_items(submission_id,source,content) values(s,'project.architecture',p.architecture);end if;
 insert into jobs(event_id,team_id,kind,payload,idempotency_key) values(e.id,team_id_input,'extract',jsonb_build_object('submissionId',s),'extract:'||s);
 if p.repository_url<>'' then insert into jobs(event_id,team_id,kind,payload,idempotency_key) values(e.id,team_id_input,'repository',jsonb_build_object('submissionId',s),'repository:'||s);end if;
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,u,'submission.locked',jsonb_build_object('submissionId',s));return s;end $$;

create function public.approve_scorecard(submission_id_input uuid,scores_input jsonb,feedback_input text,reason_input text default '') returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid:=require_verified_user();e events;r rubric_versions;c jsonb;v numeric;total numeric:=0;weight_total numeric:=0;existing approved_scorecards;result_id uuid;begin
 select ev.* into e from events ev join teams t on t.event_id=ev.id join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id where s.id=submission_id_input for update of ev;
 if not is_event_organizer(e.id) or e.status in ('released','archived') then raise exception 'An organizer of an unreleased event is required';end if;
 select rv.* into r from rubric_versions rv join submission_versions s on s.rubric_id=rv.id where s.id=submission_id_input;
 if r.frozen_at is null or length(trim(feedback_input))=0 or jsonb_typeof(scores_input)<>'object' then raise exception 'Frozen rubric, scores and feedback are required';end if;
 for c in select * from jsonb_array_elements(r.criteria) loop
  if not scores_input ? (c->>'id') or jsonb_typeof(scores_input->(c->>'id'))<>'number' then raise exception 'Score every criterion';end if;
  v=(scores_input->>(c->>'id'))::numeric;if v<0 or v>10 then raise exception 'Scores must be between 0 and 10';end if;
  weight_total=weight_total+(c->>'weight')::numeric;total=total+v*(c->>'weight')::numeric/10;
 end loop;
 if weight_total<>100 or (select count(*) from jsonb_object_keys(scores_input))<>jsonb_array_length(r.criteria) then raise exception 'Invalid rubric or score keys';end if;
 select * into existing from approved_scorecards where submission_id=submission_id_input for update;
 if found and existing.scores<>scores_input and length(trim(reason_input))=0 then raise exception 'A score-change reason is required';end if;
 insert into approved_scorecards(submission_id,scores,weighted_total,feedback,approved_by) values(submission_id_input,scores_input,round(total,2),feedback_input,u)
 on conflict(submission_id) do update set scores=excluded.scores,weighted_total=excluded.weighted_total,feedback=excluded.feedback,approved_by=u,approved_at=now(),decision_version=approved_scorecards.decision_version+1 returning id into result_id;
 insert into score_changes(scorecard_id,previous_scores,new_scores,reason,actor_id) values(result_id,existing.scores,scores_input,coalesce(nullif(reason_input,''),'Initial organizer approval'),u);
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,u,'scorecard.approved',jsonb_build_object('scorecardId',result_id));return result_id;end $$;

create function public.release_results(event_id_input uuid) returns void language plpgsql security definer set search_path=public as $$
declare u uuid:=require_verified_user();e events;m record;n uuid;begin
 select * into e from events where id=event_id_input for update;
 if not is_event_organizer(e.id) then raise exception 'Organizer permission required';end if;
 if e.status='released' then return;end if;
 if e.status not in ('published','evaluating') then raise exception 'Invalid event state';end if;
 if not exists(select 1 from teams where event_id=e.id) or exists(select 1 from teams t left join projects p on p.team_id=t.id left join submission_versions s on s.project_id=p.id left join approved_scorecards a on a.submission_id=s.id where t.event_id=e.id and a.id is null) then raise exception 'Every team must have a locked submission and approved scorecard';end if;
 update events set status='released',released_at=now() where id=e.id;
 for m in select tm.user_id,tm.team_id,a.id scorecard_id from team_memberships tm join projects p on p.team_id=tm.team_id join submission_versions s on s.project_id=p.id join approved_scorecards a on a.submission_id=s.id where tm.event_id=e.id loop
  insert into notifications(event_id,user_id,kind,logical_key) values(e.id,m.user_id,'result','result:'||e.id||':'||m.user_id) on conflict(logical_key) do update set logical_key=excluded.logical_key returning id into n;
  insert into jobs(event_id,team_id,kind,payload,idempotency_key) values(e.id,m.team_id,'email',jsonb_build_object('notificationId',n,'userId',m.user_id,'scorecardId',m.scorecard_id),'email:'||n) on conflict(idempotency_key) do nothing;
 end loop;
 insert into audit_logs(event_id,actor_id,action) values(e.id,u,'results.released');end $$;

-- PostgreSQL functions are executable by PUBLIC by default: revoke that default.
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('require_verified_user','create_event','publish_event','join_event','create_team','save_project','lock_submission','approve_scorecard','release_results','is_event_organizer','is_event_member','is_team_member','can_read_team','can_read_submission','can_read_scorecard') loop execute format('revoke all on function %s from public, anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
