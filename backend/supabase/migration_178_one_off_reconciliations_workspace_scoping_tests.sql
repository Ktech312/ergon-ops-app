-- Transaction-safe canonical test for migration 178
-- (one_off_reconciliations workspace scoping). Wrapped in
-- begin;/rollback; -- nothing here ever commits. The synthetic second
-- workspace lives ONLY inside this rolled-back transaction.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 178 ONE OFF
-- RECONCILIATIONS WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS
-- SKIPPED", or a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  row_a_id uuid;
  seen_workspace_id uuid;
  visible_count int;
begin
  select am.user_id, wm.workspace_id, wm.is_workspace_admin
    into real_user_id, real_workspace_id, real_member_was_admin
  from public.app_admins am
  join public.workspace_members wm on wm.user_id = am.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin who is also an active workspace member found -- this script requires at least one real app_admins row that is also present in workspace_members.';
  end if;

  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_178 Other Workspace', 'zz-test-178-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: an authenticated workspace member can insert a row and
  -- its workspace_id derives from the caller's own resolved workspace
  -- (guard_workspace_id_mutation).
  -- ============================================================

  insert into public.one_off_reconciliations (item_key, item_name, qty, target_sku)
    values ('zz-test-178-key', 'ZZ_TEST_178 Item', 1, 'ZZ-TEST-178-SKU')
    returning id, workspace_id into row_a_id, seen_workspace_id;

  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: one_off_reconciliations.workspace_id did not derive from the caller''s own resolved workspace (got %, expected %)', seen_workspace_id, real_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 1 -- one_off_reconciliations.workspace_id derives from the inserting caller''s workspace';

  -- ============================================================
  -- Section 2: a workspace-B caller cannot read workspace A's row
  -- (row-count check, not exception-based -- SELECT-side RLS denial is
  -- silent).
  -- ============================================================

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.one_off_reconciliations where id = row_a_id;
  if visible_count <> 0 then raise exception 'TEST FAILED: a workspace-B caller could read workspace A''s one_off_reconciliations row'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.one_off_reconciliations where id = row_a_id;
  if visible_count <> 1 then raise exception 'TEST FAILED: a workspace-A caller could not read their own one_off_reconciliations row after being restored'; end if;

  raise notice 'TEST PASSED: Section 2 -- one_off_reconciliations cross-workspace read is blocked';

  raise notice 'ALL MIGRATION 178 ONE OFF RECONCILIATIONS WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
