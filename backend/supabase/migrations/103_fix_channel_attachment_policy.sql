-- Migration 103: fix channel message attachments failing to upload.
--
-- Found live 2026-08-30 after E ran migrations 099-102: DM attachments
-- work end to end (verified -- upload, signed URL, and image fetch all
-- succeeded), but channel attachments failed at upload with "new row
-- violates row-level security policy."
--
-- Root cause, now confirmed (not guessed): migration 101's policy wrote
-- an unqualified `name` inside a correlated subquery against `channels`:
--
--   exists (select 1 from channels c where name like c.id::text || '/%')
--
-- `channels` has its own `name` column (the channel's display name, e.g.
-- "Straub Medical") -- Postgres resolves an unqualified column to the
-- INNERMOST scope that has a match, so `name` here silently bound to
-- `c.name`, not the intended `storage.objects.name`. The check actually
-- being evaluated was "does any channel's own display name look like
-- '<its-id>/something'" -- never true, so every channel upload was
-- rejected. The conversations-based policy (migration 100) happened to
-- work purely because `conversations` has no `name` column at all, so
-- Postgres had nothing to shadow with and correctly fell back to the
-- outer `storage.objects.name`. Same bug shape would have hit any future
-- table added to this pattern that happens to have its own `name`
-- column -- fixed here by explicitly schema/table-qualifying every
-- reference instead of relying on scope fallback.

drop policy if exists "authenticated read channel message-attachments" on storage.objects;
drop policy if exists "authenticated write channel message-attachments" on storage.objects;

create policy "authenticated read channel message-attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (select 1 from public.channels c where storage.objects.name like c.id::text || '/%')
  );

create policy "authenticated write channel message-attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and exists (select 1 from public.channels c where storage.objects.name like c.id::text || '/%')
  );
