create function public.valid_rubric(value jsonb) returns boolean language plpgsql immutable set search_path=public as $$
declare c jsonb;total numeric:=0;ids text[]:='{}';begin
 if jsonb_typeof(value)<>'array' or jsonb_array_length(value) not between 1 and 20 then return false;end if;
 for c in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(c->'id') is distinct from 'string' or jsonb_typeof(c->'name') is distinct from 'string' or jsonb_typeof(c->'weight') is distinct from 'number' then return false;end if;
  if length(trim(c->>'id'))=0 or length(trim(c->>'name'))=0 or c->>'id'=any(ids) or (c->>'weight')::numeric<=0 or (c->>'weight')::numeric>100 then return false;end if;
  ids=array_append(ids,c->>'id');total=total+(c->>'weight')::numeric;
 end loop;return total=100;end $$;
alter table public.rubric_versions add constraint rubric_is_valid check(public.valid_rubric(criteria));
create function public.protect_submission_snapshot() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Locked submission snapshots are immutable';end $$;
create trigger immutable_submission before update or delete on public.submission_versions for each row execute function public.protect_submission_snapshot();
create function public.protect_frozen_rubric() returns trigger language plpgsql set search_path=public as $$
begin
 if old.frozen_at is not null then
  if tg_op='DELETE' then raise exception 'Frozen rubrics cannot be deleted';end if;
  if new.criteria is distinct from old.criteria or new.frozen_at is distinct from old.frozen_at then raise exception 'Frozen rubrics cannot be changed';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger immutable_rubric before update or delete on public.rubric_versions for each row execute function public.protect_frozen_rubric();
create function public.protect_released_scorecard() returns trigger language plpgsql security definer set search_path=public as $$
declare s uuid;released boolean;begin
 if tg_op='DELETE' then s=old.submission_id;else s=new.submission_id;end if;
 select exists(select 1 from submission_versions v join projects p on p.id=v.project_id join teams t on t.id=p.team_id join events e on e.id=t.event_id where v.id=s and e.status in ('released','archived')) into released;
 if released then raise exception 'Released scorecards require a separately versioned revision workflow';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger immutable_released_decision before insert or update or delete on public.approved_scorecards for each row execute function public.protect_released_scorecard();

