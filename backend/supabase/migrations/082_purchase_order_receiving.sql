-- Migration 082: real per-line-item receiving + a receiving log.
--
-- E: "we need to be able to accept each line item and by quantity. For
-- example, I get a partial order with a packing slip of 2 items but not
-- all... create a log of who checked in what and when."
--
-- purchase_order_lines.quantity_received already existed since migration
-- 001 (never used by the app) -- this migration only adds the log table.
-- purchase_order_receipts: one row per receiving action, item_name/qty
-- snapshotted at the time (not just a running total on the line), so the
-- log stays a true history even if a line is later edited. "Received All"
-- writes one row per line that still had a remainder.

create table if not exists purchase_order_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  purchase_order_line_id uuid references purchase_order_lines(id) on delete set null,
  item_name text not null,
  qty numeric not null,
  received_by_email text,
  received_at timestamptz not null default now()
);

create index if not exists idx_purchase_order_receipts_order on purchase_order_receipts(purchase_order_id, received_at desc);

alter table purchase_order_receipts enable row level security;

create policy "authenticated read purchase_order_receipts"
  on purchase_order_receipts for select to authenticated using (true);

create policy "authenticated write purchase_order_receipts"
  on purchase_order_receipts for all to authenticated using (true) with check (true);
