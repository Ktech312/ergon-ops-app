-- Phase 18: fluid admin-configurable forms engine, applied first to the
-- After-Sales Hardware Handover form. `form_schemas`/`form_schema_fields`
-- are deliberately generic (keyed by `form_key`) so a future admin-
-- configurable form doesn't need new tables, just a new schema row.
--
-- Hardware BOM lines and attachments captured on a handover are NOT stored
-- here -- they go straight into the existing `project_bom_lines` and
-- `project_documents` tables (Phase 10f / Phase 10b) so nothing is
-- duplicated. `project_handovers.responses` only holds the free-form
-- question/answer pairs from the dynamic schema.

create table if not exists form_schemas (
  id uuid primary key default gen_random_uuid(),
  form_key text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists form_schema_fields (
  id uuid primary key default gen_random_uuid(),
  form_schema_id uuid not null references form_schemas(id) on delete cascade,
  section text not null default 'general',
  field_key text not null,
  label text not null,
  field_type text not null default 'text'
    check (field_type in ('text', 'textarea', 'number', 'select', 'checkbox', 'date')),
  placeholder text,
  is_required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  sequence_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (form_schema_id, field_key)
);

create index if not exists idx_form_schema_fields_schema on form_schema_fields(form_schema_id, sequence_order);

create table if not exists project_handovers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  form_schema_id uuid not null references form_schemas(id),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  responses jsonb not null default '{}'::jsonb,
  submitted_by_email text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_handovers_project on project_handovers(project_id, created_at desc);

create or replace function set_updated_at_generic()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists form_schemas_set_updated_at on form_schemas;
create trigger form_schemas_set_updated_at
  before update on form_schemas
  for each row execute function set_updated_at_generic();

drop trigger if exists project_handovers_set_updated_at on project_handovers;
create trigger project_handovers_set_updated_at
  before update on project_handovers
  for each row execute function set_updated_at_generic();

alter table form_schemas enable row level security;
alter table form_schema_fields enable row level security;
alter table project_handovers enable row level security;

create policy "authenticated read form_schemas" on form_schemas for select to authenticated using (true);
create policy "pm and admin write form_schemas" on form_schemas for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('pm'))
  with check (is_app_admin(auth.uid()) or has_role('pm'));

create policy "authenticated read form_schema_fields" on form_schema_fields for select to authenticated using (true);
create policy "pm and admin write form_schema_fields" on form_schema_fields for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('pm'))
  with check (is_app_admin(auth.uid()) or has_role('pm'));

create policy "authenticated read project_handovers" on project_handovers for select to authenticated using (true);
create policy "authenticated write project_handovers" on project_handovers for all to authenticated using (true) with check (true);

-- Seed the After-Sales Handover schema with a starter field set so the form
-- isn't empty on first use. An admin edits/reorders/adds/removes from here
-- on -- nothing about these fields is hardcoded in the app.
insert into form_schemas (form_key, name, description)
values ('after_sales_handover', 'After-Sales Hardware Handover', 'Site requirements captured at sales-to-operations handoff.')
on conflict (form_key) do nothing;

insert into form_schema_fields (form_schema_id, section, field_key, label, field_type, placeholder, is_required, options, sequence_order)
select fs.id, v.section, v.field_key, v.label, v.field_type, v.placeholder, v.is_required, v.options::jsonb, v.sequence_order
from form_schemas fs
cross join (values
  ('site_requirements', 'mounting_environment', 'Mounting Environment', 'select', null, true, '["Standard Rack", "Desktop", "Outdoor Weatherproof"]', 0),
  ('site_requirements', 'power_spec', 'Power Specifications', 'select', null, true, '["110V AC", "220V AC", "PoE+ Network Fed"]', 1),
  ('site_requirements', 'network_dependency', 'Network Dependency', 'select', null, false, '["Static IP", "DHCP", "Air-Gapped"]', 2),
  ('site_requirements', 'special_instructions', 'Special Installation Instructions', 'textarea', 'Enter any site-specific handling notes...', false, '[]', 3)
) as v(section, field_key, label, field_type, placeholder, is_required, options, sequence_order)
where fs.form_key = 'after_sales_handover'
on conflict (form_schema_id, field_key) do nothing;
