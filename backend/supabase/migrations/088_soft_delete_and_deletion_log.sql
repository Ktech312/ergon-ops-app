-- Migration 088: soft delete + a unified deletion log, extended from Tasks
-- (which already had this) to every other entity in the app that can be
-- permanently deleted with no trace today.
--
-- E: "Make sure Any deleted items are tracked and logged if anyone deletes
-- a task and doesn't close it properly (Site Wide)." An audit (2026-08-22)
-- found Tasks already fully compliant (soft delete, restorable, logged),
-- but everything below was a genuine hard DELETE with zero record of who
-- did it or when -- some of them (Sales Quotes, Project Locations) cascade
-- and take child rows/photos with them. Confirmed approach: full
-- Tasks-style treatment.
--
-- Every affected table gets the same two nullable columns Tasks already
-- has (deleted_by_email, deleted_at) -- a row with deleted_at set is
-- considered deleted by every loader from here on, but the data itself
-- stays in place until someone restores it or an admin permanently purges
-- it by hand. A single deletion_log table (rather than a bespoke log per
-- entity) records every delete/restore action across all of them, with
-- enough context (entity_type, entity_id, entity_label) to be useful
-- without joining back through 15 different tables.

alter table sales_quotes add column if not exists deleted_by_email text;
alter table sales_quotes add column if not exists deleted_at timestamptz;

alter table sales_quote_locations add column if not exists deleted_by_email text;
alter table sales_quote_locations add column if not exists deleted_at timestamptz;

alter table sales_quote_location_items add column if not exists deleted_by_email text;
alter table sales_quote_location_items add column if not exists deleted_at timestamptz;

alter table sales_quote_location_images add column if not exists deleted_by_email text;
alter table sales_quote_location_images add column if not exists deleted_at timestamptz;

alter table sales_quote_bom_lines add column if not exists deleted_by_email text;
alter table sales_quote_bom_lines add column if not exists deleted_at timestamptz;

alter table project_locations add column if not exists deleted_by_email text;
alter table project_locations add column if not exists deleted_at timestamptz;

alter table project_location_items add column if not exists deleted_by_email text;
alter table project_location_items add column if not exists deleted_at timestamptz;

alter table project_location_images add column if not exists deleted_by_email text;
alter table project_location_images add column if not exists deleted_at timestamptz;

alter table project_shipment_photos add column if not exists deleted_by_email text;
alter table project_shipment_photos add column if not exists deleted_at timestamptz;

alter table purchase_order_files add column if not exists deleted_by_email text;
alter table purchase_order_files add column if not exists deleted_at timestamptz;

alter table project_schedule_template_phases add column if not exists deleted_by_email text;
alter table project_schedule_template_phases add column if not exists deleted_at timestamptz;

alter table form_schema_fields add column if not exists deleted_by_email text;
alter table form_schema_fields add column if not exists deleted_at timestamptz;

alter table presales_hardware_rules add column if not exists deleted_by_email text;
alter table presales_hardware_rules add column if not exists deleted_at timestamptz;

alter table site_hardware_rules add column if not exists deleted_by_email text;
alter table site_hardware_rules add column if not exists deleted_at timestamptz;

alter table task_hardware_dependencies add column if not exists deleted_by_email text;
alter table task_hardware_dependencies add column if not exists deleted_at timestamptz;

create table if not exists deletion_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  entity_label text not null default '',
  action text not null check (action in ('deleted', 'restored')),
  actor_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_deletion_log_entity on deletion_log(entity_type, entity_id);

alter table deletion_log enable row level security;

create policy "authenticated read deletion_log"
  on deletion_log for select to authenticated using (true);

create policy "authenticated write deletion_log"
  on deletion_log for insert to authenticated with check (true);
