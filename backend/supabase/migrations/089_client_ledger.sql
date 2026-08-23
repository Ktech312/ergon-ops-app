-- Migration 089: Client Ledger -- a permanent per-site record for after a
-- project closes out, built from E's "Client Ledger" / "Asset Ledger"
-- notes (2026-08-23), scoped down to what actually maps onto this schema.
--
-- Most of the Client Ledger (Active/Archived Sites, Financial Summary,
-- SaaS info) is built entirely from data that already exists (project
-- status, saas_* columns, sale_amount, etc.) -- no schema change needed
-- for those. Two things genuinely don't exist anywhere in the app yet and
-- need real new tables/columns:

-- 1) Per-unit, serial-level installed hardware with an install date, so an
-- End-of-Life date can be computed per physical unit (not just a planned
-- quantity per location, which is all project_location_items tracks).
create table if not exists installed_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  project_location_id uuid references project_locations(id) on delete set null,
  catalog_item_id uuid references product_catalog(id) on delete set null,
  serial_number text not null,
  install_date date,
  notes text,
  created_by_email text,
  created_at timestamptz not null default now(),
  -- Same soft-delete pattern as migration 088 -- removing an asset record
  -- (e.g. a unit was actually decommissioned) should stay tracked, not
  -- vanish with no trace.
  deleted_by_email text,
  deleted_at timestamptz
);

create index if not exists idx_installed_assets_project on installed_assets(project_id);
create index if not exists idx_installed_assets_location on installed_assets(project_location_id);

alter table installed_assets enable row level security;

create policy "authenticated read installed_assets"
  on installed_assets for select to authenticated using (true);

create policy "authenticated write installed_assets"
  on installed_assets for all to authenticated using (true) with check (true);

-- Expected lifespan drives the auto-calculated target replacement date
-- (install_date + expected_lifespan_years) for every installed_assets row
-- referencing this catalog item. Null = unknown/not set, EOL tracker shows
-- "No lifespan set" instead of guessing.
alter table product_catalog add column if not exists expected_lifespan_years numeric(4,1);

-- 2) Lifecycle dates the Client Ledger needs that don't exist on projects
-- yet. Handover/completion is already covered by saas_start_date (stamped
-- automatically the first time a project is set to Closed) -- kickoff and
-- warranty expiration are new.
alter table projects add column if not exists kickoff_date date;
alter table projects add column if not exists warranty_expiration_date date;

-- 3) Closeout Vault document types -- As-Built diagrams, O&M manuals,
-- completion certs, network/IP schemas, and power/breaker schedules didn't
-- have a real category before (everything fell through to "other").
alter table project_documents drop constraint if exists project_documents_document_type_check;
alter table project_documents
  add constraint project_documents_document_type_check
  check (document_type in (
    'sales_quote', 'sow', 'bom', 'purchase_order', 'invoice', 'field_photo', 'other', 'purchasing', 'project',
    'as_built', 'om_manual', 'completion_certificate', 'network_schema', 'power_schedule'
  ));
