-- Transaction-safe canonical test for migration 172 (atomic
-- delete+log RPCs for inventory_item/equipment_type -- closes
-- migration 166's one documented residual gap). Wrapped in
-- begin;/rollback; -- nothing here ever commits. The synthetic second
-- workspace this script creates lives ONLY inside this rolled-back
-- transaction, never a persistent second workspace.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 172 ATOMIC DELETE AND
-- LOG TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  item_a_id uuid;
  item_b_id uuid;
  item_blocked_id uuid;
  location_a_id uuid;
  equip_a_id uuid;
  equip_blocked_id uuid;
  result_json jsonb;
  log_id uuid;
  seen_workspace_id uuid;
  caught boolean;
  error_text text;
  visible_count int;
begin
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
    values (ws_b, 'ZZ_TEST_172 Other Workspace', 'zz-test-172-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: baseline success -- a real inventory item with no
  -- history deletes cleanly, and its deletion_log row now resolves a
  -- REAL, non-null workspace_id (the actual fix this migration exists
  -- for).
  -- ============================================================

  insert into public.inventory_items (sku, item_name) values ('ZZ-SKU-172-A', 'ZZ_TEST_172 Item A') returning id into item_a_id;

  select public.delete_inventory_item_and_log('ZZ-SKU-172-A', 'zz-test-172@example.com') into result_json;
  if (result_json->>'ok')::boolean is not true or result_json->>'outcome' <> 'deleted' then
    raise exception 'TEST FAILED: baseline inventory item delete did not report success: %', result_json;
  end if;
  if exists (select 1 from public.inventory_items where id = item_a_id) then
    raise exception 'TEST FAILED: baseline inventory item delete did not actually remove the row';
  end if;

  select id, workspace_id into log_id, seen_workspace_id
  from public.deletion_log
  where entity_type = 'inventory_item' and entity_id = item_a_id
  order by created_at desc limit 1;
  if log_id is null then
    raise exception 'TEST FAILED: baseline inventory item delete did not write a deletion_log row';
  end if;
  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: inventory_item deletion_log row did not resolve the real workspace_id (got %, expected %) -- migration 166''s residual gap is not closed', seen_workspace_id, real_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 1 -- baseline inventory item delete succeeds and its deletion_log row resolves a real workspace_id';

  -- ============================================================
  -- Section 2: not_found is a silent success, no log entry -- matches
  -- the existing client behavior exactly (already-gone / not-yet-synced
  -- item).
  -- ============================================================

  select public.delete_inventory_item_and_log('ZZ-SKU-172-NEVER-EXISTED', 'zz-test-172@example.com') into result_json;
  if (result_json->>'ok')::boolean is not true or result_json->>'outcome' <> 'not_found' then
    raise exception 'TEST FAILED: deleting a nonexistent sku did not report a silent not_found success: %', result_json;
  end if;
  select count(*) into visible_count from public.deletion_log where entity_type = 'inventory_item' and entity_label like '%NEVER-EXISTED%';
  if visible_count <> 0 then raise exception 'TEST FAILED: a not_found delete wrote a deletion_log row anyway'; end if;

  raise notice 'TEST PASSED: Section 2 -- deleting a nonexistent sku is a silent success with no log entry';

  -- ============================================================
  -- Section 3: FK-RESTRICT conflict -- an item with real balance
  -- history is blocked with the exact same friendly message the client
  -- currently produces for this HTTP 409.
  -- ============================================================

  insert into public.inventory_items (sku, item_name) values ('ZZ-SKU-172-BLOCKED', 'ZZ_TEST_172 Item Blocked') returning id into item_blocked_id;
  perform set_config('role', 'postgres', true);
  insert into public.locations (name, location_type) values ('ZZ_TEST_172 Location A', 'warehouse') returning id into location_a_id;
  insert into public.inventory_balances (inventory_item_id, location_id, quantity_on_hand) values (item_blocked_id, location_a_id, 5);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  error_text := null;
  begin
    perform public.delete_inventory_item_and_log('ZZ-SKU-172-BLOCKED', 'zz-test-172@example.com');
  exception when others then
    caught := true;
    get stacked diagnostics error_text = message_text;
  end;
  if not caught then raise exception 'TEST FAILED: an item with real stock history was deleted instead of being blocked'; end if;
  if position('stock, movement, or build-BOM history' in error_text) = 0 then
    raise exception 'TEST FAILED: FK-blocked delete was rejected for the wrong reason: %', error_text;
  end if;
  if not exists (select 1 from public.inventory_items where id = item_blocked_id) then
    raise exception 'TEST FAILED: the blocked item was actually deleted despite the exception';
  end if;

  raise notice 'TEST PASSED: Section 3 -- an inventory item with real history is blocked with the correct friendly message, and nothing is deleted';

  -- ============================================================
  -- Section 4: force-delete clears a genuinely zero balance and
  -- succeeds where the regular delete would have been blocked.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  update public.inventory_balances set quantity_on_hand = 0, quantity_reserved = 0 where inventory_item_id = item_blocked_id;
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.force_delete_inventory_item_and_log('ZZ-SKU-172-BLOCKED', 'zz-test-172@example.com') into result_json;
  if (result_json->>'ok')::boolean is not true or result_json->>'outcome' <> 'deleted' then
    raise exception 'TEST FAILED: force-delete of a genuinely zero-balance item did not succeed: %', result_json;
  end if;

  select workspace_id into seen_workspace_id
  from public.deletion_log
  where entity_type = 'inventory_item' and entity_id = item_blocked_id and entity_label like '%admin force-delete%'
  order by created_at desc limit 1;
  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: force-delete''s deletion_log row did not resolve the real workspace_id (got %)', seen_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 4 -- force-delete clears a genuinely zero balance, succeeds, and logs correctly with the admin-force-delete label';

  -- ============================================================
  -- Section 5: cross-workspace SKU ambiguity safety -- two different
  -- workspaces each have their own item sharing the identical sku
  -- (legal since migration 164 made sku uniqueness workspace-scoped).
  -- Deleting from workspace A must only ever affect A's own row.
  -- ============================================================

  insert into public.inventory_items (sku, item_name) values ('ZZ-SKU-172-SHARED', 'ZZ_TEST_172 Shared A') returning id into item_a_id;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.inventory_items (sku, item_name) values ('ZZ-SKU-172-SHARED', 'ZZ_TEST_172 Shared B') returning id into item_b_id;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.delete_inventory_item_and_log('ZZ-SKU-172-SHARED', 'zz-test-172@example.com') into result_json;
  if (result_json->>'ok')::boolean is not true or result_json->>'outcome' <> 'deleted' then
    raise exception 'TEST FAILED: deleting workspace A''s own shared-sku item did not succeed: %', result_json;
  end if;
  if exists (select 1 from public.inventory_items where id = item_a_id) then
    raise exception 'TEST FAILED: workspace A''s shared-sku item was not actually deleted';
  end if;
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from public.inventory_items where id = item_b_id) then
    raise exception 'TEST FAILED: deleting workspace A''s shared-sku item also deleted workspace B''s own item -- the workspace-scoped lookup is not actually filtering';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 5 -- a shared sku across two workspaces is resolved to the caller''s own workspace only, never the other''s';

  -- ============================================================
  -- Section 6: equipment_type -- baseline success + FK-RESTRICT block
  -- (build history), same shapes as Sections 1 and 3.
  -- ============================================================

  insert into public.equipment_types (equipment_number, equipment_name) values ('ZZ-EQ-172-A', 'ZZ_TEST_172 Equipment A') returning id into equip_a_id;

  select public.delete_equipment_type_and_log('ZZ_TEST_172 Equipment A', 'zz-test-172@example.com') into result_json;
  if (result_json->>'ok')::boolean is not true or result_json->>'outcome' <> 'deleted' then
    raise exception 'TEST FAILED: baseline equipment type delete did not report success: %', result_json;
  end if;
  select workspace_id into seen_workspace_id
  from public.deletion_log
  where entity_type = 'equipment_type' and entity_id = equip_a_id
  order by created_at desc limit 1;
  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: equipment_type deletion_log row did not resolve the real workspace_id (got %)', seen_workspace_id;
  end if;

  insert into public.equipment_types (equipment_number, equipment_name) values ('ZZ-EQ-172-BLOCKED', 'ZZ_TEST_172 Equipment Blocked') returning id into equip_blocked_id;
  perform set_config('role', 'postgres', true);
  insert into public.build_transactions (build_number, equipment_type_id, quantity_built) values ('ZZ-BUILD-172-A', equip_blocked_id, 1);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  error_text := null;
  begin
    perform public.delete_equipment_type_and_log('ZZ_TEST_172 Equipment Blocked', 'zz-test-172@example.com');
  exception when others then
    caught := true;
    get stacked diagnostics error_text = message_text;
  end;
  if not caught then raise exception 'TEST FAILED: an equipment type with real build history was deleted instead of being blocked'; end if;
  if position('build history' in error_text) = 0 then
    raise exception 'TEST FAILED: FK-blocked equipment type delete was rejected for the wrong reason: %', error_text;
  end if;

  select public.delete_equipment_type_and_log('ZZ_TEST_172 Never Existed', 'zz-test-172@example.com') into result_json;
  if (result_json->>'ok')::boolean is not true or result_json->>'outcome' <> 'not_found' then
    raise exception 'TEST FAILED: deleting a nonexistent equipment type did not report a silent not_found success: %', result_json;
  end if;

  raise notice 'TEST PASSED: Section 6 -- equipment_type: baseline delete resolves a real workspace_id, real build history blocks correctly, nonexistent name is a silent success';

  raise notice 'ALL MIGRATION 172 ATOMIC DELETE AND LOG TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
