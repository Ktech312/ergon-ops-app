-- Phase 10f: cut Projects over from the app_records JSON blob to the
-- already-existing `projects` table (migration 001/002), plus two new
-- tables this schema never had: Scope of Work (1:1) and BOM lines (1:many).
--
-- Gap-fill on `projects`: the original schema's `status` enum
-- (planning/active/on_hold/completed/cancelled) and `owner_id`/
-- `department_id` (FKs to an unused profiles/departments concept) don't
-- match what the app actually needs, so new plain columns are added
-- alongside rather than force-fitting the app's values into the old ones.
-- `project_name` (unique, not null) is used as the upsert key; `ref`
-- becomes `project_number` (already unique-when-set from migration 002).
--
-- Safe to run standalone and safe to re-run. Does not touch app_records.
-- Best run after 018 (inventory_items backfilled) so BOM line item names
-- can resolve to real inventory rows where they match.

alter table projects
  add column if not exists site_type text,
  add column if not exists site_address text,
  add column if not exists owner_name text,
  add column if not exists app_status text
    check (app_status in ('Draft', 'Planning', 'Purchasing', 'Staging', 'Install Ready')),
  add column if not exists target_date_display text,
  add column if not exists solution_package text,
  add column if not exists camera_count integer,
  add column if not exists allocated_amount numeric(12,2) not null default 0,
  add column if not exists sales_quote_file text;

create table if not exists project_scope_of_work (
  project_id uuid primary key references projects(id) on delete cascade,
  summary text not null default '',
  preparation text not null default '',
  infrastructure text not null default '',
  installation text not null default '',
  commissioning text not null default '',
  fine_tuning text not null default '',
  assumptions text not null default '',
  exclusions text not null default '',
  updated_at timestamptz not null default now()
);

create or replace function set_project_scope_of_work_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists project_scope_of_work_set_updated_at on project_scope_of_work;
create trigger project_scope_of_work_set_updated_at
  before update on project_scope_of_work
  for each row execute function set_project_scope_of_work_updated_at();

alter table project_scope_of_work enable row level security;

create policy "authenticated read project_scope_of_work"
  on project_scope_of_work for select to authenticated using (true);

create policy "authenticated write project_scope_of_work"
  on project_scope_of_work for all to authenticated using (true) with check (true);

create table if not exists project_bom_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  item_name text not null,
  inventory_item_id uuid references inventory_items(id),
  qty numeric(12,2) not null default 0,
  status text not null default 'Not started'
    check (status in ('Need Quote', 'Not started', 'Ordered', 'Completed', 'From Inventory', 'Delivered to Office', 'Delivered to Client')),
  request_speed text not null default 'Standard'
    check (request_speed in ('ASAP', 'Standard', 'Future')),
  po text,
  notes text,
  line_sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_bom_lines_project on project_bom_lines(project_id, line_sort);

create or replace function set_project_bom_lines_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists project_bom_lines_set_updated_at on project_bom_lines;
create trigger project_bom_lines_set_updated_at
  before update on project_bom_lines
  for each row execute function set_project_bom_lines_updated_at();

alter table project_bom_lines enable row level security;

create policy "authenticated read project_bom_lines"
  on project_bom_lines for select to authenticated using (true);

create policy "authenticated write project_bom_lines"
  on project_bom_lines for all to authenticated using (true) with check (true);

-- 1. Projects
insert into projects (
  project_name,
  project_number,
  customer_name,
  site_type,
  site_address,
  owner_name,
  app_status,
  target_date,
  target_date_display,
  solution_package,
  camera_count,
  allocated_amount,
  sales_quote_file,
  notes
)
select
  elem->>'name' as project_name,
  elem->>'ref' as project_number,
  elem->>'client' as customer_name,
  elem->>'type' as site_type,
  elem->>'address' as site_address,
  elem->>'owner' as owner_name,
  case when elem->>'status' in ('Draft', 'Planning', 'Purchasing', 'Staging', 'Install Ready') then elem->>'status' else 'Draft' end as app_status,
  case when elem->>'due' ~ '^\d{4}-\d{2}-\d{2}$' then (elem->>'due')::date else null end as target_date,
  elem->>'due' as target_date_display,
  elem->>'package' as solution_package,
  coalesce((elem->>'cameras')::integer, 0) as camera_count,
  coalesce((elem->>'allocated')::numeric, 0) as allocated_amount,
  elem->>'salesQuoteFile' as sales_quote_file,
  coalesce(elem->>'siteNotes', '') as notes
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
where ar.workspace_key = 'default'
  and ar.record_key = 'projectSites'
  and elem->>'name' is not null
on conflict (project_name) do update set
  project_number = excluded.project_number,
  customer_name = excluded.customer_name,
  site_type = excluded.site_type,
  site_address = excluded.site_address,
  owner_name = excluded.owner_name,
  app_status = excluded.app_status,
  target_date = excluded.target_date,
  target_date_display = excluded.target_date_display,
  solution_package = excluded.solution_package,
  camera_count = excluded.camera_count,
  allocated_amount = excluded.allocated_amount,
  sales_quote_file = excluded.sales_quote_file,
  notes = excluded.notes;

-- 2. Scope of Work (1:1)
insert into project_scope_of_work (
  project_id, summary, preparation, infrastructure, installation, commissioning, fine_tuning, assumptions, exclusions
)
select
  p.id,
  coalesce(elem->'sow'->>'summary', ''),
  coalesce(elem->'sow'->>'preparation', ''),
  coalesce(elem->'sow'->>'infrastructure', ''),
  coalesce(elem->'sow'->>'installation', ''),
  coalesce(elem->'sow'->>'commissioning', ''),
  coalesce(elem->'sow'->>'fineTuning', ''),
  coalesce(elem->'sow'->>'assumptions', ''),
  coalesce(elem->'sow'->>'exclusions', '')
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
join projects p on p.project_name = elem->>'name'
where ar.workspace_key = 'default'
  and ar.record_key = 'projectSites'
  and elem->>'name' is not null
on conflict (project_id) do update set
  summary = excluded.summary,
  preparation = excluded.preparation,
  infrastructure = excluded.infrastructure,
  installation = excluded.installation,
  commissioning = excluded.commissioning,
  fine_tuning = excluded.fine_tuning,
  assumptions = excluded.assumptions,
  exclusions = excluded.exclusions;

-- 3. BOM lines (1:many). Re-running this migration will duplicate BOM line
-- rows since there is no natural unique key for a line -- clear existing
-- lines for a project before re-inserting so re-runs stay idempotent.
delete from project_bom_lines
where project_id in (
  select p.id from projects p
  join app_records ar on ar.workspace_key = 'default' and ar.record_key = 'projectSites'
  cross join lateral jsonb_array_elements(ar.data) as elem
  where elem->>'name' = p.project_name
);

insert into project_bom_lines (
  project_id, item_name, inventory_item_id, qty, status, request_speed, po, notes, line_sort
)
select
  p.id as project_id,
  line->>'item' as item_name,
  inv.id as inventory_item_id,
  coalesce((line->>'qty')::numeric, 0) as qty,
  case when line->>'status' in ('Need Quote', 'Not started', 'Ordered', 'Completed', 'From Inventory', 'Delivered to Office', 'Delivered to Client') then line->>'status' else 'Not started' end as status,
  case when line->>'requestSpeed' in ('ASAP', 'Standard', 'Future') then line->>'requestSpeed' else 'Standard' end as request_speed,
  nullif(line->>'po', '') as po,
  nullif(line->>'notes', '') as notes,
  line_index - 1 as line_sort
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
join projects p on p.project_name = elem->>'name'
cross join lateral jsonb_array_elements(coalesce(elem->'bom', '[]'::jsonb)) with ordinality as t(line, line_index)
left join inventory_items inv on inv.item_name = line->>'item'
where ar.workspace_key = 'default'
  and ar.record_key = 'projectSites'
  and elem->>'name' is not null;
