create table public.defence_questions(id uuid primary key default gen_random_uuid(),team_id uuid not null references public.teams,question text not null,source_reference text not null default '',answer text,asked_by uuid not null references auth.users,answered_by uuid references auth.users,created_at timestamptz not null default now(),answered_at timestamptz);
alter table public.defence_questions enable row level security;
revoke all on public.defence_questions from public,anon,authenticated;
grant select on public.defence_questions to authenticated;
grant all on public.defence_questions to service_role;
create policy defence_read on public.defence_questions for select to authenticated using(can_read_team(team_id));
create function public.ask_defence_question(team_id_input uuid,question_input text,source_input text default '') returns void language plpgsql security definer set search_path=public as $$
declare e uuid;begin perform assert_team_event_open(team_id_input);select event_id into e from teams where id=team_id_input;
 if not is_event_organizer(e) then raise exception 'Organizer permission required';end if;
 if exists(select 1 from submission_versions s join projects p on p.id=s.project_id where p.team_id=team_id_input) then raise exception 'Questions close when the submission is locked';end if;
 if length(trim(question_input)) not between 10 and 2000 or length(source_input)>500 or (select count(*) from defence_questions where team_id=team_id_input)>=20 then raise exception 'Use a clear question (10–2000 characters); at most 20 per team';end if;
 insert into defence_questions(team_id,question,source_reference,asked_by) values(team_id_input,trim(question_input),source_input,auth.uid());
 insert into audit_logs(event_id,actor_id,action,details) values(e,auth.uid(),'defence.question_created',jsonb_build_object('teamId',team_id_input));end $$;
create function public.answer_defence_question(question_id_input uuid,answer_input text) returns void language plpgsql security definer set search_path=public as $$
declare q defence_questions;e events;begin perform require_verified_user();select * into q from defence_questions where id=question_id_input;
 if not is_team_member(q.team_id) then raise exception 'Team membership required';end if;
 perform assert_team_event_open(q.team_id);select ev.* into e from events ev join teams t on t.event_id=ev.id where t.id=q.team_id;
 if (e.submission_ends_at is not null and now()>e.submission_ends_at) or exists(select 1 from submission_versions s join projects p on p.id=s.project_id where p.team_id=q.team_id) then raise exception 'The submission is closed for answers';end if;
 if length(trim(answer_input)) not between 10 and 10000 then raise exception 'Answer in 10–10000 characters';end if;
 update defence_questions set answer=trim(answer_input),answered_by=auth.uid(),answered_at=now() where id=q.id;
 insert into audit_logs(event_id,actor_id,action,details) values(e.id,auth.uid(),'defence.answered',jsonb_build_object('questionId',q.id));end $$;
create function public.snapshot_defence_answers() returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare answers jsonb;begin select coalesce(jsonb_agg(jsonb_build_object('questionId',q.id,'question',q.question,'sourceReference',q.source_reference,'answer',q.answer,'answeredBy',q.answered_by,'answeredAt',q.answered_at) order by q.created_at,q.id),'[]') into answers from defence_questions q join projects p on p.team_id=q.team_id where p.id=new.project_id and q.answer is not null;
 new.content=new.content||jsonb_build_object('defenceAnswers',answers);new.checksum=encode(digest(new.content::text,'sha256'),'hex');return new;end $$;
create trigger snapshot_defence before insert on public.submission_versions for each row execute function public.snapshot_defence_answers();
create function public.index_defence_answers() returns trigger language plpgsql set search_path=public as $$
declare q jsonb;begin for q in select * from jsonb_array_elements(new.content->'defenceAnswers') loop insert into evidence_items(submission_id,source,content) values(new.id,'defence:'||(q->>'questionId'),'Question: '||(q->>'question')||E'\nTeam response: '||(q->>'answer'));end loop;return new;end $$;
create trigger index_defence after insert on public.submission_versions for each row execute function public.index_defence_answers();
revoke all on function public.ask_defence_question(uuid,text,text),public.answer_defence_question(uuid,text) from public,anon;
grant execute on function public.ask_defence_question(uuid,text,text),public.answer_defence_question(uuid,text) to authenticated;
