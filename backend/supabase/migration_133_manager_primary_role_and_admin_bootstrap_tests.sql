-- Transaction-safe tests for migration 133's bridge_set_primary_role()
-- authorization change only. Wrapped in begin;/rollback; -- nothing here
-- ever commits. Uses REAL, already-existing users for every
-- authorization check (never fabricates a fake auth.users row), same
-- discipline as migration_130_recipe_save_tests.sql: a real manager-role
-- user's real primary role is temporarily changed by the function under
-- test, but the whole transaction rolls back at the end regardless.
--
-- This script does NOT test migration 133's other half (the one-time
-- app_admins bootstrap insert for a specific real account) -- that is a
-- plain, idempotent one-time data fix, not function logic, and there is
-- nothing meaningful to assert about it beyond "did the row get
-- inserted," which the migration's own final state already shows.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 133 TESTS PASSED -- ZERO
-- SECTIONS SKIPPED", or a hard SQL error naming what failed or was
-- skipped. It can never quietly finish as "Success. No rows returned."
-- with something having been skipped.

begin;

do $$
declare
  original_role text;
  manager_user_id uuid;
  outsider_user_id uuid;
  target_user_id uuid;
  target_original_primary_role text;
  call_succeeded boolean;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];
begin
  original_role := current_setting('role');

  -- A real user who currently holds the legacy 'manager' role and is NOT
  -- already an admin (excluding any admin keeps this a genuine test of
  -- the NEW manager-only branch, not the pre-existing admin branch).
  select ur.user_id into manager_user_id
  from public.app_user_roles ur
  where ur.role_key = 'manager'
    and not exists (select 1 from public.app_admins aa where aa.user_id = ur.user_id)
  limit 1;

  -- A real user holding neither 'manager' nor admin -- the negative case.
  select au.id into outsider_user_id
  from auth.users au
  where not exists (select 1 from public.app_admins aa where aa.user_id = au.id)
    and not exists (
      select 1 from public.app_user_roles ur where ur.user_id = au.id and ur.role_key = 'manager'
    )
  limit 1;

  -- Any real user distinct from the manager caller, to act as the
  -- target whose primary role gets (temporarily) changed.
  select au.id into target_user_id
  from auth.users au
  where au.id <> manager_user_id
  order by au.created_at
  limit 1;

  if manager_user_id is null or target_user_id is null then
    skipped_count := skipped_count + 1;
    -- array_append(), not `||` -- text[] || 'literal' can resolve to the
    -- array-concat overload instead of array-append when the array is
    -- empty, which then tries to PARSE the plain string as an array
    -- literal (expects a leading '{') and throws "malformed array
    -- literal" instead of appending it as one element. Found live
    -- running this exact script.
    skipped_names := array_append(skipped_names, 'manager-can-set-primary-role (no real non-admin manager-role user, or no distinct target user, found)');
  else
    select role_key into target_original_primary_role
    from public.app_user_roles
    where user_id = target_user_id and is_primary = true;

    perform set_config('request.jwt.claims', json_build_object('sub', manager_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    begin
      perform public.bridge_set_primary_role(target_user_id, 'purchasing');
      call_succeeded := true;
    exception when others then
      call_succeeded := false;
    end;

    perform set_config('role', original_role, true);

    if not call_succeeded then
      raise exception 'TEST FAILED: a real manager-role (non-admin) caller was rejected by bridge_set_primary_role -- expected this to succeed after migration 133.';
    end if;

    if not exists (
      select 1 from public.app_user_roles
      where user_id = target_user_id and role_key = 'purchasing' and is_primary = true
    ) then
      raise exception 'TEST FAILED: bridge_set_primary_role reported success for a manager caller but no matching primary role row exists for the target user.';
    end if;

    -- Restore the target's original primary role before continuing --
    -- moot under this transaction's rollback, but matching this repo's
    -- own established discipline of never leaving a real row mutated
    -- for longer than the test actually needs it mutated.
    if target_original_primary_role is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', manager_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      perform public.bridge_set_primary_role(target_user_id, target_original_primary_role);
      perform set_config('role', original_role, true);
    end if;
  end if;

  -- Negative case: a caller with neither admin nor manager must still be
  -- rejected -- proves this fix widened the gate to exactly one more
  -- role, not to every authenticated user.
  if outsider_user_id is null or target_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'non-manager-non-admin-still-rejected (no real user without admin/manager found)');
  else
    perform set_config('request.jwt.claims', json_build_object('sub', outsider_user_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    begin
      perform public.bridge_set_primary_role(target_user_id, 'purchasing');
      call_succeeded := true;
    exception when others then
      call_succeeded := false;
    end;

    perform set_config('role', original_role, true);

    if call_succeeded then
      raise exception 'TEST FAILED: a caller with neither admin nor manager was able to call bridge_set_primary_role -- the authorization gate is too wide.';
    end if;
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 133 TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;
