create table public.artifact_processing(
 artifact_id uuid primary key references public.artifacts,
 provider_file_name text,
 provider_uri text,
 provider_expiration timestamptz,
 state text not null default 'pending' check(state in ('pending','preparing','extracting','complete')),
 duration_seconds numeric,
 next_offset_seconds numeric not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.artifact_processing enable row level security;
revoke all on public.artifact_processing from anon,authenticated;
grant all on public.artifact_processing to service_role;
