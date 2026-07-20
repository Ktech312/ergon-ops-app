-- Adds internal project references plus project document and quote extraction tracking.

alter table projects
  add column if not exists project_number text;

create unique index if not exists idx_projects_project_number
  on projects(project_number)
  where project_number is not null;

create table if not exists project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  document_number text not null unique,
  document_type text not null check (document_type in ('sales_quote', 'sow', 'bom', 'purchase_order', 'invoice', 'field_photo', 'other')),
  file_name text not null,
  file_url text,
  storage_provider text not null default 'google_drive',
  status text not null default 'uploaded' check (status in ('uploaded', 'extracting', 'ready_to_review', 'approved', 'rejected', 'archived')),
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sales_quote_extractions (
  id uuid primary key default gen_random_uuid(),
  project_document_id uuid not null references project_documents(id) on delete cascade,
  extraction_mode text not null default 'pdf-text-rules',
  confidence text not null default 'draft' check (confidence in ('draft', 'medium', 'high')),
  extracted_project jsonb not null default '{}'::jsonb,
  extracted_sow jsonb not null default '{}'::jsonb,
  extracted_bom jsonb not null default '[]'::jsonb,
  extracted_text_preview text,
  review_status text not null default 'needs_review' check (review_status in ('needs_review', 'accepted', 'corrected', 'rejected')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_documents_project on project_documents(project_id);
create index if not exists idx_project_documents_type_status on project_documents(document_type, status);
create index if not exists idx_quote_extractions_document on sales_quote_extractions(project_document_id);
create index if not exists idx_quote_extractions_review_status on sales_quote_extractions(review_status);

create trigger project_documents_set_updated_at
  before update on project_documents
  for each row execute function set_updated_at();

create trigger sales_quote_extractions_set_updated_at
  before update on sales_quote_extractions
  for each row execute function set_updated_at();

alter table project_documents enable row level security;
alter table sales_quote_extractions enable row level security;

create policy "authenticated read project_documents"
  on project_documents for select to authenticated using (true);

create policy "authenticated write project_documents"
  on project_documents for all to authenticated using (true) with check (true);

create policy "authenticated read sales_quote_extractions"
  on sales_quote_extractions for select to authenticated using (true);

create policy "authenticated write sales_quote_extractions"
  on sales_quote_extractions for all to authenticated using (true) with check (true);
