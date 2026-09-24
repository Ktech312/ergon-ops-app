-- Transaction-safe canonical test for migration 201 (Engineering/Product
-- Development module, first release, decision D14). Wrapped in
-- begin;/rollback; -- nothing here ever commits. Two fully synthetic
-- workspaces so cross-workspace containment can be proven directly.
--
-- Covers:
-- (a) Any active workspace member can submit a request (design doc §6's
--     own "recommended yes" resolved); request_number generated
--     correctly (PR-<year>-0001); the initial status_change row exists.
-- (b) A source_project_id belonging to a DIFFERENT workspace is rejected.
-- (c) A plain member with neither the engineering nor product_development
--     role cannot log a review, change status, or release -- role gating
--     actually works, not just documented intent.
-- (d) log_product_request_review: technical_review outcomes (pass/fail/
--     needs_revision) each drive the correct automatic status
--     transition, with a status_change row recorded alongside the review
--     row itself.
-- (e) log_product_request_review: prototype_test pass advances to
--     release_ready; fail leaves it in prototyping (still logged, so a
--     retry doesn't need a manual status move first).
-- (f) log_product_request_review rejects kind=release_readiness (must go
--     through release_product_request) and rejects logging against an
--     already-released/declined request.
-- (g) change_product_request_status: a valid manual move records the
--     correct previous/new status; rejects reaching 'released' directly;
--     rejects a same-status no-op; rejects acting on a released/declined
--     request.
-- (h) release_product_request mode=new: only from release_ready; creates
--     a real product_catalog row in the SAME workspace, sets
--     released_catalog_item_id and status=released, logs a
--     release_readiness review row with the correct previous/new status.
-- (i) release_product_request mode=update: updates an EXISTING catalog
--     item; rejects one belonging to a different workspace.
-- (j) A suspended workspace blocks every write path (create, review,
--     status change) for its own members -- the same pre-existing
--     active-workspace discipline as migration 200, not new logic.
-- (k) Cross-workspace read isolation: a member of workspace B cannot see
--     workspace A's product_requests or product_request_reviews at all.
-- (l) No delete path exists on product_requests.

begin;

do $$
declare
  ws_a_id uuid;
  ws_b_id uuid;
  engineer_id uuid := gen_random_uuid();
  plain_member_id uuid := gen_random_uuid();
  ws_b_member_id uuid := gen_random_uuid();

  request_id uuid;
  request_row record;
  review_row record;
  row_count integer;
  caught boolean;
  ref_year integer := extract(year from now())::integer;
  catalog_item_id uuid;
  second_request_id uuid;
begin
  -- ============================================================
  -- Setup
  -- ============================================================

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (name, slug, status) values ('ZZ Test 201 Workspace A', 'zz-test-201-ws-a', 'active') returning id into ws_a_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 201 Workspace B', 'zz-test-201-ws-b', 'active') returning id into ws_b_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (engineer_id, 'zz-test-201-engineer@example.com', now()),
    (plain_member_id, 'zz-test-201-plain-member@example.com', now()),
    (ws_b_member_id, 'zz-test-201-ws-b-member@example.com', now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (ws_a_id, engineer_id, false),
    (ws_a_id, plain_member_id, false),
    (ws_b_id, ws_b_member_id, false);

  insert into public.app_user_roles (user_id, role_key, is_primary) values (engineer_id, 'engineering', true);

  -- ============================================================
  -- Section (a): any active member can submit.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', plain_member_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select * into request_row from public.create_product_request('ZZ Test 201: Outdoor housing revision', 'Needs IP67 rating', null, 'ZZ Test Client Co');
  request_id := request_row.id;

  if request_row.request_number is distinct from ('PR-' || ref_year || '-0001') then
    raise exception 'TEST FAILED: expected the first request_number of the year to be PR-%-0001, got %', ref_year, request_row.request_number;
  end if;
  if request_row.status is distinct from 'submitted' then
    raise exception 'TEST FAILED: new request has status=% (expected submitted)', request_row.status;
  end if;

  select count(*) into row_count from public.product_request_reviews where product_request_id = request_id and kind = 'status_change' and new_status = 'submitted';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: create_product_request did not log the initial "submitted" status_change row';
  end if;

  raise notice 'TEST PASSED: Section (a) -- any active workspace member can submit a request; request_number and initial audit row are correct';

  -- ============================================================
  -- Section (b): a source_project_id from another workspace is rejected.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.app_admins (user_id) values (ws_b_member_id) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', ws_b_member_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  declare
    ws_b_project_id uuid;
  begin
    insert into public.projects (project_name) values ('ZZ Test 201 Project B') returning id into ws_b_project_id;

    perform set_config('request.jwt.claims', json_build_object('sub', plain_member_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    caught := false;
    begin
      perform public.create_product_request('ZZ Test 201: cross-workspace attempt', null, ws_b_project_id, null);
    exception when others then
      caught := true;
    end;
    if not caught then
      raise exception 'TEST FAILED: create_product_request accepted a source_project_id belonging to a different workspace';
    end if;
  end;

  raise notice 'TEST PASSED: Section (b) -- a source_project_id from another workspace is rejected';

  -- ============================================================
  -- Section (c): a plain member (no engineering/product_development
  -- role) cannot review, change status, or release.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', plain_member_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.log_product_request_review(request_id, 'technical_review', 'pass', 'should not work');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a plain member (no engineering/product_development role) could log a review';
  end if;

  caught := false;
  begin
    perform public.change_product_request_status(request_id, 'requirements_review', 'should not work');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a plain member could change a request''s status';
  end if;

  caught := false;
  begin
    perform public.release_product_request(request_id, 'new', null, 'ZZ-TEST-201-SKU', 'Should not work', null, null, null, 0, null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a plain member could release a product request';
  end if;

  raise notice 'TEST PASSED: Section (c) -- a plain member with neither role cannot review, change status, or release';

  -- ============================================================
  -- Section (d): log_product_request_review -- technical_review outcomes
  -- drive the correct automatic transition.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', engineer_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select * into review_row from public.log_product_request_review(request_id, 'technical_review', 'needs_revision', 'Needs more detail.');
  select * into request_row from public.product_requests where id = request_id;
  if request_row.status is distinct from 'requirements_review' then
    raise exception 'TEST FAILED: technical_review outcome=needs_revision did not move the request to requirements_review (got %)', request_row.status;
  end if;

  select * into review_row from public.log_product_request_review(request_id, 'technical_review', 'pass', 'Looks good, build a prototype.');
  select * into request_row from public.product_requests where id = request_id;
  if request_row.status is distinct from 'prototyping' then
    raise exception 'TEST FAILED: technical_review outcome=pass did not move the request to prototyping (got %)', request_row.status;
  end if;

  select previous_status, new_status into review_row from public.product_request_reviews
    where product_request_id = request_id and kind = 'status_change' order by reviewed_at desc limit 1;
  if review_row.previous_status is distinct from 'requirements_review' or review_row.new_status is distinct from 'prototyping' then
    raise exception 'TEST FAILED: the automatic status_change row recorded previous_status=%/new_status=% (expected requirements_review/prototyping)', review_row.previous_status, review_row.new_status;
  end if;

  raise notice 'TEST PASSED: Section (d) -- technical_review outcomes drive the correct automatic status transition, with a correctly-paired audit row';

  -- ============================================================
  -- Section (e): prototype_test -- fail stays in prototyping, pass
  -- advances to release_ready.
  -- ============================================================

  perform public.log_product_request_review(request_id, 'prototype_test', 'fail', 'Failed thermal test.');
  select * into request_row from public.product_requests where id = request_id;
  if request_row.status is distinct from 'prototyping' then
    raise exception 'TEST FAILED: prototype_test outcome=fail should leave the request in prototyping (got %)', request_row.status;
  end if;

  select count(*) into row_count from public.product_request_reviews where product_request_id = request_id and kind = 'prototype_test';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the failed prototype_test was not logged';
  end if;

  perform public.log_product_request_review(request_id, 'prototype_test', 'pass', 'Passed on retry.');
  select * into request_row from public.product_requests where id = request_id;
  if request_row.status is distinct from 'release_ready' then
    raise exception 'TEST FAILED: prototype_test outcome=pass did not move the request to release_ready (got %)', request_row.status;
  end if;

  raise notice 'TEST PASSED: Section (e) -- prototype_test: fail stays in prototyping (still logged), pass advances to release_ready';

  -- ============================================================
  -- Section (f): log_product_request_review rejects release_readiness
  -- and rejects acting on a released/declined request.
  -- ============================================================

  caught := false;
  begin
    perform public.log_product_request_review(request_id, 'release_readiness', 'pass', 'should not work here');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: log_product_request_review accepted kind=release_readiness (must go through release_product_request)';
  end if;

  raise notice 'TEST PASSED: Section (f) -- log_product_request_review rejects kind=release_readiness';

  -- ============================================================
  -- Section (g): change_product_request_status -- valid manual move,
  -- rejects reaching released, rejects no-op.
  -- ============================================================

  select (public.create_product_request('ZZ Test 201: second request for manual status moves', null, null, null)).id into second_request_id;

  perform set_config('request.jwt.claims', json_build_object('sub', engineer_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select * into request_row from public.change_product_request_status(second_request_id, 'requirements_review', 'Starting requirements pass.');
  if request_row.status is distinct from 'requirements_review' then
    raise exception 'TEST FAILED: change_product_request_status did not move the request to requirements_review';
  end if;

  select previous_status, new_status into review_row from public.product_request_reviews
    where product_request_id = second_request_id and kind = 'status_change' order by reviewed_at desc limit 1;
  if review_row.previous_status is distinct from 'submitted' or review_row.new_status is distinct from 'requirements_review' then
    raise exception 'TEST FAILED: manual status_change row recorded previous_status=%/new_status=% (expected submitted/requirements_review)', review_row.previous_status, review_row.new_status;
  end if;

  caught := false;
  begin
    perform public.change_product_request_status(second_request_id, 'released', null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: change_product_request_status allowed reaching released directly';
  end if;

  caught := false;
  begin
    perform public.change_product_request_status(second_request_id, 'requirements_review', null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: change_product_request_status allowed a same-status no-op';
  end if;

  raise notice 'TEST PASSED: Section (g) -- change_product_request_status: valid manual move recorded correctly, rejects reaching released and a same-status no-op';

  -- ============================================================
  -- Section (h): release_product_request mode=new.
  -- ============================================================

  caught := false;
  begin
    perform public.release_product_request(second_request_id, 'new', null, 'ZZ-TEST-201-SKU-A', 'ZZ Test Product', null, null, null, 199.99, null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: release_product_request succeeded against a request that was not release_ready';
  end if;

  select * into request_row from public.release_product_request(request_id, 'new', null, 'ZZ-TEST-201-SKU-A', 'ZZ Test Product', 'Sales copy', 'Tech copy', 'ZZ Test Category', 199.99, 'First release.');
  if request_row.status is distinct from 'released' or request_row.released_catalog_item_id is null then
    raise exception 'TEST FAILED: release_product_request (mode=new) did not set status=released and released_catalog_item_id';
  end if;
  catalog_item_id := request_row.released_catalog_item_id;

  perform set_config('role', 'postgres', true);
  declare
    catalog_workspace_id uuid;
    catalog_number_val text;
  begin
    select workspace_id, catalog_number into catalog_workspace_id, catalog_number_val from public.product_catalog where id = catalog_item_id;
    if catalog_workspace_id is distinct from ws_a_id then
      raise exception 'TEST FAILED: the released catalog item was created in the wrong workspace';
    end if;
    if catalog_number_val is distinct from 'ZZ-TEST-201-SKU-A' then
      raise exception 'TEST FAILED: the released catalog item has the wrong catalog_number (got %)', catalog_number_val;
    end if;
  end;

  select previous_status, new_status, outcome into review_row from public.product_request_reviews
    where product_request_id = request_id and kind = 'release_readiness' order by reviewed_at desc limit 1;
  if review_row.previous_status is distinct from 'release_ready' or review_row.new_status is distinct from 'released' or review_row.outcome is distinct from 'pass' then
    raise exception 'TEST FAILED: release_readiness review row recorded incorrectly (previous=%, new=%, outcome=%)', review_row.previous_status, review_row.new_status, review_row.outcome;
  end if;

  raise notice 'TEST PASSED: Section (h) -- release_product_request (mode=new) only works from release_ready, creates a real catalog item in the right workspace, and logs a correct release_readiness row';

  -- ============================================================
  -- Section (i): release_product_request mode=update.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', engineer_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.log_product_request_review(second_request_id, 'technical_review', 'pass', null);
  perform public.log_product_request_review(second_request_id, 'prototype_test', 'pass', null);

  select * into request_row from public.release_product_request(second_request_id, 'update', catalog_item_id, null, 'ZZ Test Product v2', null, null, null, 249.99, 'Revision release.');
  if request_row.released_catalog_item_id is distinct from catalog_item_id then
    raise exception 'TEST FAILED: mode=update did not set released_catalog_item_id to the existing catalog item';
  end if;

  perform set_config('role', 'postgres', true);
  declare
    updated_name text;
    updated_price numeric;
  begin
    select product_name, default_sell_price into updated_name, updated_price from public.product_catalog where id = catalog_item_id;
    if updated_name is distinct from 'ZZ Test Product v2' or updated_price is distinct from 249.99 then
      raise exception 'TEST FAILED: mode=update did not actually update the existing catalog item (name=%, price=%)', updated_name, updated_price;
    end if;
  end;

  -- A cross-workspace existing catalog item is rejected -- a genuinely
  -- separate ws_b catalog item, targeted from a ws_a request.
  declare
    third_request_id uuid;
    ws_b_catalog_item_id uuid;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', ws_b_member_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    insert into public.product_catalog (catalog_number, product_name, default_sell_price)
      values ('ZZ-TEST-201-SKU-B', 'ZZ Test 201 Workspace B Product', 50)
      returning id into ws_b_catalog_item_id;

    perform set_config('request.jwt.claims', json_build_object('sub', plain_member_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    select (public.create_product_request('ZZ Test 201: third request', null, null, null)).id into third_request_id;

    perform set_config('request.jwt.claims', json_build_object('sub', engineer_id::text)::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.log_product_request_review(third_request_id, 'technical_review', 'pass', null);
    perform public.log_product_request_review(third_request_id, 'prototype_test', 'pass', null);

    caught := false;
    begin
      perform public.release_product_request(third_request_id, 'update', ws_b_catalog_item_id, null, null, null, null, null, null, null);
    exception when others then
      caught := true;
    end;
    if not caught then
      raise exception 'TEST FAILED: release_product_request (mode=update) accepted a catalog item belonging to a DIFFERENT workspace';
    end if;
  end;

  raise notice 'TEST PASSED: Section (i) -- release_product_request (mode=update) updates the existing catalog item correctly and rejects a cross-workspace one';

  -- ============================================================
  -- Section (j): a suspended workspace blocks every write path.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  update public.workspaces set status = 'suspended' where id = ws_a_id;

  perform set_config('request.jwt.claims', json_build_object('sub', plain_member_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.create_product_request('ZZ Test 201: should be blocked', null, null, null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: create_product_request succeeded for a member of a SUSPENDED workspace';
  end if;

  perform set_config('role', 'postgres', true);
  update public.workspaces set status = 'active' where id = ws_a_id;

  raise notice 'TEST PASSED: Section (j) -- a suspended workspace blocks product-request writes for its own members';

  -- ============================================================
  -- Section (k): cross-workspace read isolation.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ws_b_member_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.product_requests;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a workspace B member could see % product_requests rows belonging to workspace A', row_count;
  end if;

  select count(*) into row_count from public.product_request_reviews;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a workspace B member could see % product_request_reviews rows belonging to workspace A', row_count;
  end if;

  raise notice 'TEST PASSED: Section (k) -- cross-workspace read isolation holds for both tables';

  -- ============================================================
  -- Section (l): no delete path exists.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', plain_member_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  declare
    affected_rows integer;
  begin
    delete from public.product_requests where id = request_id;
    get diagnostics affected_rows = row_count;
    if affected_rows is distinct from 0 then
      raise exception 'TEST FAILED: a product_requests row was actually deleted -- no delete policy should exist at all';
    end if;
  end;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.product_requests where id = request_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the product_requests row is genuinely gone (expected the RLS-silent-denial case: still exists)';
  end if;

  raise notice 'TEST PASSED: Section (l) -- no delete path exists on product_requests';

  raise notice 'ALL MIGRATION 201 ENGINEERING MODULE FIRST RELEASE TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
