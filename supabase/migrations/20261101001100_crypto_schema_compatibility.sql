-- Supabase commonly installs pgcrypto in extensions rather than public.
-- Keep resolution explicit for the three workflows using digest/random bytes.
alter function public.lock_submission(uuid) set search_path=public,extensions;
alter function public.invite_member(uuid,text) set search_path=public,extensions;
alter function public.accept_invitation(text) set search_path=public,extensions;
