insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('judgex-evidence','judgex-evidence',false,104857600,array['application/pdf','image/png','image/jpeg','image/webp','video/webm','video/mp4','audio/webm','audio/mpeg']) on conflict(id) do nothing;
create policy evidence_object_read on storage.objects for select to authenticated using(bucket_id='judgex-evidence' and exists(select 1 from public.artifacts a where a.object_key=name and public.can_read_team(a.team_id)));
create policy evidence_object_insert on storage.objects for insert to authenticated with check(bucket_id='judgex-evidence' and exists(select 1 from public.artifacts a where a.object_key=name and a.created_by=auth.uid() and public.is_team_member(a.team_id) and a.submission_id is null));
create function public.create_artifact(team_id_input uuid,name_input text,mime_input text,size_input bigint,kind_input text) returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=require_verified_user();a artifacts;p projects;begin
 if not is_team_member(team_id_input) then raise exception 'Team membership required';end if;
 select * into p from projects where team_id=team_id_input for update;
 if exists(select 1 from submission_versions where project_id=p.id) then raise exception 'Submission is locked';end if;
 if mime_input not in ('application/pdf','image/png','image/jpeg','image/webp','video/webm','video/mp4','audio/webm','audio/mpeg') then raise exception 'Unsupported file type';end if;
 if (select coalesce(sum(size_bytes),0) from artifacts where team_id=team_id_input)+size_input>524288000 then raise exception 'Team storage quota exceeded';end if;
 if (kind_input='recording' or mime_input like 'video/%' or mime_input like 'audio/%') and not exists(select 1 from consents where team_id=team_id_input and user_id=u and accepted and policy_version=(select e.recording_policy_version from events e join teams t on t.event_id=e.id where t.id=team_id_input)) then raise exception 'Recording consent required';end if;
 insert into artifacts(team_id,object_key,mime_type,size_bytes,kind,created_by) values(team_id_input,team_id_input||'/'||gen_random_uuid()||'/'||regexp_replace(left(name_input,100),'[^a-zA-Z0-9._-]','_','g'),mime_input,size_input,kind_input,u) returning * into a;return to_jsonb(a);end $$;
create function public.record_consent(team_id_input uuid,accepted_input boolean) returns void language plpgsql security definer set search_path=public as $$
declare e events;begin perform require_verified_user();if not is_team_member(team_id_input) then raise exception 'Team membership required';end if;
 select ev.* into e from events ev join teams t on t.event_id=ev.id where t.id=team_id_input;
 insert into consents(team_id,user_id,policy_version,purpose,accepted) values(team_id_input,auth.uid(),e.recording_policy_version,e.recording_policy,accepted_input);end $$;
create function public.schedule_team(team_id_input uuid,starts_at_input timestamptz,room_input text) returns void language plpgsql security definer set search_path=public as $$
declare e uuid;begin perform require_verified_user();select event_id into e from teams where id=team_id_input;if not is_event_organizer(e) then raise exception 'Organizer permission required';end if;
 insert into presentation_slots(team_id,starts_at,room) values(team_id_input,starts_at_input,left(room_input,100)) on conflict(team_id) do update set starts_at=excluded.starts_at,room=excluded.room;
 insert into audit_logs(event_id,actor_id,action,details) values(e,auth.uid(),'presentation.scheduled',jsonb_build_object('teamId',team_id_input));end $$;
create function public.check_in(team_id_input uuid) returns void language plpgsql security definer set search_path=public as $$
begin perform require_verified_user();if not is_team_member(team_id_input) then raise exception 'Team membership required';end if;update presentation_slots set checked_in_at=now(),status='ready' where team_id=team_id_input and status='scheduled';end $$;
create function public.create_appeal(scorecard_id_input uuid,reason_input text,criterion_input text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare a approved_scorecards;e events;t uuid;result_id uuid;begin perform require_verified_user();select * into a from approved_scorecards where id=scorecard_id_input;
 select ev.* into e from events ev join teams t on t.event_id=ev.id join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id where s.id=a.submission_id;
 select p.team_id into t from projects p join submission_versions s on s.project_id=p.id where s.id=a.submission_id;
 if not is_team_member(t) or e.status<>'released' or e.appeals_ends_at is null or now()>e.appeals_ends_at then raise exception 'Appeal window is closed';end if;
 if length(trim(reason_input))<20 then raise exception 'Describe the issue in at least 20 characters';end if;
 insert into appeals(scorecard_id,user_id,criterion_id,reason) values(a.id,auth.uid(),criterion_input,reason_input) returning id into result_id;return result_id;end $$;
create function public.enqueue_assessment(submission_id_input uuid) returns void language plpgsql security definer set search_path=public as $$
declare e uuid;t uuid;begin perform require_verified_user();select teams.event_id,teams.id into e,t from teams join projects p on p.team_id=teams.id join submission_versions s on s.project_id=p.id where s.id=submission_id_input;
 if not is_event_organizer(e) or exists(select 1 from events where id=e and status in ('released','archived')) then raise exception 'Organizer permission required';end if;
 if exists(select 1 from jobs where team_id=t and kind in ('extract','repository') and status<>'complete') then raise exception 'Wait for evidence processing, or use manual review';end if;
 if (select count(*) from jobs where event_id=e and kind='assess')>=1000 then raise exception 'Assessment quota reached';end if;
 insert into jobs(event_id,team_id,kind,payload,idempotency_key) values(e,t,'assess',jsonb_build_object('submissionId',submission_id_input),'assess:'||submission_id_input) on conflict(idempotency_key) do nothing;end $$;
create function public.claim_job() returns setof public.jobs language sql security definer set search_path=public as $$
 update jobs set status='running',attempts=attempts+1,lease_until=now()+interval '5 minutes' where id=(select id from jobs where ((status in ('queued','retry') and available_at<=now()) or (status='running' and lease_until<now())) and attempts<5 order by available_at for update skip locked limit 1) returning * $$;
revoke all on function public.claim_job() from public,anon,authenticated;
grant execute on function public.claim_job() to service_role;
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_artifact','record_consent','schedule_team','check_in','create_appeal','enqueue_assessment') loop execute format('revoke all on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;end $$;
