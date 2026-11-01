alter table public.events add column public_results boolean not null default false;
alter table public.problem_statements add column parent_id uuid references public.problem_statements;
create function public.save_problem(event_id_input uuid,title_input text,body_input text,deliverables_input text default '',previous_id_input uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare e events;previous problem_statements;result_id uuid;begin perform require_verified_user();select * into e from events where id=event_id_input for update;
 if not is_event_organizer(e.id) or e.status in ('released','archived') then raise exception 'Organizer permission required for an open event';end if;
 if length(trim(title_input))<2 or length(trim(body_input))<20 then raise exception 'Add a title and a complete problem description';end if;
 if previous_id_input is not null then select * into previous from problem_statements where id=previous_id_input;if not found or previous.event_id<>e.id then raise exception 'Invalid prior problem version';end if;end if;
 insert into problem_statements(event_id,title,body,deliverables,version,parent_id) values(e.id,left(title_input,200),left(body_input,30000),left(deliverables_input,10000),coalesce(previous.version,0)+1,previous_id_input) returning id into result_id;
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,auth.uid(),'problem.versioned',jsonb_build_object('problemId',result_id));return result_id;end $$;
create function public.set_public_results(event_id_input uuid,enabled_input boolean) returns void language plpgsql security definer set search_path=public as $$
begin perform require_verified_user();if not is_event_organizer(event_id_input) then raise exception 'Organizer permission required';end if;update events set public_results=enabled_input where id=event_id_input;
 insert into audit_logs(event_id,actor_id,action,details) values(event_id_input,auth.uid(),'results.visibility_changed',jsonb_build_object('public',enabled_input));end $$;
create function public.public_leaderboard(event_id_input uuid) returns table(event_name text,team_name text,project_title text,approved_score numeric,released_at timestamptz) language sql stable security definer set search_path=public as $$
 select e.name,t.name,p.title,a.weighted_total,e.released_at from events e join teams t on t.event_id=e.id join projects p on p.team_id=t.id join submission_versions s on s.project_id=p.id join approved_scorecards a on a.submission_id=s.id where e.id=event_id_input and e.status='released' and e.public_results order by a.weighted_total desc,t.name $$;
revoke all on function public.save_problem(uuid,text,text,text,uuid),public.set_public_results(uuid,boolean) from public,anon;
grant execute on function public.save_problem(uuid,text,text,text,uuid),public.set_public_results(uuid,boolean) to authenticated;
revoke all on function public.public_leaderboard(uuid) from public;
grant execute on function public.public_leaderboard(uuid) to anon,authenticated;
