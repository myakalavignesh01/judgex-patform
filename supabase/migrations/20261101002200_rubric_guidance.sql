create or replace function public.set_rubric(event_id_input uuid,criteria_input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare c jsonb;k text;priorities integer[]:='{}';p integer;begin perform require_verified_user();perform 1 from events where id=event_id_input and status not in ('released','archived') for update;if not found or not is_event_organizer(event_id_input) then raise exception 'Organizer permission required for an open event';end if;
 if octet_length(criteria_input::text)>100000 then raise exception 'Rubric guidance exceeds the size limit';end if;
 for c in select * from jsonb_array_elements(criteria_input) loop
  foreach k in array array['description','anchors','evidence_requirements'] loop if c ? k and (jsonb_typeof(c->k)<>'string' or length(c->>k)>4000) then raise exception 'Rubric guidance must be text of at most 4000 characters';end if;end loop;
  if c ? 'tie_break_priority' and c->'tie_break_priority'<>'null'::jsonb then
   if jsonb_typeof(c->'tie_break_priority')<>'number' or (c->>'tie_break_priority')::numeric<>trunc((c->>'tie_break_priority')::numeric) then raise exception 'Tie-break priorities must be integers';end if;
   p=(c->>'tie_break_priority')::integer;if p not between 1 and 20 or p=any(priorities) then raise exception 'Use unique tie-break priorities from 1 to 20';end if;priorities=array_append(priorities,p);
  end if;
 end loop;perform set_rubric_core(event_id_input,criteria_input);end $$;
create function public.tie_break_scores(scores jsonb,criteria jsonb) returns numeric[] language sql immutable set search_path=public as $$
 select coalesce(array_agg((scores->>(c->>'id'))::numeric order by (c->>'tie_break_priority')::integer),'{}'::numeric[]) from jsonb_array_elements(criteria) c where c->>'tie_break_priority' is not null $$;
create or replace function public.public_leaderboard(event_id_input uuid) returns table(event_name text,team_name text,project_title text,approved_score numeric,released_at timestamptz) language sql stable security definer set search_path=public as $$
 select e.name,t.name,p.title,a.weighted_total,e.released_at from events e join teams t on t.event_id=e.id join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id join rubric_versions r on r.id=s.rubric_id join approved_scorecards a on a.submission_id=s.id where e.id=event_id_input and e.status='released' and e.public_results order by a.weighted_total desc,tie_break_scores(a.scores,r.criteria) desc,t.name $$;
revoke all on function public.tie_break_scores(jsonb,jsonb) from public,anon;
grant execute on function public.tie_break_scores(jsonb,jsonb) to authenticated;
create or replace function public.export_event_results(event_id_input uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare e events;rows jsonb;stamp timestamptz:=now();begin
 perform require_verified_user();select * into e from events where id=event_id_input;
 if not is_event_organizer(e.id) then raise exception 'Organizer permission required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('team',t.name,'project',p.title,'submissionVersion',s.version,'decisionVersion',c.decision_version,'approvedTotal',c.weighted_total,'approvedScores',c.scores,'approvedFeedback',c.feedback,'approvedAt',c.approved_at,'assessmentRunId',c.assessment_run_id) order by c.weighted_total desc,tie_break_scores(c.scores,r.criteria) desc,t.name),'[]') into rows from teams t join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id join rubric_versions r on r.id=s.rubric_id join approved_scorecards c on c.submission_id=s.id where t.event_id=e.id;
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,auth.uid(),'results.exported',jsonb_build_object('format','csv','rowCount',jsonb_array_length(rows),'released',e.released_at is not null));
 return jsonb_build_object('schemaVersion',1,'eventId',e.id,'eventName',e.name,'exportedAt',stamp,'released',e.released_at is not null,'rows',rows);end $$;
revoke all on function public.export_event_results(uuid) from public,anon;
grant execute on function public.export_event_results(uuid) to authenticated;

