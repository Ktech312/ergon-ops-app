-- Transaction-safe canonical test for migration 213 (a systemic sweep
-- fixing 43 of the 59 is_app_admin()-only policies found by a direct
-- pg_policies audit of the real, fully-migrated schema). Wrapped in
-- begin;/rollback; -- nothing here ever commits.
--
-- Two kinds of proof, matching the migration's own two claims:
-- (a) STRUCTURAL: every one of the 19 tables this migration touches now
--     has is_workspace_admin(...) somewhere in its policy text, and
--     every one of the tables this migration deliberately did NOT touch
--     (app_admins, restore_runs, system_health_events, etc.) still does
--     NOT -- proving the sweep neither missed a table it meant to fix
--     nor accidentally broadened one it explicitly excluded.
-- (b) FUNCTIONAL: a real workspace-admin-only user (no app_admins row,
--     no role assigned) can actually create/update/delete a project, an
--     inventory item, an equipment type, and a purchase request for
--     their own workspace -- the actual, concrete day-one capability
--     this migration restores -- while cross-workspace isolation and
--     the ordinary-member exclusion both still hold.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 213 WORKSPACE ADMIN
-- BYPASS SWEEP TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL
-- error naming what failed or was skipped.

begin;

do $$
declare
  fixed_tables text[] := array[
    'build_transactions', 'equipment_bom_components', 'equipment_types',
    'inventory_balances', 'inventory_items', 'inventory_movements',
    'inventory_transactions', 'notification_rules', 'project_allocation_history',
    'project_bom_lines', 'project_schedule_template_phases', 'project_schedule_templates',
    'project_scope_of_work', 'projects', 'purchase_requests',
    'sales_quote_proposal_approval_requests', 'standard_install_times', 'team_members',
    'workspace_share_link_settings'
  ];
  excluded_tables text[] := array[
    'app_admins', 'app_user_roles', 'app_user_status', 'notifications',
    'proposal_template_sections', 'restore_run_sections', 'restore_runs',
    'system_health_events', 'system_health_events_monthly_summary',
    'workspace_sales_approval_settings'
  ];
  t text;
  gap_count integer;
  workspace_a_id uuid;
  workspace_b_id uuid;
  admin_a_user_id uuid := gen_random_uuid();
  ordinary_a_user_id uuid := gen_random_uuid();
  admin_b_user_id uuid := gen_random_uuid();
  project_id uuid;
  inventory_item_id uuid;
  equipment_type_id uuid;
  purchase_request_id uuid;
  row_count integer;
  caught boolean;
begin
  -- ============================================================
  -- Section (a): structural proof, every fixed table and every
  -- deliberately-excluded table.
  -- ============================================================

  foreach t in array fixed_tables loop
    select count(*) into gap_count
    from pg_policies
    where schemaname = 'public' and tablename = t
      and (
        (qual is not null and qual ilike '%is_app_admin%' and qual not ilike '%is_workspace_admin%')
        or (with_check is not null and with_check ilike '%is_app_admin%' and with_check not ilike '%is_workspace_admin%')
      );
    if gap_count > 0 then
      raise exception 'TEST FAILED: table % still has % policy/policies checking is_app_admin with no is_workspace_admin fallback -- migration 213 did not actually fix it', t, gap_count;
    end if;
  end loop;

  raise notice 'TEST PASSED: Section (a1) -- all 19 tables migration 213 targets now have is_workspace_admin(...) in every previously-gapped policy';

  foreach t in array excluded_tables loop
    select count(*) into gap_count
    from pg_policies
    where schemaname = 'public' and tablename = t
      and (
        (qual is not null and qual ilike '%is_app_admin%' and qual not ilike '%is_workspace_admin%')
        or (with_check is not null and with_check ilike '%is_app_admin%' and with_check not ilike '%is_workspace_admin%')
      );
    if gap_count = 0 then
      raise exception 'TEST FAILED: table % (deliberately excluded, per migration 213''s own header) unexpectedly has NO is_app_admin-only policy anymore -- either it was already fixed elsewhere (update this test''s excluded list) or something silently broadened it', t;
    end if;
  end loop;

  raise notice 'TEST PASSED: Section (a2) -- every deliberately-excluded table (app_admins, system_health_events, etc.) still correctly has no workspace-admin bypass, proving the sweep did not overreach';

  -- ============================================================
  -- Setup for Section (b): a real workspace-admin-only user (no
  -- app_admins row, no role assigned), exactly K-Tech's own real shape.
  -- ============================================================

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (name, slug, status) values ('ZZ Test 213 Workspace A', 'zz-test-213-workspace-a', 'active') returning id into workspace_a_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 213 Workspace B', 'zz-test-213-workspace-b', 'active') returning id into workspace_b_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (admin_a_user_id, 'zz-test-213-admin-a@example.com', now()),
    (ordinary_a_user_id, 'zz-test-213-ordinary-a@example.com', now()),
    (admin_b_user_id, 'zz-test-213-admin-b@example.com', now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (workspace_a_id, admin_a_user_id, true),
    (workspace_a_id, ordinary_a_user_id, false),
    (workspace_b_id, admin_b_user_id, true);

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section (b1): projects -- create, update, delete.
  -- ============================================================

  insert into public.projects (workspace_id, project_name) values (workspace_a_id, 'ZZ Test 213 Project') returning id into project_id;
  update public.projects set project_name = 'ZZ Test 213 Project Renamed' where id = project_id;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.projects where id = project_id and project_name = 'ZZ Test 213 Project Renamed';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace-admin-only user could not create/update a project in their own workspace';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  delete from public.projects where id = project_id;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.projects where id = project_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a workspace-admin-only user could not delete a project in their own workspace';
  end if;

  raise notice 'TEST PASSED: Section (b1) -- a workspace-admin-only user can create, update, and delete a project in their own workspace';

  -- ============================================================
  -- Section (b2): inventory_items -- create, update, delete.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.inventory_items (workspace_id, item_name, sku) values (workspace_a_id, 'ZZ Test 213 Item', 'ZZ-213-SKU') returning id into inventory_item_id;
  update public.inventory_items set item_name = 'ZZ Test 213 Item Renamed' where id = inventory_item_id;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.inventory_items where id = inventory_item_id and item_name = 'ZZ Test 213 Item Renamed';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace-admin-only user could not create/update an inventory item in their own workspace';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  delete from public.inventory_items where id = inventory_item_id;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.inventory_items where id = inventory_item_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a workspace-admin-only user could not delete an inventory item in their own workspace';
  end if;

  raise notice 'TEST PASSED: Section (b2) -- a workspace-admin-only user can create, update, and delete an inventory item in their own workspace';

  -- ============================================================
  -- Section (b3): equipment_types -- create, update, delete.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.equipment_types (workspace_id, equipment_number, equipment_name) values (workspace_a_id, 'ZZ-213-EQ', 'ZZ Test 213 Equipment') returning id into equipment_type_id;
  update public.equipment_types set equipment_name = 'ZZ Test 213 Equipment Renamed' where id = equipment_type_id;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.equipment_types where id = equipment_type_id and equipment_name = 'ZZ Test 213 Equipment Renamed';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace-admin-only user could not create/update an equipment type in their own workspace';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  delete from public.equipment_types where id = equipment_type_id;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.equipment_types where id = equipment_type_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a workspace-admin-only user could not delete an equipment type in their own workspace';
  end if;

  raise notice 'TEST PASSED: Section (b3) -- a workspace-admin-only user can create, update, and delete an equipment type in their own workspace';

  -- ============================================================
  -- Section (b4): purchase_requests -- create, update.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.purchase_requests (workspace_id, request_number, sku_snapshot, item_name_snapshot, quantity_requested, reason, estimated_unit_cost)
    values (workspace_a_id, 'ZZ-213-REQ', 'ZZ-213-SKU', 'ZZ Test 213 Requested Part', 1, 'manual', 0)
    returning id into purchase_request_id;
  update public.purchase_requests set quantity_requested = 2 where id = purchase_request_id;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.purchase_requests where id = purchase_request_id and quantity_requested = 2;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace-admin-only user could not create/update a purchase request in their own workspace';
  end if;

  raise notice 'TEST PASSED: Section (b4) -- a workspace-admin-only user can create and update a purchase request in their own workspace';

  -- ============================================================
  -- Section (c): cross-workspace isolation preserved -- workspace A's
  -- admin cannot touch workspace B's projects.
  -- ============================================================

  -- Seeded via workspace B's own real admin identity, not "as postgres
  -- with an explicit workspace_id" -- projects has the same
  -- resolve_caller_workspace_id() INSERT trigger user_invites does
  -- (migration 212's own test hit this same lesson), which overwrites
  -- whatever workspace_id is supplied based on the CALLER's own
  -- membership, resolved from request.jwt.claims -- not the role alone.
  -- Setting role back to 'postgres' without ALSO clearing the still-set
  -- admin_a claims from the section above would silently redirect this
  -- insert into workspace A instead of B.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_b_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.projects (project_name) values ('ZZ Test 213 Workspace B Project') returning id into project_id;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.projects where id = project_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: workspace A''s admin could read workspace B''s project (% rows visible)', row_count;
  end if;

  begin
    update public.projects set project_name = 'hacked' where id = project_id;
  exception when others then
    null;
  end;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.projects where id = project_id and project_name = 'hacked') then
    raise exception 'TEST FAILED: workspace A''s admin could write to workspace B''s project';
  end if;

  raise notice 'TEST PASSED: Section (c) -- cross-workspace isolation preserved, a workspace admin cannot read or write another workspace''s projects';

  -- ============================================================
  -- Section (d): an ordinary (non-admin) workspace member still
  -- cannot create a project -- this migration only widened the
  -- ADMIN bypass, it did not open these tables to everyone.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.projects (workspace_id, project_name) values (workspace_a_id, 'ZZ Test 213 Should Fail');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an ordinary (non-admin, no pm role) workspace member could create a project -- migration 213 over-broadened this policy';
  end if;

  raise notice 'TEST PASSED: Section (d) -- an ordinary workspace member with no admin/pm role still cannot create a project';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 213 WORKSPACE ADMIN BYPASS SWEEP TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
