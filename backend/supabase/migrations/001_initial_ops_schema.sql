-- Initial operations schema for purchasing, inventory, project transfers, and reports.
-- Designed for Supabase/Postgres.

create extension if not exists "pgcrypto";

create type app_role as enum ('owner', 'admin', 'manager', 'member', 'viewer');
create type project_status as enum ('planning', 'active', 'on_hold', 'completed', 'cancelled');
create type purchase_order_status as enum ('draft', 'submitted', 'approved', 'ordered', 'partially_received', 'received', 'cancelled');
create type inventory_movement_type as enum ('receipt', 'adjustment', 'transfer', 'project_issue', 'project_return', 'reservation', 'release');

create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role app_role not null default 'member',
  department_id uuid references departments(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  email text,
  phone text,
  website text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text unique,
  location_type text not null default 'warehouse',
  address text,
  project_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  project_name text not null unique,
  customer_name text,
  status project_status not null default 'planning',
  department_id uuid references departments(id),
  owner_id uuid references profiles(id),
  start_date date,
  target_date date,
  completed_date date,
  budget_amount numeric(12,2),
  google_drive_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table locations
  add constraint locations_project_id_fkey
  foreign key (project_id) references projects(id) on delete set null;

create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  item_name text not null,
  description text,
  category text,
  unit_of_measure text not null default 'each',
  reorder_point numeric(12,2) not null default 0,
  target_stock_level numeric(12,2),
  default_unit_cost numeric(12,2),
  preferred_vendor_id uuid references vendors(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  vendor_id uuid not null references vendors(id),
  status purchase_order_status not null default 'draft',
  requested_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  requested_date date not null default current_date,
  approved_date date,
  expected_date date,
  ordered_date date,
  document_url text,
  notes text,
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  shipping_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) generated always as (subtotal + tax_amount + shipping_amount) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id),
  destination_location_id uuid references locations(id),
  quantity_ordered numeric(12,2) not null check (quantity_ordered > 0),
  quantity_received numeric(12,2) not null default 0 check (quantity_received >= 0),
  unit_cost numeric(12,2) not null default 0,
  line_total numeric(12,2) generated always as (quantity_ordered * unit_cost) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (quantity_received <= quantity_ordered)
);

create table inventory_balances (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id),
  location_id uuid not null references locations(id),
  quantity_on_hand numeric(12,2) not null default 0,
  quantity_reserved numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (inventory_item_id, location_id),
  check (quantity_on_hand >= 0),
  check (quantity_reserved >= 0),
  check (quantity_reserved <= quantity_on_hand)
);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type inventory_movement_type not null,
  inventory_item_id uuid not null references inventory_items(id),
  quantity numeric(12,2) not null check (quantity > 0),
  from_location_id uuid references locations(id),
  to_location_id uuid references locations(id),
  project_id uuid references projects(id),
  purchase_order_line_id uuid references purchase_order_lines(id),
  performed_by uuid references profiles(id),
  movement_date timestamptz not null default now(),
  reference_number text,
  notes text,
  created_at timestamptz not null default now(),
  check (
    from_location_id is not null
    or to_location_id is not null
  )
);

create table project_inventory_allocations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id),
  source_location_id uuid references locations(id),
  quantity_allocated numeric(12,2) not null check (quantity_allocated > 0),
  allocation_status text not null default 'issued',
  inventory_movement_id uuid references inventory_movements(id),
  allocated_at timestamptz not null default now(),
  notes text
);

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_projects_status on projects(status);
create index idx_projects_project_name on projects(project_name);
create index idx_po_status on purchase_orders(status);
create index idx_po_vendor on purchase_orders(vendor_id);
create index idx_po_lines_po on purchase_order_lines(purchase_order_id);
create index idx_inventory_balances_item_location on inventory_balances(inventory_item_id, location_id);
create index idx_inventory_movements_item_date on inventory_movements(inventory_item_id, movement_date desc);
create index idx_inventory_movements_project on inventory_movements(project_id);
create index idx_project_allocations_project on project_inventory_allocations(project_id);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger departments_set_updated_at before update on departments for each row execute function set_updated_at();
create trigger profiles_set_updated_at before update on profiles for each row execute function set_updated_at();
create trigger vendors_set_updated_at before update on vendors for each row execute function set_updated_at();
create trigger locations_set_updated_at before update on locations for each row execute function set_updated_at();
create trigger projects_set_updated_at before update on projects for each row execute function set_updated_at();
create trigger inventory_items_set_updated_at before update on inventory_items for each row execute function set_updated_at();
create trigger purchase_orders_set_updated_at before update on purchase_orders for each row execute function set_updated_at();
create trigger purchase_order_lines_set_updated_at before update on purchase_order_lines for each row execute function set_updated_at();

create or replace view report_inventory_on_hand as
select
  i.id as inventory_item_id,
  i.sku,
  i.item_name,
  i.category,
  i.unit_of_measure,
  l.id as location_id,
  l.name as location_name,
  l.location_type,
  b.quantity_on_hand,
  b.quantity_reserved,
  (b.quantity_on_hand - b.quantity_reserved) as quantity_available,
  i.reorder_point,
  case
    when b.quantity_on_hand <= i.reorder_point then true
    else false
  end as is_at_or_below_reorder_point
from inventory_balances b
join inventory_items i on i.id = b.inventory_item_id
join locations l on l.id = b.location_id;

create or replace view report_project_inventory_usage as
select
  p.id as project_id,
  p.project_name,
  p.customer_name,
  p.status as project_status,
  i.id as inventory_item_id,
  i.sku,
  i.item_name,
  i.unit_of_measure,
  sum(a.quantity_allocated) as quantity_allocated,
  sum(a.quantity_allocated * coalesce(i.default_unit_cost, 0)) as estimated_cost
from project_inventory_allocations a
join projects p on p.id = a.project_id
join inventory_items i on i.id = a.inventory_item_id
group by p.id, p.project_name, p.customer_name, p.status, i.id, i.sku, i.item_name, i.unit_of_measure;

create or replace view report_purchase_order_status as
select
  po.id as purchase_order_id,
  po.po_number,
  po.status,
  v.name as vendor_name,
  po.requested_date,
  po.expected_date,
  po.total_amount,
  count(pol.id) as line_count,
  coalesce(sum(pol.quantity_ordered), 0) as total_quantity_ordered,
  coalesce(sum(pol.quantity_received), 0) as total_quantity_received,
  case
    when coalesce(sum(pol.quantity_ordered), 0) = 0 then 0
    else round((sum(pol.quantity_received) / sum(pol.quantity_ordered)) * 100, 2)
  end as received_percent
from purchase_orders po
join vendors v on v.id = po.vendor_id
left join purchase_order_lines pol on pol.purchase_order_id = po.id
group by po.id, po.po_number, po.status, v.name, po.requested_date, po.expected_date, po.total_amount;

alter table departments enable row level security;
alter table profiles enable row level security;
alter table vendors enable row level security;
alter table locations enable row level security;
alter table projects enable row level security;
alter table inventory_items enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_order_lines enable row level security;
alter table inventory_balances enable row level security;
alter table inventory_movements enable row level security;
alter table project_inventory_allocations enable row level security;
alter table activity_log enable row level security;

-- Starter RLS: authenticated users can read operational data.
-- Write policies should be tightened by role before production.
create policy "authenticated read departments" on departments for select to authenticated using (true);
create policy "authenticated read profiles" on profiles for select to authenticated using (true);
create policy "authenticated read vendors" on vendors for select to authenticated using (true);
create policy "authenticated read locations" on locations for select to authenticated using (true);
create policy "authenticated read projects" on projects for select to authenticated using (true);
create policy "authenticated read inventory_items" on inventory_items for select to authenticated using (true);
create policy "authenticated read purchase_orders" on purchase_orders for select to authenticated using (true);
create policy "authenticated read purchase_order_lines" on purchase_order_lines for select to authenticated using (true);
create policy "authenticated read inventory_balances" on inventory_balances for select to authenticated using (true);
create policy "authenticated read inventory_movements" on inventory_movements for select to authenticated using (true);
create policy "authenticated read project_inventory_allocations" on project_inventory_allocations for select to authenticated using (true);
create policy "authenticated read activity_log" on activity_log for select to authenticated using (true);

create policy "authenticated write vendors" on vendors for all to authenticated using (true) with check (true);
create policy "authenticated write locations" on locations for all to authenticated using (true) with check (true);
create policy "authenticated write projects" on projects for all to authenticated using (true) with check (true);
create policy "authenticated write inventory_items" on inventory_items for all to authenticated using (true) with check (true);
create policy "authenticated write purchase_orders" on purchase_orders for all to authenticated using (true) with check (true);
create policy "authenticated write purchase_order_lines" on purchase_order_lines for all to authenticated using (true) with check (true);
create policy "authenticated write inventory_balances" on inventory_balances for all to authenticated using (true) with check (true);
create policy "authenticated write inventory_movements" on inventory_movements for all to authenticated using (true) with check (true);
create policy "authenticated write project_inventory_allocations" on project_inventory_allocations for all to authenticated using (true) with check (true);
create policy "authenticated write activity_log" on activity_log for insert to authenticated with check (true);
