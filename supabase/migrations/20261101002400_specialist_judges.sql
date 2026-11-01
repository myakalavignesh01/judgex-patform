alter table public.assessment_runs drop constraint assessment_runs_stage_check;
alter table public.assessment_runs add constraint assessment_runs_stage_check check(stage in ('technical','innovation','ux','product','impact','assessment','consistency','feedback'));
create or replace function public.checkpoint_assessment(job_id_input uuid,lease_token_input uuid,stage_input text,status_input text,model_input text,output_input jsonb default null,error_input text default null) returns public.assessment_runs language plpgsql security definer set search_path=public as $$
declare j jobs;s submission_versions;r assessment_runs;begin
 select * into j from jobs where id=job_id_input for update;
 if not found or lease_token_input is null or j.kind<>'assess' or j.status<>'running' or j.lease_token is distinct from lease_token_input or j.lease_until is null or j.lease_until<=now() then raise exception 'Active assessment worker lease required';end if;
 if exists(select 1 from events where id=j.event_id and status in ('released','archived')) then raise exception 'Assessment is closed for this event';end if;
 select v.* into s from submission_versions v join projects p on p.id=v.project_id join teams t on t.id=p.team_id where v.id=(j.payload->>'submissionId')::uuid and t.event_id=j.event_id and t.id=j.team_id;
 if s.id is null or stage_input not in ('technical','innovation','ux','product','impact','assessment','consistency','feedback') or status_input not in ('running','complete','failed') or length(model_input) not between 1 and 200 then raise exception 'Invalid assessment checkpoint';end if;
 insert into assessment_runs(submission_id,rubric_id,job_id,provider,model,prompt_version,status,stage,output) values(s.id,s.rubric_id,j.id,'gemini',model_input,'judgex-specialists-v3','running','assessment','{}') on conflict(job_id) do nothing;
 select * into r from assessment_runs where job_id=j.id for update;
 if r.model is distinct from model_input then raise exception 'Restore the original model configuration before resuming this assessment';end if;
 if stage_input='consistency' and not r.output ? 'assessment' or stage_input='feedback' and not r.output ? 'consistency' then raise exception 'Complete the preceding review stage first';end if;
 if stage_input='assessment' and status_input='complete' and r.prompt_version='judgex-specialists-v3' and not (r.output ?& array['technical','innovation','ux','product','impact']) then raise exception 'Complete specialist reviews before combining scores';end if;
 if r.output ? stage_input then return r;end if;
 if status_input='complete' and (output_input is null or jsonb_typeof(output_input)<>'object' or octet_length(output_input::text)>250000) then raise exception 'Invalid review output';end if;
 update assessment_runs set stage=stage_input,status=case when status_input='failed' then 'failed' when stage_input='feedback' and status_input='complete' then 'manual_review' else 'running' end,error=case when status_input='failed' then left(error_input,1000) else null end,output=case when status_input='complete' then coalesce(output,'{}')||jsonb_build_object(stage_input,output_input) else output end where id=r.id returning * into r;
 return r;
end $$;
revoke all on function public.checkpoint_assessment(uuid,uuid,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.checkpoint_assessment(uuid,uuid,text,text,text,jsonb,text) to service_role;

create or replace function public.set_rubric(event_id_input uuid,criteria_input jsonb) returns void language plpgsql security definer set search_path=public as $$
declare c jsonb;k text;priorities integer[]:='{}';p integer;begin perform require_verified_user();perform 1 from events where id=event_id_input and status not in ('released','archived') for update;if not found or not is_event_organizer(event_id_input) then raise exception 'Organizer permission required for an open event';end if;
 if octet_length(criteria_input::text)>100000 then raise exception 'Rubric guidance exceeds the size limit';end if;
 for c in select * from jsonb_array_elements(criteria_input) loop
  if c ? 'judge_domains' then
   if jsonb_typeof(c->'judge_domains')<>'array' then raise exception 'Specialist assignments must be an array';end if;
   if jsonb_array_length(c->'judge_domains') not between 1 and 5 or exists(select 1 from jsonb_array_elements_text(c->'judge_domains') d where d not in ('technical','innovation','ux','product','impact')) or (select count(distinct d) from jsonb_array_elements_text(c->'judge_domains') d)<>jsonb_array_length(c->'judge_domains') then raise exception 'Choose 1–5 unique specialist reviewers';end if;
  end if;
  foreach k in array array['description','anchors','evidence_requirements'] loop if c ? k and (jsonb_typeof(c->k)<>'string' or length(c->>k)>4000) then raise exception 'Rubric guidance must be text of at most 4000 characters';end if;end loop;
  if c ? 'tie_break_priority' and c->'tie_break_priority'<>'null'::jsonb then
   if jsonb_typeof(c->'tie_break_priority')<>'number' or (c->>'tie_break_priority')::numeric<>trunc((c->>'tie_break_priority')::numeric) then raise exception 'Tie-break priorities must be integers';end if;
   p=(c->>'tie_break_priority')::integer;if p not between 1 and 20 or p=any(priorities) then raise exception 'Use unique tie-break priorities from 1 to 20';end if;priorities=array_append(priorities,p);
  end if;
 end loop;perform set_rubric_core(event_id_input,criteria_input);end $$;

