-- Migration 109: user avatars. E: "Add user images to the main setup
-- that will carry next to these messages."
--
-- team_members already holds roster fields an admin manages (role_title,
-- slack_user_id, migration 099) -- avatar_url follows the same pattern,
-- no new table needed. The bucket is public (unlike message-attachments,
-- migration 100, which is deliberately private/participant-scoped) --
-- an avatar isn't sensitive, and public means every message bubble can
-- just use the stored URL directly with no signed-URL round trip.
-- Uploads are still admin-only, matching who already edits the rest of
-- the roster in Admin > Team Roster.

alter table team_members add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "public read avatars" on storage.objects;
create policy "public read avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "admins write avatars" on storage.objects;
create policy "admins write avatars"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and is_app_admin(auth.uid()));

drop policy if exists "admins update avatars" on storage.objects;
create policy "admins update avatars"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and is_app_admin(auth.uid()))
  with check (bucket_id = 'avatars' and is_app_admin(auth.uid()));
