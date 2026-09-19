-- Transaction-safe canonical test for migration 168 (urgent fix:
-- purchase-order-files storage upload bug introduced by migration 161).
-- Wrapped in begin;/rollback; -- nothing here ever commits. The
-- synthetic second workspace this script creates lives ONLY inside
-- this rolled-back transaction, never a persistent second workspace.
--
-- The core regression this migration fixes: a real file upload
-- attempt, where the storage.objects row is inserted BEFORE any
-- matching purchase_order_files metadata row exists (the real,
-- confirmed order src/persistence.ts's addPurchaseOrderFile() uses).
-- Section 1 proves this now succeeds; Section 2 proves the fix does
-- not accidentally open the door to uploading into another workspace's
-- purchase order, or a nonexistent one.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 168 PURCHASE ORDER
-- FILES STORAGE UPLOAD BUG FIX TESTS PASSED -- ZERO SECTIONS SKIPPED",
-- or a hard SQL error naming what failed or was skipped.

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
  caught boolean;
  path_a text;
  path_b text;
  bogus_po_id uuid := gen_random_uuid();
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
    values (ws_b, 'ZZ_TEST_168 Other Workspace', 'zz-test-168-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.vendors (name) values ('ZZ_TEST_168 Vendor A') returning id into vendor_a_id;
  insert into public.purchase_orders (po_number, vendor_id) values ('ZZ-PO-168-A', vendor_a_id) returning id into po_a_id;
  path_a := po_a_id::text || '/stamp-fixture.pdf';

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.vendors (name) values ('ZZ_TEST_168 Vendor B') returning id into vendor_b_id;
  insert into public.purchase_orders (po_number, vendor_id) values ('ZZ-PO-168-B', vendor_b_id) returning id into po_b_id;
  path_b := po_b_id::text || '/stamp-fixture.pdf';

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: the actual regression -- a storage.objects insert with
  -- NO pre-existing purchase_order_files row must succeed, matching the
  -- real upload-then-insert-row order this app actually uses.
  -- ============================================================

  if exists (select 1 from public.purchase_order_files where storage_path = path_a) then
    raise exception 'TEST SETUP FAILED: a purchase_order_files row already exists for the fixture path -- test fixture is not isolated';
  end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('purchase-order-files', path_a);
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: uploading a file with no pre-existing purchase_order_files row was rejected -- the migration 161 regression is not fixed'; end if;

  raise notice 'TEST PASSED: Section 1 -- a purchase-order-files upload with no pre-existing metadata row now succeeds';

  -- ============================================================
  -- Section 2: containment is not weakened by the fix -- a workspace-A
  -- caller still cannot upload into workspace B's purchase order, and
  -- cannot upload against a purchase order id that does not exist at
  -- all.
  -- ============================================================

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('purchase-order-files', path_b);
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a workspace-A caller was able to upload into workspace B''s purchase order'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('purchase-order-files', bogus_po_id::text || '/stamp-fixture.pdf');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a caller was able to upload against a purchase_order_id that does not exist at all'; end if;

  raise notice 'TEST PASSED: Section 2 -- cross-workspace and nonexistent-purchase-order uploads are still correctly rejected';

  raise notice 'ALL MIGRATION 168 PURCHASE ORDER FILES STORAGE UPLOAD BUG FIX TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
