-- Transaction-safe canonical test for migration 170 (URGENT: fixes the
-- project_documents upload incident + closes document_number's
-- workspace-scoped-uniqueness gap). Wrapped in begin;/rollback; --
-- nothing here ever commits. The synthetic second workspace this
-- script creates lives ONLY inside this rolled-back transaction, never
-- a persistent second workspace.
--
-- Section 1 is the actual incident regression: the exact no-anchor
-- payload shape createProjectDocuments() really sends must now
-- succeed, and resolve to the caller's own workspace (not null).
-- Section 2 confirms anchor-based derivation still works. Section 3
-- confirms the RLS "with check" naturally rejects a cross-workspace
-- anchor reference (the caller is not a member of the anchor's real
-- workspace), without any explicit comparison logic needed in the
-- trigger itself. Section 4 confirms document_number is now
-- workspace-scoped.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 170 PROJECT DOCUMENTS
-- UPLOAD FIX AND WORKSPACE CONTAINMENT TESTS PASSED -- ZERO SECTIONS
-- SKIPPED", or a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  vendor_a_id uuid;
  po_a_id uuid;
  doc_id uuid;
  seen_workspace_id uuid;
  caught boolean;
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
    values (ws_b, 'ZZ_TEST_170 Other Workspace', 'zz-test-170-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: THE INCIDENT REGRESSION. The exact no-anchor payload
  -- shape createProjectDocuments() actually sends (no project_id, no
  -- purchase_order_id, no purchase_request_id) must succeed, and must
  -- resolve to the caller's own workspace.
  -- ============================================================

  caught := false;
  begin
    insert into public.project_documents (document_number, document_type, file_name)
      values ('ZZ-DOC-170-A', 'other', 'zz_test_170_a.pdf')
      returning id, workspace_id into doc_id, seen_workspace_id;
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: a general project document with no anchors set was rejected -- the migration 161 incident is not fixed'; end if;
  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: a no-anchor document did not resolve to the caller''s own workspace (got %, expected %)', seen_workspace_id, real_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 1 -- a general project document with no anchors set now succeeds and resolves to the caller''s own workspace';

  -- ============================================================
  -- Section 2: anchor-based derivation still works -- a document
  -- linked to a real, own-workspace purchase order resolves via that
  -- anchor.
  -- ============================================================

  insert into public.vendors (name) values ('ZZ_TEST_170 Vendor A') returning id into vendor_a_id;
  insert into public.purchase_orders (po_number, vendor_id) values ('ZZ-PO-170-A', vendor_a_id) returning id into po_a_id;

  insert into public.project_documents (document_number, document_type, file_name, purchase_order_id)
    values ('ZZ-DOC-170-B', 'purchase_order', 'zz_test_170_b.pdf', po_a_id)
    returning workspace_id into seen_workspace_id;
  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: a purchase_order_id-anchored document did not resolve to the anchor''s real workspace (got %, expected %)', seen_workspace_id, real_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 2 -- anchor-based derivation (purchase_order_id) still works';

  -- ============================================================
  -- Section 3: a workspace-B caller cannot attach a document to
  -- workspace A's purchase order -- the RLS "with check" naturally
  -- rejects it once the trigger derives workspace_id = A, since the
  -- caller is not an active member of A.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.project_documents (document_number, document_type, file_name, purchase_order_id)
      values ('ZZ-DOC-170-C', 'purchase_order', 'zz_test_170_c.pdf', po_a_id);
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a workspace-B caller was able to attach a document to workspace A''s purchase order'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 3 -- a cross-workspace anchor reference is correctly rejected';

  -- ============================================================
  -- Section 4: document_number is now workspace-scoped -- same
  -- same-workspace duplicate still rejected, cross-workspace duplicate
  -- now accepted.
  -- ============================================================

  caught := false;
  begin
    insert into public.project_documents (document_number, document_type, file_name)
      values ('ZZ-DOC-170-A', 'other', 'zz_test_170_a_dup.pdf');
  exception when unique_violation then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: document_number allowed a same-workspace duplicate'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.project_documents (document_number, document_type, file_name)
      values ('ZZ-DOC-170-A', 'other', 'zz_test_170_a_in_b.pdf');
  exception when unique_violation then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: document_number rejected an identical number in a DIFFERENT workspace'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 4 -- document_number is workspace-scoped';

  raise notice 'ALL MIGRATION 170 PROJECT DOCUMENTS UPLOAD FIX AND WORKSPACE CONTAINMENT TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
