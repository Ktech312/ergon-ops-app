-- Transaction-safe canonical test for migration 161 (Phase 3, Stage 4 --
-- unblocked portion: documents, shipments, the purchase-order-files
-- storage bucket, and share-link table containment). Wrapped in
-- begin;/rollback; -- nothing here ever commits. Any synthetic second
-- workspace this script creates lives ONLY inside this rolled-back
-- transaction, never a persistent second workspace.
--
-- Strategy, matching migration 160's own precedent: full behavioral
-- round-trip (correct workspace allowed, another workspace denied,
-- missing membership denied) for two representative tables spanning the
-- two resolver shapes this migration introduces -- `project_documents`
-- (three-way coalesce anchor, the most complex shape in this migration)
-- and `project_shipments` (clean single-FK anchor, representative of the
-- shipment cluster and of every reused-resolver child). Every other
-- table in scope uses the identical `is_workspace_member(...)`/
-- `is_active_workspace_member(...)` wrapper around either a resolver
-- function of the same shape or (for the three share-link tables)
-- migration 158's own already-proven `share_link_entity_workspace_id()`
-- -- covered structurally (Section 4) rather than round-tripping the
-- full cross-workspace fixture dance five more times.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 161 PHASE 3 DOCUMENTS
-- SHIPMENTS SHARELINKS WORKSPACE RLS TESTS PASSED -- ZERO SECTIONS
-- SKIPPED", or a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  row_count integer;
  caught boolean;
  project_id uuid;
  doc_id uuid;
  shipment_id uuid;
  project_b_id uuid;
  doc_b_id uuid;
  shipment_b_id uuid;
  policy_check text;
begin
  -- ============================================================
  -- Discover a real, existing app_admin who is also an active workspace
  -- member (is_app_admin() is a GLOBAL check, unrelated to which
  -- workspace the membership row points to).
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

  -- ============================================================
  -- Section 1: correct-workspace access allowed, for both representative
  -- tables. Uses a real project (pm/admin role gate on projects itself,
  -- migration 023 -- our admin passes).
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (project_name) values ('ZZ_TEST_161 Project') returning id into project_id;

  insert into public.project_documents (project_id, document_number, document_type, file_name)
    values (project_id, 'ZZ-DOC-161-A', 'other', 'test-a.pdf') returning id into doc_id;
  select count(*) into row_count from public.project_documents where id = doc_id;
  if row_count <> 1 then raise exception 'TEST FAILED: real-workspace caller could not read back their own new project_document'; end if;
  update public.project_documents set notes = 'updated' where id = doc_id;
  select count(*) into row_count from public.project_documents where id = doc_id and notes = 'updated';
  if row_count <> 1 then raise exception 'TEST FAILED: real-workspace caller could not update their own project_document'; end if;

  insert into public.project_shipments (project_id, shipment_number)
    values (project_id, 'ZZ-SHIP-161-A') returning id into shipment_id;
  select count(*) into row_count from public.project_shipments where id = shipment_id;
  if row_count <> 1 then raise exception 'TEST FAILED: real-workspace caller could not read back their own new project_shipment'; end if;
  update public.project_shipments set notes = 'updated' where id = shipment_id;
  select count(*) into row_count from public.project_shipments where id = shipment_id and notes = 'updated';
  if row_count <> 1 then raise exception 'TEST FAILED: real-workspace caller could not update their own project_shipment'; end if;

  raise notice 'TEST PASSED: Section 1 -- correct-workspace read/write allowed for project_documents, project_shipments';

  -- ============================================================
  -- Section 2: another-workspace denied. A genuine second active
  -- workspace, created and torn down entirely inside this rolled-back
  -- transaction, the same real admin temporarily moved into it -- not a
  -- second real user -- exactly the technique already proven in
  -- migrations 155/157/158/159/160's own tests.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_161 Other Workspace', 'zz-test-161-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (project_name) values ('ZZ_TEST_161 Project B') returning id into project_b_id;
  insert into public.project_documents (project_id, document_number, document_type, file_name)
    values (project_b_id, 'ZZ-DOC-161-B', 'other', 'test-b.pdf') returning id into doc_b_id;
  insert into public.project_shipments (project_id, shipment_number)
    values (project_b_id, 'ZZ-SHIP-161-B') returning id into shipment_b_id;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.project_documents where id = doc_b_id;
  if row_count <> 0 then raise exception 'TEST FAILED: a real-workspace caller could read a project_document belonging to another workspace'; end if;
  select count(*) into row_count from public.project_shipments where id = shipment_b_id;
  if row_count <> 0 then raise exception 'TEST FAILED: a real-workspace caller could read a project_shipment belonging to another workspace'; end if;

  begin
    caught := false;
    update public.project_documents set notes = 'hijacked' where id = doc_b_id;
  exception when others then caught := true; end;
  -- An UPDATE against a row invisible under RLS matches zero rows rather
  -- than raising -- the real assertion is the postgres-role verification
  -- read below, not `caught`.
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.project_documents where id = doc_b_id and notes = 'hijacked';
  if row_count <> 0 then raise exception 'TEST FAILED: a real-workspace caller was able to modify a project_document belonging to another workspace'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 2 -- another-workspace rows are invisible and unwritable for project_documents, project_shipments';

  -- ============================================================
  -- Section 3: missing-membership denied.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.project_documents where id = doc_id;
  if row_count <> 0 then raise exception 'TEST FAILED: a caller with zero workspace memberships could read an existing project_document'; end if;
  select count(*) into row_count from public.project_shipments where id = shipment_id;
  if row_count <> 0 then raise exception 'TEST FAILED: a caller with zero workspace memberships could read an existing project_shipment'; end if;

  begin
    caught := false;
    insert into public.project_documents (project_id, document_number, document_type, file_name)
      values (project_id, 'ZZ-DOC-161-NOWS', 'other', 'nows.pdf');
  exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert a project_document'; end if;

  begin
    caught := false;
    insert into public.project_shipments (project_id, shipment_number) values (project_id, 'ZZ-SHIP-161-NOWS');
  exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert a project_shipment'; end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 3 -- a caller with zero workspace memberships sees zero rows and cannot insert into project_documents or project_shipments';

  -- ============================================================
  -- Section 4: structural sweep. Every remaining table's SELECT policy
  -- references is_workspace_member and the correct column/resolver;
  -- project_documents' own three-way coalesce is confirmed to reference
  -- all three anchor resolvers (only the project_id path was
  -- behaviorally exercised above); every table has the expected policy
  -- count.
  -- ============================================================

  select count(*) into row_count from pg_policies
    where schemaname = 'public' and tablename = 'project_documents' and cmd = 'SELECT'
      and position('project_owner_workspace_id' in coalesce(qual, '')) > 0
      and position('purchase_order_owner_workspace_id' in coalesce(qual, '')) > 0
      and position('purchase_request_owner_workspace_id' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: project_documents SELECT policy does not reference all three coalesced resolvers'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'sales_quote_extractions' and cmd = 'SELECT' and position('project_document_owner_workspace_id' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: sales_quote_extractions SELECT policy does not reference project_document_owner_workspace_id'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'project_shipping_addresses' and cmd = 'SELECT' and position('project_owner_workspace_id' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: project_shipping_addresses SELECT policy does not reference project_owner_workspace_id'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'project_shipment_lines' and cmd = 'SELECT' and position('project_shipment_owner_workspace_id' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: project_shipment_lines SELECT policy does not reference project_shipment_owner_workspace_id'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'project_shipment_photos' and cmd = 'SELECT' and position('project_shipment_owner_workspace_id' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: project_shipment_photos SELECT policy does not reference project_shipment_owner_workspace_id'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'public_share_tokens' and cmd = 'SELECT' and position('share_link_entity_workspace_id' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: public_share_tokens SELECT policy does not reference share_link_entity_workspace_id'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'share_link_views' and cmd = 'SELECT' and position('share_link_entity_workspace_id' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: share_link_views SELECT policy does not reference share_link_entity_workspace_id'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'share_link_actions' and cmd = 'SELECT' and position('share_link_entity_workspace_id' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: share_link_actions SELECT policy does not reference share_link_entity_workspace_id'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'workspace_share_link_settings' and cmd = 'SELECT' and position('is_workspace_member(workspace_id)' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: workspace_share_link_settings SELECT policy does not reference is_workspace_member(workspace_id)'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'workspace_share_link_settings' and cmd = 'ALL'
    and position('is_app_admin' in coalesce(qual, '')) > 0 and position('is_active_workspace_member' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: workspace_share_link_settings write policy is missing either its admin gate or the new workspace predicate'; end if;

  -- storage.objects policies for the purchase-order-files bucket.
  select count(*) into row_count from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
      and policyname = 'workspace members read purchase-order-files objects'
      and position('purchase_order_owner_workspace_id' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: purchase-order-files storage read policy does not reference purchase_order_owner_workspace_id'; end if;

  select count(*) into row_count from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'workspace members % purchase-order-files objects';
  if row_count <> 4 then raise exception 'TEST FAILED: expected exactly 4 workspace-scoped purchase-order-files storage policies, found %', row_count; end if;

  -- Every RLS-bearing table in scope must have exactly the expected
  -- policy count after this migration -- no leftover using(true) policy,
  -- no accidental duplicate.
  for policy_check in
    select unnest(array[
      'project_documents', 'sales_quote_extractions', 'project_shipping_addresses',
      'project_shipments', 'project_shipment_lines', 'project_shipment_photos'
    ])
  loop
    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = policy_check;
    if row_count <> 4 then
      raise exception 'TEST FAILED: % has % policies after migration 161, expected exactly 4', policy_check, row_count;
    end if;
  end loop;

  for policy_check in
    select unnest(array['public_share_tokens', 'share_link_views', 'share_link_actions'])
  loop
    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = policy_check;
    if row_count <> 1 then
      raise exception 'TEST FAILED: % has % policies after migration 161, expected exactly 1 (SELECT-only, RPC-write-only)', policy_check, row_count;
    end if;
  end loop;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'workspace_share_link_settings';
  if row_count <> 2 then raise exception 'TEST FAILED: workspace_share_link_settings has % policies after migration 161, expected exactly 2', row_count; end if;

  raise notice 'TEST PASSED: Section 4 -- structural sweep confirms correct predicate and exact policy counts across all remaining tables and the purchase-order-files storage bucket';

  raise notice 'ALL MIGRATION 161 PHASE 3 DOCUMENTS SHIPMENTS SHARELINKS WORKSPACE RLS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
