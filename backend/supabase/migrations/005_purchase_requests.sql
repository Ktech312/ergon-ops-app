-- Purchase request queue for reorder points, planned build shortages, and manual buys.
-- This gives Purchasing a durable worklist before a vendor PO exists.

create table if not exists purchase_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  inventory_item_id uuid references inventory_items(id),
  sku_snapshot text not null,
  item_name_snapshot text not null,
  quantity_requested numeric(12,2) not null check (quantity_requested > 0),
  reason text not null check (reason in ('reorder_point', 'planned_build_shortage', 'manual')),
  source_type text check (source_type in ('inventory', 'build', 'project', 'manual')),
  source_ref text,
  project_id uuid references projects(id),
  preferred_vendor text,
  estimated_unit_cost numeric(12,2) not null default 0,
  status text not null default 'need_quote' check (status in ('draft', 'need_quote', 'ready_to_order', 'ordered', 'received', 'cancelled')),
  requested_by uuid references profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_purchase_requests_status on purchase_requests(status, created_at desc);
create index if not exists idx_purchase_requests_inventory_item on purchase_requests(inventory_item_id);
create index if not exists idx_purchase_requests_project on purchase_requests(project_id);
create index if not exists idx_purchase_requests_source on purchase_requests(source_type, source_ref);

create trigger purchase_requests_set_updated_at
  before update on purchase_requests
  for each row execute function set_updated_at();

alter table purchase_requests enable row level security;

create policy "authenticated read purchase_requests" on purchase_requests for select to authenticated using (true);
create policy "authenticated write purchase_requests" on purchase_requests for all to authenticated using (true) with check (true);
create policy "anon read purchase_requests during no-login MVP" on purchase_requests for select to anon using (true);
create policy "anon write purchase_requests during no-login MVP" on purchase_requests for all to anon using (true) with check (true);
