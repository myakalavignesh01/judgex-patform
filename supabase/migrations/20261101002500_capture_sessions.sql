create or replace function public.create_artifact_core(team_id_input uuid,name_input text,mime_input text,size_input bigint,kind_input text) returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=require_verified_user();a artifacts;p projects;begin
 if not is_team_member(team_id_input) then raise exception 'Team membership required';end if;
 select * into p from projects where team_id=team_id_input for update;
 if exists(select 1 from submission_versions where project_id=p.id) then raise exception 'Submission is locked';end if;
 if mime_input not in ('application/pdf','image/png','image/jpeg','image/webp','video/webm','video/mp4','audio/webm','audio/mpeg','audio/mp4') then raise exception 'Unsupported file type';end if;
 if (select coalesce(sum(size_bytes),0) from artifacts where team_id=team_id_input)+size_input>524288000 then raise exception 'Team storage quota exceeded';end if;
 if (kind_input='recording' or mime_input like 'video/%' or mime_input like 'audio/%') and not exists(select 1 from consents where team_id=team_id_input and user_id=u and accepted and policy_version=(select e.recording_policy_version from events e join teams t on t.event_id=e.id where t.id=team_id_input)) then raise exception 'Recording consent required';end if;
 insert into artifacts(team_id,object_key,mime_type,size_bytes,kind,created_by) values(team_id_input,team_id_input||'/'||gen_random_uuid()||'/'||regexp_replace(left(name_input,100),'[^a-zA-Z0-9._-]','_','g'),mime_input,size_input,kind_input,u) returning * into a;return to_jsonb(a);end $$;

