-- Transaction-safe canonical test for migration 171 (revoke stray anon
-- grants on app_sync_events/app_transaction_locks, pre-`workspaces`
-- MVP leftovers). Wrapped in begin;/rollback; -- nothing here ever
-- commits.
--
-- Since this migration only ever REMOVES privileges, every section here
-- is a negative check (anon must now be rejected) plus one regression
-- check per table/function (authenticated access must be unaffected).
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 171 REVOKE STRAY ANON
-- GRANTS TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  caught boolean;
  lock_row_id uuid;
  visible_count int;
  fixture_event_id uuid;
begin
  select am.user_id into real_user_id
  from public.app_admins am
  join public.workspace_members wm on wm.user_id = am.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin who is also an active workspace member found -- this script requires at least one real app_admins row that is also present in workspace_members.';
  end if;

  -- ============================================================
  -- Section 1: app_sync_events -- anon can no longer read or write;
  -- authenticated still can (regression check). A real fixture row is
  -- inserted first (as postgres, bypassing RLS) so the read-denial
  -- check proves something meaningful: RLS denies a SELECT by silently
  -- returning zero rows, not by raising an exception, so "no exception"
  -- is never a valid way to test read access -- the check has to be a
  -- row-count comparison against a row that is confirmed to exist.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.app_sync_events (event_type, entity_type, entity_ref)
    values ('normalized_write', 'zz_test_171', 'zz-test-171-fixture')
    returning id into fixture_event_id;

  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);

  caught := false;
  begin
    insert into public.app_sync_events (event_type, entity_type, entity_ref)
      values ('normalized_write', 'zz_test_171', 'zz-test-171-anon');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: anon was able to write to app_sync_events'; end if;

  select count(*) into visible_count from public.app_sync_events where id = fixture_event_id;
  if visible_count <> 0 then raise exception 'TEST FAILED: anon was able to read a real app_sync_events row'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.app_sync_events where id = fixture_event_id;
  if visible_count <> 1 then raise exception 'TEST FAILED: authenticated could not read app_sync_events -- this migration should not affect authenticated access'; end if;

  caught := false;
  begin
    insert into public.app_sync_events (event_type, entity_type, entity_ref)
      values ('normalized_write', 'zz_test_171', 'zz-test-171-authenticated');
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: authenticated write to app_sync_events was rejected -- this migration should not affect authenticated access'; end if;

  raise notice 'TEST PASSED: Section 1 -- app_sync_events: anon rejected, authenticated unaffected';

  -- ============================================================
  -- Section 2: app_transaction_locks -- same pattern (a real fixture
  -- row first, then a row-count check for read-denial, not an
  -- exception check).
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.app_transaction_locks (lock_key, lock_type)
    values ('zz-test-171-fixture', 'project');

  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);

  caught := false;
  begin
    insert into public.app_transaction_locks (lock_key, lock_type)
      values ('zz-test-171-anon', 'project');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: anon was able to write to app_transaction_locks'; end if;

  select count(*) into visible_count from public.app_transaction_locks where lock_key = 'zz-test-171-fixture';
  if visible_count <> 0 then raise exception 'TEST FAILED: anon was able to read a real app_transaction_locks row'; end if;

  caught := false;
  begin
    perform public.acquire_transaction_lock('default', 'project', 'zz-test-171-anon-rpc', 'zz-test-171', 300);
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: anon was able to execute acquire_transaction_lock()'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    select id into lock_row_id from public.acquire_transaction_lock('default', 'project', 'zz-test-171-authenticated-rpc', 'zz-test-171', 300);
  exception when others then
    caught := true;
  end;
  if caught or lock_row_id is null then raise exception 'TEST FAILED: authenticated call to acquire_transaction_lock() was rejected -- this migration should not affect authenticated access'; end if;

  raise notice 'TEST PASSED: Section 2 -- app_transaction_locks/acquire_transaction_lock(): anon rejected, authenticated unaffected';

  raise notice 'ALL MIGRATION 171 REVOKE STRAY ANON GRANTS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
