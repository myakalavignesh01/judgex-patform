alter table public.events add column registration_starts_at timestamptz;
alter table public.events add column eligibility text not null default '';
alter table public.events add column event_mode text not null default 'online' check(event_mode in ('online','in_person','hybrid'));
alter table public.events add constraint valid_registration_window check(registration_starts_at is null or registration_ends_at is null or registration_starts_at<registration_ends_at);
alter table public.events add constraint valid_event_deadlines check(submission_ends_at is null or appeals_ends_at is null or submission_ends_at<appeals_ends_at);
create or replace function public.configure_event(event_id_input uuid,settings_input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare e events;v events;begin perform require_verified_user();select * into e from events where id=event_id_input for update;
 if not is_event_organizer(e.id) or e.status in ('released','archived') then raise exception 'Organizer permission required for an open event';end if;
 select * into v from jsonb_populate_record(e,settings_input);
 if not exists(select 1 from pg_timezone_names where name=v.timezone) or length(trim(v.name)) not between 2 and 120 or length(v.description)>10000 or length(v.eligibility)>10000 then raise exception 'Check event name, timezone and description lengths';end if;
 if v.team_limit<(select count(*) from teams where event_id=e.id) or v.team_size<(select coalesce(max(n),0) from (select count(*) n from team_memberships where event_id=e.id group by team_id) m) then raise exception 'Limits cannot exclude existing teams or members';end if;
 update events set name=v.name,description=v.description,timezone=v.timezone,location=left(v.location,500),starts_at=v.starts_at,registration_starts_at=v.registration_starts_at,registration_ends_at=v.registration_ends_at,submission_ends_at=v.submission_ends_at,appeals_ends_at=v.appeals_ends_at,team_limit=v.team_limit,team_size=v.team_size,eligibility=v.eligibility,event_mode=v.event_mode,retention_days=v.retention_days,recording_policy=v.recording_policy,recording_policy_version=case when e.recording_policy is distinct from v.recording_policy then (e.recording_policy_version::integer+1)::text else e.recording_policy_version end where id=e.id;
 insert into audit_logs(event_id,actor_id,action) values(e.id,auth.uid(),'event.configured');end $$;
alter function public.join_event(uuid) rename to join_event_core;
revoke all on function public.join_event_core(uuid) from public,anon,authenticated;
create function public.join_event(code uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare e events;begin select * into e from events where join_code=code for update;
 if e.registration_starts_at is not null and now()<e.registration_starts_at then raise exception 'Registration has not opened yet';end if;
 return join_event_core(code);end $$;
alter function public.create_team(uuid,text) rename to create_team_core;
revoke all on function public.create_team_core(uuid,text) from public,anon,authenticated;
create function public.create_team(event_id_input uuid,team_name text) returns uuid language plpgsql security definer set search_path=public as $$
declare e events;begin perform require_verified_user();select * into e from events where id=event_id_input for update;
 if (e.registration_starts_at is not null and now()<e.registration_starts_at) or (e.registration_ends_at is not null and now()>e.registration_ends_at) then raise exception 'Registration window is closed';end if;
 if not exists(select 1 from event_memberships where event_id=e.id and user_id=auth.uid() and role='participant') then raise exception 'Participant membership required to create a team';end if;
 return create_team_core(event_id_input,team_name);end $$;
alter table public.projects add column details jsonb not null default '{}';
create function public.save_project_details(team_id_input uuid,title_input text,abstract_input text,repository_input text,architecture_input text,details_input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare k text;begin
 if jsonb_typeof(details_input)<>'object' or octet_length(details_input::text)>50000 then raise exception 'Project details are too large';end if;
 for k in select jsonb_object_keys(details_input) loop
  if k not in ('problem','solution','tech_stack','impact','demo_url','declarations') or jsonb_typeof(details_input->k)<>'string' or length(details_input->>k)>10000 then raise exception 'Invalid project detail';end if;
 end loop;
 if coalesce(details_input->>'demo_url','')<>'' and (details_input->>'demo_url') !~ '^https://[^[:space:]]+$' then raise exception 'Demo links must use HTTPS';end if;
 perform save_project(team_id_input,title_input,abstract_input,repository_input,architecture_input);
 update projects set details=details_input where team_id=team_id_input;end $$;
create function public.index_project_details() returns trigger language plpgsql set search_path=public as $$
declare k text;begin for k in select jsonb_object_keys(coalesce(new.content->'details','{}')) loop
 if k in ('problem','solution','tech_stack','impact','declarations') and length(trim(new.content->'details'->>k))>0 then insert into evidence_items(submission_id,source,content) values(new.id,'project.'||k,new.content->'details'->>k);end if;
 end loop;return new;end $$;
create trigger project_detail_evidence after insert on public.submission_versions for each row execute function public.index_project_details();
alter table public.approved_scorecards add column assessment_run_id uuid references public.assessment_runs;
alter table public.score_changes add column assessment_run_id uuid references public.assessment_runs;
alter function public.approve_scorecard(uuid,jsonb,text,text) rename to approve_scorecard_core;
revoke all on function public.approve_scorecard_core(uuid,jsonb,text,text) from public,anon,authenticated;
create function public.approve_scorecard(submission_id_input uuid,scores_input jsonb,feedback_input text,reason_input text default '') returns uuid language plpgsql security definer set search_path=public as $$
declare r assessment_runs;f jsonb;id_result uuid;e uuid;begin perform require_verified_user();
 select t.event_id into e from submission_versions s join projects p on p.id=s.project_id join teams t on t.id=p.team_id where s.id=submission_id_input;
 perform 1 from events where id=e for update;
 if not is_event_organizer(e) then raise exception 'Organizer permission required';end if;
 select * into r from assessment_runs where submission_id=submission_id_input and (output ? 'assessment' or output ? 'findings') order by created_at desc,id desc limit 1;
 if r.id is not null then
  for f in select * from jsonb_array_elements(coalesce(r.output->'assessment'->'findings',r.output->'findings','[]')) loop
   if (f->'score'='null'::jsonb or (f->>'score')::numeric is distinct from (scores_input->>(f->>'criterionId'))::numeric) and length(trim(reason_input))<10 then raise exception 'Explain differences from AI suggestions in at least 10 characters';end if;
  end loop;
 end if;
 id_result=approve_scorecard_core(submission_id_input,scores_input,feedback_input,reason_input);
 update approved_scorecards set assessment_run_id=r.id where id=id_result;
 return id_result;end $$;
create function public.link_score_change_assessment() returns trigger language plpgsql security definer set search_path=public as $$
begin select r.id into new.assessment_run_id from assessment_runs r join approved_scorecards c on c.submission_id=r.submission_id where c.id=new.scorecard_id and (r.output ? 'assessment' or r.output ? 'findings') order by r.created_at desc,r.id desc limit 1;return new;end $$;
create trigger link_score_change before insert on public.score_changes for each row execute function public.link_score_change_assessment();
create function public.decline_invitation(token_input text) returns void language plpgsql security definer set search_path=public,extensions as $$
declare i invitations;e uuid;begin perform require_verified_user();select * into i from invitations where token_hash=encode(digest(token_input,'sha256'),'hex') for update;
 if not found or i.status<>'pending' or i.expires_at<now() or lower(i.email)<>lower(auth.jwt()->>'email') then raise exception 'Invitation is invalid or addressed to another account';end if;
 update invitations set status='declined' where id=i.id;select event_id into e from teams where id=i.team_id;
 insert into audit_logs(event_id,actor_id,action,details) values(e,auth.uid(),'invitation.declined',jsonb_build_object('invitationId',i.id));end $$;
do $$ declare f text;begin foreach f in array array['join_event(uuid)','create_team(uuid,text)','save_project_details(uuid,text,text,text,text,jsonb)','approve_scorecard(uuid,jsonb,text,text)','decline_invitation(text)'] loop execute 'revoke all on function public.'||f||' from public,anon';execute 'grant execute on function public.'||f||' to authenticated';end loop;end $$;
