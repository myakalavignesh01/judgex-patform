create function public.assert_team_event_open(team_id_input uuid,registration_input boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare e events;begin perform require_verified_user();select ev.* into e from events ev join teams t on t.event_id=ev.id where t.id=team_id_input for update of ev;
 if e.id is null or e.status in ('released','archived') then raise exception 'This event is closed for changes';end if;
 if registration_input and (e.status<>'published' or (e.registration_starts_at is not null and now()<e.registration_starts_at) or (e.registration_ends_at is not null and now()>e.registration_ends_at)) then raise exception 'Registration window is closed';end if;
end $$;
revoke all on function public.assert_team_event_open(uuid,boolean) from public,anon,authenticated;
alter function public.create_artifact(uuid,text,text,bigint,text) rename to create_artifact_core;
alter function public.schedule_team(uuid,timestamptz,text) rename to schedule_team_core;
alter function public.check_in(uuid) rename to check_in_core;
alter function public.invite_member(uuid,text) rename to invite_member_core;
alter function public.accept_invitation(text) rename to accept_invitation_core;
alter function public.set_rubric(uuid,jsonb) rename to set_rubric_core;
revoke all on function public.create_artifact_core(uuid,text,text,bigint,text),public.schedule_team_core(uuid,timestamptz,text),public.check_in_core(uuid),public.invite_member_core(uuid,text),public.accept_invitation_core(text),public.set_rubric_core(uuid,jsonb) from public,anon,authenticated;
create function public.create_artifact(team_id_input uuid,name_input text,mime_input text,size_input bigint,kind_input text) returns jsonb language plpgsql security definer set search_path=public as $$
begin perform assert_team_event_open(team_id_input);if exists(select 1 from events e join teams t on t.event_id=e.id where t.id=team_id_input and e.submission_ends_at<now()) then raise exception 'Submission deadline has passed';end if;return create_artifact_core(team_id_input,name_input,mime_input,size_input,kind_input);end $$;
create function public.schedule_team(team_id_input uuid,starts_at_input timestamptz,room_input text) returns void language plpgsql security definer set search_path=public as $$
begin perform assert_team_event_open(team_id_input);perform schedule_team_core(team_id_input,starts_at_input,room_input);end $$;
create function public.check_in(team_id_input uuid) returns void language plpgsql security definer set search_path=public as $$
begin perform assert_team_event_open(team_id_input);perform check_in_core(team_id_input);end $$;
create function public.invite_member(team_id_input uuid,email_input text) returns text language plpgsql security definer set search_path=public as $$
begin perform assert_team_event_open(team_id_input,true);return invite_member_core(team_id_input,email_input);end $$;
create function public.accept_invitation(token_input text) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare t uuid;begin perform require_verified_user();select team_id into t from invitations where token_hash=encode(digest(token_input,'sha256'),'hex');perform assert_team_event_open(t,true);return accept_invitation_core(token_input);end $$;
create function public.set_rubric(event_id_input uuid,criteria_input jsonb) returns void language plpgsql security definer set search_path=public as $$
begin perform require_verified_user();perform 1 from events where id=event_id_input and status not in ('released','archived') for update;if not found then raise exception 'This event is closed for changes';end if;perform set_rubric_core(event_id_input,criteria_input);end $$;
do $$ declare f text;begin foreach f in array array['create_artifact(uuid,text,text,bigint,text)','schedule_team(uuid,timestamptz,text)','check_in(uuid)','invite_member(uuid,text)','accept_invitation(text)','set_rubric(uuid,jsonb)'] loop execute 'revoke all on function public.'||f||' from public,anon';execute 'grant execute on function public.'||f||' to authenticated';end loop;end $$;
