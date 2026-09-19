-- Transaction-safe canonical test for migration 176 (product_catalog /
-- catalog_price_change_requests workspace scoping). Wrapped in
-- begin;/rollback; -- nothing here ever commits. The synthetic second
-- workspace lives ONLY inside this rolled-back transaction.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 176 PRODUCT CATALOG
-- WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard
-- SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_user_email text;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  caught boolean;
  item_a_id uuid;
  item_b_id uuid;
  request_a_id uuid;
  seen_workspace_id uuid;
  visible_count int;
begin
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

  select email into real_user_email from auth.users where id = real_user_id;

  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_176 Other Workspace', 'zz-test-176-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text, 'email', real_user_email)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: product_catalog.catalog_number -- same-workspace
  -- duplicate still rejected, cross-workspace duplicate now accepted.
  -- ============================================================

  insert into public.product_catalog (catalog_number, product_name) values ('ZZ-CAT-176-A', 'ZZ_TEST_176 Item A') returning id into item_a_id;

  caught := false;
  begin
    insert into public.product_catalog (catalog_number, product_name) values ('ZZ-CAT-176-A', 'ZZ_TEST_176 Item A Dup');
  exception when unique_violation then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: product_catalog.catalog_number allowed a same-workspace duplicate'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text, 'email', real_user_email)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.product_catalog (catalog_number, product_name) values ('ZZ-CAT-176-A', 'ZZ_TEST_176 Item A in B') returning id into item_b_id;
  exception when unique_violation then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: product_catalog.catalog_number rejected an identical number in a DIFFERENT workspace'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text, 'email', real_user_email)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 1 -- product_catalog.catalog_number is workspace-scoped';

  -- ============================================================
  -- Section 2: catalog_price_change_requests -- workspace_id derives
  -- from its mandatory parent (product_catalog), not the caller
  -- directly.
  -- ============================================================

  insert into public.catalog_price_change_requests (catalog_item_id, requested_by_email, field_changed, previous_value, requested_value)
    values (item_a_id, coalesce(auth.jwt() ->> 'email', 'zz-test-176@example.com'), 'unit_cost', 1, 2)
    returning id, workspace_id into request_a_id, seen_workspace_id;
  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: catalog_price_change_requests.workspace_id did not derive from its parent product_catalog row (got %, expected %)', seen_workspace_id, real_workspace_id;
  end if;

  -- Cross-workspace containment: a workspace-B caller cannot see
  -- workspace A's price change request (row-count check).
  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text, 'email', real_user_email)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.catalog_price_change_requests where id = request_a_id;
  if visible_count <> 0 then raise exception 'TEST FAILED: a workspace-B caller could read workspace A''s catalog_price_change_requests row'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text, 'email', real_user_email)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 2 -- catalog_price_change_requests derives its workspace_id from its parent and is correctly contained';

  raise notice 'ALL MIGRATION 176 PRODUCT CATALOG WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
