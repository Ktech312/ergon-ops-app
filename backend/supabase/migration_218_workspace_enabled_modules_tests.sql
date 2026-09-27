-- Transaction-safe canonical test for migration 218 (workspace_enabled_
-- modules + is_module_enabled() + set_workspace_module_enabled() +
-- workspace_module_audit_log + backend enforcement on the Support and
-- Engineering modules). Wrapped in begin;/rollback; -- nothing here ever
-- commits. Two fully synthetic workspaces so cross-workspace isolation
-- can be proven directly rather than assumed.
--
-- Covers:
-- (a) Default (opt-out) behavior: with no workspace_enabled_modules row
--     at all, both modules behave exactly as before this migration --
--     a member can create and read a support case and a product request.
-- (b) An ordinary (non-admin) workspace member cannot call
--     set_workspace_module_enabled for their own workspace.
-- (c) A workspace admin CAN disable a module for their own workspace;
--     doing so writes a 'disabled' row to workspace_module_audit_log.
-- (d) Once disabled: an ordinary member can no longer read the existing
--     support case (blocked, not merely hidden from a list), cannot
--     create a new one, and cannot record activity against the existing
--     one -- but the row itself is still physically present (data
--     preserved, not deleted).
-- (e) Disabling 'support' does not touch 'engineering_requests' for the
--     SAME workspace -- module gates are independent of each other.
-- (f) Re-enabling restores full access to the SAME, untouched row, and
--     writes an 'enabled' audit row.
-- (g) Disabling a module for workspace A has zero effect on workspace
--     B's own independent module state.
-- (h) A real global app_admin who also happens to be an ordinary
--     (non-admin-flagged) member of a workspace can still toggle that
--     workspace's own modules -- the is_app_admin() bypass in
--     set_workspace_module_enabled.
-- (i) The Engineering module: same disable -> blocked -> re-enable ->
--     restored shape, covering product_requests and its child table
--     product_request_reviews.
-- (j) workspace_enabled_modules itself: a member reads their own
--     workspace's rows; a different workspace's member cannot see them.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 218 WORKSPACE ENABLED
-- MODULES TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  ws_a_id uuid;
  ws_b_id uuid;
  admin_a_id uuid := gen_random_uuid();
  member_a_id uuid := gen_random_uuid();
  global_admin_member_a_id uuid := gen_random_uuid();
  admin_b_id uuid := gen_random_uuid();
  member_b_id uuid := gen_random_uuid();

  project_a_id uuid;
  project_b_id uuid;

  case_a_id uuid;
  case_b_id uuid;
  request_a_id uuid;

  row_count integer;
  caught boolean;
  err_msg text;
begin
  -- ============================================================
  -- Setup
  -- ============================================================

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (name, slug, status) values ('ZZ Test 218 Workspace A', 'zz-test-218-ws-a', 'active') returning id into ws_a_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 218 Workspace B', 'zz-test-218-ws-b', 'active') returning id into ws_b_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (admin_a_id, 'zz-test-218-admin-a@example.com', now()),
    (member_a_id, 'zz-test-218-member-a@example.com', now()),
    (global_admin_member_a_id, 'zz-test-218-global-admin-member-a@example.com', now()),
    (admin_b_id, 'zz-test-218-admin-b@example.com', now()),
    (member_b_id, 'zz-test-218-member-b@example.com', now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (ws_a_id, admin_a_id, true),
    (ws_a_id, member_a_id, false),
    (ws_a_id, global_admin_member_a_id, false),
    (ws_b_id, admin_b_id, true),
    (ws_b_id, member_b_id, false);

  -- global_admin_member_a_id is a real GLOBAL app_admin, but flagged
  -- is_workspace_admin = false in workspace A -- Section (h) proves the
  -- is_app_admin() bypass is what lets them act, not a mistaken
  -- workspace-admin flag.
  insert into public.app_admins (user_id) values (global_admin_member_a_id);

  -- projects' own INSERT policy needs is_app_admin() or has_role('pm') --
  -- unrelated to this migration, same as migration 200's own test setup.
  insert into public.app_admins (user_id) values (admin_a_id), (admin_b_id) on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.projects (project_name) values ('ZZ Test 218 Project A') returning id into project_a_id;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_b_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.projects (project_name) values ('ZZ Test 218 Project B') returning id into project_b_id;

  perform set_config('role', 'postgres', true);
  update public.projects set added_to_ledger = true where id in (project_a_id, project_b_id);

  -- ============================================================
  -- Section (a): default (opt-out) behavior -- no row in
  -- workspace_enabled_modules at all yet, both modules work exactly as
  -- they did before this migration.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select (public.create_support_case(project_a_id, 'ZZ Test 218 case, module enabled by default')).id into case_a_id;
  select (public.create_product_request('ZZ Test 218 request, module enabled by default')).id into request_a_id;

  select count(*) into row_count from public.support_cases where id = case_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: with no workspace_enabled_modules row, a member cannot read a support case they just created';
  end if;

  select count(*) into row_count from public.product_requests where id = request_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: with no workspace_enabled_modules row, a member cannot read a product request they just created';
  end if;

  raise notice 'TEST PASSED: Section (a) -- with no row at all, both modules default to fully enabled, unchanged from before this migration';

  -- ============================================================
  -- Section (b): an ordinary member cannot change module settings.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.set_workspace_module_enabled('support', false);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an ordinary workspace member could disable a module';
  end if;

  raise notice 'TEST PASSED: Section (b) -- an ordinary member cannot call set_workspace_module_enabled';

  -- ============================================================
  -- Section (c): a workspace admin can disable a module; an audit row
  -- is written.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.set_workspace_module_enabled('support', false);

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_module_audit_log
    where workspace_id = ws_a_id and module_key = 'support' and action = 'disabled' and actor_user_id = admin_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: disabling a module did not write a disabled audit row';
  end if;

  raise notice 'TEST PASSED: Section (c) -- a workspace admin can disable a module, recorded in workspace_module_audit_log';

  -- ============================================================
  -- Section (d): once disabled -- blocked read, blocked create, blocked
  -- activity on the existing case; the row itself is still present.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.support_cases where id = case_a_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a member could still read a support case after the Support module was disabled for their workspace';
  end if;

  caught := false;
  begin
    perform public.create_support_case(project_a_id, 'ZZ Test 218 should be blocked');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a member could still create a support case after the Support module was disabled';
  end if;

  perform set_config('role', 'postgres', true);
  caught := false;
  begin
    insert into public.support_case_activity (support_case_id, kind, actor_email)
    values (case_a_id, 'note', 'zz-test-218-member-a@example.com');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an activity row could still be inserted against a case in a workspace with Support disabled';
  end if;

  select count(*) into row_count from public.support_cases where id = case_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the support case row was deleted or lost while the module was disabled -- data must be preserved';
  end if;

  raise notice 'TEST PASSED: Section (d) -- disabling Support blocks read, create, and activity for existing members, while preserving the underlying data';

  -- ============================================================
  -- Section (e): module gates are independent -- Engineering is
  -- unaffected by Support being disabled, in the SAME workspace.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.product_requests where id = request_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: disabling Support incorrectly blocked Engineering in the same workspace';
  end if;

  raise notice 'TEST PASSED: Section (e) -- disabling one module has no effect on another module in the same workspace';

  -- ============================================================
  -- Section (f): re-enabling restores access to the same row; writes an
  -- 'enabled' audit row.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.set_workspace_module_enabled('support', true);

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_module_audit_log
    where workspace_id = ws_a_id and module_key = 'support' and action = 'enabled' and actor_user_id = admin_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: re-enabling a module did not write an enabled audit row';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.support_cases where id = case_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: re-enabling Support did not restore read access to the original, preserved case';
  end if;

  raise notice 'TEST PASSED: Section (f) -- re-enabling a module restores full access to the same, untouched data';

  -- ============================================================
  -- Section (g): workspace isolation -- workspace A's disable/enable
  -- history has zero effect on workspace B's own module state.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_b_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select (public.create_support_case(project_b_id, 'ZZ Test 218 workspace B case')).id into case_b_id;

  select count(*) into row_count from public.support_cases where id = case_b_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: workspace B''s own Support module was affected by workspace A''s module changes';
  end if;

  raise notice 'TEST PASSED: Section (g) -- a workspace''s module state is fully independent of any other workspace''s';

  -- ============================================================
  -- Section (h): a real global app_admin who is only an ordinary
  -- (non-admin-flagged) member of workspace A can still toggle its
  -- modules -- the is_app_admin() bypass.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', global_admin_member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.set_workspace_module_enabled('engineering_requests', false);

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_enabled_modules
    where workspace_id = ws_a_id and module_key = 'engineering_requests' and enabled = false;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a global app_admin who is only an ordinary workspace member could not disable that workspace''s module';
  end if;

  raise notice 'TEST PASSED: Section (h) -- a global app_admin can act on a workspace they belong to even without the workspace-admin flag';

  -- ============================================================
  -- Section (i): Engineering module -- disable blocks product_requests
  -- and product_request_reviews; re-enable restores; data preserved.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.product_requests where id = request_a_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a member could still read a product request after Engineering was disabled for their workspace';
  end if;

  caught := false;
  begin
    perform public.create_product_request('ZZ Test 218 should be blocked');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a member could still create a product request after Engineering was disabled';
  end if;

  perform set_config('role', 'postgres', true);
  caught := false;
  begin
    insert into public.product_request_reviews (product_request_id, kind, reviewed_by_email)
    values (request_a_id, 'status_change', 'zz-test-218-member-a@example.com');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a review row could still be inserted against a request in a workspace with Engineering disabled';
  end if;

  select count(*) into row_count from public.product_requests where id = request_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the product request row was deleted or lost while Engineering was disabled -- data must be preserved';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.set_workspace_module_enabled('engineering_requests', true);

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into row_count from public.product_requests where id = request_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: re-enabling Engineering did not restore read access to the original, preserved request';
  end if;

  raise notice 'TEST PASSED: Section (i) -- the Engineering module gates product_requests and product_request_reviews the same way Support gates its own tables, and re-enabling restores the same preserved data';

  -- ============================================================
  -- Section (j): workspace_enabled_modules itself -- a member reads
  -- their own workspace's rows; a different workspace's member cannot.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.workspace_enabled_modules where workspace_id = ws_a_id;
  if row_count < 1 then
    raise exception 'TEST FAILED: a workspace member cannot read their own workspace''s module settings';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', member_b_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.workspace_enabled_modules where workspace_id = ws_a_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a different workspace''s member could read workspace A''s module settings';
  end if;

  raise notice 'TEST PASSED: Section (j) -- workspace_enabled_modules rows are only readable by that workspace''s own members';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 218 WORKSPACE ENABLED MODULES TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
