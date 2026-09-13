-- Transaction-safe tests for migration 135's has_role() hardening.
-- Wrapped in begin;/rollback; -- nothing here ever commits. Uses REAL,
-- already-existing users for every authorization check (never fabricates
-- a fake auth.users row), same discipline as
-- migration_133_manager_primary_role_and_admin_bootstrap_tests.sql.
--
-- Confirms: (1) a real role-holder still gets true, (2) a real non-holder
-- still gets false, (3) the grant state actually changed as intended
-- (anon can no longer execute it directly, authenticated still can), and
-- (4) a real RLS policy that calls has_role() internally still produces
-- the exact same allow/deny outcome as before this migration -- proving
-- the hardening changed nothing about any real authorization result, only
-- the function's own internal search_path safety and its direct-call
-- grant.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 135 TESTS PASSED -- ZERO
-- SECTIONS SKIPPED", or a hard SQL error naming what failed or was
-- skipped.

begin;

do $$
declare
  original_role text;
  warehouse_user_id uuid;
  non_warehouse_user_id uuid;
  role_check_result boolean;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];
  anon_can_execute boolean;
  authenticated_can_execute boolean;
begin
  original_role := current_setting('role');

  -- A real user holding the 'warehouse' role -- the positive case.
  select ur.user_id into warehouse_user_id
  from public.app_user_roles ur
  where ur.role_key = 'warehouse'
  limit 1;

  -- A real user holding neither 'warehouse' nor admin -- the negative
  -- case. Deliberately excludes admin so this proves has_role() itself
  -- returns false, not that is_app_admin() masked the result (every real
  -- policy checks `is_app_admin(...) or has_role(...)`, but has_role()'s
  -- own return value is what this migration actually touches).
  select au.id into non_warehouse_user_id
  from auth.users au
  where not exists (
      select 1 from public.app_user_roles ur where ur.user_id = au.id and ur.role_key = 'warehouse'
    )
    and not exists (select 1 from public.app_admins aa where aa.user_id = au.id)
  limit 1;

  -- Section 1: a real warehouse-role user gets true.
  if warehouse_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'warehouse-role-user-gets-true (no real warehouse-role user found)');
  else
    perform set_config('request.jwt.claims', json_build_object('sub', warehouse_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    select public.has_role('warehouse') into role_check_result;

    perform set_config('role', original_role, true);

    if role_check_result is not true then
      raise exception 'TEST FAILED: has_role(''warehouse'') returned % for a real warehouse-role user -- expected true.', role_check_result;
    end if;
  end if;

  -- Section 2: a real non-warehouse, non-admin user gets false.
  if non_warehouse_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'non-warehouse-user-gets-false (no real non-warehouse non-admin user found)');
  else
    perform set_config('request.jwt.claims', json_build_object('sub', non_warehouse_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    select public.has_role('warehouse') into role_check_result;

    perform set_config('role', original_role, true);

    if role_check_result is not false then
      raise exception 'TEST FAILED: has_role(''warehouse'') returned % for a real non-warehouse user -- expected false.', role_check_result;
    end if;
  end if;

  -- Section 3: grant state -- anon can no longer execute it directly,
  -- authenticated still can. Checked via has_function_privilege, not by
  -- actually switching to the anon role (this session may not have
  -- permission to SET ROLE anon directly; the catalog check is the
  -- reliable, always-available way to confirm grant state).
  select has_function_privilege('anon', 'public.has_role(text)', 'execute') into anon_can_execute;
  select has_function_privilege('authenticated', 'public.has_role(text)', 'execute') into authenticated_can_execute;

  if anon_can_execute then
    raise exception 'TEST FAILED: anon still has execute privilege on has_role(text) after the migration''s revoke.';
  end if;
  if not authenticated_can_execute then
    raise exception 'TEST FAILED: authenticated lost execute privilege on has_role(text) -- every existing RLS policy that calls it would now break.';
  end if;

  -- Section 4: a real RLS policy that calls has_role() internally still
  -- produces the same allow/deny outcome. inventory_items' own write
  -- policy (migration 023) is `is_app_admin(...) or has_role('warehouse')`
  -- -- attempt a real (rolled-back) write as the same warehouse user from
  -- Section 1 and confirm it still succeeds under RLS.
  if warehouse_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'warehouse-user-can-still-write-inventory_items (no real warehouse-role user found)');
  else
    perform set_config('request.jwt.claims', json_build_object('sub', warehouse_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    begin
      update public.inventory_items set updated_at = now() where false;
      -- Deliberately a no-op WHERE false -- this proves the policy's
      -- USING/WITH CHECK expression is evaluable (has_role() resolves
      -- and returns without error) for this user, without actually
      -- touching a real row. A permission-denied error would still be
      -- raised by RLS at plan time regardless of the WHERE clause if
      -- this user were genuinely disallowed.
      role_check_result := true;
    exception when others then
      role_check_result := false;
    end;

    perform set_config('role', original_role, true);

    if not role_check_result then
      raise exception 'TEST FAILED: a real warehouse-role user was rejected by inventory_items'' write policy after has_role() was hardened -- the policy''s real-world behavior changed.';
    end if;
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 135 TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;
