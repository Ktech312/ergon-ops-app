-- Migration 093: audit trail for merging a "one-off" PO receipt (an item
-- name that didn't exact-match anything in inventory) into an existing
-- inventory item's stock.
--
-- E: "we are able to open the item and either merge with existing item
-- (which means the inventory is added, but a copy of the real receipt is
-- left in the log as reference) or have a button to create new inventory
-- line item." The One-Off Items list (Inventory Movement Ledger tab)
-- matches PO receipts to inventory purely by exact item-name string -- a
-- receipt named "Samsung 990 PRO SSD 1TB M.2 drive" won't match an existing
-- item named "Samsung 990 Pro SSD" even though it's the same part. The
-- underlying PO receipt is never touched by a merge (it's derived from
-- purchase_orders, already immutable, and stays exactly as it was received
-- -- that's the "reference" E means), so a separate record is needed for how
-- much of a given one-off name has already been folded into which SKU.
create table if not exists one_off_reconciliations (
  id uuid primary key default gen_random_uuid(),
  item_key text not null,
  item_name text not null,
  qty numeric not null,
  target_sku text not null,
  order_numbers text,
  resolved_by_email text,
  resolved_at timestamptz not null default now()
);

create index if not exists one_off_reconciliations_item_key_idx on one_off_reconciliations (item_key);

alter table one_off_reconciliations enable row level security;

create policy "authenticated read one_off_reconciliations"
  on one_off_reconciliations for select to authenticated using (true);

create policy "authenticated write one_off_reconciliations"
  on one_off_reconciliations for insert to authenticated with check (true);
