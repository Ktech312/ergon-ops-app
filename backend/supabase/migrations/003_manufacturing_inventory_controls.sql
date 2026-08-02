-- Manufacturing and inventory-control foundation.
-- Adds durable equipment definitions, BOMs, movement ledger detail, build history,
-- project allocation history, role modes, and an app-state snapshot bridge for the
-- current frontend MVP.

alter type inventory_movement_type add value if not exists 'build_consume';
alter type inventory_movement_type add value if not exists 'build_complete';
alter type inventory_movement_type add value if not exists 'retire';
alter type inventory_movement_type add value if not exists 'reactivate';

create table if not exists equipment_types (
  id uuid primary key default gen_random_uuid(),
  equipment_number text not null unique,
  equipment_name text not null,
  description text,
  image_url text,
  is_retired boolean not null default false,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists equipment_bom_components (
  id uuid primary key default gen_random_uuid(),
  equipment_type_id uuid not null references equipment_types(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id),
  quantity_required numeric(12,2) not null check (quantity_required > 0),
  line_sort integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (equipment_type_id, inventory_item_id)
);

create table if not exists inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_number text not null unique,
  transaction_type text not null check (transaction_type in ('receive', 'transfer', 'build', 'adjust', 'retire', 'reactivate', 'undo')),
  transaction_status text not null default 'posted' check (transaction_status in ('draft', 'posted', 'undone')),
  source_type text,
  source_ref text,
  project_id uuid references projects(id),
  purchase_order_id uuid references purchase_orders(id),
  equipment_type_id uuid references equipment_types(id),
  performed_by uuid references profiles(id),
  posted_at timestamptz not null default now(),
  undone_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table inventory_movements
  add column if not exists inventory_transaction_id uuid references inventory_transactions(id),
  add column if not exists unit_cost numeric(12,2),
  add column if not exists balance_before numeric(12,2),
  add column if not exists balance_after numeric(12,2),
  add column if not exists undo_of_movement_id uuid references inventory_movements(id);

create table if not exists build_transactions (
  id uuid primary key default gen_random_uuid(),
  inventory_transaction_id uuid references inventory_transactions(id),
  build_number text not null unique,
  equipment_type_id uuid references equipment_types(id),
  finished_inventory_item_id uuid references inventory_items(id),
  quantity_built numeric(12,2) not null check (quantity_built > 0),
  status text not null default 'posted' check (status in ('draft', 'posted', 'undone')),
  total_component_cost numeric(12,2) not null default 0,
  posted_at timestamptz not null default now(),
  undone_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists project_allocation_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  inventory_item_id uuid references inventory_items(id),
  inventory_transaction_id uuid references inventory_transactions(id),
  movement_id uuid references inventory_movements(id),
  allocation_number text not null unique,
  action text not null check (action in ('allocated', 'returned', 'adjusted', 'undone')),
  quantity numeric(12,2) not null check (quantity > 0),
  project_name_snapshot text,
  sku_snapshot text,
  item_name_snapshot text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists app_role_modes (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique check (role_key in ('warehouse', 'purchasing', 'pm', 'manager')),
  role_name text not null,
  description text,
  default_view text not null default 'dashboard',
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null unique,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_equipment_types_retired on equipment_types(is_retired);
create index if not exists idx_equipment_bom_equipment on equipment_bom_components(equipment_type_id);
create index if not exists idx_inventory_transactions_posted on inventory_transactions(posted_at desc);
create index if not exists idx_inventory_transactions_project on inventory_transactions(project_id);
create index if not exists idx_inventory_movements_transaction on inventory_movements(inventory_transaction_id);
create index if not exists idx_build_transactions_posted on build_transactions(posted_at desc);
create index if not exists idx_project_allocation_history_project on project_allocation_history(project_id, created_at desc);
create index if not exists idx_app_state_snapshots_workspace on app_state_snapshots(workspace_key);

create trigger equipment_types_set_updated_at
  before update on equipment_types
  for each row execute function set_updated_at();

create trigger equipment_bom_components_set_updated_at
  before update on equipment_bom_components
  for each row execute function set_updated_at();

create trigger app_role_modes_set_updated_at
  before update on app_role_modes
  for each row execute function set_updated_at();

alter table equipment_types enable row level security;
alter table equipment_bom_components enable row level security;
alter table inventory_transactions enable row level security;
alter table build_transactions enable row level security;
alter table project_allocation_history enable row level security;
alter table app_role_modes enable row level security;
alter table app_state_snapshots enable row level security;

create policy "authenticated read equipment_types" on equipment_types for select to authenticated using (true);
create policy "authenticated write equipment_types" on equipment_types for all to authenticated using (true) with check (true);
create policy "authenticated read equipment_bom_components" on equipment_bom_components for select to authenticated using (true);
create policy "authenticated write equipment_bom_components" on equipment_bom_components for all to authenticated using (true) with check (true);
create policy "authenticated read inventory_transactions" on inventory_transactions for select to authenticated using (true);
create policy "authenticated write inventory_transactions" on inventory_transactions for all to authenticated using (true) with check (true);
create policy "authenticated read build_transactions" on build_transactions for select to authenticated using (true);
create policy "authenticated write build_transactions" on build_transactions for all to authenticated using (true) with check (true);
create policy "authenticated read project_allocation_history" on project_allocation_history for select to authenticated using (true);
create policy "authenticated write project_allocation_history" on project_allocation_history for all to authenticated using (true) with check (true);
create policy "authenticated read app_role_modes" on app_role_modes for select to authenticated using (true);
create policy "authenticated write app_role_modes" on app_role_modes for all to authenticated using (true) with check (true);
create policy "authenticated read app_state_snapshots" on app_state_snapshots for select to authenticated using (true);
create policy "authenticated write app_state_snapshots" on app_state_snapshots for all to authenticated using (true) with check (true);
create policy "anon read app_state_snapshots during no-login MVP" on app_state_snapshots for select to anon using (true);
create policy "anon write app_state_snapshots during no-login MVP" on app_state_snapshots for all to anon using (true) with check (true);

insert into app_role_modes (role_key, role_name, description, default_view, permissions)
values
  ('warehouse', 'Warehouse', 'Receive stock, adjust counts, build equipment, and transfer materials.', 'inventory', '{"inventory": "write", "projects": "read"}'),
  ('purchasing', 'Purchasing', 'Manage purchase orders, vendor costs, receiving, and reorder queues.', 'purchasing', '{"purchasing": "write", "inventory": "read"}'),
  ('pm', 'PM', 'Create projects, review SOW/BOM needs, and request material allocations.', 'projects', '{"projects": "write", "inventory": "read"}'),
  ('manager', 'Manager', 'Review reports, inventory health, purchasing spend, and project usage.', 'reports', '{"reports": "read", "inventory": "read", "projects": "read"}')
on conflict (role_key) do update
set role_name = excluded.role_name,
    description = excluded.description,
    default_view = excluded.default_view,
    permissions = excluded.permissions;
