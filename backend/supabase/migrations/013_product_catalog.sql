-- Sales/product catalog, kept separate from physical inventory.
-- Inventory tracks what is physically on hand. The catalog tracks what Ergon
-- sells or specifies: sales-facing descriptions, default pricing, datasheets,
-- and (optionally) a link to the inventory SKU or manufactured equipment type
-- that fulfills it. A catalog item does not have to map to a single inventory
-- row, and retiring a catalog item must not remove it from old quotes/reports.

create table if not exists product_catalog (
  id uuid primary key default gen_random_uuid(),
  catalog_number text not null unique,
  product_name text not null,
  sales_description text,
  technical_description text,
  category text,
  manufacturer text,
  default_sell_price numeric(12,2) not null default 0,
  cost_source text not null default 'manual'
    check (cost_source in ('manual', 'inventory_unit_cost', 'vendor_quote')),
  inventory_item_id uuid references inventory_items(id),
  equipment_type_id uuid references equipment_types(id),
  -- Free-text pointer to a SKU or equipment/recipe name for quick reference.
  -- inventory_item_id / equipment_type_id above are reserved for once inventory
  -- and manufacturing move onto the relational tables (see roadmap Phase 10);
  -- today's inventory/equipment data lives in app_records, not those tables,
  -- so a strict foreign key link is not reliably wireable yet.
  linked_reference text,
  datasheet_url text,
  image_url text,
  is_retired boolean not null default false,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_catalog_category on product_catalog(category);
create index if not exists idx_product_catalog_retired on product_catalog(is_retired);
create index if not exists idx_product_catalog_inventory_item on product_catalog(inventory_item_id);
create index if not exists idx_product_catalog_equipment_type on product_catalog(equipment_type_id);

create trigger product_catalog_set_updated_at
  before update on product_catalog
  for each row execute function set_updated_at();

alter table product_catalog enable row level security;

create policy "authenticated read product_catalog"
  on product_catalog for select to authenticated using (true);

create policy "authenticated write product_catalog"
  on product_catalog for all to authenticated using (true) with check (true);
