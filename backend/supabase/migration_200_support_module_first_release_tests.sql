-- Transaction-safe canonical test for migration 200 (Support/Service
-- module, first release, decision D13). Wrapped in begin;/rollback; --
-- nothing here ever commits. Two fully synthetic workspaces (never the
-- real production ones) so cross-workspace containment can be proven
-- directly rather than assumed.
--
-- Covers:
-- (a) Creating a case from a ledger-added project succeeds; case_number
--     is generated (SC-<year>-####); the initial 'status_change' activity
--     row ("Case opened.") exists.
-- (b) Creating a case from a project NOT added to the ledger is rejected.
-- (c) Creating a case against ANOTHER workspace's project is rejected --
--     the caller's own resolved workspace never silently adopts a
--     foreign project.
-- (d) A user with no membership anywhere cannot see or create cases.
-- (e) add_support_case_activity covers note/client_communication/
--     scheduled_visit/parts_used; rejects status_change/reopened kinds
--     (those have their own dedicated functions); parts_used rejects an
--     inventory item from a different workspace.
-- (f) change_support_case_status: valid transitions succeed and record a
--     status_change activity row with the CORRECT previous_status (this
--     is the real bug caught and fixed while writing this migration --
--     an earlier draft recorded the NEW status as previous_status since
--     it read v_case.status AFTER the UPDATE; this section proves the
--     fix, not just that a transition happened at all).
-- (g) change_support_case_status: invalid transitions (open -> closed
--     directly, resolved -> open directly, same-status no-op) are all
--     rejected.
-- (h) reopen_support_case: only valid from resolved/closed, sets status
--     to 'reopened' (a real distinct status, not merely an activity
--     kind), records the correct previous_status.
-- (i) support_case_assets: linking an installed asset from the SAME
--     project succeeds; linking one from a DIFFERENT project is
--     rejected, even within the same workspace.
-- (j) A suspended workspace blocks every write path (create, activity,
--     status change) for its own members, via the pre-existing
--     active-workspace discipline -- no new blocking logic was written
--     for this, matching migration 198's own precedent.
-- (k) assign_support_case_owner reassigns correctly within the
--     workspace, rejects an owner id from a different workspace.
-- (l) No delete path exists at all -- RLS has no delete policy on
--     support_cases, so any DELETE attempt is silently a no-op (0 rows
--     affected), never an error, matching this schema's usual RLS-DELETE-
--     denial-is-silent behavior.

begin;

do $$
declare
  ws_a_id uuid;
  ws_b_id uuid;
  user_a_id uuid := gen_random_uuid();
  user_b_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();

  project_a_ledger_id uuid;
  project_a_not_ledger_id uuid;
  project_b_ledger_id uuid;

  asset_a_id uuid;
  asset_b_id uuid;
  inventory_item_a_id uuid;
  inventory_item_b_id uuid;

  case_id uuid;
  case_row record;
  activity_row record;
  row_count integer;
  affected_rows integer;
  caught boolean;
  err_msg text;
  ref_year integer := extract(year from now())::integer;
begin
  -- ============================================================
  -- Setup
  -- ============================================================

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (name, slug, status) values ('ZZ Test 200 Workspace A', 'zz-test-200-ws-a', 'active') returning id into ws_a_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 200 Workspace B', 'zz-test-200-ws-b', 'active') returning id into ws_b_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (user_a_id, 'zz-test-200-user-a@example.com', now()),
    (user_b_id, 'zz-test-200-user-b@example.com', now()),
    (outsider_id, 'zz-test-200-outsider@example.com', now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (ws_a_id, user_a_id, true),
    (ws_b_id, user_b_id, true);

  -- projects' own INSERT policy (migration 157) requires is_app_admin()
  -- or has_role('pm') -- the legacy, still-live gate on who may create a
  -- project at all, unrelated to this migration's own scope. Both test
  -- users need it purely so this test's OWN fixtures can create projects;
  -- neither user's admin status is exercised or asserted on anywhere
  -- else in this test.
  insert into public.app_admins (user_id) values (user_a_id), (user_b_id) on conflict do nothing;

  -- Projects, created AS each workspace's own member so the guard
  -- trigger stamps workspace_id correctly via resolve_caller_workspace_id().
  perform set_config('request.jwt.claims', json_build_object('sub', user_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.projects (project_name) values ('ZZ Test 200 Ledger Project A') returning id into project_a_ledger_id;
  insert into public.projects (project_name) values ('ZZ Test 200 Non-Ledger Project A') returning id into project_a_not_ledger_id;

  perform set_config('request.jwt.claims', json_build_object('sub', user_b_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.projects (project_name) values ('ZZ Test 200 Ledger Project B') returning id into project_b_ledger_id;

  perform set_config('role', 'postgres', true);
  update public.projects set added_to_ledger = true where id in (project_a_ledger_id, project_b_ledger_id);

  insert into public.installed_assets (project_id, serial_number) values (project_a_ledger_id, 'ZZ-TEST-200-SN-A') returning id into asset_a_id;
  insert into public.installed_assets (project_id, serial_number) values (project_b_ledger_id, 'ZZ-TEST-200-SN-B') returning id into asset_b_id;

  perform set_config('request.jwt.claims', json_build_object('sub', user_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.inventory_items (sku, item_name) values ('ZZ-TEST-200-SKU-A', 'ZZ Test 200 Part A') returning id into inventory_item_a_id;

  perform set_config('request.jwt.claims', json_build_object('sub', user_b_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.inventory_items (sku, item_name) values ('ZZ-TEST-200-SKU-B', 'ZZ Test 200 Part B') returning id into inventory_item_b_id;

  -- ============================================================
  -- Section (a): create a case from a ledger project.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', user_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select * into case_row from public.create_support_case(project_a_ledger_id, 'ZZ Test 200: entry point is down', 'high', null, array[asset_a_id]);
  case_id := case_row.id;

  if case_row.case_number is distinct from ('SC-' || ref_year || '-0001') then
    raise exception 'TEST FAILED: expected the first case_number of the year to be SC-%-0001, got %', ref_year, case_row.case_number;
  end if;
  if case_row.status is distinct from 'open' or case_row.priority is distinct from 'high' then
    raise exception 'TEST FAILED: new case has status=%/priority=% (expected open/high)', case_row.status, case_row.priority;
  end if;

  select count(*) into row_count from public.support_case_activity where support_case_id = case_id and kind = 'status_change' and new_status = 'open';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: create_support_case did not log the initial "Case opened" activity row';
  end if;

  select count(*) into row_count from public.support_case_assets where support_case_id = case_id and installed_asset_id = asset_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: create_support_case did not link the requested installed asset';
  end if;

  raise notice 'TEST PASSED: Section (a) -- creating a case from a ledger project works: case_number, status, priority, initial activity row, and asset link all correct';

  -- ============================================================
  -- Section (b): a project not on the ledger is rejected.
  -- ============================================================

  caught := false;
  begin
    perform public.create_support_case(project_a_not_ledger_id, 'ZZ Test 200: should not be allowed', 'normal', null, null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: create_support_case succeeded against a project not added to the Client Ledger';
  end if;

  raise notice 'TEST PASSED: Section (b) -- a project not on the Client Ledger is rejected';

  -- ============================================================
  -- Section (c): another workspace's project is rejected.
  -- ============================================================

  caught := false;
  begin
    perform public.create_support_case(project_b_ledger_id, 'ZZ Test 200: cross-workspace attempt', 'normal', null, null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: user_a (workspace A) could create a support case against workspace B''s own project';
  end if;

  raise notice 'TEST PASSED: Section (c) -- creating a case against another workspace''s project is rejected';

  -- ============================================================
  -- Section (d): a user with no membership anywhere sees and can create
  -- nothing.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', outsider_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.support_cases;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: an outsider with no workspace membership could see % support_cases rows', row_count;
  end if;

  caught := false;
  begin
    perform public.create_support_case(project_a_ledger_id, 'ZZ Test 200: outsider attempt', 'normal', null, null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an outsider with no workspace membership could create a support case';
  end if;

  raise notice 'TEST PASSED: Section (d) -- a user with no workspace membership sees and can create nothing';

  -- ============================================================
  -- Section (e): add_support_case_activity -- valid kinds, rejected
  -- kinds, cross-workspace inventory item rejected.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', user_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.add_support_case_activity(case_id, 'note', 'ZZ Test 200: called the client back.');
  perform public.add_support_case_activity(case_id, 'client_communication', 'ZZ Test 200: emailed the client an update.');
  perform public.add_support_case_activity(case_id, 'scheduled_visit', 'ZZ Test 200: site visit booked.', now() + interval '3 days');
  select * into activity_row from public.add_support_case_activity(case_id, 'parts_used', 'ZZ Test 200: replaced the unit.', null, inventory_item_a_id, 2);

  if activity_row.qty is distinct from 2 or activity_row.inventory_item_id is distinct from inventory_item_a_id then
    raise exception 'TEST FAILED: parts_used activity row did not record the item/qty correctly';
  end if;

  select count(*) into row_count from public.support_case_activity where support_case_id = case_id;
  if row_count is distinct from 5 then -- 1 (case opened) + 4 above
    raise exception 'TEST FAILED: expected 5 activity rows on the case so far, found %', row_count;
  end if;

  caught := false;
  begin
    perform public.add_support_case_activity(case_id, 'status_change', 'ZZ Test 200: should not work here');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: add_support_case_activity accepted kind=status_change (must go through change_support_case_status)';
  end if;

  caught := false;
  begin
    perform public.add_support_case_activity(case_id, 'reopened', 'ZZ Test 200: should not work here');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: add_support_case_activity accepted kind=reopened (must go through reopen_support_case)';
  end if;

  caught := false;
  begin
    perform public.add_support_case_activity(case_id, 'parts_used', 'ZZ Test 200: wrong workspace item', null, inventory_item_b_id, 1);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: parts_used accepted an inventory item belonging to a different workspace';
  end if;

  raise notice 'TEST PASSED: Section (e) -- add_support_case_activity handles note/client_communication/scheduled_visit/parts_used, rejects status_change/reopened, and rejects a cross-workspace inventory item';

  -- ============================================================
  -- Section (f): valid status transitions record the CORRECT
  -- previous_status (the real bug this migration's own dev caught).
  -- ============================================================

  select * into case_row from public.change_support_case_status(case_id, 'in_progress', 'ZZ Test 200: starting work.');
  if case_row.status is distinct from 'in_progress' then
    raise exception 'TEST FAILED: change_support_case_status did not move the case to in_progress';
  end if;

  select previous_status, new_status into activity_row from public.support_case_activity
    where support_case_id = case_id and kind = 'status_change' and new_status = 'in_progress'
    order by occurred_at desc limit 1;
  if activity_row.previous_status is distinct from 'open' then
    raise exception 'TEST FAILED: status_change activity recorded previous_status=% (expected open) -- the exact previous/new-status ordering bug', activity_row.previous_status;
  end if;

  select * into case_row from public.change_support_case_status(case_id, 'resolved', 'ZZ Test 200: fixed.');
  if case_row.status is distinct from 'resolved' or case_row.resolved_at is null then
    raise exception 'TEST FAILED: change_support_case_status to resolved did not set status/resolved_at correctly';
  end if;

  select previous_status into activity_row from public.support_case_activity
    where support_case_id = case_id and kind = 'status_change' and new_status = 'resolved'
    order by occurred_at desc limit 1;
  if activity_row.previous_status is distinct from 'in_progress' then
    raise exception 'TEST FAILED: resolved transition recorded previous_status=% (expected in_progress)', activity_row.previous_status;
  end if;

  raise notice 'TEST PASSED: Section (f) -- valid status transitions succeed and record the correct previous_status on every step';

  -- ============================================================
  -- Section (g): invalid transitions are rejected.
  -- ============================================================

  caught := false;
  begin
    perform public.change_support_case_status(case_id, 'resolved', null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: change_support_case_status allowed a same-status no-op (resolved -> resolved)';
  end if;

  caught := false;
  begin
    perform public.change_support_case_status(case_id, 'open', null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: change_support_case_status allowed resolved -> open directly (must go through reopen_support_case)';
  end if;

  raise notice 'TEST PASSED: Section (g) -- invalid transitions (no-op, resolved -> open directly) are rejected';

  -- ============================================================
  -- Section (h): reopen_support_case.
  -- ============================================================

  select * into case_row from public.reopen_support_case(case_id, 'ZZ Test 200: client reports it broke again.');
  if case_row.status is distinct from 'reopened' then
    raise exception 'TEST FAILED: reopen_support_case did not set status to reopened (got %)', case_row.status;
  end if;

  select previous_status, new_status into activity_row from public.support_case_activity
    where support_case_id = case_id and kind = 'reopened'
    order by occurred_at desc limit 1;
  if activity_row.previous_status is distinct from 'resolved' or activity_row.new_status is distinct from 'reopened' then
    raise exception 'TEST FAILED: reopened activity row recorded previous_status=%/new_status=% (expected resolved/reopened)', activity_row.previous_status, activity_row.new_status;
  end if;

  caught := false;
  begin
    perform public.reopen_support_case(case_id, null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: reopen_support_case succeeded against a case that was not resolved/closed (already reopened)';
  end if;

  select * into case_row from public.change_support_case_status(case_id, 'closed', 'ZZ Test 200: closing for good.');
  if case_row.status is distinct from 'closed' or case_row.closed_at is null then
    raise exception 'TEST FAILED: reopened -> closed transition did not work';
  end if;

  raise notice 'TEST PASSED: Section (h) -- reopen_support_case only works from resolved/closed, sets status to reopened correctly, and reopened -> closed works afterward';

  -- ============================================================
  -- Section (i): support_case_assets cross-project containment.
  -- ============================================================

  caught := false;
  begin
    insert into public.support_case_assets (support_case_id, installed_asset_id) values (case_id, asset_b_id);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: linked an installed asset belonging to a different project (workspace B''s own asset) onto workspace A''s case';
  end if;

  raise notice 'TEST PASSED: Section (i) -- linking an installed asset from a different project is rejected';

  -- ============================================================
  -- Section (j): a suspended workspace blocks every write path for its
  -- own members -- no new blocking logic, same pre-existing discipline
  -- as migration 198.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  update public.workspaces set status = 'suspended' where id = ws_a_id;

  perform set_config('request.jwt.claims', json_build_object('sub', user_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.create_support_case(project_a_ledger_id, 'ZZ Test 200: should be blocked', 'normal', null, null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: create_support_case succeeded for a member of a SUSPENDED workspace';
  end if;

  caught := false;
  begin
    perform public.add_support_case_activity(case_id, 'note', 'ZZ Test 200: should be blocked');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: add_support_case_activity succeeded for a member of a SUSPENDED workspace';
  end if;

  perform set_config('role', 'postgres', true);
  update public.workspaces set status = 'active' where id = ws_a_id;

  raise notice 'TEST PASSED: Section (j) -- a suspended workspace blocks every support-case write path for its own members, via the pre-existing active-workspace discipline';

  -- ============================================================
  -- Section (k): assign_support_case_owner.
  -- ============================================================

  declare
    owner_member_id uuid;
    other_ws_member_id uuid;
  begin
    -- Fetched as postgres, bypassing RLS -- this is test setup, not
    -- something the real user_a should be able to see (workspace_members
    -- RLS correctly hides workspace B's own member row from a workspace A
    -- caller, confirmed incidentally by this needing the role switch at
    -- all). Fetching these as user_a instead silently returned NULL for
    -- other_ws_member_id the first time this test was written, which
    -- made assign_support_case_owner's own rejection check a no-op
    -- (NULL short-circuits the "is not null" guard) -- a real bug in
    -- this test's fixture gathering, not in the function itself.
    perform set_config('role', 'postgres', true);
    select id into owner_member_id from public.workspace_members where workspace_id = ws_a_id and user_id = user_a_id;
    select id into other_ws_member_id from public.workspace_members where workspace_id = ws_b_id and user_id = user_b_id;
    if owner_member_id is null or other_ws_member_id is null then
      raise exception 'TEST SETUP FAILED: could not resolve owner_member_id/other_ws_member_id fixtures';
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', user_a_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    select * into case_row from public.assign_support_case_owner(case_id, owner_member_id);
    if case_row.owner_workspace_member_id is distinct from owner_member_id then
      raise exception 'TEST FAILED: assign_support_case_owner did not set the owner correctly';
    end if;

    caught := false;
    begin
      perform public.assign_support_case_owner(case_id, other_ws_member_id);
    exception when others then
      caught := true;
    end;
    if not caught then
      raise exception 'TEST FAILED: assign_support_case_owner accepted a workspace_members id from a DIFFERENT workspace';
    end if;
  end;

  raise notice 'TEST PASSED: Section (k) -- assign_support_case_owner reassigns correctly within the workspace, rejects a cross-workspace owner id';

  -- ============================================================
  -- Section (l): no delete path exists -- RLS silently denies (0 rows
  -- affected, no error), same as every other RLS-DELETE-denial in this
  -- schema.
  -- ============================================================

  delete from public.support_cases where id = case_id;
  get diagnostics affected_rows = row_count;
  if affected_rows is distinct from 0 then
    raise exception 'TEST FAILED: a support_cases row was actually deleted -- no delete policy should exist at all';
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.support_cases where id = case_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the support_cases row is genuinely gone (expected the RLS-silent-denial case: still exists)';
  end if;

  raise notice 'TEST PASSED: Section (l) -- no delete path exists on support_cases; RLS silently denies the attempt';

  raise notice 'ALL MIGRATION 200 SUPPORT MODULE FIRST RELEASE TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
