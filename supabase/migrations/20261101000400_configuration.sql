create function public.configure_event(event_id_input uuid,settings_input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare e events;tz text:=settings_input->>'timezone';begin perform require_verified_user();select * into e from events where id=event_id_input for update;
 if not is_event_organizer(e.id) or e.status in ('released','archived') then raise exception 'Organizer permission required for an open event';end if;
 if not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'Invalid timezone';end if;
 if (settings_input->>'team_limit')::integer<(select count(*) from teams where event_id=e.id) then raise exception 'Team limit cannot exclude registered teams';end if;
 update events set timezone=tz,location=left(coalesce(settings_input->>'location',''),500),submission_ends_at=(settings_input->>'submission_ends_at')::timestamptz,appeals_ends_at=(settings_input->>'appeals_ends_at')::timestamptz,team_limit=(settings_input->>'team_limit')::integer,retention_days=(settings_input->>'retention_days')::integer,recording_policy=coalesce(settings_input->>'recording_policy',recording_policy),recording_policy_version=case when recording_policy is distinct from settings_input->>'recording_policy' then (recording_policy_version::integer+1)::text else recording_policy_version end where id=e.id;
 insert into audit_logs(event_id,actor_id,action) values(e.id,auth.uid(),'event.configured');end $$;
create function public.set_rubric(event_id_input uuid,criteria_input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare r rubric_versions;w numeric;begin perform require_verified_user();perform 1 from events where id=event_id_input for update;
 if not is_event_organizer(event_id_input) then raise exception 'Organizer permission required';end if;
 select * into r from rubric_versions where event_id=event_id_input order by version desc limit 1 for update;
 if r.frozen_at is not null then raise exception 'Rubric is frozen';end if;
 if jsonb_typeof(criteria_input)<>'array' or jsonb_array_length(criteria_input)=0 or jsonb_array_length(criteria_input)>20 then raise exception 'Use 1–20 criteria';end if;
 if exists(select 1 from jsonb_array_elements(criteria_input) c where length(trim(c->>'id'))=0 or length(trim(c->>'name'))=0 or (c->>'weight')::numeric<=0) then raise exception 'Invalid criterion';end if;
 select sum((c->>'weight')::numeric) into w from jsonb_array_elements(criteria_input) c;
 if w<>100 or (select count(distinct c->>'id') from jsonb_array_elements(criteria_input) c)<>jsonb_array_length(criteria_input) then raise exception 'Weights must total 100 with unique criteria';end if;
 update rubric_versions set criteria=criteria_input where id=r.id;insert into audit_logs(event_id,actor_id,action) values(event_id_input,auth.uid(),'rubric.updated');end $$;
create function public.invite_member(team_id_input uuid,email_input text) returns text language plpgsql security definer set search_path=public as $$
declare u uuid:=require_verified_user();t teams;token text:=encode(gen_random_bytes(32),'hex');begin select * into t from teams where id=team_id_input;
 if t.captain_id<>u or not is_team_member(t.id) then raise exception 'Only the verified captain can invite members';end if;
 if email_input !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Invalid email';end if;
 insert into invitations(team_id,email,token_hash) values(t.id,lower(trim(email_input)),encode(digest(token,'sha256'),'hex'));
 insert into audit_logs(event_id,actor_id,action,details) values(t.event_id,u,'team.invited',jsonb_build_object('teamId',t.id));return token;end $$;
create function public.accept_invitation(token_input text) returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid:=require_verified_user();i invitations;t teams;e events;begin
 select * into i from invitations where token_hash=encode(digest(token_input,'sha256'),'hex') for update;
 if not found or i.status<>'pending' or i.expires_at<now() or lower(i.email)<>lower(auth.jwt()->>'email') then raise exception 'Invitation is invalid, expired or addressed to another account';end if;
 select * into t from teams where id=i.team_id for update;select * into e from events where id=t.event_id;
 if e.status<>'published' or (select count(*) from team_memberships where team_id=t.id)>=e.team_size then raise exception 'This team cannot accept new members';end if;
 insert into event_memberships values(e.id,u,'participant') on conflict do nothing;insert into team_memberships(team_id,event_id,user_id) values(t.id,e.id,u);
 update invitations set status='accepted' where id=i.id;insert into audit_logs(event_id,actor_id,action,details) values(e.id,u,'invitation.accepted',jsonb_build_object('invitationId',i.id));return e.id;end $$;
create function public.retry_job(job_id_input uuid) returns void language plpgsql security definer set search_path=public as $$
declare j jobs;begin perform require_verified_user();select * into j from jobs where id=job_id_input for update;
 if not is_event_organizer(j.event_id) or j.status not in ('dead','retry') then raise exception 'This job cannot be retried';end if;
 update jobs set status='queued',attempts=0,available_at=now(),lease_until=null where id=j.id;insert into audit_logs(event_id,actor_id,action,details) values(j.event_id,auth.uid(),'job.retried',jsonb_build_object('jobId',j.id));end $$;
create function public.resolve_appeal(appeal_id_input uuid,resolution_input text,status_input text) returns void language plpgsql security definer set search_path=public as $$
declare e uuid;begin perform require_verified_user();select t.event_id into e from appeals a join approved_scorecards sc on sc.id=a.scorecard_id join submission_versions s on s.id=sc.submission_id join projects p on p.id=s.project_id join teams t on t.id=p.team_id where a.id=appeal_id_input;
 if not is_event_organizer(e) or status_input not in ('reviewing','resolved','declined') or length(trim(resolution_input))<10 then raise exception 'Organizer permission and a clear resolution are required';end if;
 update appeals set status=status_input,resolution=resolution_input where id=appeal_id_input;insert into audit_logs(event_id,actor_id,action,details) values(e,auth.uid(),'appeal.resolved',jsonb_build_object('appealId',appeal_id_input,'status',status_input));end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('configure_event','set_rubric','invite_member','accept_invitation','retry_job','resolve_appeal') loop execute format('revoke all on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
