-- Phase 10c: cut Inventory Items over from the app_records JSON blob to the
-- already-existing relational `inventory_items` table (migration 001,
-- extended in 004). `sku` is already unique and matches the app's `ref`
-- field exactly, so it doubles as the natural/legacy key -- no extra column
-- needed there.
--
-- Two real gaps get filled: (1) the app has a flat `vendorUrl` text field and
-- a `priceHistory` array with no home in the existing schema -- both are
-- added as plain columns (price_history as jsonb, following the same
-- pattern already used for purchase_sources on this same table); (2) the
-- app's `stock` is a single flat number, but this schema models stock via
-- inventory_balances(item, location) -- a default "Main Warehouse" location
-- is created and used so the app keeps working with one flat number today,
-- while the schema is already ready for the not-yet-built location/bin UI.
--
-- Safe to run standalone and safe to re-run (ON CONFLICT (sku) DO UPDATE,
-- ON CONFLICT (inventory_item_id, location_id) DO UPDATE). Does not touch
-- app_records.

alter table inventory_items
  add column if not exists vendor_url text,
  add column if not exists price_history jsonb not null default '[]'::jsonb;

insert into locations (name, code, location_type)
values ('Main Warehouse', 'MAIN', 'warehouse')
on conflict (name) do nothing;

insert into inventory_items (
  sku,
  item_name,
  description,
  manufacturer,
  category,
  default_unit_cost,
  reorder_point,
  vendor_url,
  image_url,
  barcode_value,
  purchase_sources,
  price_history,
  inventory_tags,
  is_active,
  retired_at
)
select
  elem->>'ref' as sku,
  coalesce(elem->>'name', elem->>'ref') as item_name,
  elem->>'description' as description,
  elem->>'manufacturer' as manufacturer,
  coalesce(elem->>'category', 'Base') as category,
  coalesce((elem->>'cost')::numeric, 0) as default_unit_cost,
  coalesce((elem->>'reorderPoint')::numeric, 0) as reorder_point,
  elem->>'vendorUrl' as vendor_url,
  elem->>'imageUrl' as image_url,
  elem->>'barcode' as barcode_value,
  coalesce(elem->'purchaseUrls', '[]'::jsonb) as purchase_sources,
  coalesce(elem->'priceHistory', '[]'::jsonb) as price_history,
  case
    when jsonb_typeof(elem->'tags') = 'array'
      then array(select jsonb_array_elements_text(elem->'tags'))
    else '{}'::text[]
  end as inventory_tags,
  not coalesce((elem->>'retired')::boolean, false) as is_active,
  case when coalesce((elem->>'retired')::boolean, false) then now() else null end as retired_at
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
where ar.workspace_key = 'default'
  and ar.record_key = 'inventoryItems'
  and elem->>'ref' is not null
on conflict (sku) do update set
  item_name = excluded.item_name,
  description = excluded.description,
  manufacturer = excluded.manufacturer,
  category = excluded.category,
  default_unit_cost = excluded.default_unit_cost,
  reorder_point = excluded.reorder_point,
  vendor_url = excluded.vendor_url,
  image_url = excluded.image_url,
  barcode_value = excluded.barcode_value,
  purchase_sources = excluded.purchase_sources,
  price_history = excluded.price_history,
  inventory_tags = excluded.inventory_tags,
  is_active = excluded.is_active,
  retired_at = excluded.retired_at;

insert into inventory_balances (inventory_item_id, location_id, quantity_on_hand)
select
  inv.id as inventory_item_id,
  loc.id as location_id,
  coalesce((elem->>'stock')::numeric, 0) as quantity_on_hand
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
join inventory_items inv on inv.sku = elem->>'ref'
cross join (select id from locations where name = 'Main Warehouse') as loc
where ar.workspace_key = 'default'
  and ar.record_key = 'inventoryItems'
  and elem->>'ref' is not null
on conflict (inventory_item_id, location_id) do update set
  quantity_on_hand = excluded.quantity_on_hand;
