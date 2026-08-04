-- Phase 10a: cut Purchase Requests over from the app_records JSON blob to the
-- already-existing relational `purchase_requests` table (created in migration
-- 005, extended in 006/007/011). The table was already field-complete for
-- almost everything the app needs -- this migration only adds a `legacy_id`
-- column so the app's existing client-generated string ids
-- (e.g. "req-1690000000-ab12cd") can keep working as the natural key the UI
-- already uses, while Postgres keeps its own uuid primary key underneath.
--
-- This migration is safe to run standalone: it only adds a column/index and
-- backfills rows from the current blob contents. It does not remove or touch
-- app_records, so nothing about the live app changes until the corresponding
-- code deploy (separate commit) starts reading/writing this table instead of
-- the blob. Re-running this file is safe -- the backfill uses
-- ON CONFLICT (legacy_id) DO UPDATE, so it will not create duplicates.

alter table purchase_requests
  add column if not exists legacy_id text;

create unique index if not exists idx_purchase_requests_legacy_id
  on purchase_requests(legacy_id)
  where legacy_id is not null;

-- Backfill from the current app_records blob (record_key = 'purchaseRequests').
-- Reason/status strings are mapped from the app's display-case values to the
-- table's snake_case check-constraint values.
insert into purchase_requests (
  legacy_id,
  request_number,
  inventory_item_id,
  sku_snapshot,
  item_name_snapshot,
  quantity_requested,
  reason,
  source_type,
  source_ref,
  project_id,
  project_name,
  procurement_track,
  preferred_vendor,
  estimated_unit_cost,
  quantity_received,
  status,
  po_number,
  expected_date,
  notes,
  created_at
)
select
  elem->>'id' as legacy_id,
  coalesce(elem->>'requestNumber', 'REQ-LEGACY-' || substr(md5(elem->>'id'), 1, 8)) as request_number,
  inv.id as inventory_item_id,
  elem->>'sku' as sku_snapshot,
  elem->>'itemName' as item_name_snapshot,
  coalesce((elem->>'quantity')::numeric, 0) as quantity_requested,
  case elem->>'reason'
    when 'Reorder Point' then 'reorder_point'
    when 'Planned Build Shortage' then 'planned_build_shortage'
    when 'Manual' then 'manual'
    when 'Project BOM' then 'project_bom'
    else 'manual'
  end as reason,
  case
    when elem->>'reason' = 'Project BOM' then 'project'
    when elem->>'reason' = 'Planned Build Shortage' then 'build'
    when elem->>'reason' = 'Reorder Point' then 'inventory'
    else 'manual'
  end as source_type,
  elem->>'sourceRef' as source_ref,
  proj.id as project_id,
  elem->>'projectName' as project_name,
  coalesce(nullif(elem->>'procurementTrack', ''), 'warehouse_stock') as procurement_track,
  elem->>'preferredVendor' as preferred_vendor,
  coalesce((elem->>'estimatedUnitCost')::numeric, 0) as estimated_unit_cost,
  coalesce((elem->>'receivedQuantity')::numeric, 0) as quantity_received,
  case elem->>'status'
    when 'Draft' then 'draft'
    when 'Need Quote' then 'need_quote'
    when 'Ready to Order' then 'ready_to_order'
    when 'Ordered' then 'ordered'
    when 'Received' then 'received'
    when 'Cancelled' then 'cancelled'
    else 'draft'
  end as status,
  nullif(elem->>'poNumber', '') as po_number,
  case when elem->>'expectedDate' ~ '^\d{4}-\d{2}-\d{2}$' then (elem->>'expectedDate')::date else null end as expected_date,
  coalesce(elem->>'notes', '') as notes,
  case when elem->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}' then (elem->>'createdAt')::timestamptz else now() end as created_at
from app_records ar
cross join lateral jsonb_array_elements(ar.data) as elem
left join inventory_items inv on inv.sku = elem->>'sku'
left join projects proj on proj.project_name = elem->>'projectName'
where ar.workspace_key = 'default'
  and ar.record_key = 'purchaseRequests'
  and elem->>'id' is not null
on conflict (legacy_id) do update set
  request_number = excluded.request_number,
  inventory_item_id = excluded.inventory_item_id,
  sku_snapshot = excluded.sku_snapshot,
  item_name_snapshot = excluded.item_name_snapshot,
  quantity_requested = excluded.quantity_requested,
  reason = excluded.reason,
  source_type = excluded.source_type,
  source_ref = excluded.source_ref,
  project_id = excluded.project_id,
  project_name = excluded.project_name,
  procurement_track = excluded.procurement_track,
  preferred_vendor = excluded.preferred_vendor,
  estimated_unit_cost = excluded.estimated_unit_cost,
  quantity_received = excluded.quantity_received,
  status = excluded.status,
  po_number = excluded.po_number,
  expected_date = excluded.expected_date,
  notes = excluded.notes;

-- Sanity check: row counts should match after running. If they don't, some
-- blob rows had a null/duplicate id and were skipped -- worth reviewing.
-- select
--   (select jsonb_array_length(data) from app_records where record_key = 'purchaseRequests') as blob_count,
--   (select count(*) from purchase_requests where legacy_id is not null) as migrated_count;
