create schema if not exists extensions;
create extension if not exists vector with schema extensions;
alter table evidence_items add constraint evidence_submission_pair unique(id,submission_id);
create table public.evidence_chunks(id uuid primary key default gen_random_uuid(),evidence_id uuid not null,submission_id uuid not null,ordinal integer not null check(ordinal>=0),body text not null check(length(body)<=5000),embedding extensions.vector(768),embedding_model text,search_document tsvector generated always as(to_tsvector('simple',body)) stored,foreign key(evidence_id,submission_id) references public.evidence_items(id,submission_id),unique(evidence_id,ordinal));
alter table public.evidence_chunks enable row level security;
revoke all on public.evidence_chunks from anon,authenticated;
grant select on public.evidence_chunks to authenticated;
grant all on public.evidence_chunks to service_role;
create policy chunk_read on public.evidence_chunks for select to authenticated using(public.can_read_submission(submission_id));
create index chunk_submission on public.evidence_chunks(submission_id);
create index chunk_keywords on public.evidence_chunks using gin(search_document);
create index chunk_vectors on public.evidence_chunks using hnsw(embedding extensions.vector_cosine_ops);
create function public.retrieve_evidence(submission_id_input uuid,query_text text,embedding_input text default null,limit_input integer default 8)
returns table(chunk_id uuid,evidence_id uuid,body text,source text,page integer,timestamp_seconds numeric,rank double precision)
language plpgsql stable security definer set search_path=public,extensions as $$
declare q extensions.vector(768);begin
 if coalesce(auth.role(),'')<>'service_role' and not can_read_submission(submission_id_input) then raise exception 'Submission authorization required before retrieval';end if;
 if embedding_input is not null then q=embedding_input::extensions.vector(768);end if;
 return query select c.id,c.evidence_id,c.body,e.source,e.page,e.timestamp_seconds,
 (coalesce(ts_rank_cd(c.search_document,plainto_tsquery('simple',left(query_text,2000))),0)::double precision+case when q is null or c.embedding is null then 0 else 1-(c.embedding<=>q) end)::double precision as score
 from evidence_chunks c join evidence_items e on e.id=c.evidence_id where c.submission_id=submission_id_input
 order by score desc,c.ordinal asc,c.id limit greatest(1,least(limit_input,20));
end $$;
revoke all on function public.retrieve_evidence(uuid,text,text,integer) from public,anon;
grant execute on function public.retrieve_evidence(uuid,text,text,integer) to authenticated,service_role;
create table public.webhook_receipts(id text primary key,event_type text not null,processed_at timestamptz not null default now());
alter table public.webhook_receipts enable row level security;
revoke all on public.webhook_receipts from anon,authenticated;
grant all on public.webhook_receipts to service_role;
create function public.record_email_delivery(webhook_id_input text,type_input text,provider_id_input text) returns boolean language plpgsql security definer set search_path=public as $$
declare next_status text;begin
 if exists(select 1 from webhook_receipts where id=webhook_id_input) then return false;end if;
 next_status=case type_input when 'email.delivered' then 'delivered' when 'email.bounced' then 'bounced' when 'email.failed' then 'failed' when 'email.sent' then 'sent' else null end;
 insert into webhook_receipts(id,event_type) values(webhook_id_input,type_input) on conflict do nothing;
 if not found then return false;end if;
 if next_status is not null then update notifications set status=next_status where provider_id=provider_id_input and (status in ('queued','sent') or next_status in ('bounced','failed'));end if;return true;
end $$;
revoke all on function public.record_email_delivery(text,text,text) from public,anon,authenticated;
grant execute on function public.record_email_delivery(text,text,text) to service_role;
