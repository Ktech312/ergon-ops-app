-- Migration 224: make the app's `?on_conflict=legacy_id` upserts work for
-- inventory_movements and project_allocation_history.
--
-- Found in the 2026-10-04 functional walkthrough. Migration 021 created
-- PARTIAL unique indexes (`... where legacy_id is not null`). PostgREST's
-- `on_conflict=legacy_id` generates `ON CONFLICT (legacy_id)` with no
-- predicate, and Postgres can only infer a PARTIAL index when the statement
-- repeats its predicate -- so every save failed with 42P10 ("no unique or
-- exclusion constraint matching the ON CONFLICT specification").
-- Production confirmed it: both tables had 0 rows while inventory_balances
-- and build_transactions were populated. The UI reported success because
-- the balance save happens before (and independently of) the ledger save.
--
-- A plain (non-partial) unique index on legacy_id is equivalent for the data
-- (NULLs are never equal to each other, so rows without a legacy_id are
-- unaffected) and is inferable. Idempotent.

drop index if exists idx_inventory_movements_legacy_id;
create unique index if not exists idx_inventory_movements_legacy_id
  on inventory_movements(legacy_id);

drop index if exists idx_project_allocation_history_legacy_id;
create unique index if not exists idx_project_allocation_history_legacy_id
  on project_allocation_history(legacy_id);
