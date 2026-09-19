-- Transaction-safe canonical test for migration 186 (is_app_manager()
-- missing anon/public grant fix). Wrapped in begin;/rollback; -- nothing
-- here ever commits.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 186 IS APP MANAGER
-- MISSING GRANTS TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL
-- error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  caught boolean;
  result_val boolean;
begin
  select am.user_id
    into real_user_id
  from public.app_admins am
  join public.workspace_members wm on wm.user_id = am.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin who is also an active workspace member found -- this script requires at least one real app_admins row that is also present in workspace_members.';
  end if;

  -- ============================================================
  -- Section 1: an anon (fully unauthenticated) caller can no longer
  -- execute is_app_manager() at all -- must be rejected outright, not
  -- merely return false (a rejection proves EXECUTE is actually revoked;
  -- a silent "false" would not distinguish "no permission" from "not a
  -- manager").
  -- ============================================================

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', 'null', true);

  caught := false;
  begin
    perform public.is_app_manager(real_user_id);
  exception when insufficient_privilege then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: anon was able to execute is_app_manager()'; end if;

  raise notice 'TEST PASSED: Section 1 -- anon can no longer execute is_app_manager()';

  -- ============================================================
  -- Section 2: an authenticated caller is unaffected -- this migration
  -- must not break the RLS policies that legitimately call
  -- is_app_manager() internally for real authenticated users.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    select public.is_app_manager(real_user_id) into result_val;
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: authenticated call to is_app_manager() was rejected -- this migration should not affect authenticated access'; end if;

  raise notice 'TEST PASSED: Section 2 -- is_app_manager() unaffected for authenticated callers (result=%)', result_val;

  raise notice 'ALL MIGRATION 186 IS APP MANAGER MISSING GRANTS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
