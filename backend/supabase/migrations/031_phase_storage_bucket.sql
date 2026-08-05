-- Real file storage for uploaded documents. Before this, "uploading" a
-- document only ever recorded its name/size/status in project_documents --
-- the actual file bytes were never sent anywhere, so the file itself was
-- gone the moment the browser tab closed. This creates a private Storage
-- bucket and lets any authenticated user read/write objects in it, matching
-- the same "authenticated read/write" posture already used for every other
-- table in this schema. project_documents.file_url (already a column, added
-- in migration 002 but never populated) now holds the object's storage
-- path, which the app resolves to a short-lived signed URL on demand.

insert into storage.buckets (id, name, public)
values ('project-documents', 'project-documents', false)
on conflict (id) do nothing;

drop policy if exists "authenticated read project-documents objects" on storage.objects;
create policy "authenticated read project-documents objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'project-documents');

drop policy if exists "authenticated write project-documents objects" on storage.objects;
create policy "authenticated write project-documents objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'project-documents');

drop policy if exists "authenticated update project-documents objects" on storage.objects;
create policy "authenticated update project-documents objects"
  on storage.objects for update to authenticated
  using (bucket_id = 'project-documents')
  with check (bucket_id = 'project-documents');

drop policy if exists "authenticated delete project-documents objects" on storage.objects;
create policy "authenticated delete project-documents objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-documents');
