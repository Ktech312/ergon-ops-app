-- App-wide upload provenance rule:
-- every project document should show when it was uploaded and who uploaded it.
-- Location photos/files already have uploaded_at + uploaded_by_email from
-- migration 064; this extends the same readable email field to project_documents.

alter table project_documents
  add column if not exists uploaded_by_email text;

create index if not exists idx_project_documents_uploaded_by_email
  on project_documents(uploaded_by_email)
  where uploaded_by_email is not null;
