create table public.api_budgets(user_id uuid not null references auth.users on delete cascade,operation text not null,window_start timestamptz not null,hits integer not null,primary key(user_id,operation));
alter table public.api_budgets enable row level security;
revoke all on public.api_budgets from public,anon,authenticated;
create function public.consume_api_budget(user_id_input uuid,operation_input text) returns boolean language plpgsql security definer set search_path=public as $$
declare ceiling integer;n integer;begin
 ceiling=case operation_input when '/v1/assessments' then 6 when '/v1/invitations/send' then 6 when '/v1/artifacts/complete' then 12 else 0 end;
 if ceiling=0 then return false;end if;
 insert into api_budgets(user_id,operation,window_start,hits) values(user_id_input,operation_input,date_trunc('minute',now()),1)
 on conflict(user_id,operation) do update set window_start=excluded.window_start,hits=case when api_budgets.window_start=excluded.window_start then least(api_budgets.hits+1,10000) else 1 end returning hits into n;
 return n<=ceiling;
end $$;
revoke all on function public.consume_api_budget(uuid,text) from public,anon,authenticated;
grant execute on function public.consume_api_budget(uuid,text) to service_role;
