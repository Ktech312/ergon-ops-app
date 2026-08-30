-- Migration 100: picture/file attachments on direct messages.
-- E: "for now, in the messaging, can you allow Picture and File uploads
-- to the messages."
--
-- body was previously required (not null, char_length > 0) -- a message
-- that's just a photo with no caption needs to be allowed, so body
-- becomes nullable and the length check moves to a separate constraint
-- that also requires *something* (text or attachment) be present, so a
-- truly empty message still can't be sent.
--
-- Storage path is prefixed with the conversation id
-- (message-attachments/<conversation_id>/<stamp>-<filename>) specifically
-- so the bucket policies below can restrict access to the two actual
-- conversation participants, matching direct_messages' own row-level
-- security -- these are private attachments, not organization-wide files
-- like project-documents/catalog-datasheets, so the broader
-- "any authenticated user" pattern used for those isn't appropriate here.

alter table direct_messages alter column body drop not null;
alter table direct_messages drop constraint if exists direct_messages_body_check;
alter table direct_messages add constraint direct_messages_body_check
  check (body is null or char_length(body) <= 4000);

alter table direct_messages add column if not exists attachment_storage_path text;
alter table direct_messages add column if not exists attachment_file_name text;
alter table direct_messages add column if not exists attachment_mime_type text;
alter table direct_messages add column if not exists attachment_size_bytes bigint;

alter table direct_messages drop constraint if exists direct_messages_has_content;
alter table direct_messages add constraint direct_messages_has_content
  check ((body is not null and char_length(body) > 0) or attachment_storage_path is not null);

insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;

drop policy if exists "conversation participants read message-attachments" on storage.objects;
create policy "conversation participants read message-attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from conversations c
      where (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
        and name like c.id::text || '/%'
    )
  );

drop policy if exists "conversation participants write message-attachments" on storage.objects;
create policy "conversation participants write message-attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from conversations c
      where (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
        and name like c.id::text || '/%'
    )
  );
