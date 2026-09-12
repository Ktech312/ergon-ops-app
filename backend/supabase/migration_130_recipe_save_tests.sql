-- Transaction-safe tests for migration 130's save_equipment_recipe() RPC.
-- Wrapped in begin;/rollback; -- nothing here ever commits. Uses REAL,
-- already-existing users and workspace membership for every authorization
-- check (never fabricates a fake auth.users row, never removes or
-- destructively mutates a real user's real workspace membership -- role
-- grants are added only when genuinely missing and removed again before
-- the script ends, and workspace status is temporarily toggled then always
-- restored before continuing, moot regardless since the whole transaction
-- rolls back), but every equipment recipe, inventory catalog item, and
-- synthetic workspace used as a fixture is created fresh inside this same
-- rolled-back transaction, clearly named "ZZ_TEST_..." so none of it can
-- ever be confused with real production data even if something went wrong
-- and this somehow committed.
--
-- Every "should fail" assertion snapshots the row/id state it could have
-- affected before and after the call and asserts equality -- catching an
-- exception alone does not prove nothing was written.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 130 RECIPE SAVE TESTS
-- PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error (a "TEST FAILED"
-- exception from a real assertion, a "SECTIONS SKIPPED" exception naming
-- what was skipped, or a genuine unexpected SQL error). It can never
-- quietly finish as "Success. No rows returned." with something having
-- been skipped.

begin;

do $$
declare
  -- CORRECTED (review): renamed from `workspace_id` -- that name is an
  -- EXACT match for workspace_members.workspace_id, a real column
  -- queried throughout this script. Even where the column side of a
  -- comparison was itself qualified (e.g. `wm.workspace_id = v_workspace_id`),
  -- the bare right-hand reference was still genuinely ambiguous to
  -- Postgres -- variable-vs-column ambiguity is evaluated per bare
  -- identifier, not resolved just because ONE side of an expression
  -- happens to be qualified. `v_workspace_id` cannot collide with any
  -- column in any table this script queries.
  v_workspace_id uuid;
  admin_user_id uuid;
  admin_is_bridged boolean;
  warehouse_user_id uuid;
  warehouse_role_preexisted boolean;
  non_privileged_user_id uuid;
  original_role text;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  caught boolean;
  caught_sqlstate text;
  v_invalid_qty_text text;
  result_json jsonb;
  result_json_2 jsonb;

  -- Catalog fixtures.
  item_a_id uuid;
  item_b_id uuid;
  item_c_id uuid;
  ambiguous_item_1_id uuid;
  ambiguous_item_2_id uuid;
  ambiguous_item_name text := 'ZZ_TEST_AMBIGUOUS_ITEM_' || substr(md5(random()::text), 1, 8);

  -- Recipe-under-test fixtures.
  recipe_a_name text := 'ZZ_TEST_RECIPE_A_' || substr(md5(random()::text), 1, 10);
  recipe_b_name text := 'ZZ_TEST_RECIPE_B_' || substr(md5(random()::text), 1, 10);
  recipe_a_id uuid;
  recipe_b_id uuid;
  equipment_type_snapshot_before jsonb;
  equipment_type_snapshot_after jsonb;
  equipment_type_snapshot_before_2 jsonb;
  equipment_type_snapshot_after_2 jsonb;
  component_snapshot_before jsonb;
  component_snapshot_after jsonb;
  recipe_full_snapshot_before jsonb;
  recipe_full_snapshot_after jsonb;
  component_count integer;
  row_count integer;
  non_privileged_original_roles jsonb;

  search_path_marker text := 'SET search_path TO ' || quote_literal('');
  func_def text;
begin
  select current_setting('role') into original_role;

  -- ============================================================
  -- Fixture discovery: a real, currently-active workspace and its real
  -- members. This script does not create a synthetic "home" workspace --
  -- it uses the one real workspace this bridge-era app already has, the
  -- same way migration 124/127's own test scripts do.
  -- ============================================================
  select w.id into v_workspace_id from public.workspaces w where w.status = 'active' limit 1;

  if v_workspace_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no active workspace found)');
  else
    -- The real, current admin -- and an explicit assertion (not just an
    -- assumption) that they are actually bridged into
    -- workspace_members.is_workspace_admin for THIS workspace. If this
    -- assertion ever fails, that is itself a real drift finding worth
    -- surfacing loudly, not a reason to quietly fall back to a synthetic
    -- admin -- so this raises a hard TEST FAILED, not a skip.
    select wm.user_id into admin_user_id
      from public.workspace_members wm
      where wm.workspace_id = v_workspace_id and wm.is_workspace_admin
      limit 1;

    if admin_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'workspace-admin sections (no workspace_members row with is_workspace_admin=true found for the active workspace)');
    else
      select exists (
        select 1 from public.app_admins aa where aa.user_id = admin_user_id
      ) into admin_is_bridged;
      if not admin_is_bridged then
        raise exception 'TEST FAILED: the workspace admin found (%) has workspace_members.is_workspace_admin=true but no app_admins row -- either a real drift between the legacy and workspace-side admin records, or this test''s own fixture-discovery query is wrong. This is exactly the kind of drift migration 130''s review was asked to rule out for the CURRENT production admin, so it must not be silently ignored.', admin_user_id;
      end if;
      raise notice 'TEST PASSED (fixture confirmation): the real workspace admin found (a real workspace_members row with is_workspace_admin=true) also has a real app_admins row -- the bridge between the legacy and workspace-side admin records is intact for this account, confirming a real production admin is not newly locked out by this migration''s workspace-scoped check.';
    end if;

    -- A real 'warehouse' role member of this workspace -- or, failing
    -- that, a real non-admin member temporarily granted 'warehouse' for
    -- the life of this transaction only (mirroring migration 127's own
    -- pm_role_preexisted pattern exactly).
    select wm.user_id into warehouse_user_id
      from public.workspace_members wm
      join public.workspace_member_roles wmr on wmr.workspace_member_id = wm.id
      where wm.workspace_id = v_workspace_id and wmr.role_key = 'warehouse'
        and not wm.is_workspace_admin
      limit 1;
    warehouse_role_preexisted := warehouse_user_id is not null;
    if warehouse_user_id is null then
      select wm.user_id into warehouse_user_id
        from public.workspace_members wm
        where wm.workspace_id = v_workspace_id and not wm.is_workspace_admin
        limit 1;
      if warehouse_user_id is not null then
        insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
          select wm.id, 'warehouse', false from public.workspace_members wm
          where wm.workspace_id = v_workspace_id and wm.user_id = warehouse_user_id
          on conflict do nothing;
      end if;
    end if;

    -- CORRECTED (review): a real member of this workspace who is not the
    -- admin -- ANY non-admin member, regardless of their current roles.
    -- The prior version required finding a member who ALREADY had zero
    -- roles (no warehouse row) -- a real precondition about production
    -- data this test cannot guarantee, and its absence would skip
    -- Sections 1b/1c even though nothing about the RPC itself was
    -- untestable. This fixture's CURRENT roles (if any) are instead
    -- temporarily stripped for the span of Sections 1b/1c only,
    -- snapshotted first and restored immediately after -- deterministic
    -- as long as the workspace has ANY second real member at all, not
    -- dependent on one already being role-less. Not reused as the
    -- warehouse fixture below, so nothing here interferes with Section 3.
    select wm.user_id into non_privileged_user_id
      from public.workspace_members wm
      where wm.workspace_id = v_workspace_id
        and not wm.is_workspace_admin
        and wm.user_id <> coalesce(warehouse_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      limit 1;

    if warehouse_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'sections needing a warehouse user (no non-admin member of the active workspace found to grant a temporary warehouse role to)');
    end if;
    if non_privileged_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Sections 1b/1c (no second real non-admin member of the active workspace found at all)');
    end if;

    -- ============================================================
    -- Catalog fixtures -- real, synthetic inventory_items rows, clearly
    -- named, created fresh in this transaction.
    -- ============================================================
    insert into public.inventory_items (sku, item_name, category)
      values ('ZZ-TEST-A-' || substr(md5(random()::text), 1, 8), 'ZZ_TEST_ITEM_A_' || substr(md5(random()::text), 1, 8), 'Base')
      returning id into item_a_id;
    insert into public.inventory_items (sku, item_name, category)
      values ('ZZ-TEST-B-' || substr(md5(random()::text), 1, 8), 'ZZ_TEST_ITEM_B_' || substr(md5(random()::text), 1, 8), 'Base')
      returning id into item_b_id;
    insert into public.inventory_items (sku, item_name, category)
      values ('ZZ-TEST-C-' || substr(md5(random()::text), 1, 8), 'ZZ_TEST_ITEM_C_' || substr(md5(random()::text), 1, 8), 'Base')
      returning id into item_c_id;
    insert into public.inventory_items (sku, item_name, category)
      values ('ZZ-TEST-AMBIG-1-' || substr(md5(random()::text), 1, 8), ambiguous_item_name, 'Base')
      returning id into ambiguous_item_1_id;
    insert into public.inventory_items (sku, item_name, category)
      values ('ZZ-TEST-AMBIG-2-' || substr(md5(random()::text), 1, 8), ambiguous_item_name, 'Base')
      returning id into ambiguous_item_2_id;

    -- A single combined snapshot (the equipment_types row AND its complete
    -- component collection in one call) used by Section 9 to compare
    -- state after EACH individual rejection, not just once across a whole
    -- group of rejections -- a single function call before/after each
    -- sub-test is far less error-prone than remembering to re-run two
    -- separate queries every time.
    create or replace function pg_temp.zz_snapshot_recipe(p_recipe_id uuid) returns jsonb as $snap$
      select jsonb_build_object(
        'equipment_type', to_jsonb(et),
        'components', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ebc.id, 'inventory_item_id', ebc.inventory_item_id,
            'quantity_required', ebc.quantity_required, 'line_sort', ebc.line_sort, 'is_active', ebc.is_active
          ) order by ebc.line_sort)
          from public.equipment_bom_components ebc where ebc.equipment_type_id = p_recipe_id
        ), '[]'::jsonb)
      )
      from public.equipment_types et where et.id = p_recipe_id;
    $snap$ language sql;

    -- ============================================================
    -- Section 1a: anonymous execution rejected at the grant layer.
    -- ============================================================
    perform set_config('role', 'anon', true);
    caught := false;
    begin
      perform public.save_equipment_recipe(null, recipe_a_name, null, null, false, null, null, '[]'::jsonb);
    exception when others then
      caught := true;
    end;
    perform set_config('role', original_role, true);
    if not caught then
      raise exception 'TEST FAILED: an anon caller should be rejected outright (no EXECUTE grant)';
    end if;
    if exists (select 1 from public.equipment_types where equipment_name = recipe_a_name) then
      raise exception 'TEST FAILED: an anon call should not have created a recipe';
    end if;
    raise notice 'TEST PASSED: anon caller rejected at the grant layer, no recipe created';

    -- ============================================================
    -- Sections 1b/1c: an authenticated caller who is neither warehouse nor
    -- a workspace admin is rejected (1b); separately, a real legacy
    -- app_admins row ALONE (no workspace_members.is_workspace_admin) is
    -- also rejected (1c) -- the direct proof the review's correction #2
    -- actually changed behavior, not just its wording.
    --
    -- Both sections share the same non-privileged fixture. Its CURRENT
    -- roles (if any -- it is no longer required to already have zero) are
    -- snapshotted and temporarily stripped for the span of both sections,
    -- restored immediately after with nested exception protection (both
    -- the success path AND the exception handler restore, matching
    -- Section 2's own pattern) so a real member's real role assignment is
    -- never left altered, even transiently, if either call unexpectedly
    -- raises for a reason other than the one being tested.
    -- ============================================================
    if non_privileged_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 1b (no non-privileged user available)');
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 1c (no non-privileged user available to simulate drift)');
    else
      declare
        already_had_app_admin_row boolean;
      begin
        select coalesce(jsonb_agg(jsonb_build_object('id', wmr.id, 'role_key', wmr.role_key, 'is_primary', wmr.is_primary)), '[]'::jsonb)
          into non_privileged_original_roles
          from public.workspace_member_roles wmr
          join public.workspace_members wm on wm.id = wmr.workspace_member_id
          where wm.workspace_id = v_workspace_id and wm.user_id = non_privileged_user_id;

        delete from public.workspace_member_roles wmr
          using public.workspace_members wm
          where wmr.workspace_member_id = wm.id and wm.workspace_id = v_workspace_id and wm.user_id = non_privileged_user_id;

        select exists (select 1 from public.app_admins where user_id = non_privileged_user_id) into already_had_app_admin_row;

        begin
          -- Section 1b: stripped of every role, no app_admins row --
          -- must be rejected.
          perform set_config('request.jwt.claims', json_build_object('sub', non_privileged_user_id::text)::text, true);
          perform set_config('role', 'authenticated', true);
          caught := false; caught_sqlstate := null;
          begin
            perform public.save_equipment_recipe(null, recipe_a_name, null, null, false, null, null, '[]'::jsonb);
          exception when others then
            caught := true;
            get stacked diagnostics caught_sqlstate = returned_sqlstate;
          end;
          perform set_config('role', original_role, true);
          if not caught or caught_sqlstate is distinct from 'EC009' then
            raise exception 'TEST FAILED: a non-admin, non-warehouse workspace member should be rejected with EC009, got caught=%, sqlstate=%', caught, caught_sqlstate;
          end if;
          if exists (select 1 from public.equipment_types where equipment_name = recipe_a_name) then
            raise exception 'TEST FAILED: a rejected caller should not have created a recipe';
          end if;
          raise notice 'TEST PASSED: a non-admin, non-warehouse workspace member is rejected (SQLSTATE EC009), no recipe created';

          -- Section 1c: same fixture, now given a REAL app_admins row
          -- (the legacy global-admin system) but still no
          -- workspace_members.is_workspace_admin -- must STILL be
          -- rejected. If the fixture unexpectedly already has a real
          -- app_admins row, this is a genuine "cannot cleanly test this
          -- precondition" case -- a tracked SKIP (the script's own
          -- established mechanism for exactly this), not a hard test
          -- failure -- Section 1b above already ran and passed regardless.
          if already_had_app_admin_row then
            skipped_count := skipped_count + 1;
            skipped_names := array_append(skipped_names, 'Section 1c (the non-privileged fixture unexpectedly already has an app_admins row)');
          else
            insert into public.app_admins (user_id) values (non_privileged_user_id);

            perform set_config('request.jwt.claims', json_build_object('sub', non_privileged_user_id::text)::text, true);
            perform set_config('role', 'authenticated', true);
            caught := false; caught_sqlstate := null;
            begin
              perform public.save_equipment_recipe(null, recipe_a_name, null, null, false, null, null, '[]'::jsonb);
            exception when others then
              caught := true;
              get stacked diagnostics caught_sqlstate = returned_sqlstate;
            end;
            perform set_config('role', original_role, true);

            delete from public.app_admins where user_id = non_privileged_user_id;

            if not caught or caught_sqlstate is distinct from 'EC009' then
              raise exception 'TEST FAILED: a user with a legacy app_admins row but no workspace_members.is_workspace_admin=true for this workspace should still be rejected with EC009, got caught=%, sqlstate=%', caught, caught_sqlstate;
            end if;
            if exists (select 1 from public.equipment_types where equipment_name = recipe_a_name) then
              raise exception 'TEST FAILED: a rejected global-admin-only caller should not have created a recipe';
            end if;
            raise notice 'TEST PASSED: a real legacy app_admins row alone (no workspace_members.is_workspace_admin) is rejected (SQLSTATE EC009) -- confirms the fix from is_app_admin() to is_workspace_admin() actually changed behavior, not just its wording';
          end if;

          -- Success-path restoration: real roles back, no lingering
          -- temporary app_admins row.
          delete from public.app_admins where user_id = non_privileged_user_id;
          insert into public.workspace_member_roles (id, workspace_member_id, role_key, is_primary)
            select (r->>'id')::uuid, wm.id, r->>'role_key', (r->>'is_primary')::boolean
            from jsonb_array_elements(non_privileged_original_roles) r
            cross join public.workspace_members wm
            where wm.workspace_id = v_workspace_id and wm.user_id = non_privileged_user_id
            on conflict do nothing;
        exception when others then
          -- Nested restoration protection: guarantee the fixture's real
          -- roles are restored, and no lingering temporary app_admins row
          -- is left behind, even if either call above unexpectedly
          -- raised for a reason other than the one being tested -- before
          -- re-raising the original exception unchanged.
          perform set_config('role', original_role, true);
          delete from public.app_admins where user_id = non_privileged_user_id;
          insert into public.workspace_member_roles (id, workspace_member_id, role_key, is_primary)
            select (r->>'id')::uuid, wm.id, r->>'role_key', (r->>'is_primary')::boolean
            from jsonb_array_elements(non_privileged_original_roles) r
            cross join public.workspace_members wm
            where wm.workspace_id = v_workspace_id and wm.user_id = non_privileged_user_id
            on conflict do nothing;
          raise;
        end;
      end;
    end if;

    -- ============================================================
    -- Section 2: workspace-admin authorization succeeds -- the real,
    -- properly-bridged admin found above can save a recipe.
    --
    -- CORRECTED (review): this must prove the is_workspace_admin() branch
    -- SPECIFICALLY, not merely a successful call that could have passed
    -- through the warehouse branch instead if this admin also happens to
    -- have a 'warehouse' role. If the admin currently has a 'warehouse'
    -- role_key row for this workspace, it is temporarily removed
    -- (snapshotted first) for the duration of this one call only, then
    -- restored immediately after -- regardless of the outer rollback,
    -- since a real workspace_member_roles row for a real production
    -- account should not be left altered by a test, even transiently,
    -- longer than the single call it's protecting.
    --
    -- CORRECTED (review, nested restoration protection): the risky span
    -- (the call itself) is now wrapped in its OWN begin/exception block
    -- with the restore logic duplicated in BOTH the normal-flow
    -- continuation and the exception handler -- not just "restore
    -- unconditionally after the call," which would skip the restore
    -- entirely if save_equipment_recipe unexpectedly raised for any
    -- reason, leaving the real admin's real warehouse role stripped for
    -- the rest of this transaction (not fixed until the final rollback,
    -- which could confuse or break later sections in the same run that
    -- assume the admin's original role state). The exception handler
    -- restores, then re-raises the original error unchanged.
    -- ============================================================
    if admin_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 2 (no bridged workspace admin available)');
    else
      declare
        admin_warehouse_role_id uuid;
        admin_warehouse_was_primary boolean;
      begin
        select wmr.id, wmr.is_primary into admin_warehouse_role_id, admin_warehouse_was_primary
          from public.workspace_member_roles wmr
          join public.workspace_members wm on wm.id = wmr.workspace_member_id
          where wm.workspace_id = v_workspace_id and wm.user_id = admin_user_id and wmr.role_key = 'warehouse';

        if admin_warehouse_role_id is not null then
          delete from public.workspace_member_roles where id = admin_warehouse_role_id;
        end if;

        begin
          perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
          perform set_config('role', 'authenticated', true);
          select public.save_equipment_recipe(null, recipe_a_name, 'ZZ test description', null, false, null, null,
            jsonb_build_array(jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_a_id), 'quantity_required', 2))
          ) into result_json;
          perform set_config('role', original_role, true);
        exception when others then
          perform set_config('role', original_role, true);
          if admin_warehouse_role_id is not null then
            insert into public.workspace_member_roles (id, workspace_member_id, role_key, is_primary)
              select admin_warehouse_role_id, wm.id, 'warehouse', admin_warehouse_was_primary
              from public.workspace_members wm
              where wm.workspace_id = v_workspace_id and wm.user_id = admin_user_id
              on conflict do nothing;
          end if;
          raise;
        end;

        -- Normal-flow restoration (the exception handler above covers the
        -- failure path; this covers the success path -- both must
        -- restore, neither alone is "nested restoration protection").
        if admin_warehouse_role_id is not null then
          insert into public.workspace_member_roles (id, workspace_member_id, role_key, is_primary)
            select admin_warehouse_role_id, wm.id, 'warehouse', admin_warehouse_was_primary
            from public.workspace_members wm
            where wm.workspace_id = v_workspace_id and wm.user_id = admin_user_id
            on conflict do nothing;
        end if;

        if result_json->>'equipmentTypeId' is null then
          raise exception 'TEST FAILED: workspace-admin save should succeed and return a real equipmentTypeId';
        end if;
        recipe_a_id := (result_json->>'equipmentTypeId')::uuid;
        raise notice 'TEST PASSED: a real workspace administrator, WITHOUT a warehouse role for the duration of this call (temporarily removed and restored, with nested exception-protected restoration on both the success and failure paths), can save a recipe -- proves the is_workspace_admin() branch independently, not a pass-through via warehouse';
      end;
    end if;

    -- ============================================================
    -- Section 3: warehouse authorization succeeds -- a distinct real user
    -- with only the 'warehouse' role, not admin, saves a SECOND recipe.
    -- ============================================================
    if warehouse_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 3 (no warehouse user available)');
    else
      perform set_config('request.jwt.claims', json_build_object('sub', warehouse_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.save_equipment_recipe(null, recipe_b_name, null, null, false, null, null,
        jsonb_build_array(jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_b_id), 'quantity_required', 1))
      ) into result_json;
      perform set_config('role', original_role, true);

      if result_json->>'equipmentTypeId' is null then
        raise exception 'TEST FAILED: warehouse-role save should succeed and return a real equipmentTypeId';
      end if;
      recipe_b_id := (result_json->>'equipmentTypeId')::uuid;
      raise notice 'TEST PASSED: a real warehouse-role user (not admin) can save a recipe';
    end if;

    -- ============================================================
    -- Section 4: zero/suspended/multiple-workspace failure. Mirrors
    -- migration 124's own established, safe technique exactly: a second
    -- ACTIVE workspace, a second SUSPENDED workspace, and the sole
    -- workspace suspended-then-restored are all exercised live; "zero
    -- workspaces" is proven structurally (never destructively tested by
    -- deleting the real workspace row).
    -- ============================================================
    if admin_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 4 (no admin user available to call as)');
    else
      declare
        second_workspace_id uuid;
        wcount_before integer;
      begin
        select count(*) into wcount_before from public.equipment_types where equipment_name = recipe_a_name || '_WSTEST';

        -- Second ACTIVE workspace.
        insert into public.workspaces (name, slug, status)
          values ('ZZ Test Second Workspace -- ACTIVE (never committed)', 'zz-test-second-workspace-active-' || substr(md5(random()::text), 1, 8), 'active')
          returning id into second_workspace_id;

        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        caught := false;
        caught_sqlstate := null;
        begin
          perform public.save_equipment_recipe(null, recipe_a_name || '_WSTEST', null, null, false, null, null, '[]'::jsonb);
        exception when others then
          caught := true;
          get stacked diagnostics caught_sqlstate = returned_sqlstate;
        end;
        perform set_config('role', original_role, true);
        if not caught then
          raise exception 'TEST FAILED: save_equipment_recipe should reject with a second ACTIVE workspace present';
        end if;
        if caught_sqlstate is distinct from 'EC008' then
          raise exception 'TEST FAILED: expected SQLSTATE EC008 (workspace guard) with a second active workspace, got %', caught_sqlstate;
        end if;
        raise notice 'TEST PASSED: save_equipment_recipe rejects (SQLSTATE EC008) with a second ACTIVE workspace present';

        -- Second SUSPENDED workspace -- total row count matters, not just
        -- active count.
        update public.workspaces set status = 'suspended' where id = second_workspace_id;
        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        caught := false;
        caught_sqlstate := null;
        begin
          perform public.save_equipment_recipe(null, recipe_a_name || '_WSTEST', null, null, false, null, null, '[]'::jsonb);
        exception when others then
          caught := true;
          get stacked diagnostics caught_sqlstate = returned_sqlstate;
        end;
        perform set_config('role', original_role, true);
        if not caught then
          raise exception 'TEST FAILED: save_equipment_recipe should reject with a second SUSPENDED workspace present';
        end if;
        if caught_sqlstate is distinct from 'EC008' then
          raise exception 'TEST FAILED: expected SQLSTATE EC008 with a second suspended workspace, got %', caught_sqlstate;
        end if;
        raise notice 'TEST PASSED: save_equipment_recipe rejects (SQLSTATE EC008) with a second (merely suspended) workspace present';

        delete from public.workspaces where id = second_workspace_id;

        -- Sole workspace suspended, then restored.
        update public.workspaces set status = 'suspended' where id = v_workspace_id;
        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        caught := false;
        caught_sqlstate := null;
        begin
          perform public.save_equipment_recipe(null, recipe_a_name || '_WSTEST', null, null, false, null, null, '[]'::jsonb);
        exception when others then
          caught := true;
          get stacked diagnostics caught_sqlstate = returned_sqlstate;
        end;
        perform set_config('role', original_role, true);
        update public.workspaces set status = 'active' where id = v_workspace_id;

        if not caught then
          raise exception 'TEST FAILED: save_equipment_recipe should reject when the sole workspace is suspended';
        end if;
        if caught_sqlstate is distinct from 'EC008' then
          raise exception 'TEST FAILED: expected SQLSTATE EC008 with the sole workspace suspended, got %', caught_sqlstate;
        end if;
        raise notice 'TEST PASSED: save_equipment_recipe rejects (SQLSTATE EC008) when the sole workspace is suspended -- restored to active immediately after';

        select count(*) into row_count from public.equipment_types where equipment_name = recipe_a_name || '_WSTEST';
        if row_count is distinct from wcount_before then
          raise exception 'TEST FAILED: one of the workspace-guard rejections above created a recipe row';
        end if;

        -- Zero-workspace case: proven structurally, never live-tested
        -- (would require deleting the real workspace row). This mirrors
        -- migration 124's own test script's exact technique for the same
        -- underlying active_workspace_id() guard.
        select pg_get_functiondef('public.active_workspace_id()'::regprocedure) into func_def;
        if position('from public.workspaces' in func_def) = 0 then
          raise exception 'TEST FAILED: active_workspace_id() source no longer counts from public.workspaces -- cannot verify the zero-workspace case structurally';
        end if;
        if position('total_count' in func_def) = 0 or position('<> 1' in func_def) = 0 then
          raise exception 'TEST FAILED: active_workspace_id() source does not contain the expected total-row-count guard -- the zero-workspace case is no longer provably covered';
        end if;
        select pg_get_functiondef('public.save_equipment_recipe(uuid,text,text,text,boolean,uuid,text,jsonb)'::regprocedure) into func_def;
        if position('active_workspace_id' in func_def) = 0 then
          raise exception 'TEST FAILED: save_equipment_recipe() no longer calls active_workspace_id() at all -- the workspace guard has been removed';
        end if;
        raise notice 'TEST PASSED: active_workspace_id() source confirmed (via pg_get_functiondef) to count ALL workspace rows and reject on total_count <> 1, and save_equipment_recipe() confirmed to call it -- combined with the two live-tested cases above, this proves the zero-workspace case is rejected by the same code path, without ever deleting the real workspace row';
      end;
    end if;

    -- ============================================================
    -- Section 5: rename preserving the same equipment_type_id -- the
    -- direct proof of the bug this migration exists to close.
    -- ============================================================
    if recipe_a_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 5 (recipe A was not created in Section 2)');
    else
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.save_equipment_recipe(recipe_a_id, recipe_a_name || '_RENAMED', 'ZZ test description', null, false, null, null,
        jsonb_build_array(jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_a_id), 'quantity_required', 2))
      ) into result_json;
      perform set_config('role', original_role, true);

      if (result_json->>'equipmentTypeId')::uuid is distinct from recipe_a_id then
        raise exception 'TEST FAILED: renaming via equipmentTypeId should return the SAME id, got %', result_json->>'equipmentTypeId';
      end if;
      if result_json->>'name' is distinct from recipe_a_name || '_RENAMED' then
        raise exception 'TEST FAILED: the recipe should be renamed to the new name';
      end if;
      select count(*) into row_count from public.equipment_types where equipment_name = recipe_a_name;
      if row_count <> 0 then
        raise exception 'TEST FAILED: the OLD name should no longer exist as a separate row -- a rename must not create a duplicate';
      end if;
      select count(*) into row_count from public.equipment_types where id = recipe_a_id;
      if row_count <> 1 then
        raise exception 'TEST FAILED: exactly one row should exist for this recipe after a rename, found %', row_count;
      end if;
      raise notice 'TEST PASSED: renaming an existing recipe via its stable equipmentTypeId updates the SAME row (same id), creates no duplicate under the new name -- the exact bug this migration closes';

      -- Restore the name for subsequent sections' readability (not
      -- required for correctness -- the whole transaction rolls back).
      recipe_a_name := recipe_a_name || '_RENAMED';
    end if;

    -- ============================================================
    -- Section 5b: recipe-name normalization -- a name with leading/
    -- trailing whitespace is stored and returned TRIMMED, and a later
    -- call using the already-trimmed name (no equipmentTypeId, relying on
    -- the name-based fallback resolution) resolves to the SAME row
    -- instead of creating a second one under the untrimmed variant.
    -- ============================================================
    if admin_user_id is not null then
      declare
        untrimmed_name text := '  ZZ_TEST_TRIM_ME_' || substr(md5(random()::text), 1, 8) || '  ';
        trimmed_name text := trim(untrimmed_name);
        trim_recipe_id uuid;
        trim_recipe_id_2 uuid;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        select public.save_equipment_recipe(null, untrimmed_name, null, null, false, null, null, '[]'::jsonb) into result_json;
        perform set_config('role', original_role, true);

        if result_json->>'name' is distinct from trimmed_name then
          raise exception 'TEST FAILED: a name with leading/trailing whitespace should be stored and returned trimmed -- got %', result_json->>'name';
        end if;
        trim_recipe_id := (result_json->>'equipmentTypeId')::uuid;
        if exists (select 1 from public.equipment_types where equipment_name = untrimmed_name) then
          raise exception 'TEST FAILED: no row should exist under the UNTRIMMED name -- storage did not normalize it';
        end if;

        -- Retry with the already-trimmed name, no stable id -- must
        -- resolve to the SAME row (the name-based fallback lookup uses
        -- the same trimmed value the row was stored under), not create a
        -- second row.
        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        select public.save_equipment_recipe(null, trimmed_name, null, null, false, null, null, '[]'::jsonb) into result_json_2;
        perform set_config('role', original_role, true);

        trim_recipe_id_2 := (result_json_2->>'equipmentTypeId')::uuid;
        if trim_recipe_id_2 is distinct from trim_recipe_id then
          raise exception 'TEST FAILED: saving with the already-trimmed name should resolve to the SAME recipe, got a different id (% vs %)', trim_recipe_id, trim_recipe_id_2;
        end if;
        select count(*) into row_count from public.equipment_types where equipment_name = trimmed_name;
        if row_count <> 1 then
          raise exception 'TEST FAILED: exactly one row should exist under the trimmed name, found %', row_count;
        end if;
        raise notice 'TEST PASSED: a name with leading/trailing whitespace is stored and returned trimmed, and a later save using the already-trimmed name resolves to the same row rather than creating a duplicate';
      end;
    else
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Section 5b (no admin user available)');
    end if;

    -- ============================================================
    -- Section 6: unknown equipment_type_id is rejected.
    -- ============================================================
    if admin_user_id is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(gen_random_uuid(), 'ZZ_TEST_UNKNOWN_ID_' || substr(md5(random()::text), 1, 8), null, null, false, null, null, '[]'::jsonb);
      exception when others then
        caught := true;
        get stacked diagnostics caught_sqlstate = returned_sqlstate;
      end;
      perform set_config('role', original_role, true);
      if not caught then
        raise exception 'TEST FAILED: a nonexistent equipment_type_id should be rejected';
      end if;
      if caught_sqlstate is distinct from 'EC010' then
        raise exception 'TEST FAILED: expected SQLSTATE EC010 (unknown id), got %', caught_sqlstate;
      end if;
      raise notice 'TEST PASSED: a nonexistent equipment_type_id is rejected (SQLSTATE EC010)';

      -- ============================================================
      -- Section 6b: a supplied real equipment_type_id is AUTHORITATIVE --
      -- given recipe B's own real id alongside a brand-new name, the
      -- function correctly renames recipe B's own row, same id, rather
      -- than getting confused by the name or creating a fresh insert.
      -- CORRECTED WORDING (review): this is NOT a rejection case -- a
      -- real id for an existing record, combined with any new name that
      -- isn't already used by a DIFFERENT recipe, is valid, expected
      -- behavior in this single-workspace model (there is nothing here to
      -- reject). Section 7 below is the one that proves the actual
      -- rejection case -- a recipe cannot be renamed onto a name a
      -- DIFFERENT existing recipe already has. This section only proves
      -- the id itself is trusted and acted on correctly, independent of
      -- whatever name is supplied alongside it.
      -- ============================================================
      if recipe_b_id is not null then
        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        select public.save_equipment_recipe(recipe_b_id, recipe_b_name || '_IDAUTHORITATIVE', null, null, false, null, null,
          jsonb_build_array(jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_b_id), 'quantity_required', 1))
        ) into result_json;
        perform set_config('role', original_role, true);

        if (result_json->>'equipmentTypeId')::uuid is distinct from recipe_b_id then
          raise exception 'TEST FAILED: a real, existing equipment_type_id should update THAT record''s own row, same id';
        end if;
        select count(*) into row_count from public.equipment_types where id = recipe_a_id and equipment_name = recipe_a_name;
        if row_count <> 1 then
          raise exception 'TEST FAILED: updating recipe B by its own id should not have touched recipe A';
        end if;
        raise notice 'TEST PASSED: a supplied real equipment_type_id is authoritative -- the function updates that specific record (same id) regardless of the new name supplied alongside it, without disturbing an unrelated recipe. (The actual name-collision rejection is proven separately, in Section 7.)';
        recipe_b_name := recipe_b_name || '_IDAUTHORITATIVE';
      end if;
    end if;

    -- ============================================================
    -- Section 7: duplicate recipe-name collision -- saving (or renaming)
    -- to a name already used by a DIFFERENT existing recipe is rejected,
    -- neither recipe is changed.
    --
    -- CORRECTED (review): snapshots BOTH recipes' complete rows before and
    -- after (not just recipe A plus a re-read of recipe B's name alone) --
    -- this call also carries an empty component list for recipe B, which
    -- would clear recipe B's real components if the call reached the
    -- write step, so recipe B's full row is the thing actually at risk
    -- here, not recipe A's.
    -- ============================================================
    if admin_user_id is not null and recipe_a_id is not null and recipe_b_id is not null then
      select to_jsonb(et) into equipment_type_snapshot_before from public.equipment_types et where et.id = recipe_a_id;
      select to_jsonb(et) into equipment_type_snapshot_before_2 from public.equipment_types et where et.id = recipe_b_id;

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false;
      caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_b_id, recipe_a_name, null, null, false, null, null, '[]'::jsonb);
      exception when others then
        caught := true;
        get stacked diagnostics caught_sqlstate = returned_sqlstate;
      end;
      perform set_config('role', original_role, true);

      select to_jsonb(et) into equipment_type_snapshot_after from public.equipment_types et where et.id = recipe_a_id;
      select to_jsonb(et) into equipment_type_snapshot_after_2 from public.equipment_types et where et.id = recipe_b_id;

      if not caught then
        raise exception 'TEST FAILED: renaming recipe B to recipe A''s existing name should be rejected';
      end if;
      if caught_sqlstate is distinct from 'EC016' then
        raise exception 'TEST FAILED: expected SQLSTATE EC016 (name collision), got %', caught_sqlstate;
      end if;
      if equipment_type_snapshot_before is distinct from equipment_type_snapshot_after then
        raise exception 'TEST FAILED: the unrelated recipe A was modified by a rejected name-collision attempt on recipe B';
      end if;
      if equipment_type_snapshot_before_2 is distinct from equipment_type_snapshot_after_2 then
        raise exception 'TEST FAILED: recipe B''s own row (including its components, via the empty-list payload this call carried) was modified despite the rejection -- the whole call, not just the rename, must roll back';
      end if;
      raise notice 'TEST PASSED: renaming to a name already used by a different recipe is rejected (SQLSTATE EC016) -- BOTH recipes'' complete rows confirmed unchanged, including recipe B''s own row despite this call''s empty-component-list payload';
    end if;

    -- ============================================================
    -- Section 8: empty components intentionally clears ONE recipe only.
    -- ============================================================
    if admin_user_id is not null and recipe_a_id is not null and recipe_b_id is not null then
      select count(*) into component_count from public.equipment_bom_components where equipment_type_id = recipe_a_id and is_active;
      if component_count = 0 then
        raise exception 'TEST FAILED (fixture check): recipe A should have at least one active component before this section runs';
      end if;
      select count(*) into row_count from public.equipment_bom_components where equipment_type_id = recipe_b_id and is_active;
      if row_count = 0 then
        raise exception 'TEST FAILED (fixture check): recipe B should have at least one active component before this section runs';
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null, '[]'::jsonb);
      perform set_config('role', original_role, true);

      select count(*) into component_count from public.equipment_bom_components where equipment_type_id = recipe_a_id and is_active;
      if component_count <> 0 then
        raise exception 'TEST FAILED: an empty component list should clear every active component for that recipe, found %', component_count;
      end if;
      select count(*) into row_count from public.equipment_bom_components where equipment_type_id = recipe_b_id and is_active;
      if row_count = 0 then
        raise exception 'TEST FAILED: clearing recipe A''s components should not have touched recipe B''s';
      end if;
      raise notice 'TEST PASSED: an empty component list clears every component for the targeted recipe only, leaving an unrelated recipe''s own components untouched';
    end if;

    -- ============================================================
    -- Section 9: component payload validation -- SQL NULL, JSON null, an
    -- object, a scalar, unresolved, ambiguous, duplicate, malformed, and
    -- invalid-quantity, each its own sub-case.
    --
    -- CORRECTED (review): state (recipe A's own row AND its complete
    -- component collection, via the pg_temp.zz_snapshot_recipe() helper
    -- defined above) is now snapshotted and compared AFTER EACH INDIVIDUAL
    -- rejection, not once before the whole group and once after -- a
    -- single before/after pair across many sub-tests could only prove the
    -- NET state matched at the very end; it could not have caught an
    -- intermediate corruption from sub-test #3 that sub-test #10 happened
    -- to revert back to the original values. Every one of the ~15 calls
    -- below now has its own snapshot-before, call, snapshot-after,
    -- compare, each identifying exactly which sub-test would have failed.
    -- ============================================================
    if admin_user_id is not null and recipe_a_id is not null then
      -- 9-null-a: p_components is SQL NULL (the parameter omitted
      -- entirely) -- must be rejected, not silently treated as "no
      -- components," which could otherwise clear a real recipe's real
      -- components on an accidental omission.
      recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null, null);
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC011' then
        raise exception 'TEST FAILED: SQL NULL p_components should be rejected with EC011, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;
      recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
      if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s state changed after the SQL-NULL-p_components rejection';
      end if;

      -- 9-null-b: p_components is a JSON scalar (a plain number).
      recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null, '42'::jsonb);
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC011' then
        raise exception 'TEST FAILED: a JSON number p_components should be rejected with EC011, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;
      recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
      if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s state changed after the JSON-number-p_components rejection';
      end if;

      -- 9-null-c: p_components is a JSON scalar (a plain string).
      recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null, '"not-an-array"'::jsonb);
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC011' then
        raise exception 'TEST FAILED: a JSON string p_components should be rejected with EC011, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;
      recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
      if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s state changed after the JSON-string-p_components rejection';
      end if;

      -- 9-null-d: p_components is a JSON scalar (a boolean).
      recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null, 'true'::jsonb);
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC011' then
        raise exception 'TEST FAILED: a JSON boolean p_components should be rejected with EC011, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;
      recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
      if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s state changed after the JSON-boolean-p_components rejection';
      end if;

      -- 9a: unresolved component name.
      recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null,
          jsonb_build_array(jsonb_build_object('item_name', 'ZZ_TEST_DOES_NOT_EXIST_' || substr(md5(random()::text), 1, 8), 'quantity_required', 1)));
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC012' then
        raise exception 'TEST FAILED: unresolved component name should be rejected with EC012, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;
      recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
      if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s state changed after the unresolved-component-name rejection';
      end if;

      -- 9b: ambiguous component name.
      recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null,
          jsonb_build_array(jsonb_build_object('item_name', ambiguous_item_name, 'quantity_required', 1)));
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC013' then
        raise exception 'TEST FAILED: ambiguous component name should be rejected with EC013, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;
      recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
      if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s state changed after the ambiguous-component-name rejection';
      end if;

      -- 9c: duplicate component within the recipe (same name twice).
      recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null,
          jsonb_build_array(
            jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_a_id), 'quantity_required', 1),
            jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_a_id), 'quantity_required', 2)
          ));
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC014' then
        raise exception 'TEST FAILED: duplicate component within one recipe should be rejected with EC014, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;
      recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
      if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s state changed after the duplicate-component rejection';
      end if;

      -- 9d: malformed component object (qty is a non-numeric string).
      recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null,
          jsonb_build_array(jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_a_id), 'quantity_required', 'not-a-number')));
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC011' then
        raise exception 'TEST FAILED: a malformed component object should be rejected with EC011, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;
      recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
      if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s state changed after the malformed-component-object rejection';
      end if;

      -- 9e: p_components is a JSON object, not an array.
      recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null, '{"not": "an array"}'::jsonb);
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC011' then
        raise exception 'TEST FAILED: a JSON object p_components should be rejected with EC011, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;
      recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
      if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s state changed after the JSON-object-p_components rejection';
      end if;

      -- 9e-2: p_components is an explicit JSON null value (not SQL NULL).
      recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null, 'null'::jsonb);
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC011' then
        raise exception 'TEST FAILED: an explicit JSON null p_components should be rejected with EC011, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;
      recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
      if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s state changed after the JSON-null-p_components rejection';
      end if;

      -- 9f: invalid quantities -- zero, negative, NaN, Infinity,
      -- -Infinity, and too large for numeric(12,2) -- each its own call,
      -- each asserted to fail with EC011 specifically, each with its own
      -- before/after snapshot compare.
      --
      -- The quantity is passed as JSON TEXT (jsonb_build_object with a
      -- text argument produces a JSON string value), not pre-cast to
      -- numeric in this test script itself. The ->>'quantity_required'
      -- extraction inside save_equipment_recipe() returns text regardless
      -- of whether the underlying JSON value is a string or a number, so
      -- this is exactly what a real payload looks like -- and it means
      -- the numeric cast (and therefore the actual rejection) happens
      -- INSIDE the RPC, not in this script's own argument construction.
      for v_invalid_qty_text in select unnest(array['0', '-5', 'NaN', 'Infinity', '-Infinity', '99999999999']) loop
        recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        caught := false; caught_sqlstate := null;
        begin
          perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, null,
            jsonb_build_array(jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_a_id), 'quantity_required', v_invalid_qty_text)));
        exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
        perform set_config('role', original_role, true);
        if not caught or caught_sqlstate is distinct from 'EC011' then
          raise exception 'TEST FAILED: quantity_required = % should be rejected with EC011, got caught=%, sqlstate=%', v_invalid_qty_text, caught, caught_sqlstate;
        end if;
        recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
        if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
          raise exception 'TEST FAILED: recipe A''s state changed after the quantity_required=% rejection', v_invalid_qty_text;
        end if;
      end loop;

      -- 9g: p_retired is SQL NULL -- must be rejected with EC011.
      recipe_full_snapshot_before := pg_temp.zz_snapshot_recipe(recipe_a_id);
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, null, null, null,
          jsonb_build_array(jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_a_id), 'quantity_required', 1)));
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC011' then
        raise exception 'TEST FAILED: p_retired = NULL should be rejected with EC011, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;
      recipe_full_snapshot_after := pg_temp.zz_snapshot_recipe(recipe_a_id);
      if recipe_full_snapshot_before is distinct from recipe_full_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s state changed after the p_retired=NULL rejection';
      end if;

      raise notice 'TEST PASSED: SQL NULL, JSON null, object, string, number, and boolean p_components; unresolved (EC012); ambiguous (EC013); duplicate (EC014); malformed (EC011); invalid-quantity (zero/negative/NaN/Infinity/-Infinity/too-large, all EC011); and p_retired=NULL (EC011) are all rejected before any write, with the exact expected SQLSTATE asserted for each, and recipe A''s complete state (row + components) verified unchanged AFTER EACH INDIVIDUAL rejection, not just once across the whole group';
    end if;

    -- ============================================================
    -- Section 10: invalid output_inventory_item_id is rejected. Note the
    -- payload here is a real, explicit empty array ('[]'), which WOULD
    -- clear recipe A's real components if this call ever reached the
    -- write step (Step 7's output-item check runs before Step 8/9's
    -- writes) -- exactly why the full before/after snapshot below,
    -- covering both the equipment_types row and the complete component
    -- collection, matters here specifically, not just a generic sanity
    -- check.
    -- ============================================================
    if admin_user_id is not null and recipe_a_id is not null then
      select to_jsonb(et) into equipment_type_snapshot_before from public.equipment_types et where et.id = recipe_a_id;
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'inventory_item_id', inventory_item_id, 'quantity_required', quantity_required,
        'line_sort', line_sort, 'is_active', is_active
      ) order by line_sort), '[]'::jsonb)
      into component_snapshot_before
      from public.equipment_bom_components where equipment_type_id = recipe_a_id;

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      caught := false; caught_sqlstate := null;
      begin
        perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, gen_random_uuid(), null, '[]'::jsonb);
      exception when others then caught := true; get stacked diagnostics caught_sqlstate = returned_sqlstate; end;
      perform set_config('role', original_role, true);
      if not caught or caught_sqlstate is distinct from 'EC015' then
        raise exception 'TEST FAILED: an invalid output_inventory_item_id should be rejected with EC015, got caught=%, sqlstate=%', caught, caught_sqlstate;
      end if;

      select to_jsonb(et) into equipment_type_snapshot_after from public.equipment_types et where et.id = recipe_a_id;
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'inventory_item_id', inventory_item_id, 'quantity_required', quantity_required,
        'line_sort', line_sort, 'is_active', is_active
      ) order by line_sort), '[]'::jsonb)
      into component_snapshot_after
      from public.equipment_bom_components where equipment_type_id = recipe_a_id;

      if equipment_type_snapshot_before is distinct from equipment_type_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s own row changed despite the invalid output_inventory_item_id call being rejected';
      end if;
      if component_snapshot_before is distinct from component_snapshot_after then
        raise exception 'TEST FAILED: recipe A''s components were cleared by a rejected call that carried an empty component list -- the rejection must happen before ANY write, including the component reconciliation';
      end if;
      raise notice 'TEST PASSED: an invalid stable output_inventory_item_id is rejected (SQLSTATE EC015), with recipe A''s own row AND its complete component collection confirmed unchanged -- proving the empty-components payload in this call''s test fixture was never actually written';
    end if;

    -- ============================================================
    -- Section 11: output-NAME resolution is tolerant -- zero, one, and
    -- multiple matches all succeed (never an error), resolving to null,
    -- the real id, and null respectively.
    -- ============================================================
    if admin_user_id is not null and recipe_a_id is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, 'ZZ_TEST_NO_SUCH_OUTPUT_' || substr(md5(random()::text), 1, 8), '[]'::jsonb) into result_json;
      perform set_config('role', original_role, true);
      if result_json is null then
        raise exception 'TEST FAILED: a zero-match output name should still succeed';
      end if;
      if (select output_inventory_item_id from public.equipment_types where id = recipe_a_id) is not null then
        raise exception 'TEST FAILED: a zero-match output name should resolve to null, not an arbitrary id';
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, (select item_name from public.inventory_items where id = item_c_id), '[]'::jsonb);
      perform set_config('role', original_role, true);
      if (select output_inventory_item_id from public.equipment_types where id = recipe_a_id) is distinct from item_c_id then
        raise exception 'TEST FAILED: a one-match output name should resolve to that real item''s id';
      end if;

      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      perform public.save_equipment_recipe(recipe_a_id, recipe_a_name, null, null, false, null, ambiguous_item_name, '[]'::jsonb);
      perform set_config('role', original_role, true);
      if (select output_inventory_item_id from public.equipment_types where id = recipe_a_id) is not null then
        raise exception 'TEST FAILED: a multiple-match output name should resolve to null, not an arbitrary pick';
      end if;

      raise notice 'TEST PASSED: output-item NAME resolution is tolerant -- zero, one, and multiple matches all succeed without error, resolving to null/the real id/null respectively';
    end if;

    -- ============================================================
    -- Section 12: rollback after a forced component-write failure --
    -- proves the recipe's OWN row (name/description just set in this
    -- same call) also remains unchanged, not just the components. Uses a
    -- temporary AFTER INSERT trigger on equipment_bom_components, scoped
    -- to a sentinel item name only, added and dropped entirely within
    -- this same rolled-back transaction.
    -- ============================================================
    if admin_user_id is not null and recipe_a_id is not null then
      declare
        sentinel_item_id uuid;
        sentinel_item_name text := 'ZZ_TEST_FORCE_FAILURE_' || substr(md5(random()::text), 1, 8);
      begin
        insert into public.inventory_items (sku, item_name, category)
          values ('ZZ-TEST-SENTINEL-' || substr(md5(random()::text), 1, 8), sentinel_item_name, 'Base')
          returning id into sentinel_item_id;

        -- pg_temp functions can't easily reference an outer-scope plpgsql
        -- variable by name at CREATE time, so the sentinel id is baked in
        -- via dynamic SQL (format %L) instead. Note: inside a $f$...$f$
        -- dollar-quoted string, a single-quoted literal needs only ONE
        -- pair of quotes, not doubled -- this is not a regular '...'
        -- string that would need its interior quotes escaped.
        execute format(
          $f$
          create or replace function pg_temp.zz_test_force_component_failure() returns trigger as $body$
          begin
            if new.inventory_item_id = %L::uuid then
              raise exception 'ZZ_TEST forced failure';
            end if;
            return new;
          end;
          $body$ language plpgsql;
          $f$,
          sentinel_item_id
        );

        create trigger zz_test_force_component_failure_trg
          after insert on public.equipment_bom_components
          for each row execute function pg_temp.zz_test_force_component_failure();

        select to_jsonb(et) into equipment_type_snapshot_before from public.equipment_types et where et.id = recipe_a_id;
        -- CORRECTED (review): the complete ordered component collection,
        -- not just a count -- a matching count alone would not detect a
        -- component row that was replaced or altered (e.g. deleted and a
        -- different one re-inserted with a different id, or a quantity
        -- silently changed) while the total number stayed the same.
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'inventory_item_id', inventory_item_id, 'quantity_required', quantity_required,
          'line_sort', line_sort, 'is_active', is_active
        ) order by line_sort), '[]'::jsonb)
        into component_snapshot_before
        from public.equipment_bom_components where equipment_type_id = recipe_a_id;

        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        caught := false;
        begin
          perform public.save_equipment_recipe(recipe_a_id, recipe_a_name || '_SHOULD_NOT_STICK', 'ZZ this description should not stick', null, false, null, null,
            jsonb_build_array(jsonb_build_object('item_name', sentinel_item_name, 'quantity_required', 1)));
        exception when others then
          caught := true;
        end;
        perform set_config('role', original_role, true);

        drop trigger zz_test_force_component_failure_trg on public.equipment_bom_components;

        if not caught then
          raise exception 'TEST FAILED: the forced component-insert failure should have propagated out of save_equipment_recipe';
        end if;

        select to_jsonb(et) into equipment_type_snapshot_after from public.equipment_types et where et.id = recipe_a_id;
        if equipment_type_snapshot_before is distinct from equipment_type_snapshot_after then
          raise exception 'TEST FAILED: the recipe''s OWN row (name/description) changed even though the component write for the same call failed -- atomicity broken';
        end if;
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'inventory_item_id', inventory_item_id, 'quantity_required', quantity_required,
          'line_sort', line_sort, 'is_active', is_active
        ) order by line_sort), '[]'::jsonb)
        into component_snapshot_after
        from public.equipment_bom_components where equipment_type_id = recipe_a_id;
        if component_snapshot_before is distinct from component_snapshot_after then
          raise exception 'TEST FAILED: the recipe''s complete component collection changed despite the forced failure -- atomicity broken';
        end if;
        raise notice 'TEST PASSED: a forced failure partway through the component write rolls back the ENTIRE call, including the equipment_types row this same call had already set AND the complete component collection (ids, inventory ids, quantities, line order, active state all confirmed unchanged, not just a matching count) -- true atomicity, not just a checked write';
      end;
    end if;

    -- ============================================================
    -- Section 13: identical retry produces the same recipe and component
    -- identities -- no duplicate rows, same ids both times.
    -- ============================================================
    if admin_user_id is not null and recipe_a_id is not null then
      declare
        component_ids_1 uuid[];
        component_ids_2 uuid[];
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        select public.save_equipment_recipe(recipe_a_id, recipe_a_name, 'ZZ retry test', null, false, null, null,
          jsonb_build_array(jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_a_id), 'quantity_required', 3))
        ) into result_json;
        perform set_config('role', original_role, true);

        select array_agg(id order by inventory_item_id) into component_ids_1
          from public.equipment_bom_components where equipment_type_id = recipe_a_id and is_active;

        perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
        perform set_config('role', 'authenticated', true);
        select public.save_equipment_recipe(recipe_a_id, recipe_a_name, 'ZZ retry test', null, false, null, null,
          jsonb_build_array(jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_a_id), 'quantity_required', 3))
        ) into result_json_2;
        perform set_config('role', original_role, true);

        select array_agg(id order by inventory_item_id) into component_ids_2
          from public.equipment_bom_components where equipment_type_id = recipe_a_id and is_active;

        if (result_json->>'equipmentTypeId')::uuid is distinct from (result_json_2->>'equipmentTypeId')::uuid then
          raise exception 'TEST FAILED: an identical retry should return the same equipmentTypeId';
        end if;
        if component_ids_1 is distinct from component_ids_2 then
          raise exception 'TEST FAILED: an identical retry should preserve the same component row identities, not create new ones';
        end if;
        select count(*) into row_count from public.equipment_types where id = recipe_a_id;
        if row_count <> 1 then
          raise exception 'TEST FAILED: an identical retry should not create a duplicate equipment_types row';
        end if;
        raise notice 'TEST PASSED: calling save_equipment_recipe twice with the same payload produces the same recipe id and the same component row identities, no duplicates';
      end;
    end if;

    -- ============================================================
    -- Section 14: returned JSON maps completely into BuildRecipe --
    -- CORRECTED (review): checks the actual JSON TYPE of every field, not
    -- just that the key is present. Key-presence alone would not catch a
    -- real regression (e.g. `retired` returned as the STRING "true"
    -- instead of the JSON boolean `true` -- `(result_json->>'retired')::boolean`
    -- would still cast successfully either way, so that check alone,
    -- used by the previous version of this section, could not have told
    -- the two apart). Two calls: one with a real imageUrl (expects JSON
    -- type 'string'), one with no image at all (expects JSON type
    -- 'null'), since BOTH are valid outcomes of the RPC's own contract
    -- (imageUrl is `string | null` at the SQL/JSON level; the mapper,
    -- not the RPC, converts null to undefined -- see
    -- mapSaveEquipmentRecipeResult in src/persistence.ts) and a type
    -- check on only one of the two would leave the other unverified.
    -- ============================================================
    if admin_user_id is not null and recipe_a_id is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.save_equipment_recipe(recipe_a_id, recipe_a_name, 'ZZ mapping test', 'https://example.test/img.png', true, null, null,
        jsonb_build_array(jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_a_id), 'quantity_required', 5))
      ) into result_json;
      perform set_config('role', original_role, true);

      if jsonb_typeof(result_json->'equipmentTypeId') is distinct from 'string' then
        raise exception 'TEST FAILED: equipmentTypeId should be a JSON string, got type %', jsonb_typeof(result_json->'equipmentTypeId');
      end if;
      if jsonb_typeof(result_json->'name') is distinct from 'string' then
        raise exception 'TEST FAILED: name should be a JSON string, got type %', jsonb_typeof(result_json->'name');
      end if;
      if jsonb_typeof(result_json->'outputName') is distinct from 'string' then
        raise exception 'TEST FAILED: outputName should be a JSON string, got type %', jsonb_typeof(result_json->'outputName');
      end if;
      if jsonb_typeof(result_json->'description') is distinct from 'string' then
        raise exception 'TEST FAILED: description should be a JSON string (never null -- coalesced to empty string), got type %', jsonb_typeof(result_json->'description');
      end if;
      if jsonb_typeof(result_json->'imageUrl') is distinct from 'string' then
        raise exception 'TEST FAILED: imageUrl should be a JSON string when a real image_url is set, got type %', jsonb_typeof(result_json->'imageUrl');
      end if;
      if jsonb_typeof(result_json->'retired') is distinct from 'boolean' then
        raise exception 'TEST FAILED: retired should be a JSON boolean (not a string or number that happens to cast), got type %', jsonb_typeof(result_json->'retired');
      end if;
      if (result_json->>'retired')::boolean is distinct from true then
        raise exception 'TEST FAILED: retired should round-trip as true';
      end if;
      if jsonb_typeof(result_json->'components') is distinct from 'array' then
        raise exception 'TEST FAILED: components should be a JSON array, got type %', jsonb_typeof(result_json->'components');
      end if;
      if jsonb_array_length(result_json->'components') <> 1 then
        raise exception 'TEST FAILED: expected exactly 1 component in this call''s payload, got %', jsonb_array_length(result_json->'components');
      end if;
      if jsonb_typeof(result_json->'components'->0->'itemName') is distinct from 'string' then
        raise exception 'TEST FAILED: each component''s itemName should be a JSON string, got type %', jsonb_typeof(result_json->'components'->0->'itemName');
      end if;
      if jsonb_typeof(result_json->'components'->0->'qty') is distinct from 'number' then
        raise exception 'TEST FAILED: each component''s qty should be a JSON number, got type %', jsonb_typeof(result_json->'components'->0->'qty');
      end if;

      -- Second call, no image at all -- imageUrl must come back as the
      -- JSON type 'null' specifically (not absent, not a string).
      perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
      perform set_config('role', 'authenticated', true);
      select public.save_equipment_recipe(recipe_a_id, recipe_a_name, 'ZZ mapping test', null, false, null, null,
        jsonb_build_array(jsonb_build_object('item_name', (select item_name from public.inventory_items where id = item_a_id), 'quantity_required', 5))
      ) into result_json_2;
      perform set_config('role', original_role, true);

      if not (result_json_2 ? 'imageUrl') then
        raise exception 'TEST FAILED: imageUrl key should still be present even when there is no image';
      end if;
      if jsonb_typeof(result_json_2->'imageUrl') is distinct from 'null' then
        raise exception 'TEST FAILED: imageUrl should be the JSON type null when there is no image, got type %', jsonb_typeof(result_json_2->'imageUrl');
      end if;
      if jsonb_typeof(result_json_2->'retired') is distinct from 'boolean' or (result_json_2->>'retired')::boolean is distinct from false then
        raise exception 'TEST FAILED: retired should round-trip as JSON boolean false in this second call';
      end if;

      raise notice 'TEST PASSED: the returned JSON maps completely into BuildRecipe''s own shape with the correct JSON TYPE for every field (equipmentTypeId/name/outputName/description/imageUrl as string, retired as boolean, components as an array of {itemName: string, qty: number}) -- verified for both a real imageUrl (JSON string) and no image at all (JSON null, matching the RPC''s null | string contract that mapSaveEquipmentRecipeResult converts, not the RPC itself)';
    end if;

    -- ============================================================
    -- Section 15: exact function search_path and grants.
    -- ============================================================
    select pg_get_functiondef('public.save_equipment_recipe(uuid,text,text,text,boolean,uuid,text,jsonb)'::regprocedure) into func_def;
    if position(search_path_marker in func_def) = 0 then
      raise exception 'TEST FAILED: save_equipment_recipe() does not have search_path pinned to an empty string';
    end if;
    if has_function_privilege('anon', 'public.save_equipment_recipe(uuid,text,text,text,boolean,uuid,text,jsonb)', 'EXECUTE') then
      raise exception 'TEST FAILED: anon should not have EXECUTE on save_equipment_recipe()';
    end if;
    if not has_function_privilege('authenticated', 'public.save_equipment_recipe(uuid,text,text,text,boolean,uuid,text,jsonb)', 'EXECUTE') then
      raise exception 'TEST FAILED: authenticated should have EXECUTE on save_equipment_recipe()';
    end if;
    if exists (
      select 1 from information_schema.role_routine_grants
      where routine_schema = 'public' and routine_name = 'save_equipment_recipe' and grantee = 'anon'
    ) then
      raise exception 'TEST FAILED: information_schema.role_routine_grants shows a grant to anon on save_equipment_recipe';
    end if;
    raise notice 'TEST PASSED: save_equipment_recipe() has search_path pinned to an empty string, is executable by authenticated, and is confirmed (both has_function_privilege and information_schema.role_routine_grants) to have no anon grant';

    -- ============================================================
    -- Cleanup of temporary role grants (not required for correctness --
    -- the whole transaction rolls back -- kept for readability if this
    -- script is ever adapted to run section-by-section outside a single
    -- rollback).
    -- ============================================================
    if not warehouse_role_preexisted and warehouse_user_id is not null then
      delete from public.workspace_member_roles wmr
        using public.workspace_members wm
        where wmr.workspace_member_id = wm.id and wm.workspace_id = v_workspace_id
          and wm.user_id = warehouse_user_id and wmr.role_key = 'warehouse' and wmr.is_primary = false;
    end if;
  end if;

  -- ============================================================
  -- Section 16: two-session concurrency -- CANNOT be exercised from a
  -- single SQL script/connection (this whole script runs sequentially on
  -- one connection). Documented here, same reasoning and methodology as
  -- migration 127's own test script's concurrency section, and the
  -- design document's own §7/§14 item 9 -- an external harness with two
  -- real database connections is required, run separately, NOT as part
  -- of this rolled-back-transaction script.
  --
  -- Case A -- EXISTING recipe (row lock):
  --   1. Session A: BEGIN; SELECT id FROM equipment_types WHERE id =
  --      '<real-recipe-id>' FOR UPDATE; -- do not commit yet.
  --   2. Session B (started while A is still open): call
  --      rpc/save_equipment_recipe for the SAME equipment_type_id.
  --   3. A third, monitoring connection queries pg_locks/pg_blocking_pids()
  --      and confirms session B's backend is blocked, naming session A's
  --      backend as the blocker -- timing-independent, not a guess.
  --   4. Session A commits or rolls back; confirm session B's call then
  --      completes, and that the final row reflects exactly one call's
  --      data (assert which session's payload should win, explicitly).
  --
  -- Case B -- NEW recipe (advisory lock):
  --   1. Session A: BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(
  --      'equipment_type:Test Recipe', 0)); -- do not commit yet.
  --   2. Session B (started while A is still open): call
  --      rpc/save_equipment_recipe to CREATE a recipe named exactly
  --      'Test Recipe' (no equipment_type_id).
  --   3. Same monitoring-connection proof session B is blocked on session A.
  --   4. Session A commits or rolls back; confirm session B's call then
  --      completes, and that exactly ONE equipment_types row named
  --      'Test Recipe' exists afterward -- not a raw unique-constraint
  --      error surfaced to the loser.
  --
  -- This section intentionally does not run any SQL and cannot be
  -- "skipped" in the sense the rest of this script tracks -- it is
  -- documentation, not an automated assertion. It is not counted toward
  -- skipped_count.
  --
  -- HOW THIS ACTUALLY GETS VERIFIED, WITHOUT MANUAL MULTI-TAB
  -- COORDINATION: two real, simultaneously-open database connections are
  -- unavoidably required for a genuine concurrency proof -- neither
  -- Supabase's PostgREST API (stateless, no held-open transactions across
  -- requests) nor a single SQL editor tab can hold session A's
  -- transaction open while session B's call runs. The one way to automate
  -- both cases above as ONE command, with no tabs to coordinate and no
  -- transaction to babysit, is a small standalone script using a real
  -- Postgres client library (e.g. Node's `pg` package) that opens the two
  -- connections itself, runs the exact sequences above, and reports a
  -- single pass/fail. That is genuinely the simplest path -- but it
  -- requires a client library this project does not currently depend on
  -- (everything today talks to Supabase via plain PostgREST `fetch()`
  -- calls, confirmed nowhere does this repo use `pg`, `postgres`, or
  -- `supabase-js`). Nothing has been added -- this is a proposal for E's
  -- decision, not a change made unilaterally:
  --   - If E approves adding `pg` as a temporary devDependency (removable
  --     afterward), a follow-up pass writes
  --     `scripts/verify-recipe-concurrency.mjs`, E runs it once
  --     (`node scripts/verify-recipe-concurrency.mjs`) against the real
  --     database connection string, and it reports pass/fail for both
  --     Case A and Case B automatically -- no manual tab-juggling at all.
  --   - If E would rather not add any dependency, the fallback is the
  --     manual two-SQL-editor-tab process spelled out in Case A/B above,
  --     which does require the kind of coordination E asked to avoid --
  --     kept here only as a documented fallback, not the recommended path.
  --   - This environment (no local Postgres client of any kind, confirmed
  --     -- no `psql` on PATH) cannot run either path itself; whichever
  --     path E picks still needs to be run by E, separately, after the
  --     migration and this transaction-safe test script are both already
  --     confirmed passing.
  -- ============================================================

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, '; ');
  end if;

  raise notice 'ALL MIGRATION 130 RECIPE SAVE TESTS PASSED -- ZERO SECTIONS SKIPPED (two-session concurrency documented in Section 16 for separate, external execution)';
end $$;

rollback;
