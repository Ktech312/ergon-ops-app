-- Phase 10e prep: the app's movement model doesn't track physical
-- from/to locations at all (Phase 10c settled on one flat "Main Warehouse"
-- balance per SKU), and it legitimately posts zero-quantity movements for
-- "retire"/"reactivate" events (a status-change log entry, not a stock
-- move). The original schema (migration 001) didn't anticipate either of
-- these, so writing real app movement rows through the client (rather than
-- the one-time backfill in migration 021, which never actually inserted a
-- row if the source blob's movement list was empty) needs both relaxed:
--
-- 1. `quantity > 0` -> `quantity >= 0` (allow retire/reactivate's 0 qty).
-- 2. drop the `from_location_id is not null or to_location_id is not null`
--    check entirely -- this app has no location-to-location transfer
--    concept for movements, so requiring one is a mismatch with real usage,
--    not a real constraint worth enforcing here.
--
-- Both changes are looked up by definition text (not by a guessed
-- auto-generated constraint name) so this is safe to re-run.

do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'inventory_movements'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%from_location_id%'
  loop
    execute format('alter table inventory_movements drop constraint %I', con.conname);
  end loop;

  for con in
    select conname from pg_constraint
    where conrelid = 'inventory_movements'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%quantity > 0%'
  loop
    execute format('alter table inventory_movements drop constraint %I', con.conname);
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_quantity_nonneg') then
    alter table inventory_movements
      add constraint inventory_movements_quantity_nonneg check (quantity >= 0);
  end if;
end $$;
