-- Migration 111: self-service avatar upload. E: "the Avatar has to be in
-- the individual users info page" -- migration 109 only let an admin
-- upload someone else's avatar from Team Roster; a real "my profile"
-- page needs the signed-in user to be able to upload their own.
--
-- team_members already has a self-service UPDATE policy (migration 035,
-- "users update their own team_members row" -- matched by JWT email) so
-- the avatar_url column write is already covered. The only gap is the
-- storage bucket itself: migration 109's write/update policies are
-- admin-only. Widen them the same way 035 widened team_members --
-- additive, Postgres ORs multiple permissive policies together, so
-- admins keep the ability to upload for anyone (Team Roster keeps
-- working exactly as before) while a user gains the narrow ability to
-- write only to the folder matching their own team_members row
-- (buildAvatarStoragePath's storage path is `<team_member_id>/...`).

drop policy if exists "admins write avatars" on storage.objects;
create policy "admins write avatars"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and is_app_admin(auth.uid()));

create policy "users write their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.team_members tm
      where tm.id::text = split_part(storage.objects.name, '/', 1)
        and lower(tm.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "admins update avatars" on storage.objects;
create policy "admins update avatars"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and is_app_admin(auth.uid()))
  with check (bucket_id = 'avatars' and is_app_admin(auth.uid()));

create policy "users update their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.team_members tm
      where tm.id::text = split_part(storage.objects.name, '/', 1)
        and lower(tm.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
  with check (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.team_members tm
      where tm.id::text = split_part(storage.objects.name, '/', 1)
        and lower(tm.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );
