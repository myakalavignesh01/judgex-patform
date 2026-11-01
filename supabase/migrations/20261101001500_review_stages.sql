alter table public.assessment_runs add column job_id uuid unique references public.jobs;
alter table public.assessment_runs add column stage text check(stage in ('assessment','consistency','feedback'));
create function public.checkpoint_assessment(job_id_input uuid,lease_token_input uuid,stage_input text,status_input text,model_input text,output_input jsonb default null,error_input text default null) returns public.assessment_runs language plpgsql security definer set search_path=public as $$
declare j jobs;s submission_versions;r assessment_runs;begin
 select * into j from jobs where id=job_id_input for update;
 if not found or lease_token_input is null or j.kind<>'assess' or j.status<>'running' or j.lease_token is distinct from lease_token_input or j.lease_until is null or j.lease_until<=now() then raise exception 'Active assessment worker lease required';end if;
 if exists(select 1 from events where id=j.event_id and status in ('released','archived')) then raise exception 'Assessment is closed for this event';end if;
 select v.* into s from submission_versions v join projects p on p.id=v.project_id join teams t on t.id=p.team_id where v.id=(j.payload->>'submissionId')::uuid and t.event_id=j.event_id and t.id=j.team_id;
 if s.id is null or stage_input not in ('assessment','consistency','feedback') or status_input not in ('running','complete','failed') or length(model_input) not between 1 and 200 then raise exception 'Invalid assessment checkpoint';end if;
 insert into assessment_runs(submission_id,rubric_id,job_id,provider,model,prompt_version,status,stage,output) values(s.id,s.rubric_id,j.id,'gemini',model_input,'judgex-review-v2','running','assessment','{}') on conflict(job_id) do nothing;
 select * into r from assessment_runs where job_id=j.id for update;
 if stage_input='consistency' and not r.output ? 'assessment' or stage_input='feedback' and not r.output ? 'consistency' then raise exception 'Complete the preceding review stage first';end if;
 if r.output ? stage_input then return r;end if;
 if status_input='complete' and (output_input is null or jsonb_typeof(output_input)<>'object' or octet_length(output_input::text)>250000) then raise exception 'Invalid review output';end if;
 update assessment_runs set stage=stage_input,status=case when status_input='failed' then 'failed' when stage_input='feedback' and status_input='complete' then 'manual_review' else 'running' end,error=case when status_input='failed' then left(error_input,1000) else null end,output=case when status_input='complete' then coalesce(output,'{}')||jsonb_build_object(stage_input,output_input) else output end where id=r.id returning * into r;
 return r;
end $$;
revoke all on function public.checkpoint_assessment(uuid,uuid,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.checkpoint_assessment(uuid,uuid,text,text,text,jsonb,text) to service_role;
