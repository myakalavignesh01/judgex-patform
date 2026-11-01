alter table public.evidence_items add column extraction_key text unique;
create unique index evidence_source_unique on public.evidence_items(submission_id,source) where artifact_id is null;
