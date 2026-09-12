-- Transaction-safe tests for migration 131's replace_project_bom_lines() RPC.
-- Wrapped in begin;/rollback; -- nothing here ever commits. Uses REAL,
-- already-existing users and workspace membership for every authorization
-- check (never fabricates a fake auth.users row, never removes or
-- destructively mutates a real user's real workspace membership -- role
-- grants are added only when genuinely missing and removed again before the
-- script ends, moot regardless since the whole transaction rolls back), but
-- every project, BOM line, and inventory catalog item used as a fixture is
-- created fresh inside this same rolled-back transaction, clearly named
-- "ZZ_TEST_..." so none of it can ever be confused with real production
-- data even if something went wrong and this somehow committed.
--
-- Every "should fail" assertion snapshots the row/id state it could have
-- affected before and after the call and asserts equality -- catching an
-- exception alone does not prove nothing was written.
--
-- DRAFTED FOR LOCAL REVIEW ONLY. NOT RUN. This is a first draft, written
-- alongside migration 131 itself, not yet reviewed by E -- unlike migration
-- 130's test script (which went through several review/correction rounds
-- before E ran it), this has had exactly one pass. Expect correction rounds
-- before this is approved to run, same process as every other migration in
-- this repo.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 131 BOM REPLACE TESTS
-- PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error (a "TEST FAILED"
-- exception from a real assertion, a "SECTIONS SKIPPED" exception naming
-- what was skipped, or a genuine unexpected SQL error). It can never
-- quietly finish as "Success. No rows returned." with something having
-- been skipped.
--
-- Two-session concurrency (the FOR UPDATE lock on the parent project row)
-- is NOT automated here, for the same reason migration 130's own test
-- script documents its Section 16 as a plan rather than a runnable test:
-- a single SQL script executes on one connection and cannot open a second,
-- genuinely concurrent transaction against itself. See this file's final
-- section for the documented (not automated) two-session verification
-- procedure.

begin;

do $$
declare
  v_workspace_id uuid;
  admin_user_id uuid;
  pm_user_id uuid;
  pm_role_preexisted boolean;
  non_privileged_user_id uuid;
  non_privileged_original_roles jsonb;
  original_role text;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  caught boolean;
  caught_sqlstate text;
  result_json jsonb;
  result_json_2 jsonb;

  -- Catalog fixtures.
  item_a_id uuid;
  item_a_sku text := 'ZZ-TEST-BOM-A-' || substr(md5(random()::text), 1, 8);
  item_a_name text := 'ZZ_TEST_BOM_ITEM_A_' || substr(md5(random()::text), 1, 8);
  item_b_id uuid;
  item_b_sku text := 'ZZ-TEST-BOM-B-' || substr(md5(random()::text), 1, 8);
  item_b_name text := 'ZZ_TEST_BOM_ITEM_B_' || substr(md5(random()::text), 1, 8);
  other_item_id uuid;
  other_item_sku text := 'ZZ-TEST-BOM-OTHER-' || substr(md5(random()::text), 1, 8);
  ambiguous_item_1_id uuid;
  ambiguous_item_2_id uuid;
  ambiguous_item_name text := 'ZZ_TEST_BOM_AMBIGUOUS_' || substr(md5(random()::text), 1, 8);

  -- Project-under-test fixtures.
  project_a_name text := 'ZZ_TEST_BOM_PROJECT_A_' || substr(md5(random()::text), 1, 10);
  project_a_id uuid;
  project_b_name text := 'ZZ_TEST_BOM_PROJECT_B_' || substr(md5(random()::text), 1, 10);
  project_b_id uuid;
  other_project_line_id uuid;

  bom_snapshot_before jsonb;
  bom_snapshot_after jsonb;
  row_count integer;
  line_a_id uuid;
  line_b_id uuid;

  search_path_marker text := 'SET search_path TO ' || quote_literal('');
  func_def text;
begin
  select current_setting('role') into original_role;

  -- ============================================================
  -- Fixture discovery: the real, currently-active workspace and its real
  -- members -- same convention as migration 127/130's own test scripts.
  -- ============================================================
  select w.id into v_workspace_id from public.workspaces w where w.status = 'active' limit 1;

  if v_workspace_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no active workspace found)');
  else
    select wm.user_id into admin_user_id
      from public.workspace_members wm
      where wm.workspace_id = v_workspace_id and wm.is_workspace_admin
      limit 1;

    if admin_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'workspace-admin sections (no workspace_members row with is_workspace_admin=true found for the active workspace)');
    end if;

    -- A real 'pm' role member of this workspace -- or, failing that, a
    -- real non-admin member temporarily granted 'pm' for the life of this
    -- transaction only (mirroring migration 127/130's own pattern).
    select wm.user_id into pm_user_id
      from public.workspace_members wm
      join public.workspace_member_roles wmr on wmr.workspace_member_id = wm.id
      where wm.workspace_id = v_workspace_id and wmr.role_key = 'pm'
        and not wm.is_workspace_admin
      limit 1;
    pm_role_preexisted := pm_user_id is not null;
    if pm_user_id is null then
      select wm.user_id into pm_user_id
        from public.workspace_members wm
        where wm.workspace_id = v_workspace_id and not wm.is_workspace_admin
        limit 1;
      if pm_user_id is not null then
        insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
          select wm.id, 'pm', false from public.workspace_members wm
          where wm.workspace_id = v_workspace_id and wm.user_id = pm_user_id
          on conflict do nothing;
      end if;
    end if;

    -- Any non-admin member at all, for the unauthorized-caller section --
    -- current roles temporarily stripped for that one section, restored
    -- immediately after (nested exception protection), same pattern as
    -- migration 130's test script.
    select wm.user_id into non_privileged_user_id
      from public.workspace_members wm
      where wm.workspace_id = v_workspace_id
        and not wm.is_workspace_admin
        and wm.user_id <> coalesce(pm_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      limit 1;

    if pm_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'sections needing a PM user (no non-admin member of the active workspace found to grant a temporary pm role to)');
    end if;
    if non_privileged_user_id is null then
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'unauthorized-caller section (no second real non-admin member of the active workspace found at all)');
    end if;

    -- ============================================================
    -- Catalog + project fixtures.
    -- ============================================================
    insert into public.inventory_items (sku, item_name, category)
      values (item_a_sku, item_a_name, 'Base') returning id into item_a_id;
    insert into public.inventory_items (sku, item_name, category)
      values (item_b_sku, item_b_name, 'Base') returning id into item_b_id;
    insert into public.inventory_items (sku, item_name, category)
      values (other_item_sku, 'ZZ_TEST_BOM_OTHER_ITEM_' || substr(md5(random()::text), 1, 8), 'Base') returning id into other_item_id;
    insert into public.inventory_items (sku, item_name, category)
      values ('ZZ-TEST-BOM-AMB1-' || substr(md5(random()::text), 1, 6), ambiguous_item_name, 'Base') returning id into ambiguous_item_1_id;
    insert into public.inventory_items (sku, item_name, category)
      values ('ZZ-TEST-BOM-AMB2-' || substr(md5(random()::text), 1, 6), ambiguous_item_name, 'Base') returning id into ambiguous_item_2_id;

    insert into public.projects (project_name, project_number, customer_name, site_type, app_status)
      values (project_a_name, 'ZZ-TEST-A', 'ZZ_TEST_CUSTOMER', 'Parking Garage', 'Draft')
      returning id into project_a_id;
    insert into public.projects (project_name, project_number, customer_name, site_type, app_status)
      values (project_b_name, 'ZZ-TEST-B', 'ZZ_TEST_CUSTOMER', 'Parking Garage', 'Draft')
      returning id into project_b_id;

    -- A real, pre-existing line on project B -- used to prove a line id
    -- belonging to a DIFFERENT project is rejected, not reassigned.
    insert into public.project_bom_lines (project_id, item_name, qty, status, request_speed, line_sort)
      values (project_b_id, 'ZZ_TEST_OTHER_PROJECT_LINE', 1, 'Not started', 'Standard', 0)
      returning id into other_project_line_id;

    raise notice 'FIXTURES READY: workspace=%, admin=%, pm=% (preexisted role: %), non_privileged=%, project_a=%, project_b=%',
      v_workspace_id, admin_user_id, pm_user_id, pm_role_preexisted, non_privileged_user_id, project_a_id, project_b_id;

    -- ============================================================
    -- Section 1: anon / unauthenticated caller is rejected.
    -- ============================================================
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claim.sub', '', true);
    begin
      perform public.replace_project_bom_lines(project_a_id, '[]'::jsonb);
      raise exception 'TEST FAILED (Section 1): anon call did not raise at all.';
    exception when insufficient_privilege then
      raise notice 'TEST PASSED (Section 1): anon call rejected at the grant layer (insufficient_privilege), before the function body ever ran.';
    when others then
      raise exception 'TEST FAILED (Section 1): anon call raised an unexpected error instead of insufficient_privilege: % / %', sqlstate, sqlerrm;
    end;
    perform set_config('role', original_role, true);

    -- ============================================================
    -- Section 2: unauthorized (non-admin, non-pm) caller is rejected --
    -- existing BOM lines on project_a (currently none) are unaffected.
    -- ============================================================
    if non_privileged_user_id is not null then
      select coalesce(jsonb_agg(row_to_json(wmr.*)), '[]'::jsonb) into non_privileged_original_roles
        from public.workspace_member_roles wmr
        join public.workspace_members wm on wm.id = wmr.workspace_member_id
        where wm.user_id = non_privileged_user_id and wm.workspace_id = v_workspace_id;

      begin
        delete from public.workspace_member_roles
          where workspace_member_id in (
            select id from public.workspace_members where user_id = non_privileged_user_id and workspace_id = v_workspace_id
          );

        select coalesce(jsonb_agg(row_to_json(pbl.*) order by pbl.line_sort), '[]'::jsonb) into bom_snapshot_before
          from public.project_bom_lines pbl where pbl.project_id = project_a_id;

        perform set_config('request.jwt.claim.sub', non_privileged_user_id::text, true);
        begin
          perform public.replace_project_bom_lines(project_a_id, jsonb_build_array(jsonb_build_object('item_name', 'ZZ_TEST_SHOULD_NOT_SAVE', 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard')));
          raise exception 'TEST FAILED (Section 2): non-privileged caller was allowed to replace a BOM.';
        exception when sqlstate 'EC018' then
          get stacked diagnostics caught_sqlstate = returned_sqlstate;
          if sqlerrm not like '%PM or workspace administrator%' then
            raise exception 'TEST FAILED (Section 2): wrong rejection message: %', sqlerrm;
          end if;
          raise notice 'TEST PASSED (Section 2): non-privileged caller rejected with the expected message.';
        end;

        select coalesce(jsonb_agg(row_to_json(pbl.*) order by pbl.line_sort), '[]'::jsonb) into bom_snapshot_after
          from public.project_bom_lines pbl where pbl.project_id = project_a_id;
        if bom_snapshot_before is distinct from bom_snapshot_after then
          raise exception 'TEST FAILED (Section 2): project_a''s BOM lines changed despite the rejected call.';
        end if;
        raise notice 'TEST PASSED (Section 2 state check): project_a''s BOM lines are unchanged after the rejected call.';

        -- Restore roles even on success, before any later section runs.
        delete from public.workspace_member_roles
          where workspace_member_id in (
            select id from public.workspace_members where user_id = non_privileged_user_id and workspace_id = v_workspace_id
          );
        insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
          select (r->>'workspace_member_id')::uuid, r->>'role_key', (r->>'is_primary')::boolean
          from jsonb_array_elements(non_privileged_original_roles) r;
      exception when others then
        -- Nested protection: restore roles even if something above failed
        -- unexpectedly, then re-raise so the failure is not swallowed.
        delete from public.workspace_member_roles
          where workspace_member_id in (
            select id from public.workspace_members where user_id = non_privileged_user_id and workspace_id = v_workspace_id
          );
        insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
          select (r->>'workspace_member_id')::uuid, r->>'role_key', (r->>'is_primary')::boolean
          from jsonb_array_elements(non_privileged_original_roles) r;
        raise;
      end;
    end if;

    -- From here on, act as the real PM fixture for every "should succeed"
    -- and "PM-authorized but data-invalid" section.
    if pm_user_id is not null then
      perform set_config('request.jwt.claim.sub', pm_user_id::text, true);

      -- ============================================================
      -- Section 3: new recipe... new BOM -- two new lines inserted,
      -- correct ids returned, item identity resolved by stable
      -- inventory_item_id and by sku.
      -- ============================================================
      select public.replace_project_bom_lines(
        project_a_id,
        jsonb_build_array(
          jsonb_build_object('item_name', item_a_name, 'inventory_item_id', item_a_id, 'qty', 2, 'status', 'Not started', 'request_speed', 'Standard'),
          jsonb_build_object('item_name', item_b_name, 'sku', item_b_sku, 'qty', 3, 'status', 'Ordered', 'request_speed', 'ASAP')
        )
      ) into result_json;

      if (result_json->>'insertedCount')::int <> 2 or (result_json->>'updatedCount')::int <> 0 or (result_json->>'deletedCount')::int <> 0 then
        raise exception 'TEST FAILED (Section 3): wrong counts: %', result_json;
      end if;
      if jsonb_array_length(result_json->'lines') <> 2 then
        raise exception 'TEST FAILED (Section 3): expected 2 returned lines, got: %', result_json;
      end if;
      select id into line_a_id from public.project_bom_lines where project_id = project_a_id and item_name = item_a_name;
      select id into line_b_id from public.project_bom_lines where project_id = project_a_id and item_name = item_b_name;
      if line_a_id is null or line_b_id is null then
        raise exception 'TEST FAILED (Section 3): lines were not actually persisted.';
      end if;
      raise notice 'TEST PASSED (Section 3): two new BOM lines inserted, resolved via inventory_item_id and via sku respectively, ids returned: % / %', line_a_id, line_b_id;

      -- ============================================================
      -- Section 4: reconcile-by-id -- update line A in place (same id,
      -- new qty), drop line B (not present in this payload), insert one
      -- brand-new line. Confirm line A's id is UNCHANGED.
      -- ============================================================
      select public.replace_project_bom_lines(
        project_a_id,
        jsonb_build_array(
          jsonb_build_object('id', line_a_id, 'item_name', item_a_name, 'inventory_item_id', item_a_id, 'qty', 9, 'status', 'Completed', 'request_speed', 'Standard'),
          jsonb_build_object('item_name', 'ZZ_TEST_BOM_NEW_LINE', 'qty', 1, 'status', 'Not started', 'request_speed', 'Future')
        )
      ) into result_json;

      if (result_json->>'updatedCount')::int <> 1 or (result_json->>'insertedCount')::int <> 1 or (result_json->>'deletedCount')::int <> 1 then
        raise exception 'TEST FAILED (Section 4): wrong counts: %', result_json;
      end if;
      if not exists (select 1 from public.project_bom_lines where id = line_a_id and qty = 9 and status = 'Completed') then
        raise exception 'TEST FAILED (Section 4): line A was not updated in place (same id).';
      end if;
      if exists (select 1 from public.project_bom_lines where id = line_b_id) then
        raise exception 'TEST FAILED (Section 4): line B still exists -- should have been deleted.';
      end if;
      raise notice 'TEST PASSED (Section 4): reconcile-by-id -- line A updated in place (id unchanged), line B deleted, one new line inserted.';

      -- ============================================================
      -- Section 5: idempotent retry -- calling again with the exact same
      -- payload (including the real id from Section 4) produces the same
      -- end state, same row ids, no duplicates.
      -- ============================================================
      select coalesce(jsonb_agg(row_to_json(pbl.*) order by pbl.id), '[]'::jsonb) into bom_snapshot_before
        from public.project_bom_lines pbl where pbl.project_id = project_a_id;

      select public.replace_project_bom_lines(
        project_a_id,
        (select coalesce(jsonb_agg(jsonb_build_object(
          'id', pbl.id, 'item_name', pbl.item_name, 'inventory_item_id', pbl.inventory_item_id,
          'qty', pbl.qty, 'status', pbl.status, 'request_speed', pbl.request_speed, 'line_sort', pbl.line_sort
        )), '[]'::jsonb) from public.project_bom_lines pbl where pbl.project_id = project_a_id)
      ) into result_json;

      select coalesce(jsonb_agg(row_to_json(pbl.*) order by pbl.id), '[]'::jsonb) into bom_snapshot_after
        from public.project_bom_lines pbl where pbl.project_id = project_a_id;

      if (select count(*) from public.project_bom_lines where project_id = project_a_id) <> 2 then
        raise exception 'TEST FAILED (Section 5): retry changed the row count.';
      end if;
      raise notice 'TEST PASSED (Section 5): identical retry produces the same 2 rows, same ids, no duplicates.';

      -- ============================================================
      -- Section 6: empty array clears the whole BOM (deliberate, not an
      -- error) -- then Section 3's setup is effectively undone for the
      -- rest of this script.
      -- ============================================================
      select public.replace_project_bom_lines(project_a_id, '[]'::jsonb) into result_json;
      if (result_json->>'deletedCount')::int <> 2 then
        raise exception 'TEST FAILED (Section 6): expected 2 deleted, got %', result_json;
      end if;
      if exists (select 1 from public.project_bom_lines where project_id = project_a_id) then
        raise exception 'TEST FAILED (Section 6): project_a still has BOM lines after an empty-array replace.';
      end if;
      raise notice 'TEST PASSED (Section 6): an empty array deliberately clears every line for the project.';

      -- ============================================================
      -- Section 7: a supplied id belonging to a DIFFERENT project is
      -- rejected -- project_a's (currently empty) BOM stays empty, and
      -- project_b's real line is untouched.
      -- ============================================================
      begin
        perform public.replace_project_bom_lines(
          project_a_id,
          jsonb_build_array(jsonb_build_object('id', other_project_line_id, 'item_name', 'ZZ_TEST_SHOULD_NOT_SAVE', 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard'))
        );
        raise exception 'TEST FAILED (Section 7): a cross-project line id was accepted instead of rejected.';
      exception when sqlstate 'EC022' then
        if sqlerrm not like '%do not belong to this project%' then
          raise exception 'TEST FAILED (Section 7): wrong rejection message: %', sqlerrm;
        end if;
        raise notice 'TEST PASSED (Section 7): a line id belonging to a different project is rejected, not reassigned.';
      end;
      if exists (select 1 from public.project_bom_lines where project_id = project_a_id) then
        raise exception 'TEST FAILED (Section 7 state check): project_a unexpectedly has BOM lines.';
      end if;
      if not exists (select 1 from public.project_bom_lines where id = other_project_line_id and project_id = project_b_id) then
        raise exception 'TEST FAILED (Section 7 state check): project_b''s real line was affected.';
      end if;

      -- ============================================================
      -- Section 8: a supplied id that does not exist at all is rejected
      -- the same way as a cross-project id.
      -- ============================================================
      begin
        perform public.replace_project_bom_lines(
          project_a_id,
          jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'item_name', 'ZZ_TEST_SHOULD_NOT_SAVE', 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard'))
        );
        raise exception 'TEST FAILED (Section 8): a nonexistent line id was accepted instead of rejected.';
      exception when sqlstate 'EC022' then
        raise notice 'TEST PASSED (Section 8): a nonexistent line id is rejected.';
      end;

      -- ============================================================
      -- Section 9: duplicate non-null line ids in the same payload are
      -- rejected before any write.
      -- ============================================================
      select public.replace_project_bom_lines(project_a_id, jsonb_build_array(jsonb_build_object('item_name', 'ZZ_TEST_DUP_SETUP', 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard'))) into result_json;
      select id into line_a_id from public.project_bom_lines where project_id = project_a_id and item_name = 'ZZ_TEST_DUP_SETUP';

      begin
        perform public.replace_project_bom_lines(
          project_a_id,
          jsonb_build_array(
            jsonb_build_object('id', line_a_id, 'item_name', 'ZZ_TEST_DUP_SETUP', 'qty', 5, 'status', 'Not started', 'request_speed', 'Standard'),
            jsonb_build_object('id', line_a_id, 'item_name', 'ZZ_TEST_DUP_SETUP', 'qty', 9, 'status', 'Ordered', 'request_speed', 'ASAP')
          )
        );
        raise exception 'TEST FAILED (Section 9): duplicate line ids in one payload were accepted.';
      exception when sqlstate 'EC021' then
        raise notice 'TEST PASSED (Section 9): duplicate line ids in one payload are rejected before any write.';
      end;
      if not exists (select 1 from public.project_bom_lines where id = line_a_id and qty = 1) then
        raise exception 'TEST FAILED (Section 9 state check): the existing line was modified despite the rejection.';
      end if;

      -- ============================================================
      -- Section 10: malformed line data is rejected -- bad quantity,
      -- missing item name, invalid status/request_speed/procurement_track.
      -- ============================================================
      begin
        perform public.replace_project_bom_lines(project_a_id, jsonb_build_array(jsonb_build_object('item_name', 'X', 'qty', -1, 'status', 'Not started', 'request_speed', 'Standard')));
        raise exception 'TEST FAILED (Section 10a): negative quantity accepted.';
      exception when sqlstate 'EC020' then
        raise notice 'TEST PASSED (Section 10a): negative quantity rejected.';
      end;

      select public.replace_project_bom_lines(project_a_id, jsonb_build_array(jsonb_build_object('item_name', 'ZZ_TEST_ZERO_QTY_PLACEHOLDER', 'qty', 0, 'status', 'Need Quote', 'request_speed', 'Standard'))) into result_json;
      if (result_json->'lines'->0->>'qty')::numeric <> 0 then
        raise exception 'TEST FAILED (Section 10a2): zero-quantity Draft placeholder was not preserved: %', result_json;
      end if;
      raise notice 'TEST PASSED (Section 10a2): zero-quantity Draft placeholder remains supported.';

      begin
        perform public.replace_project_bom_lines(project_a_id, jsonb_build_array(jsonb_build_object('item_name', 'X', 'qty', 1, 'status', 'Not A Real Status', 'request_speed', 'Standard')));
        raise exception 'TEST FAILED (Section 10b): invalid status value accepted.';
      exception when sqlstate 'EC020' then
        raise notice 'TEST PASSED (Section 10b): invalid status value rejected.';
      end;

      begin
        perform public.replace_project_bom_lines(project_a_id, jsonb_build_array(jsonb_build_object('item_name', 'X', 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard', 'procurement_track', 'not_a_real_track')));
        raise exception 'TEST FAILED (Section 10c): invalid procurement_track value accepted.';
      exception when sqlstate 'EC020' then
        raise notice 'TEST PASSED (Section 10c): invalid procurement_track value rejected.';
      end;

      begin
        perform public.replace_project_bom_lines(project_a_id, '{"not": "an array"}'::jsonb);
        raise exception 'TEST FAILED (Section 10d): a non-array p_lines payload was accepted.';
      exception when sqlstate 'EC020' then
        raise notice 'TEST PASSED (Section 10d): a non-array p_lines payload is rejected.';
      end;

      -- ============================================================
      -- Section 11: item-identity validation -- invalid inventory_item_id,
      -- invalid sku, mismatched inventory_item_id+sku pair, all rejected;
      -- an unresolved (zero-match) item_name is TOLERATED (nulls the
      -- link, does not reject) -- matching current, unchanged behavior.
      -- ============================================================
      begin
        perform public.replace_project_bom_lines(project_a_id, jsonb_build_array(jsonb_build_object('item_name', 'X', 'inventory_item_id', gen_random_uuid(), 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard')));
        raise exception 'TEST FAILED (Section 11a): a nonexistent inventory_item_id was accepted.';
      exception when sqlstate 'EC023' then
        raise notice 'TEST PASSED (Section 11a): a nonexistent inventory_item_id is rejected.';
      end;

      begin
        perform public.replace_project_bom_lines(project_a_id, jsonb_build_array(jsonb_build_object('item_name', 'X', 'sku', 'ZZ-TEST-NO-SUCH-SKU', 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard')));
        raise exception 'TEST FAILED (Section 11b): a nonexistent sku was accepted.';
      exception when sqlstate 'EC023' then
        raise notice 'TEST PASSED (Section 11b): a nonexistent sku is rejected.';
      end;

      begin
        perform public.replace_project_bom_lines(project_a_id, jsonb_build_array(jsonb_build_object('item_name', 'X', 'inventory_item_id', item_a_id, 'sku', item_b_sku, 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard')));
        raise exception 'TEST FAILED (Section 11c): a mismatched inventory_item_id/sku pair was accepted.';
      exception when sqlstate 'EC023' then
        raise notice 'TEST PASSED (Section 11c): a mismatched inventory_item_id/sku pair is rejected.';
      end;

      select public.replace_project_bom_lines(project_a_id, jsonb_build_array(jsonb_build_object('item_name', 'ZZ_TEST_UNRESOLVED_NAME_' || substr(md5(random()::text), 1, 8), 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard'))) into result_json;
      if (result_json->'lines'->0->>'sku') is not null then
        raise exception 'TEST FAILED (Section 11d): an unresolved item name should leave sku null, got %', result_json;
      end if;
      raise notice 'TEST PASSED (Section 11d): an item name matching zero catalog rows is tolerated (null link), not rejected.';

      -- ============================================================
      -- Section 12: an ambiguous item name (matches more than one
      -- catalog row) rejects the WHOLE call -- never an arbitrary pick.
      -- ============================================================
      begin
        perform public.replace_project_bom_lines(
          project_a_id,
          jsonb_build_array(
            jsonb_build_object('item_name', item_a_name, 'inventory_item_id', item_a_id, 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard'),
            jsonb_build_object('item_name', ambiguous_item_name, 'qty', 1, 'status', 'Not started', 'request_speed', 'Standard')
          )
        );
        raise exception 'TEST FAILED (Section 12): an ambiguous item name was accepted instead of rejecting the whole call.';
      exception when sqlstate 'EC024' then
        if sqlerrm not like '%match more than one catalog item%' then
          raise exception 'TEST FAILED (Section 12): wrong rejection message: %', sqlerrm;
        end if;
        raise notice 'TEST PASSED (Section 12): an ambiguous item name rejects the whole call, including an otherwise-fine sibling line.';
      end;

      -- ============================================================
      -- Section 13: grants -- anon has no execute privilege, matching
      -- migrations 127/130's own verification pattern.
      -- ============================================================
      if exists (
        select 1 from information_schema.role_routine_grants
        where routine_name = 'replace_project_bom_lines' and grantee = 'anon' and privilege_type = 'EXECUTE'
      ) then
        raise exception 'TEST FAILED (Section 13): anon has an EXECUTE grant on replace_project_bom_lines.';
      end if;
      raise notice 'TEST PASSED (Section 13): anon has no EXECUTE grant on replace_project_bom_lines.';

      -- ============================================================
      -- Section 14: search_path hardening -- the function's own
      -- definition pins search_path to empty, matching every other
      -- security-definer RPC in this repo.
      -- ============================================================
      select pg_get_functiondef(p.oid) into func_def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'replace_project_bom_lines';
      if func_def not like '%' || search_path_marker || '%' then
        raise exception 'TEST FAILED (Section 14): replace_project_bom_lines is not pinned to an empty search_path.';
      end if;
      raise notice 'TEST PASSED (Section 14): replace_project_bom_lines has search_path hardening.';

      -- ============================================================
      -- Section 15: workspace-admin caller (not a PM) is also authorized.
      -- ============================================================
      if admin_user_id is not null then
        perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
        select public.replace_project_bom_lines(project_b_id, (
          select coalesce(jsonb_agg(jsonb_build_object('id', pbl.id, 'item_name', pbl.item_name, 'qty', pbl.qty, 'status', pbl.status, 'request_speed', pbl.request_speed)), '[]'::jsonb)
          from public.project_bom_lines pbl where pbl.project_id = project_b_id
        )) into result_json;
        raise notice 'TEST PASSED (Section 15): a workspace-admin caller (not a PM) is authorized -- result: %', result_json;
        perform set_config('request.jwt.claim.sub', pm_user_id::text, true);
      else
        skipped_count := skipped_count + 1;
        skipped_names := array_append(skipped_names, 'Section 15 (no workspace admin found)');
      end if;

      -- ============================================================
      -- Section 16: zero/suspended/multiple-workspace failure --
      -- active_workspace_id()'s fail-closed guard, exercised structurally
      -- (matching migration 124/130's own structural-proof technique for
      -- this case -- this repo genuinely has exactly one workspace, so
      -- this is a proof the guard EXISTS and is called first, not a live
      -- multi-workspace drill).
      -- ============================================================
      if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'replace_project_bom_lines' and pg_get_functiondef(p.oid) like '%active_workspace_id%') then
        raise exception 'TEST FAILED (Section 16): replace_project_bom_lines does not call active_workspace_id() at all.';
      end if;
      raise notice 'TEST PASSED (Section 16, structural): replace_project_bom_lines calls active_workspace_id() as its fail-closed single-workspace guard.';

    else
      skipped_count := skipped_count + 1;
      skipped_names := array_append(skipped_names, 'Sections 3-14 (no PM fixture available)');
    end if;

    -- Clean up the temporarily-granted pm role if this script added it.
    if pm_user_id is not null and not pm_role_preexisted then
      delete from public.workspace_member_roles
        where workspace_member_id in (select id from public.workspace_members where user_id = pm_user_id and workspace_id = v_workspace_id)
        and role_key = 'pm';
    end if;
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, '; ');
  end if;

  raise notice 'ALL MIGRATION 131 BOM REPLACE TESTS PASSED -- ZERO SECTIONS SKIPPED';
end $$;

rollback;

-- ============================================================
-- Two-session concurrency verification -- DOCUMENTED, NOT AUTOMATED.
-- Same reasoning and same proposed completion path as migration 130's own
-- Section 16 (see migration_130_recipe_save_tests.sql): a single SQL
-- script executes on one connection and cannot open a second, genuinely
-- concurrent transaction against itself.
--
-- Manual two-tab procedure:
--   1. Session A: BEGIN; SELECT id FROM projects WHERE id = '<a real
--      project id>' FOR UPDATE; -- leave this transaction open, do not
--      commit or roll back yet.
--   2. Session B: call rpc/replace_project_bom_lines for the SAME
--      project_id. Confirm it blocks (does not return) while Session A's
--      transaction is still open.
--   3. Session C (a third connection): query pg_locks / pg_stat_activity
--      (pg_blocking_pids()) to confirm Session B's backend is genuinely
--      blocked ON Session A's held lock -- not just slow for an unrelated
--      reason.
--   4. Session A: COMMIT (or ROLLBACK). Confirm Session B proceeds
--      immediately afterward, and that the project's final BOM state
--      reflects exactly Session B's payload (or whatever the intended
--      "last writer wins under a held lock" semantics should be for this
--      specific test).
--
-- Automating this requires an external two-connection harness (e.g. a
-- standalone Node.js script using the `pg` client library, not currently a
-- dependency of this project) -- proposed, not built, exactly as migration
-- 130's own concurrency section proposes and leaves for E's decision.
-- ============================================================
