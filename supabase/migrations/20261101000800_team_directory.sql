create function public.team_directory(team_id_input uuid) returns table(user_id uuid,email text,display_name text,joined_at timestamptz) language plpgsql stable security definer set search_path=public as $$
begin if not can_read_team(team_id_input) then raise exception 'Team authorization required';end if;
 return query select u.id,u.email::text,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),split_part(u.email,'@',1))::text,m.accepted_at from team_memberships m join auth.users u on u.id=m.user_id where m.team_id=team_id_input order by m.accepted_at;end $$;
revoke all on function public.team_directory(uuid) from public,anon;
grant execute on function public.team_directory(uuid) to authenticated;
create function public.remove_pending_artifact(artifact_id_input uuid) returns void language plpgsql security definer set search_path=public as $$
declare a artifacts;begin perform require_verified_user();select * into a from artifacts where id=artifact_id_input for update;
 if a.created_by<>auth.uid() or not is_team_member(a.team_id) or a.submission_id is not null then raise exception 'Only your own unlocked evidence can be removed';end if;
 if exists(select 1 from storage.objects where bucket_id='judgex-evidence' and name=a.object_key) then raise exception 'Delete the private object before its metadata';end if;
 delete from artifacts where id=a.id;end $$;
revoke all on function public.remove_pending_artifact(uuid) from public,anon;
grant execute on function public.remove_pending_artifact(uuid) to authenticated;
create policy evidence_object_delete on storage.objects for delete to authenticated using(bucket_id='judgex-evidence' and exists(select 1 from public.artifacts a where a.object_key=name and a.created_by=auth.uid() and a.submission_id is null and public.is_team_member(a.team_id)));
