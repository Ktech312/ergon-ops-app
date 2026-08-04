-- Phase 10d: cut Equipment Recipes (device recipes / BOM templates) over
-- from the app_records JSON blob to the already-existing relational
-- `equipment_types` + `equipment_bom_components` tables (migration 003).
--
-- The app's BuildRecipe type has no id field at all -- `name` is its de
-- facto primary key everywhere in the UI. This migration makes
-- `equipment_name` unique so it can serve as that natural key, and adds
-- `output_inventory_item_id` (the finished-good Part this recipe produces),
-- which the original schema didn't have a column for.
--
-- Safe to run standalone and safe to re-run. Does not touch app_records.
-- NOTE: if two recipes in the current blob share the same name, the unique
-- index creation will fail with a clear duplicate-key error -- that's a
-- real data problem worth surfacing and fixing by hand, not silently
-- resolving here.

alter table equipment_types
  add column if not exists output_inventory_item_id uuid references inventory_items(id);

create unique index if not exists idx_equipment_types_equipment_name
  on equipment_types(equipment_name);

insert into equipment_types (
  equipment_number,
  equipment_name,
  description,
  image_url,
  output_inventory_item_id,
  is_retired,
  retired_at
)
select
  'EQ-LEGACY-' || substr(md5(elem->>'name'), 1, 8) as equipment_number,
  elem->>'name' as equipment_name,
  elem->>'description' as description,
  elem->>'imageUrl' as image_url,
  outp.id as output_inventory_item_id,
  coalesce((elem->>'retired')::boolean, false) as is_retired,
  case when coalesce((elem->>'retired')::boolean, false) then now() else null end as retired_at
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
left join inventory_items outp on outp.item_name = elem->>'outputName'
where ar.workspace_key = 'default'
  and ar.record_key = 'deviceRecipes'
  and elem->>'name' is not null
on conflict (equipment_name) do update set
  description = excluded.description,
  image_url = excluded.image_url,
  output_inventory_item_id = excluded.output_inventory_item_id,
  is_retired = excluded.is_retired,
  retired_at = excluded.retired_at;

insert into equipment_bom_components (
  equipment_type_id,
  inventory_item_id,
  quantity_required,
  line_sort,
  is_active
)
select
  eq.id as equipment_type_id,
  inv.id as inventory_item_id,
  coalesce((component->>'qty')::numeric, 0) as quantity_required,
  component_index - 1 as line_sort,
  true as is_active
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
join equipment_types eq on eq.equipment_name = elem->>'name'
cross join lateral jsonb_array_elements(coalesce(elem->'components', '[]'::jsonb)) with ordinality as t(component, component_index)
join inventory_items inv on inv.item_name = component->>'itemName'
where ar.workspace_key = 'default'
  and ar.record_key = 'deviceRecipes'
  and elem->>'name' is not null
on conflict (equipment_type_id, inventory_item_id) do update set
  quantity_required = excluded.quantity_required,
  line_sort = excluded.line_sort,
  is_active = true;
