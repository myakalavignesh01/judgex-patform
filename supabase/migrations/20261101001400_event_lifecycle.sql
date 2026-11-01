create function public.change_event_state(event_id_input uuid,action_input text) returns void language plpgsql security definer set search_path=public as $$
declare e events;next_state text;begin
 perform require_verified_user();select * into e from events where id=event_id_input for update;
 if not is_event_organizer(e.id) then raise exception 'Organizer permission required';end if;
 if action_input='close_registration' and e.status='published' then next_state='evaluating';
 elsif action_input='reopen_registration' and e.status='evaluating' then next_state='published';
 elsif action_input='return_to_draft' and e.status='published' and not exists(select 1 from teams where event_id=e.id) then next_state='draft';
 elsif action_input='archive' and e.status<>'archived' then next_state='archived';
 elsif action_input='restore' and e.status='archived' then next_state=case when e.released_at is not null then 'released' else 'draft' end;
 else raise exception 'This event transition is not allowed';end if;
 update events set status=next_state where id=e.id;
 if next_state='archived' then update jobs set status='dead',lease_until=null,lease_token=null,last_error='Event archived; organizer may retry after restoration' where event_id=e.id and status in ('queued','retry','running') and (e.released_at is null or kind<>'email');end if;
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,auth.uid(),'event.state_changed',jsonb_build_object('from',e.status,'to',next_state));
end $$;
revoke all on function public.change_event_state(uuid,text) from public,anon;
grant execute on function public.change_event_state(uuid,text) to authenticated;
create or replace function public.can_read_scorecard(s uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from submission_versions v join projects p on p.id=v.project_id join teams t on t.id=p.team_id join events e on e.id=t.event_id where v.id=s and (is_event_organizer(e.id) or (e.released_at is not null and e.status in ('released','archived') and is_team_member(t.id)))) $$;
create or replace function public.retry_job(job_id_input uuid) returns void language plpgsql security definer set search_path=public as $$
declare j jobs;begin perform require_verified_user();select * into j from jobs where id=job_id_input for update;
 if not is_event_organizer(j.event_id) or j.status not in ('dead','retry') or exists(select 1 from events where id=j.event_id and status='archived') then raise exception 'Restore the event before retrying this job';end if;
 update jobs set status='queued',attempts=0,available_at=now(),lease_until=null,lease_token=null where id=j.id;
 insert into audit_logs(event_id,actor_id,action,details) values(j.event_id,auth.uid(),'job.retried',jsonb_build_object('jobId',j.id));end $$;
