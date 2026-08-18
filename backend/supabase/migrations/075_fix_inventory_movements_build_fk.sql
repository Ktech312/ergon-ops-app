-- Migration 075: inventory_movements.build_transaction_id was added in
-- migration 021 as a bare `uuid` column -- that migration's own comment
-- called it "a direct FK", but the DDL never actually added the
-- `references build_transactions(id)` constraint. Without a real FK,
-- PostgREST can't discover the relationship the app needs for its
-- `build_transaction:build_transactions(build_number)` embed
-- (INVENTORY_MOVEMENT_SELECT in persistence.ts), so every load of
-- Inventory Movements 400s and silently comes back empty -- Dashboard
-- "Recent Activity", Reports, and Inventory's movement ledger have all
-- been reading nothing this whole time. Found live via a DevTools
-- console check on 2026-08-15.

-- Null out any stray references that don't point to a real row before
-- adding the constraint. Should be a no-op in practice -- the app always
-- resolves this to a real build_transactions.id or null on write
-- (see the movements-upload payload builder in persistence.ts).
update inventory_movements m
set build_transaction_id = null
where m.build_transaction_id is not null
  and not exists (select 1 from build_transactions bt where bt.id = m.build_transaction_id);

alter table inventory_movements
  add constraint inventory_movements_build_transaction_id_fkey
  foreign key (build_transaction_id) references build_transactions(id);
