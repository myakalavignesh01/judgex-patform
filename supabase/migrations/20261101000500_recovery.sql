create policy captain_invitation_read on invitations for select to authenticated using(exists(select 1 from teams t where t.id=team_id and t.captain_id=auth.uid()));
create function public.revoke_invitation(invitation_id_input uuid) returns void language plpgsql security definer set search_path=public as $$
declare i invitations;t teams;begin perform require_verified_user();select * into i from invitations where id=invitation_id_input for update;select * into t from teams where id=i.team_id;if t.captain_id<>auth.uid() and not is_event_organizer(t.event_id) then raise exception 'Captain or organizer permission required';end if;
 update invitations set status='revoked' where id=i.id and status='pending';insert into audit_logs(event_id,actor_id,action,details) values(t.event_id,auth.uid(),'invitation.revoked',jsonb_build_object('invitationId',i.id));end $$;
revoke all on function public.revoke_invitation(uuid) from public,anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;
create or replace function public.claim_job() returns setof public.jobs language plpgsql security definer set search_path=public as $$
begin
 update jobs set status='dead',last_error=coalesce(last_error,'Worker lease expired after final attempt'),lease_until=null where status='running' and lease_until<now() and attempts>=5;
 return query update jobs set status='running',attempts=attempts+1,lease_until=now()+interval '5 minutes' where id=(select id from jobs where ((status in ('queued','retry') and available_at<=now()) or (status='running' and lease_until<now())) and attempts<5 order by available_at for update skip locked limit 1) returning *;
end $$;
