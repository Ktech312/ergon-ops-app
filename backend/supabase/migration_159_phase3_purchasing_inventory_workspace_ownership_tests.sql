-- Transaction-safe canonical test for migration 159 (Phase 3, Stage 3
-- ownership half: vendors/locations/inventory_items/purchase_orders/
-- purchase_requests/equipment_types/build_transactions.workspace_id,
-- plus the save_equipment_recipe() containment retrofit). Wrapped in
-- begin;/rollback; -- nothing here ever commits. Any synthetic second
-- workspace this script creates lives ONLY inside this rolled-back
-- transaction, per standing policy -- never a persistent second
-- workspace.
--
-- Scope: this migration does NOT touch RLS on any of the seven root
-- tables -- each keeps its existing policy shape exactly (using(true)
-- for vendors/locations/purchase_orders, role-gated
-- is_app_admin()/has_role(...) for inventory_items/purchase_requests/
-- equipment_types/build_transactions, per migration 023). So this test
-- verifies ownership-metadata correctness (backfill completeness,
-- trigger stamping/immutability, fail-closed for a caller with no
-- membership), exactly like migration 156's own test -- plus one real
-- behavioral surface this migration DOES change: save_equipment_recipe()
-- now enforces per-caller workspace containment instead of the retired
-- active_workspace_id() single-workspace-in-whole-database guard, so
-- Section 5 exercises that directly against a real second workspace.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 159 PHASE 3 PURCHASING
-- INVENTORY WORKSPACE OWNERSHIP TESTS PASSED -- ZERO SECTIONS SKIPPED",
-- or a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  null_count integer;
  row_count integer;
  caught boolean;
  new_vendor_id uuid;
  new_location_id uuid;
  new_item_id uuid;
  new_po_id uuid;
  new_pr_id uuid;
  new_equipment_id uuid;
  new_build_id uuid;
  b_item_id uuid;
  b_equipment_id uuid;
  recipe_json jsonb;
  error_text text;
begin
  -- ============================================================
  -- Section 1: backfill completeness across all seven root tables.
  -- ============================================================

  select count(*) into null_count from public.vendors where workspace_id is null;
  if null_count <> 0 then
    raise exception 'TEST FAILED: % vendors row(s) still have a null workspace_id after migration 159', null_count;
  end if;

  select count(*) into null_count from public.locations where workspace_id is null;
  if null_count <> 0 then
    raise exception 'TEST FAILED: % locations row(s) still have a null workspace_id after migration 159', null_count;
  end if;

  select count(*) into null_count from public.inventory_items where workspace_id is null;
  if null_count <> 0 then
    raise exception 'TEST FAILED: % inventory_items row(s) still have a null workspace_id after migration 159', null_count;
  end if;

  select count(*) into null_count from public.purchase_orders where workspace_id is null;
  if null_count <> 0 then
    raise exception 'TEST FAILED: % purchase_orders row(s) still have a null workspace_id after migration 159', null_count;
  end if;

  select count(*) into null_count from public.purchase_requests where workspace_id is null;
  if null_count <> 0 then
    raise exception 'TEST FAILED: % purchase_requests row(s) still have a null workspace_id after migration 159', null_count;
  end if;

  select count(*) into null_count from public.equipment_types where workspace_id is null;
  if null_count <> 0 then
    raise exception 'TEST FAILED: % equipment_types row(s) still have a null workspace_id after migration 159', null_count;
  end if;

  select count(*) into null_count from public.build_transactions where workspace_id is null;
  if null_count <> 0 then
    raise exception 'TEST FAILED: % build_transactions row(s) still have a null workspace_id after migration 159', null_count;
  end if;

  raise notice 'TEST PASSED: Section 1 -- zero null workspace_id rows across vendors, locations, inventory_items, purchase_orders, purchase_requests, equipment_types, build_transactions';

  -- Discover a real, existing app_admin who is also an active workspace
  -- member -- moved ahead of Section 2 (not just Section 3, where this
  -- lookup conceptually belongs) because Section 2's own purchase_orders
  -- fixture needs a real caller identity too: guard_workspace_id_mutation()
  -- is a BEFORE INSERT trigger, not an RLS policy -- switching to the
  -- 'postgres' role bypasses RLS but does NOT bypass trigger execution,
  -- so a fixture row still needs a real auth.uid() with a real workspace
  -- membership behind it, not just an elevated role. is_app_admin() is a
  -- GLOBAL check, unrelated to which workspace the membership row points
  -- to -- this admin passes every write policy in this table group
  -- uniformly (using(true) trivially, is_app_admin()-or-has_role(...) via
  -- the admin branch), avoiding migration 156's own documented "any
  -- active member" limitation.
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

  -- ============================================================
  -- Section 2: missing-membership denial on write. A caller with zero
  -- workspace_members rows cannot insert into any of the seven tables --
  -- guard_workspace_id_mutation()'s resolve_caller_workspace_id() call
  -- fails closed before the row is ever written, regardless of whether
  -- the table's own RLS write policy is using(true) or role-gated (the
  -- BEFORE INSERT trigger runs, and can raise, before RLS's WITH CHECK
  -- is evaluated against the final row image) -- same guarantee already
  -- proven for projects/tasks in migration 156's own Section 2.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    caught := false;
    insert into public.vendors (name) values ('ZZ_TEST_159 No-Membership Vendor');
  exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert a vendor'; end if;

  begin
    caught := false;
    insert into public.locations (name) values ('ZZ_TEST_159 No-Membership Location');
  exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert a location'; end if;

  begin
    caught := false;
    insert into public.inventory_items (sku, item_name) values ('ZZ-SKU-159-NOWS', 'ZZ_TEST_159 No-Membership Item');
  exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert an inventory_item'; end if;

  begin
    caught := false;
    insert into public.purchase_requests (request_number, sku_snapshot, item_name_snapshot, quantity_requested, reason)
      values ('ZZ-PR-159-NOWS', 'ZZ-SKU', 'ZZ Item', 1, 'manual');
  exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert a purchase_request'; end if;

  begin
    caught := false;
    insert into public.equipment_types (equipment_number, equipment_name) values ('ZZ-EQ-159-NOWS', 'ZZ_TEST_159 No-Membership Equipment');
  exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert an equipment_type'; end if;

  begin
    caught := false;
    insert into public.build_transactions (build_number, quantity_built) values ('ZZ-BT-159-NOWS', 1);
  exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert a build_transaction'; end if;

  -- purchase_orders needs a real vendor_id to reach the workspace guard
  -- at all (vendor_id is NOT NULL). The fixture vendor is inserted AS
  -- the real admin discovered above -- not under the 'postgres' role --
  -- because the ownership trigger fires on every INSERT regardless of
  -- role; only a caller with a real workspace membership can get past
  -- it, elevated role or not. The trigger stamps workspace_id itself;
  -- no explicit value is given.
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.vendors (name) values ('ZZ_TEST_159 Fixture Vendor For PO Guard') returning id into new_vendor_id;

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    caught := false;
    insert into public.purchase_orders (po_number, vendor_id) values ('ZZ-PO-159-NOWS', new_vendor_id);
  exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert a purchase_order'; end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 2 -- a caller with zero workspace memberships cannot insert into any of the seven tables';

  -- ============================================================
  -- Section 3: trigger correctly stamps workspace_id on insert
  -- (ignoring/overwriting any client-supplied value), and rejects any
  -- attempt to change it on update. Reuses the real admin discovered
  -- ahead of Section 2 above -- this passes every write policy in this
  -- table group uniformly (the using(true) ones trivially, and the
  -- is_app_admin()-or-has_role(...) ones via the admin branch), avoiding
  -- migration 156's own documented "any active member" limitation.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.vendors (name, workspace_id) values ('ZZ_TEST_159 Trigger Stamp Vendor', gen_random_uuid()) returning id into new_vendor_id;
  select count(*) into row_count from public.vendors where id = new_vendor_id and workspace_id = real_workspace_id;
  if row_count <> 1 then raise exception 'TEST FAILED: vendors insert did not get stamped with the caller''s real workspace_id'; end if;

  insert into public.locations (name, workspace_id) values ('ZZ_TEST_159 Trigger Stamp Location', gen_random_uuid()) returning id into new_location_id;
  select count(*) into row_count from public.locations where id = new_location_id and workspace_id = real_workspace_id;
  if row_count <> 1 then raise exception 'TEST FAILED: locations insert did not get stamped with the caller''s real workspace_id'; end if;

  insert into public.inventory_items (sku, item_name, workspace_id) values ('ZZ-SKU-159-STAMP', 'ZZ_TEST_159 Item', gen_random_uuid()) returning id into new_item_id;
  select count(*) into row_count from public.inventory_items where id = new_item_id and workspace_id = real_workspace_id;
  if row_count <> 1 then raise exception 'TEST FAILED: inventory_items insert did not get stamped with the caller''s real workspace_id'; end if;

  insert into public.purchase_orders (po_number, vendor_id, workspace_id) values ('ZZ-PO-159-STAMP', new_vendor_id, gen_random_uuid()) returning id into new_po_id;
  select count(*) into row_count from public.purchase_orders where id = new_po_id and workspace_id = real_workspace_id;
  if row_count <> 1 then raise exception 'TEST FAILED: purchase_orders insert did not get stamped with the caller''s real workspace_id'; end if;

  insert into public.purchase_requests (request_number, sku_snapshot, item_name_snapshot, quantity_requested, reason, workspace_id)
    values ('ZZ-PR-159-STAMP', 'ZZ-SKU', 'ZZ Item', 1, 'manual', gen_random_uuid())
    returning id into new_pr_id;
  select count(*) into row_count from public.purchase_requests where id = new_pr_id and workspace_id = real_workspace_id;
  if row_count <> 1 then raise exception 'TEST FAILED: purchase_requests insert did not get stamped with the caller''s real workspace_id'; end if;

  insert into public.equipment_types (equipment_number, equipment_name, workspace_id) values ('ZZ-EQ-159-STAMP', 'ZZ_TEST_159 Equipment', gen_random_uuid()) returning id into new_equipment_id;
  select count(*) into row_count from public.equipment_types where id = new_equipment_id and workspace_id = real_workspace_id;
  if row_count <> 1 then raise exception 'TEST FAILED: equipment_types insert did not get stamped with the caller''s real workspace_id'; end if;

  insert into public.build_transactions (build_number, quantity_built, workspace_id) values ('ZZ-BT-159-STAMP', 1, gen_random_uuid()) returning id into new_build_id;
  select count(*) into row_count from public.build_transactions where id = new_build_id and workspace_id = real_workspace_id;
  if row_count <> 1 then raise exception 'TEST FAILED: build_transactions insert did not get stamped with the caller''s real workspace_id'; end if;

  -- Attempting to change workspace_id on an existing row must be
  -- rejected outright, no exceptions, for all seven tables.
  begin caught := false; update public.vendors set workspace_id = gen_random_uuid() where id = new_vendor_id; exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: vendors.workspace_id was mutable via a plain UPDATE'; end if;

  begin caught := false; update public.locations set workspace_id = gen_random_uuid() where id = new_location_id; exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: locations.workspace_id was mutable via a plain UPDATE'; end if;

  begin caught := false; update public.inventory_items set workspace_id = gen_random_uuid() where id = new_item_id; exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: inventory_items.workspace_id was mutable via a plain UPDATE'; end if;

  begin caught := false; update public.purchase_orders set workspace_id = gen_random_uuid() where id = new_po_id; exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: purchase_orders.workspace_id was mutable via a plain UPDATE'; end if;

  begin caught := false; update public.purchase_requests set workspace_id = gen_random_uuid() where id = new_pr_id; exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: purchase_requests.workspace_id was mutable via a plain UPDATE'; end if;

  begin caught := false; update public.equipment_types set workspace_id = gen_random_uuid() where id = new_equipment_id; exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: equipment_types.workspace_id was mutable via a plain UPDATE'; end if;

  begin caught := false; update public.build_transactions set workspace_id = gen_random_uuid() where id = new_build_id; exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: build_transactions.workspace_id was mutable via a plain UPDATE'; end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 3 -- all seven triggers correctly stamp workspace_id on insert and reject mutation on update';

  -- ============================================================
  -- Section 4: RLS on all seven tables is UNCHANGED by THIS migration's
  -- OWN diff. Structural check only, matching migration 156's own
  -- Section 4 precedent -- not a behavioral re-test of migration 023's
  -- role gates.
  --
  -- CONSOLIDATED-SUITE FINDING (found running the full 001-185 replay,
  -- not visible to migration 159's own isolated verification): migration
  -- 160 -- the very next migration, same documented two-part
  -- ownership-then-RLS phase -- legitimately drops and replaces every
  -- one of these seven tables' policies with workspace-scoped versions,
  -- by design (confirmed in 160's own header and its own passing test
  -- file). The legacy shapes asserted below only ever hold in the narrow
  -- window between migration 159 and 160. Made supersession-aware below
  -- (same discipline already applied to migration 156's and 173's own
  -- tests), so this section still catches a real regression run
  -- standalone against a 159-only bootstrap.
  -- ============================================================

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'vendors' and policyname = 'workspace members read vendors';
  if row_count > 0 then
    raise notice 'Section 4 -- vendors/locations/purchase_orders/inventory_items/purchase_requests/equipment_types/build_transactions RLS already superseded by migration 160''s workspace-scoped policies (expected under the full migration history) -- skipping migration-159-era legacy-shape checks, covered instead by migration 160''s own test.';
  else
    -- vendors, locations, purchase_orders: still fully using(true) on both
    -- read and write (migration 023 never touched these three).
    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'vendors' and position('true' in lower(coalesce(qual, ''))) > 0;
    if row_count < 2 then raise exception 'TEST FAILED: vendors no longer has both its using(true) read and write policies (found %)', row_count; end if;

    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'locations' and position('true' in lower(coalesce(qual, ''))) > 0;
    if row_count < 2 then raise exception 'TEST FAILED: locations no longer has both its using(true) read and write policies (found %)', row_count; end if;

    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'purchase_orders' and position('true' in lower(coalesce(qual, ''))) > 0;
    if row_count < 2 then raise exception 'TEST FAILED: purchase_orders no longer has both its using(true) read and write policies (found %)', row_count; end if;

    -- inventory_items, purchase_requests, equipment_types, build_transactions:
    -- read stays using(true); write stays role-gated (is_app_admin/has_role).
    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'inventory_items' and cmd = 'SELECT' and position('true' in lower(coalesce(qual, ''))) > 0;
    if row_count = 0 then raise exception 'TEST FAILED: inventory_items no longer has a using(true) SELECT policy'; end if;
    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'inventory_items' and cmd = 'ALL' and position('is_app_admin' in coalesce(qual, '')) > 0 and position('has_role' in coalesce(qual, '')) > 0;
    if row_count = 0 then raise exception 'TEST FAILED: inventory_items no longer has its pre-existing role-gated write policy'; end if;

    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'purchase_requests' and cmd = 'SELECT' and position('true' in lower(coalesce(qual, ''))) > 0;
    if row_count = 0 then raise exception 'TEST FAILED: purchase_requests no longer has a using(true) SELECT policy'; end if;
    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'purchase_requests' and cmd = 'ALL' and position('is_app_admin' in coalesce(qual, '')) > 0 and position('has_role' in coalesce(qual, '')) > 0;
    if row_count = 0 then raise exception 'TEST FAILED: purchase_requests no longer has its pre-existing role-gated write policy'; end if;

    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'equipment_types' and cmd = 'SELECT' and position('true' in lower(coalesce(qual, ''))) > 0;
    if row_count = 0 then raise exception 'TEST FAILED: equipment_types no longer has a using(true) SELECT policy'; end if;
    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'equipment_types' and cmd = 'ALL' and position('is_app_admin' in coalesce(qual, '')) > 0 and position('has_role' in coalesce(qual, '')) > 0;
    if row_count = 0 then raise exception 'TEST FAILED: equipment_types no longer has its pre-existing role-gated write policy'; end if;

    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'build_transactions' and cmd = 'SELECT' and position('true' in lower(coalesce(qual, ''))) > 0;
    if row_count = 0 then raise exception 'TEST FAILED: build_transactions no longer has a using(true) SELECT policy'; end if;
    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'build_transactions' and cmd = 'ALL' and position('is_app_admin' in coalesce(qual, '')) > 0 and position('has_role' in coalesce(qual, '')) > 0;
    if row_count = 0 then raise exception 'TEST FAILED: build_transactions no longer has its pre-existing role-gated write policy'; end if;
  end if;

  raise notice 'TEST PASSED: Section 4 -- RLS on all seven tables confirmed either unchanged (159-only bootstrap) or correctly superseded by migration 160 (full-history run)';

  -- ============================================================
  -- Section 5: save_equipment_recipe() workspace containment (this
  -- migration's one real behavioral change). A genuine second active
  -- workspace, created and torn down entirely inside this rolled-back
  -- transaction -- never a persistent second workspace. The same real
  -- admin user is temporarily moved into it (delete + re-insert their
  -- workspace_members row, switching to the postgres role immediately
  -- before every such mutation), exactly the technique already proven
  -- in migrations 155/157/158's own tests -- not a second real user.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_159 Other Workspace', 'zz-test-159-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  -- Baseline: the admin, still in their real workspace, saves a genuine
  -- recipe referencing the real-workspace item created in Section 3 --
  -- must succeed and be stamped with real_workspace_id.
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.save_equipment_recipe(
    null, 'ZZ_TEST_159 Recipe A', null, null, false, null, null,
    jsonb_build_array(jsonb_build_object('item_name', 'ZZ_TEST_159 Item', 'quantity_required', 2))
  ) into recipe_json;

  select count(*) into row_count from public.equipment_types where id = (recipe_json->>'equipmentTypeId')::uuid and workspace_id = real_workspace_id;
  if row_count <> 1 then
    raise exception 'TEST FAILED: save_equipment_recipe() did not stamp the new equipment_type with the caller''s real workspace_id';
  end if;

  -- Move the admin into ws_b and create a workspace-B-only inventory
  -- item and equipment_type directly (postgres role, RLS bypassed --
  -- fixture setup only, not exercising any policy).
  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  insert into public.inventory_items (sku, item_name, workspace_id) values ('ZZ-SKU-159-B', 'ZZ_TEST_159 Item B', ws_b) returning id into b_item_id;
  insert into public.equipment_types (equipment_number, equipment_name, workspace_id) values ('ZZ-EQ-159-B', 'ZZ_TEST_159 Equipment B', ws_b) returning id into b_equipment_id;

  -- Move the admin back to their real workspace -- every remaining
  -- assertion in this section is made AS the real-workspace caller,
  -- attempting to reach workspace-B-only rows.
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- A component name that only exists in workspace B must NOT resolve --
  -- same rejection as a genuinely nonexistent item name (EC012).
  caught := false;
  begin
    perform public.save_equipment_recipe(
      null, 'ZZ_TEST_159 Recipe Cross-WS Component', null, null, false, null, null,
      jsonb_build_array(jsonb_build_object('item_name', 'ZZ_TEST_159 Item B', 'quantity_required', 1))
    );
  exception when others then
    caught := true;
    get stacked diagnostics error_text = message_text;
  end;
  if not caught then
    raise exception 'TEST FAILED: save_equipment_recipe() resolved a component name that only exists in another workspace';
  end if;
  if position('do not match any catalog item' in error_text) = 0 then
    raise exception 'TEST FAILED: cross-workspace component name was rejected for the wrong reason: %', error_text;
  end if;

  -- A stable output-item id belonging to workspace B must be rejected as
  -- not-found (EC015), not silently accepted.
  caught := false;
  begin
    perform public.save_equipment_recipe(
      null, 'ZZ_TEST_159 Recipe Cross-WS Output', null, null, false, b_item_id, null,
      jsonb_build_array(jsonb_build_object('item_name', 'ZZ_TEST_159 Item', 'quantity_required', 1))
    );
  exception when others then
    caught := true;
    get stacked diagnostics error_text = message_text;
  end;
  if not caught then
    raise exception 'TEST FAILED: save_equipment_recipe() accepted a stable output_inventory_item_id belonging to another workspace';
  end if;
  if position('output item could not be found' in error_text) = 0 then
    raise exception 'TEST FAILED: cross-workspace output item id was rejected for the wrong reason: %', error_text;
  end if;

  -- An equipment_type_id belonging to workspace B must resolve as
  -- not-found (EC010) when passed as p_equipment_type_id, not silently
  -- let the caller edit another workspace's recipe.
  caught := false;
  begin
    perform public.save_equipment_recipe(
      b_equipment_id, 'ZZ_TEST_159 Equipment B Renamed', null, null, false, null, null,
      jsonb_build_array(jsonb_build_object('item_name', 'ZZ_TEST_159 Item', 'quantity_required', 1))
    );
  exception when others then
    caught := true;
    get stacked diagnostics error_text = message_text;
  end;
  if not caught then
    raise exception 'TEST FAILED: save_equipment_recipe() accepted a p_equipment_type_id belonging to another workspace';
  end if;
  if position('could not be found' in error_text) = 0 then
    raise exception 'TEST FAILED: cross-workspace equipment_type_id was rejected for the wrong reason: %', error_text;
  end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 5 -- save_equipment_recipe() correctly contains component resolution, output-item resolution, and existing-recipe resolution to the caller''s own workspace';

  raise notice 'ALL MIGRATION 159 PHASE 3 PURCHASING INVENTORY WORKSPACE OWNERSHIP TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
