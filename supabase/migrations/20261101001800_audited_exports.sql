create function public.export_event_results(event_id_input uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare e events;rows jsonb;stamp timestamptz:=now();begin
 perform require_verified_user();select * into e from events where id=event_id_input;
 if not is_event_organizer(e.id) then raise exception 'Organizer permission required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('team',t.name,'project',p.title,'submissionVersion',s.version,'decisionVersion',c.decision_version,'approvedTotal',c.weighted_total,'approvedScores',c.scores,'approvedFeedback',c.feedback,'approvedAt',c.approved_at,'assessmentRunId',c.assessment_run_id) order by c.weighted_total desc,t.name),'[]') into rows from teams t join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id join approved_scorecards c on c.submission_id=s.id where t.event_id=e.id;
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,auth.uid(),'results.exported',jsonb_build_object('format','csv','rowCount',jsonb_array_length(rows),'released',e.released_at is not null));
 return jsonb_build_object('schemaVersion',1,'eventId',e.id,'eventName',e.name,'exportedAt',stamp,'released',e.released_at is not null,'rows',rows);end $$;
revoke all on function public.export_event_results(uuid) from public,anon;
grant execute on function public.export_event_results(uuid) to authenticated;
