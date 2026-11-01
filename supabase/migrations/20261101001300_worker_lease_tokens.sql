alter table public.jobs add column lease_token uuid;
create or replace function public.claim_job() returns setof public.jobs language plpgsql security definer set search_path=public as $$
begin
 update jobs set status='dead',last_error=coalesce(last_error,'Worker lease expired after final attempt'),lease_until=null,lease_token=null where status='running' and lease_until<now() and attempts>=5;
 return query update jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=(select id from jobs where ((status in ('queued','retry') and available_at<=now()) or (status='running' and lease_until<now())) and attempts<5 order by available_at for update skip locked limit 1) returning *;
end $$;
create function public.commit_media_segment(job_id_input uuid,lease_token_input uuid,artifact_id_input uuid,submission_id_input uuid,start_input numeric,end_input numeric,duration_input numeric,items_input jsonb) returns boolean language plpgsql security definer set search_path=public as $$
declare j jobs;a artifacts;p artifact_processing;i jsonb;ordinal integer:=0;item_timestamp numeric;item_page integer;begin
 select * into j from jobs where id=job_id_input for update;
 if j.id is null or lease_token_input is null or j.lease_token is distinct from lease_token_input or j.status<>'running' or j.lease_until<=now() or j.kind<>'extract' or (j.payload->>'submissionId') is distinct from submission_id_input::text then raise exception 'Active extraction lease required';end if;
 select * into a from artifacts where id=artifact_id_input;
 if a.submission_id is distinct from submission_id_input or a.team_id is distinct from j.team_id or a.scan_state<>'clean' then raise exception 'Invalid extraction artifact';end if;
 select * into p from artifact_processing where artifact_id=a.id for update;if not found then raise exception 'Processing checkpoint required';end if;
 if end_input<=p.next_offset_seconds then return false;end if;
 if start_input<>p.next_offset_seconds or end_input<=start_input or end_input>duration_input or duration_input>3600 then raise exception 'Invalid processing window';end if;
 if jsonb_typeof(items_input)<>'array' or jsonb_array_length(items_input)>300 then raise exception 'Invalid extraction output';end if;
 for i in select * from jsonb_array_elements(items_input) loop
  if jsonb_typeof(i->'text') is distinct from 'string' or length(i->>'text')>20000 then raise exception 'Invalid extracted text';end if;
  item_timestamp=(i->>'timestamp')::numeric;item_page=(i->>'page')::integer;
  if item_page is not null and item_page<1 then raise exception 'Invalid page';end if;
  if item_timestamp is not null and (item_timestamp<0 or (a.mime_type like 'video/%' and (item_timestamp<start_input or item_timestamp>end_input))) then raise exception 'Timestamp outside source window';end if;
  insert into evidence_items(extraction_key,submission_id,artifact_id,source,content,page,timestamp_seconds) values(a.id||':window:'||start_input||':'||ordinal,submission_id_input,a.id,a.object_key||case when a.mime_type like 'video/%' then '#'||start_input||'-'||end_input||'s' else '' end,i->>'text',item_page,item_timestamp) on conflict(extraction_key) do nothing;
  ordinal=ordinal+1;
 end loop;
 update artifact_processing set next_offset_seconds=end_input,duration_seconds=duration_input,state=case when end_input>=duration_input then 'complete' else 'extracting' end,updated_at=now() where artifact_id=a.id;
 update jobs set payload=payload||jsonb_build_object('stage','visual_extraction','processedSeconds',end_input,'totalSeconds',duration_input) where id=j.id;
 return true;
end $$;
revoke all on function public.commit_media_segment(uuid,uuid,uuid,uuid,numeric,numeric,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.commit_media_segment(uuid,uuid,uuid,uuid,numeric,numeric,numeric,jsonb) to service_role;
create function public.register_media_file(job_id_input uuid,lease_token_input uuid,artifact_id_input uuid,name_input text,uri_input text,expiration_input timestamptz default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare j jobs;a artifacts;result artifact_processing;begin
 select * into j from jobs where id=job_id_input for update;
 if j.id is null or lease_token_input is null or j.lease_token is distinct from lease_token_input or j.status<>'running' or j.lease_until<=now() or j.kind<>'extract' then raise exception 'Active extraction lease required';end if;
 select * into a from artifacts where id=artifact_id_input;
 if a.team_id is distinct from j.team_id or a.submission_id::text is distinct from j.payload->>'submissionId' or a.scan_state<>'clean' then raise exception 'Invalid extraction artifact';end if;
 if name_input !~ '^files/[A-Za-z0-9_-]+$' or uri_input not like 'https://generativelanguage.googleapis.com/v1beta/files/%' then raise exception 'Invalid provider media reference';end if;
 insert into artifact_processing(artifact_id,provider_file_name,provider_uri,provider_expiration,state) values(a.id,name_input,uri_input,expiration_input,'preparing')
 on conflict(artifact_id) do update set provider_file_name=excluded.provider_file_name,provider_uri=excluded.provider_uri,provider_expiration=excluded.provider_expiration,state=case when artifact_processing.state='complete' then 'complete' else 'preparing' end,updated_at=now() returning * into result;
 return to_jsonb(result);
end $$;
revoke all on function public.register_media_file(uuid,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.register_media_file(uuid,uuid,uuid,text,text,timestamptz) to service_role;
create or replace function public.retry_job(job_id_input uuid) returns void language plpgsql security definer set search_path=public as $$
declare j jobs;begin perform require_verified_user();select * into j from jobs where id=job_id_input for update;
 if not is_event_organizer(j.event_id) or j.status not in ('dead','retry') then raise exception 'This job cannot be retried';end if;
 update jobs set status='queued',attempts=0,available_at=now(),lease_until=null,lease_token=null where id=j.id;
 insert into audit_logs(event_id,actor_id,action,details) values(j.event_id,auth.uid(),'job.retried',jsonb_build_object('jobId',j.id));end $$;
