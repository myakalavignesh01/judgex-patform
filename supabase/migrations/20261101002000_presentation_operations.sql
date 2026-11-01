alter table public.presentation_slots add column version integer not null default 1;
alter table public.notifications drop constraint notifications_status_check;
alter table public.notifications add constraint notifications_status_check check(status in ('queued','sent','delivered','bounced','failed','cancelled'));
create function public.configure_presentation(team_id_input uuid,starts_at_input timestamptz,room_input text,duration_input integer default 15,notify_input boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare e events;s presentation_slots;m record;n uuid;k text;begin
 perform assert_team_event_open(team_id_input);select ev.* into e from events ev join teams t on t.event_id=ev.id where t.id=team_id_input;
 if not is_event_organizer(e.id) then raise exception 'Organizer permission required';end if;
 if starts_at_input is null or duration_input not between 1 and 120 or length(trim(room_input)) not between 1 and 100 then raise exception 'Set a time, room and duration from 1 to 120 minutes';end if;
 if exists(select 1 from presentation_slots p join teams t on t.id=p.team_id where t.event_id=e.id and p.team_id<>team_id_input and lower(trim(p.room))=lower(trim(room_input)) and p.status<>'missed' and p.starts_at<starts_at_input+make_interval(mins=>duration_input) and p.starts_at+make_interval(mins=>p.duration_minutes)>starts_at_input) then raise exception 'This room already has an overlapping presentation';end if;
 select * into s from presentation_slots where team_id=team_id_input for update;
 if s.id is null or s.starts_at is distinct from starts_at_input or s.room is distinct from trim(room_input) or s.duration_minutes is distinct from duration_input then
  if s.status='presenting' then raise exception 'Finish the active presentation before rescheduling';end if;
  insert into presentation_slots(team_id,starts_at,room,duration_minutes) values(team_id_input,starts_at_input,trim(room_input),duration_input) on conflict(team_id) do update set starts_at=excluded.starts_at,room=excluded.room,duration_minutes=excluded.duration_minutes,version=presentation_slots.version+1,status='scheduled',checked_in_at=null returning * into s;
  update notifications set status='cancelled',last_error='Schedule superseded' where id in (select (payload->>'notificationId')::uuid from jobs where payload->>'scheduleId'=s.id::text and (payload->>'scheduleVersion')::integer<>s.version) and status='queued';
  update jobs set status='dead',lease_token=null,lease_until=null,last_error='Schedule superseded' where payload->>'scheduleId'=s.id::text and (payload->>'scheduleVersion')::integer<>s.version and status in ('queued','retry','running');
 end if;
 if notify_input then
  if (select count(*) from notifications where event_id=e.id)>10000 then raise exception 'Event notification quota reached';end if;
  for m in select tm.user_id from team_memberships tm join auth.users u on u.id=tm.user_id where tm.team_id=team_id_input and u.email_confirmed_at is not null loop
   foreach k in array array['schedule','presentation_reminder'] loop
    if k='presentation_reminder' and s.starts_at<=now() then continue;end if;
    insert into notifications(event_id,user_id,kind,logical_key) values(e.id,m.user_id,k,k||':'||s.id||':'||s.version||':'||m.user_id) on conflict(logical_key) do update set logical_key=excluded.logical_key returning id into n;
    insert into jobs(event_id,team_id,kind,payload,idempotency_key,available_at) values(e.id,team_id_input,'email',jsonb_build_object('notificationId',n,'userId',m.user_id,'scheduleId',s.id,'scheduleVersion',s.version,'messageKind',k),'email:'||n,case when k='presentation_reminder' then greatest(now(),s.starts_at-interval '15 minutes') else now() end) on conflict(idempotency_key) do nothing;
   end loop;
  end loop;
 end if;
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,auth.uid(),'presentation.scheduled',jsonb_build_object('slotId',s.id,'version',s.version,'notificationsRequested',notify_input));end $$;
create or replace function public.schedule_team(team_id_input uuid,starts_at_input timestamptz,room_input text) returns void language plpgsql security definer set search_path=public as $$
begin perform configure_presentation(team_id_input,starts_at_input,room_input,15,false);end $$;
create function public.set_presentation_state(team_id_input uuid,state_input text) returns void language plpgsql security definer set search_path=public as $$
declare s presentation_slots;e uuid;begin perform assert_team_event_open(team_id_input);select event_id into e from teams where id=team_id_input;
 if not is_event_organizer(e) then raise exception 'Organizer permission required';end if;
 select * into s from presentation_slots where team_id=team_id_input for update;
 if s.id is null or not ((s.status='scheduled' and state_input in ('ready','missed')) or (s.status='ready' and state_input in ('presenting','missed')) or (s.status='presenting' and state_input='complete') or (s.status='missed' and state_input='ready')) then raise exception 'Invalid presentation state transition';end if;
 if state_input='presenting' and exists(select 1 from presentation_slots p join teams t on t.id=p.team_id where t.event_id=e and p.id<>s.id and lower(trim(p.room))=lower(trim(s.room)) and p.status='presenting') then raise exception 'This room already has an active presentation';end if;
 update presentation_slots set status=state_input,checked_in_at=case when state_input='ready' then coalesce(checked_in_at,now()) else checked_in_at end where id=s.id;
 insert into audit_logs(event_id,actor_id,action,details) values(e,auth.uid(),'presentation.state_changed',jsonb_build_object('slotId',s.id,'from',s.status,'to',state_input));end $$;
revoke all on function public.configure_presentation(uuid,timestamptz,text,integer,boolean),public.set_presentation_state(uuid,text) from public,anon;
grant execute on function public.configure_presentation(uuid,timestamptz,text,integer,boolean),public.set_presentation_state(uuid,text) to authenticated;
