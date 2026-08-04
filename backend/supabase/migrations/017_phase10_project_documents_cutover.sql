-- Phase 10b: cut Project Documents over from the app_records JSON blob to
-- the already-existing relational `project_documents` table (migration 002,
-- extended in 008). The table already has `local_document_id` for exactly
-- this purpose (matching the app's client-generated doc ids) -- this
-- migration just makes it unique/indexable, widens two check constraints to
-- cover app values that didn't exist in the original schema ("Backed up"
-- status, "Purchasing"/"Project" doc types), and backfills from the blob.
--
-- Safe to run standalone and safe to re-run (ON CONFLICT (local_document_id)
-- DO UPDATE). Does not touch app_records.

create unique index if not exists idx_project_documents_local_document_id
  on project_documents(local_document_id)
  where local_document_id is not null;

alter table project_documents
  drop constraint if exists project_documents_status_check;

alter table project_documents
  add constraint project_documents_status_check
  check (status in ('uploaded', 'extracting', 'ready_to_review', 'approved', 'rejected', 'archived', 'backed_up'));

alter table project_documents
  drop constraint if exists project_documents_document_type_check;

alter table project_documents
  add constraint project_documents_document_type_check
  check (document_type in ('sales_quote', 'sow', 'bom', 'purchase_order', 'invoice', 'field_photo', 'other', 'purchasing', 'project'));

insert into project_documents (
  local_document_id,
  document_number,
  project_id,
  project_name,
  document_type,
  file_name,
  file_size_bytes,
  status,
  storage_status,
  uploaded_at,
  storage_provider
)
select
  elem->>'id' as local_document_id,
  'DOC-LEGACY-' || substr(md5(coalesce(elem->>'id', elem->>'name', random()::text)), 1, 10) as document_number,
  proj.id as project_id,
  elem->>'project' as project_name,
  case elem->>'type'
    when 'Sales Quote' then 'sales_quote'
    when 'SOW' then 'sow'
    when 'BOM' then 'bom'
    when 'Purchasing' then 'purchasing'
    when 'Project' then 'project'
    else 'other'
  end as document_type,
  coalesce(elem->>'name', 'Untitled document') as file_name,
  coalesce((elem->>'size')::bigint, 0) as file_size_bytes,
  case elem->>'status'
    when 'Uploaded' then 'uploaded'
    when 'Ready to review' then 'ready_to_review'
    when 'Backed up' then 'backed_up'
    when 'Archived' then 'archived'
    else 'uploaded'
  end as status,
  case elem->>'storage'
    when 'Browser' then 'browser'
    when 'Google Drive' then 'google_drive'
    when 'Supabase Storage' then 'supabase_storage'
    else 'browser'
  end as storage_status,
  case when elem->>'uploadedAt' ~ '^\d{4}-\d{2}-\d{2}' then (elem->>'uploadedAt')::timestamptz else now() end as uploaded_at,
  'browser' as storage_provider
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
left join projects proj on proj.project_name = elem->>'project'
where ar.workspace_key = 'default'
  and ar.record_key = 'projectDocuments'
  and elem->>'id' is not null
on conflict (local_document_id) where local_document_id is not null do update set
  project_id = excluded.project_id,
  project_name = excluded.project_name,
  document_type = excluded.document_type,
  file_name = excluded.file_name,
  file_size_bytes = excluded.file_size_bytes,
  status = excluded.status,
  storage_status = excluded.storage_status,
  uploaded_at = excluded.uploaded_at;
