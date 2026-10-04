-- Transaction-safe canonical test for migration 224 (non-partial unique
-- indexes on legacy_id so PostgREST's `?on_conflict=legacy_id` upserts for
-- inventory_movements and project_allocation_history can be inferred).
-- Wrapped in begin;/rollback; -- nothing here ever commits.
--
-- Covers, for BOTH tables:
-- (a) the unique index on legacy_id exists and is NOT partial (indpred
--     is null) -- the exact property whose absence caused 42P10 in prod.
-- (b) `INSERT ... ON CONFLICT (legacy_id) DO UPDATE` -- the statement
--     PostgREST generates -- is accepted by the planner (it raised 42P10
--     before this migration). Uses a zero-row SELECT so no fixtures are
--     needed; inference is decided at parse time, before any row exists.
-- (c) a duplicate legacy_id is still rejected by a unique-index check
--     (index is unique, so upsert-by-legacy_id stays idempotent), checked
--     structurally via pg_index.indisunique.
--
-- A production-acceptance run ends in exactly one of two ways: the final
-- notice reading "ALL MIGRATION 224 LEGACY_ID UPSERT CONSTRAINT TESTS
-- PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error.

begin;

do $$
declare
  t text;
  idx_unique boolean;
  idx_partial boolean;
  idx_cols text;
begin
  perform set_config('role', 'postgres', true);

  foreach t in array array['inventory_movements', 'project_allocation_history'] loop
    select i.indisunique, i.indpred is not null, a.attname
      into idx_unique, idx_partial, idx_cols
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
     where n.nspname = 'public' and c.relname = t
       and i.indnatts = 1 and a.attname = 'legacy_id'
     order by i.indpred is null desc
     limit 1;

    if idx_cols is null then
      raise exception 'FAIL (a): % has no index on (legacy_id)', t;
    end if;
    if not idx_unique then
      raise exception 'FAIL (c): % legacy_id index is not unique', t;
    end if;
    if idx_partial then
      raise exception 'FAIL (a): % legacy_id unique index is still PARTIAL -- ON CONFLICT (legacy_id) cannot infer it', t;
    end if;
  end loop;

  -- (b) the ON CONFLICT clause PostgREST generates must be plannable.
  begin
    insert into public.inventory_movements (legacy_id, movement_type, inventory_item_id, quantity, to_location_id)
    select 'ZZ-224-X', 'receipt'::inventory_movement_type, gen_random_uuid(), 1, gen_random_uuid()
     where false
    on conflict (legacy_id) do update set quantity = excluded.quantity;
  exception when sqlstate '42P10' then
    raise exception 'FAIL (b): inventory_movements ON CONFLICT (legacy_id) -> 42P10 (no inferable unique index)';
  end;

  begin
    insert into public.project_allocation_history (legacy_id, allocation_number, action, quantity)
    select 'ZZ-224-X', 'ZZ-224-ALLOC', 'allocated', 1
     where false
    on conflict (legacy_id) do update set quantity = excluded.quantity;
  exception when sqlstate '42P10' then
    raise exception 'FAIL (b): project_allocation_history ON CONFLICT (legacy_id) -> 42P10 (no inferable unique index)';
  end;

  raise notice 'ALL MIGRATION 224 LEGACY_ID UPSERT CONSTRAINT TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;
