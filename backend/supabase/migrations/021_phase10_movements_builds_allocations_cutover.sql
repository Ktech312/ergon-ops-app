-- Phase 10e: cut Inventory Movements, Build Transactions, and Project
-- Allocation History over from the app_records JSON blob to the
-- already-existing relational tables (migration 001/003/004).
--
-- Gap-fills:
-- - inventory_movement_type enum is missing 'undo' (the app has an "undo"
--   movement type; the enum only had receipt/adjustment/transfer/
--   project_issue/project_return/reservation/release/build_consume/
--   build_complete/retire/reactivate).
-- - inventory_movements gets `legacy_id` (matches the app's client-generated
--   movement id, for idempotent re-runs and for project_allocation_history
--   to resolve movement_id below) and `build_transaction_id` (a direct FK,
--   simpler than routing through inventory_transactions for what is, in the
--   app today, just a flat buildNumber string per movement).
-- - project_allocation_history gets `legacy_id` for the same idempotency
--   reason.
--
-- Order matters within this file: build_transactions first (so movements
-- can resolve build_transaction_id by build_number), then movements (so
-- allocations can resolve movement_id by legacy_id), then allocations.
--
-- Safe to run standalone and safe to re-run. Does not touch app_records.
-- Depends on migration 020 (equipment_types backfilled) for equipment_type
-- resolution on build_transactions, and works best after 018
-- (inventory_items backfilled) for sku resolution -- run in numeric order.

alter type inventory_movement_type add value if not exists 'undo';

alter table inventory_movements
  add column if not exists legacy_id text,
  add column if not exists build_transaction_id uuid;

create unique index if not exists idx_inventory_movements_legacy_id
  on inventory_movements(legacy_id)
  where legacy_id is not null;

alter table project_allocation_history
  add column if not exists legacy_id text;

create unique index if not exists idx_project_allocation_history_legacy_id
  on project_allocation_history(legacy_id)
  where legacy_id is not null;

-- 1. Build Transactions
insert into build_transactions (
  build_number,
  equipment_type_id,
  finished_inventory_item_id,
  quantity_built,
  status,
  workflow_stage,
  created_at,
  undone_at
)
select
  elem->>'buildNumber' as build_number,
  eq.id as equipment_type_id,
  eq.output_inventory_item_id as finished_inventory_item_id,
  coalesce((elem->>'quantityBuilt')::numeric, 0) as quantity_built,
  case elem->>'status'
    when 'planned' then 'planned'
    when 'posted' then 'posted'
    when 'undone' then 'undone'
    when 'cancelled' then 'cancelled'
    else 'posted'
  end as status,
  case elem->>'stage'
    when 'planned' then 'planned'
    when 'kitting' then 'kitting'
    when 'assembled' then 'assembled'
    when 'tested' then 'tested'
    when 'complete' then 'complete'
    else 'complete'
  end as workflow_stage,
  case when elem->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}' then (elem->>'createdAt')::timestamptz else now() end as created_at,
  case when elem->>'undoneAt' ~ '^\d{4}-\d{2}-\d{2}' then (elem->>'undoneAt')::timestamptz else null end as undone_at
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
left join equipment_types eq on eq.equipment_name = elem->>'equipmentName'
where ar.workspace_key = 'default'
  and ar.record_key = 'buildTransactions'
  and elem->>'buildNumber' is not null
on conflict (build_number) do update set
  equipment_type_id = excluded.equipment_type_id,
  finished_inventory_item_id = excluded.finished_inventory_item_id,
  quantity_built = excluded.quantity_built,
  status = excluded.status,
  workflow_stage = excluded.workflow_stage,
  undone_at = excluded.undone_at;

-- 2. Inventory Movements
insert into inventory_movements (
  legacy_id,
  movement_type,
  inventory_item_id,
  quantity,
  project_id,
  reference_number,
  build_transaction_id,
  performed_by,
  movement_date,
  balance_before,
  balance_after,
  notes,
  created_at
)
select
  elem->>'id' as legacy_id,
  case elem->>'type'
    when 'receive' then 'receipt'
    when 'transfer' then 'transfer'
    when 'build_consume' then 'build_consume'
    when 'build_complete' then 'build_complete'
    when 'adjust' then 'adjustment'
    when 'retire' then 'retire'
    when 'reactivate' then 'reactivate'
    when 'undo' then 'undo'
    else 'adjustment'
  end::inventory_movement_type as movement_type,
  inv.id as inventory_item_id,
  coalesce((elem->>'quantity')::numeric, 0) as quantity,
  proj.id as project_id,
  elem->>'poNumber' as reference_number,
  bt.id as build_transaction_id,
  null as performed_by,
  case when elem->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}' then (elem->>'createdAt')::timestamptz else now() end as movement_date,
  coalesce((elem->>'quantityBefore')::numeric, 0) as balance_before,
  coalesce((elem->>'quantityAfter')::numeric, 0) as balance_after,
  coalesce(elem->>'notes', '') as notes,
  case when elem->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}' then (elem->>'createdAt')::timestamptz else now() end as created_at
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
join inventory_items inv on inv.sku = elem->>'sku'
left join projects proj on proj.project_name = elem->>'projectName'
left join build_transactions bt on bt.build_number = elem->>'buildNumber'
where ar.workspace_key = 'default'
  and ar.record_key = 'inventoryMovements'
  and elem->>'id' is not null
on conflict (legacy_id) where legacy_id is not null do update set
  movement_type = excluded.movement_type,
  inventory_item_id = excluded.inventory_item_id,
  quantity = excluded.quantity,
  project_id = excluded.project_id,
  reference_number = excluded.reference_number,
  build_transaction_id = excluded.build_transaction_id,
  balance_before = excluded.balance_before,
  balance_after = excluded.balance_after,
  notes = excluded.notes;

-- 3. Project Allocation History
insert into project_allocation_history (
  legacy_id,
  allocation_number,
  project_id,
  inventory_item_id,
  movement_id,
  action,
  quantity,
  project_name_snapshot,
  sku_snapshot,
  item_name_snapshot,
  notes,
  created_at
)
select
  elem->>'id' as legacy_id,
  'ALLOC-LEGACY-' || substr(md5(elem->>'id'), 1, 8) as allocation_number,
  proj.id as project_id,
  inv.id as inventory_item_id,
  mv.id as movement_id,
  case elem->>'action'
    when 'allocated' then 'allocated'
    when 'returned' then 'returned'
    when 'adjusted' then 'adjusted'
    when 'undone' then 'undone'
    else 'allocated'
  end as action,
  coalesce((elem->>'quantity')::numeric, 0) as quantity,
  elem->>'projectName' as project_name_snapshot,
  elem->>'sku' as sku_snapshot,
  elem->>'itemName' as item_name_snapshot,
  coalesce(elem->>'notes', '') as notes,
  case when elem->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}' then (elem->>'createdAt')::timestamptz else now() end as created_at
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
left join projects proj on proj.project_name = elem->>'projectName'
left join inventory_items inv on inv.sku = elem->>'sku'
left join inventory_movements mv on mv.legacy_id = elem->>'movementId'
where ar.workspace_key = 'default'
  and ar.record_key = 'projectAllocations'
  and elem->>'id' is not null
on conflict (legacy_id) where legacy_id is not null do update set
  project_id = excluded.project_id,
  inventory_item_id = excluded.inventory_item_id,
  movement_id = excluded.movement_id,
  action = excluded.action,
  quantity = excluded.quantity,
  notes = excluded.notes;
