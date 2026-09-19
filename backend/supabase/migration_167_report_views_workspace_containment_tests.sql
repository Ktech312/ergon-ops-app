-- Transaction-safe canonical test for migration 167 (Phase 3, Stage 5,
-- fourth migration: report views workspace containment). Wrapped in
-- begin;/rollback; -- nothing here ever commits. The synthetic second
-- workspace this script creates lives ONLY inside this rolled-back
-- transaction, never a persistent second workspace.
--
-- Each of the three views gets one real behavioral check: a workspace-A
-- caller must see ONLY workspace A's row through the view, never
-- workspace B's, proving security_invoker actually causes RLS to be
-- evaluated (not just that the reloption is set). A separate section
-- confirms anon's SELECT grant is gone on all three.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 167 REPORT VIEWS
-- WORKSPACE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED", or a
-- hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  vendor_a_id uuid;
  vendor_b_id uuid;
  po_a_id uuid;
  po_b_id uuid;
  project_a_id uuid;
  project_b_id uuid;
  item_a_id uuid;
  item_b_id uuid;
  location_a_id uuid;
  location_b_id uuid;
  visible_count int;
  reloptions_val text[];
begin
  -- ============================================================
  -- Section 0: catalog check -- security_invoker actually set, anon
  -- grant actually gone, on all three views.
  -- ============================================================

  perform set_config('role', 'postgres', true);

  select c.reloptions into reloptions_val from pg_class c where c.relname = 'report_inventory_on_hand' and c.relkind = 'v';
  if reloptions_val is null or not ('security_invoker=true' = any(reloptions_val)) then
    raise exception 'TEST FAILED: report_inventory_on_hand does not have security_invoker=true set';
  end if;
  select c.reloptions into reloptions_val from pg_class c where c.relname = 'report_project_inventory_usage' and c.relkind = 'v';
  if reloptions_val is null or not ('security_invoker=true' = any(reloptions_val)) then
    raise exception 'TEST FAILED: report_project_inventory_usage does not have security_invoker=true set';
  end if;
  select c.reloptions into reloptions_val from pg_class c where c.relname = 'report_purchase_order_status' and c.relkind = 'v';
  if reloptions_val is null or not ('security_invoker=true' = any(reloptions_val)) then
    raise exception 'TEST FAILED: report_purchase_order_status does not have security_invoker=true set';
  end if;

  if has_table_privilege('anon', 'public.report_inventory_on_hand', 'SELECT')
    or has_table_privilege('anon', 'public.report_project_inventory_usage', 'SELECT')
    or has_table_privilege('anon', 'public.report_purchase_order_status', 'SELECT')
  then
    raise exception 'TEST FAILED: anon still has SELECT on at least one report view';
  end if;

  raise notice 'TEST PASSED: Section 0 -- all three views have security_invoker=true and anon SELECT revoked';

  -- ============================================================
  -- Discover a real, existing app_admin who is also an active workspace
  -- member, then build a synthetic second workspace the same way every
  -- prior Phase 3 test has.
  -- ============================================================

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
    values (ws_b, 'ZZ_TEST_167 Other Workspace', 'zz-test-167-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  -- Build workspace A's fixtures first (still the real workspace).
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.vendors (name) values ('ZZ_TEST_167 Vendor A') returning id into vendor_a_id;
  insert into public.purchase_orders (po_number, vendor_id) values ('ZZ-PO-167-A', vendor_a_id) returning id into po_a_id;
  insert into public.projects (project_name) values ('ZZ_TEST_167 Project A') returning id into project_a_id;
  insert into public.inventory_items (sku, item_name) values ('ZZ-SKU-167-A', 'ZZ_TEST_167 Item A') returning id into item_a_id;

  insert into public.locations (name, location_type) values ('ZZ_TEST_167 Location A', 'warehouse') returning id into location_a_id;
  perform set_config('role', 'postgres', true);
  insert into public.inventory_balances (inventory_item_id, location_id, quantity_on_hand) values (item_a_id, location_a_id, 10);
  insert into public.project_inventory_allocations (project_id, inventory_item_id, quantity_allocated) values (project_a_id, item_a_id, 5);

  -- Build workspace B's fixtures (admin temporarily relocated, same
  -- technique proven in every prior Phase 3 test).
  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.vendors (name) values ('ZZ_TEST_167 Vendor B') returning id into vendor_b_id;
  insert into public.purchase_orders (po_number, vendor_id) values ('ZZ-PO-167-B', vendor_b_id) returning id into po_b_id;
  insert into public.projects (project_name) values ('ZZ_TEST_167 Project B') returning id into project_b_id;
  insert into public.inventory_items (sku, item_name) values ('ZZ-SKU-167-B', 'ZZ_TEST_167 Item B') returning id into item_b_id;

  insert into public.locations (name, location_type) values ('ZZ_TEST_167 Location B', 'warehouse') returning id into location_b_id;
  perform set_config('role', 'postgres', true);
  insert into public.inventory_balances (inventory_item_id, location_id, quantity_on_hand) values (item_b_id, location_b_id, 20);
  insert into public.project_inventory_allocations (project_id, inventory_item_id, quantity_allocated) values (project_b_id, item_b_id, 7);

  -- Move the admin back to workspace A for the actual assertions.
  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: report_purchase_order_status -- workspace A caller sees
  -- ONLY workspace A's purchase order, never workspace B's.
  -- ============================================================

  select count(*) into visible_count from public.report_purchase_order_status where purchase_order_id = po_a_id;
  if visible_count <> 1 then
    raise exception 'TEST FAILED: workspace A caller could not see workspace A''s own row in report_purchase_order_status';
  end if;
  select count(*) into visible_count from public.report_purchase_order_status where purchase_order_id = po_b_id;
  if visible_count <> 0 then
    raise exception 'TEST FAILED: workspace A caller could see workspace B''s row in report_purchase_order_status -- security_invoker is not actually filtering';
  end if;

  raise notice 'TEST PASSED: Section 1 -- report_purchase_order_status is workspace-scoped';

  -- ============================================================
  -- Section 2: report_project_inventory_usage -- same check.
  -- ============================================================

  select count(*) into visible_count from public.report_project_inventory_usage where project_id = project_a_id;
  if visible_count <> 1 then
    raise exception 'TEST FAILED: workspace A caller could not see workspace A''s own row in report_project_inventory_usage';
  end if;
  select count(*) into visible_count from public.report_project_inventory_usage where project_id = project_b_id;
  if visible_count <> 0 then
    raise exception 'TEST FAILED: workspace A caller could see workspace B''s row in report_project_inventory_usage -- security_invoker is not actually filtering';
  end if;

  raise notice 'TEST PASSED: Section 2 -- report_project_inventory_usage is workspace-scoped';

  -- ============================================================
  -- Section 3: report_inventory_on_hand -- same check.
  -- ============================================================

  select count(*) into visible_count from public.report_inventory_on_hand where inventory_item_id = item_a_id;
  if visible_count <> 1 then
    raise exception 'TEST FAILED: workspace A caller could not see workspace A''s own row in report_inventory_on_hand';
  end if;
  select count(*) into visible_count from public.report_inventory_on_hand where inventory_item_id = item_b_id;
  if visible_count <> 0 then
    raise exception 'TEST FAILED: workspace A caller could see workspace B''s row in report_inventory_on_hand -- security_invoker is not actually filtering';
  end if;

  raise notice 'TEST PASSED: Section 3 -- report_inventory_on_hand is workspace-scoped';

  raise notice 'ALL MIGRATION 167 REPORT VIEWS WORKSPACE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
