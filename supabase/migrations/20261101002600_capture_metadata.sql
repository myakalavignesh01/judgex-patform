update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'audio/mp4') where id='judgex-evidence' and not 'audio/mp4'=any(allowed_mime_types);
alter table public.artifacts add column capture_session uuid;
alter table public.artifacts add column capture_source text check(capture_source in ('camera','screen','audio'));
alter table public.artifacts add column captured_at timestamptz;
alter table public.artifacts add column capture_duration_seconds numeric check(capture_duration_seconds between 0 and 900);
create index capture_session_lookup on public.artifacts(team_id,capture_session) where capture_session is not null;
create function public.record_capture_consent(team_id_input uuid,policy_version_input text) returns void language plpgsql security definer set search_path=public as $$
declare e events;begin perform assert_team_event_open(team_id_input);select ev.* into e from events ev join teams t on t.event_id=ev.id where t.id=team_id_input;
 if not is_team_member(team_id_input) or policy_version_input is distinct from e.recording_policy_version then raise exception 'Recording policy changed or team membership is missing. Refresh before consenting';end if;
 perform record_consent(team_id_input,true);insert into audit_logs(event_id,actor_id,action,details) values(e.id,auth.uid(),'capture.consent_accepted',jsonb_build_object('policyVersion',policy_version_input));end $$;
create function public.link_capture(artifact_id_input uuid,session_input uuid,source_input text,started_at_input timestamptz,duration_input numeric) returns void language plpgsql security definer set search_path=public as $$
declare a artifacts;begin perform require_verified_user();select * into a from artifacts where id=artifact_id_input;
 if a.id is null or a.created_by<>auth.uid() or not is_team_member(a.team_id) then raise exception 'Uploader permission required';end if;
 perform assert_team_event_open(a.team_id);perform 1 from projects where team_id=a.team_id for update;select * into a from artifacts where id=artifact_id_input for update;
 if a.submission_id is not null or a.scan_state<>'pending' or a.kind<>'recording' or session_input is null or source_input is null or source_input not in ('camera','screen','audio') or started_at_input is null or duration_input is null or duration_input<0 or duration_input>900 then raise exception 'Invalid recording metadata or locked evidence';end if;
 if (source_input='audio' and a.mime_type not like 'audio/%') or (source_input in ('camera','screen') and a.mime_type not like 'video/%') then raise exception 'Capture source does not match the recording type';end if;
 update artifacts set capture_session=session_input,capture_source=source_input,captured_at=started_at_input,capture_duration_seconds=duration_input where id=a.id;
 insert into audit_logs(event_id,actor_id,action,details) select t.event_id,auth.uid(),'capture.linked',jsonb_build_object('artifactId',a.id,'reportedSessionId',session_input,'reportedSource',source_input) from teams t where t.id=a.team_id;
end $$;
revoke all on function public.record_capture_consent(uuid,text),public.link_capture(uuid,uuid,text,timestamptz,numeric) from public,anon;
grant execute on function public.record_capture_consent(uuid,text),public.link_capture(uuid,uuid,text,timestamptz,numeric) to authenticated;
