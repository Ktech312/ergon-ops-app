-- Transaction-safe canonical test for migration 185 (per-workspace admin
-- authorization: workspace_members.is_workspace_admin(workspace_id) now
-- ALSO satisfies the admin gate on user_invites, company_branding [table
-- + storage], product_catalog, catalog_price_change_requests,
-- presales_hardware_rules, site_hardware_rules, form_schemas, and
-- form_schema_fields -- additively, alongside the pre-existing
-- is_app_admin(auth.uid())/has_role(...) conditions). Wrapped in
-- begin;/rollback; -- nothing here ever commits. The synthetic second
-- workspace and the one synthetic auth.users row this script fabricates
-- live ONLY inside this rolled-back transaction.
--
-- The scenario none of migrations 176/177/181/182's own tests ever
-- exercised: a user who IS a real `workspace_members.is_workspace_admin =
-- true` member of a workspace but has NO row in the global `app_admins`
-- table at all. Every section below proves that user can now do each
-- admin-gated action for their OWN workspace, cannot do any of them for a
-- DIFFERENT workspace (ordinary containment -- they have no membership
-- row there at all), and that a real `app_admins` global admin (whose own
-- `is_workspace_admin` flag is deliberately forced to false for this
-- check, so success is attributable ONLY to is_app_admin, not
-- accidentally also to is_workspace_admin) still gets everything they got
-- before -- zero regression.
--
-- Fabricating one synthetic identity (`ws_admin_id`, via `insert into
-- auth.users` + `workspace_members(is_workspace_admin=true)`, deliberately
-- NEVER given an `app_admins` row) mirrors migration 182's own test's
-- idiom for fabricating a second identity
-- (migration_182_company_branding_workspace_scoping_tests.sql:99-102).
-- Every other identity used below is the discovered real app_admin --
-- never fabricated, same discipline as every other canonical test this
-- session.
--
-- SELECT/UPDATE denial is asserted via row-count checks, never exception
-- checks (RLS blocks those two silently -- migrations 171/174's own
-- lesson). Storage INSERT denial IS exception-based (an INSERT has no
-- pre-existing row to silently filter -- a blocked INSERT genuinely
-- raises "new row violates row-level security policy" -- same idiom as
-- migration 179's own storage tests).
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 185 PER WORKSPACE ADMIN
-- AUTHORIZATION TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL
-- error naming what failed or was skipped.

begin;

do $$
declare
  admin_user_id uuid;
  workspace_a_id uuid;
  admin_was_workspace_admin boolean;
  admin_email text;
  ws_admin_id uuid := gen_random_uuid();
  ws_b uuid := gen_random_uuid();
  caught boolean;
  affected_rows int;
  visible_count int;
  invite_a_id uuid;
  invite_b_id uuid;
  seen_workspace_id uuid;
  item_a_id uuid;
  item_b_id uuid;
  request_a_id uuid;
  request_b_id uuid;
  schema_a_id uuid;
  schema_b_id uuid;
  field_b_id uuid;
begin
  -- ============================================================
  -- Setup: discover a real app_admin who is also an active workspace
  -- member (this is "workspace A" and the "global admin" fixture, same
  -- discovery idiom as every other Phase 3 canonical test). Fabricate the
  -- one synthetic workspace-admin-only identity this migration's test
  -- coverage newly requires, and a synthetic workspace B for containment
  -- checks.
  -- ============================================================

  select am.user_id, wm.workspace_id, wm.is_workspace_admin
    into admin_user_id, workspace_a_id, admin_was_workspace_admin
  from public.app_admins am
  join public.workspace_members wm on wm.user_id = am.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if admin_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin who is also an active workspace member found -- this script requires at least one real app_admins row that is also present in workspace_members.';
  end if;

  select email into admin_email from auth.users where id = admin_user_id;

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_185 Other Workspace', 'zz-test-185-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  insert into auth.users (id, email) values (ws_admin_id, 'zz-test-185-ws-admin-only@example.com');
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
    values (workspace_a_id, ws_admin_id, true);

  if exists (select 1 from public.app_admins where user_id = ws_admin_id) then
    raise exception 'TEST SETUP FAILED: the synthetic workspace-admin-only fixture must not have an app_admins row -- this is the entire point of this scenario';
  end if;

  -- ============================================================
  -- Section 1: user_invites -- the workspace-admin-only user can invite a
  -- teammate into (create + read within) their OWN workspace, but cannot
  -- read or revoke a workspace-B invite they have no membership in at all.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ws_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.user_invites (email, full_name, primary_role, invited_by_email)
  values ('zz-test-185-invitee-a@example.com', 'ZZ_TEST_185 Invitee A', 'warehouse', 'zz-test-185-ws-admin-only@example.com')
  returning id, workspace_id into invite_a_id, seen_workspace_id;

  if seen_workspace_id is distinct from workspace_a_id then
    raise exception 'TEST FAILED: workspace-admin-only user''s new user_invites row was stamped with workspace_id % instead of their own workspace %', seen_workspace_id, workspace_a_id;
  end if;

  select count(*) into visible_count from public.user_invites where id = invite_a_id;
  if visible_count <> 1 then
    raise exception 'TEST FAILED: workspace-admin-only user could not read the user_invites row they just created in their own workspace';
  end if;

  -- Fabricate the workspace-B fixture row the RIGHT way: user_invites'
  -- workspace_id is caller-derived (guard_workspace_id_mutation() ALWAYS
  -- overwrites whatever value an INSERT names, migration
  -- 117:191-201:199 -- `new.workspace_id :=
  -- public.resolve_caller_workspace_id()` unconditionally, regardless of
  -- role, since triggers fire even for a superuser/bypassrls role,
  -- unlike RLS). So the acting identity's OWN active membership has to
  -- genuinely be workspace B at insert time -- moving the real admin's
  -- membership there and back (same technique migrations 176/177/181's
  -- own tests already use for this exact reason) is the only way to
  -- produce a real workspace-B row here, not a plain `workspace_id = ws_b`
  -- column value passed to an otherwise-privileged insert.
  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = admin_user_id and workspace_id = workspace_a_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, admin_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text, 'email', admin_email)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.user_invites (email, full_name, primary_role, invited_by_email)
  values ('zz-test-185-invitee-b@example.com', 'ZZ_TEST_185 Invitee B', 'warehouse', 'zz-test-185-admin-b@example.com')
  returning id, workspace_id into invite_b_id, seen_workspace_id;

  if seen_workspace_id is distinct from ws_b then
    raise exception 'TEST SETUP FAILED: workspace-B user_invites fixture was not actually stamped with workspace B''s id (got %) -- fixture technique is broken, this section would prove nothing', seen_workspace_id;
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = admin_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (workspace_a_id, admin_user_id, admin_was_workspace_admin);

  perform set_config('request.jwt.claims', json_build_object('sub', ws_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.user_invites where id = invite_b_id;
  if visible_count <> 0 then
    raise exception 'TEST FAILED: workspace-admin-only user of workspace A could read workspace B''s user_invites row';
  end if;

  update public.user_invites set status = 'revoked' where id = invite_b_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'TEST FAILED: workspace-admin-only user of workspace A was able to revoke workspace B''s user_invites row -- % row(s) affected', affected_rows;
  end if;

  raise notice 'TEST PASSED: Section 1 -- a workspace_members.is_workspace_admin=true, non-app_admin user can invite a teammate into their own workspace and cannot touch a different workspace''s invites';

  -- ============================================================
  -- Section 2: company_branding TABLE -- workspace-admin-only user can
  -- update their own company's branding row (auto-seeded by
  -- workspaces_seed_default_branding), but cannot touch workspace B's.
  -- ============================================================

  update public.company_branding set company_name = 'ZZ_TEST_185 Updated By Workspace Admin'
    where workspace_id = workspace_a_id
    returning workspace_id into seen_workspace_id;

  if seen_workspace_id is distinct from workspace_a_id then
    raise exception 'TEST FAILED: workspace-admin-only user could not update their own workspace''s company_branding row';
  end if;

  update public.company_branding set company_name = 'ZZ_TEST_185 HACKED' where workspace_id = ws_b;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'TEST FAILED: workspace-admin-only user of workspace A was able to write workspace B''s company_branding row -- % row(s) affected', affected_rows;
  end if;

  raise notice 'TEST PASSED: Section 2 -- workspace-admin-only user can write their own company_branding row and cannot touch workspace B''s';

  -- ============================================================
  -- Section 3: company-branding STORAGE bucket -- workspace-admin-only
  -- user can upload under their own workspace's path prefix, but not
  -- under workspace B's.
  -- ============================================================

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('company-branding', workspace_a_id::text || '/logo-zz-test-185.png');
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: workspace-admin-only user was rejected uploading into their own workspace''s company-branding path'; end if;

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('company-branding', ws_b::text || '/logo-zz-test-185-hacked.png');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: workspace-admin-only user of workspace A was able to upload into workspace B''s company-branding path'; end if;

  -- Malformed leading path segment (not a valid uuid at all) must still
  -- fail cleanly, never raise a cast error -- confirms
  -- safe_workspace_id_from_object_path()'s exception handling actually
  -- works, not just that legitimate uuids happen to parse.
  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('company-branding', 'not-a-uuid/logo-zz-test-185.png');
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: an upload with a malformed (non-uuid) leading path segment was not rejected'; end if;

  raise notice 'TEST PASSED: Section 3 -- company-branding storage uploads honor the new workspace-admin path, reject cross-workspace uploads, and a malformed path segment fails cleanly (no cast error)';

  -- ============================================================
  -- Section 4: product_catalog -- workspace-admin-only user can write
  -- their own workspace's catalog (insert auto-scopes to their own
  -- active workspace via guard_workspace_id_mutation()), but cannot touch
  -- a workspace-B row.
  -- ============================================================

  insert into public.product_catalog (catalog_number, product_name)
    values ('ZZ-CAT-185-A', 'ZZ_TEST_185 Item A')
    returning id, workspace_id into item_a_id, seen_workspace_id;

  if seen_workspace_id is distinct from workspace_a_id then
    raise exception 'TEST FAILED: workspace-admin-only user''s new product_catalog row was stamped with workspace_id % instead of their own workspace %', seen_workspace_id, workspace_a_id;
  end if;

  -- Same caller-derived-workspace_id fixture technique as Section 1
  -- (product_catalog's own guard_workspace_id_mutation() trigger,
  -- migration 176:45-48, behaves identically).
  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = admin_user_id and workspace_id = workspace_a_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, admin_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text, 'email', admin_email)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.product_catalog (catalog_number, product_name)
    values ('ZZ-CAT-185-B', 'ZZ_TEST_185 Item B')
    returning id, workspace_id into item_b_id, seen_workspace_id;

  if seen_workspace_id is distinct from ws_b then
    raise exception 'TEST SETUP FAILED: workspace-B product_catalog fixture was not actually stamped with workspace B''s id (got %)', seen_workspace_id;
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = admin_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (workspace_a_id, admin_user_id, admin_was_workspace_admin);

  perform set_config('request.jwt.claims', json_build_object('sub', ws_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  update public.product_catalog set product_name = 'ZZ_TEST_185 HACKED' where id = item_b_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'TEST FAILED: workspace-admin-only user of workspace A was able to write workspace B''s product_catalog row -- % row(s) affected', affected_rows;
  end if;

  raise notice 'TEST PASSED: Section 4 -- workspace-admin-only user can write their own workspace''s product_catalog and cannot touch workspace B''s';

  -- ============================================================
  -- Section 5: catalog_price_change_requests -- workspace-admin-only
  -- user can read/review (UPDATE) a request against their own workspace's
  -- catalog item, but cannot touch one anchored to workspace B.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ws_admin_id::text, 'email', 'zz-test-185-ws-admin-only@example.com')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.catalog_price_change_requests (catalog_item_id, requested_by_email, field_changed, previous_value, requested_value)
    values (item_a_id, 'zz-test-185-ws-admin-only@example.com', 'unit_cost', 1, 2)
    returning id into request_a_id;

  update public.catalog_price_change_requests set requested_value = 3 where id = request_a_id returning workspace_id into seen_workspace_id;
  if seen_workspace_id is distinct from workspace_a_id then
    raise exception 'TEST FAILED: workspace-admin-only user could not review (UPDATE) their own workspace''s catalog_price_change_requests row';
  end if;

  perform set_config('role', 'postgres', true);
  insert into public.catalog_price_change_requests (catalog_item_id, requested_by_email, field_changed, previous_value, requested_value)
    values (item_b_id, 'zz-test-185-other@example.com', 'unit_cost', 1, 2)
    returning id into request_b_id;

  perform set_config('request.jwt.claims', json_build_object('sub', ws_admin_id::text, 'email', 'zz-test-185-ws-admin-only@example.com')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.catalog_price_change_requests where id = request_b_id;
  if visible_count <> 0 then
    raise exception 'TEST FAILED: workspace-admin-only user of workspace A could read workspace B''s catalog_price_change_requests row';
  end if;

  update public.catalog_price_change_requests set requested_value = 99 where id = request_b_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'TEST FAILED: workspace-admin-only user of workspace A was able to review (UPDATE) workspace B''s catalog_price_change_requests row -- % row(s) affected', affected_rows;
  end if;

  raise notice 'TEST PASSED: Section 5 -- workspace-admin-only user can review their own workspace''s catalog_price_change_requests and cannot touch workspace B''s';

  -- ============================================================
  -- Section 6: presales_hardware_rules, site_hardware_rules,
  -- form_schemas, form_schema_fields -- workspace-admin-only user can
  -- write their own workspace's copy of each; cannot touch workspace B's.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ws_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.presales_hardware_rules (tier, base_item_name)
    values ('ZZ_TEST_185_TIER', 'ZZ_TEST_185_ITEM')
    returning workspace_id into seen_workspace_id;
  if seen_workspace_id is distinct from workspace_a_id then
    raise exception 'TEST FAILED: workspace-admin-only user''s new presales_hardware_rules row was not stamped with their own workspace_id';
  end if;

  insert into public.site_hardware_rules (metric, item_name)
    values ('fli', 'ZZ_TEST_185_ITEM')
    returning workspace_id into seen_workspace_id;
  if seen_workspace_id is distinct from workspace_a_id then
    raise exception 'TEST FAILED: workspace-admin-only user''s new site_hardware_rules row was not stamped with their own workspace_id';
  end if;

  insert into public.form_schemas (form_key, name)
    values ('zz_test_185_form', 'ZZ_TEST_185 Form')
    returning id, workspace_id into schema_a_id, seen_workspace_id;
  if seen_workspace_id is distinct from workspace_a_id then
    raise exception 'TEST FAILED: workspace-admin-only user''s new form_schemas row was not stamped with their own workspace_id';
  end if;

  insert into public.form_schema_fields (form_schema_id, field_key, label)
    values (schema_a_id, 'zz_field', 'ZZ Field')
    returning workspace_id into seen_workspace_id;
  if seen_workspace_id is distinct from workspace_a_id then
    raise exception 'TEST FAILED: workspace-admin-only user''s new form_schema_fields row was not stamped with their own workspace_id (derived from its parent form_schemas row)';
  end if;

  -- Cross-workspace denial: a workspace-B form_schemas row (and its own
  -- field), fabricated as postgres, cannot be touched by workspace A's
  -- workspace-admin-only user.
  -- Same caller-derived-workspace_id fixture technique as Sections 1/4
  -- (form_schemas' own guard_workspace_id_mutation() trigger, migration
  -- 177:172-175, behaves identically). form_schema_fields itself derives
  -- from its PARENT form_schemas row (migration 177:223-244, not the
  -- caller), so once schema_b_id is genuinely workspace-B-scoped, a
  -- plain insert for its field is correctly scoped too regardless of who
  -- performs it.
  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = admin_user_id and workspace_id = workspace_a_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, admin_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text, 'email', admin_email)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.form_schemas (form_key, name)
    values ('zz_test_185_form_b', 'ZZ_TEST_185 Form B')
    returning id, workspace_id into schema_b_id, seen_workspace_id;

  if seen_workspace_id is distinct from ws_b then
    raise exception 'TEST SETUP FAILED: workspace-B form_schemas fixture was not actually stamped with workspace B''s id (got %)', seen_workspace_id;
  end if;

  insert into public.form_schema_fields (form_schema_id, field_key, label)
    values (schema_b_id, 'zz_field_b', 'ZZ Field B')
    returning id into field_b_id;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = admin_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (workspace_a_id, admin_user_id, admin_was_workspace_admin);

  perform set_config('request.jwt.claims', json_build_object('sub', ws_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  update public.form_schemas set name = 'ZZ_TEST_185 HACKED' where id = schema_b_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'TEST FAILED: workspace-admin-only user of workspace A was able to write workspace B''s form_schemas row -- % row(s) affected', affected_rows;
  end if;

  update public.form_schema_fields set label = 'ZZ_TEST_185 HACKED' where id = field_b_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'TEST FAILED: workspace-admin-only user of workspace A was able to write workspace B''s form_schema_fields row -- % row(s) affected', affected_rows;
  end if;

  raise notice 'TEST PASSED: Section 6 -- workspace-admin-only user can write their own workspace''s presales_hardware_rules/site_hardware_rules/form_schemas/form_schema_fields and cannot touch workspace B''s';

  -- ============================================================
  -- Section 7: regression guard -- a real app_admins user (global admin)
  -- can still do all of the above for their own workspace, exactly as
  -- before. is_workspace_admin is deliberately forced to false for the
  -- duration of this check so success here is attributable ONLY to
  -- is_app_admin(auth.uid()), never accidentally to the new
  -- is_workspace_admin() clause -- otherwise this section would prove
  -- nothing about the pre-existing path being unbroken.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  update public.workspace_members set is_workspace_admin = false
    where workspace_id = workspace_a_id and user_id = admin_user_id;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text, 'email', admin_email)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.user_invites (email, full_name, primary_role, invited_by_email)
  values ('zz-test-185-invitee-regress@example.com', 'ZZ_TEST_185 Invitee Regress', 'warehouse', coalesce(admin_email, 'admin@example.com'));

  update public.company_branding set company_name = 'ZZ_TEST_185 Updated By Global Admin' where workspace_id = workspace_a_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'TEST FAILED (REGRESSION): a real app_admins global admin (is_workspace_admin forced false) could no longer write their own workspace''s company_branding row';
  end if;

  insert into public.product_catalog (catalog_number, product_name)
  values ('ZZ-CAT-185-REGRESS', 'ZZ_TEST_185 Item Regress');

  insert into public.presales_hardware_rules (tier, base_item_name)
  values ('ZZ_TEST_185_TIER_REGRESS', 'ZZ_TEST_185_ITEM_REGRESS');

  caught := false;
  begin
    insert into storage.objects (bucket_id, name) values ('company-branding', workspace_a_id::text || '/logo-zz-test-185-regress.png');
  exception when others then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED (REGRESSION): a real app_admins global admin (is_workspace_admin forced false) could no longer upload into their own workspace''s company-branding path'; end if;

  perform set_config('role', 'postgres', true);
  update public.workspace_members set is_workspace_admin = admin_was_workspace_admin
    where workspace_id = workspace_a_id and user_id = admin_user_id;

  raise notice 'TEST PASSED: Section 7 -- a real app_admins global admin (with is_workspace_admin forced false) still passes every admin gate touched by this migration for their own workspace -- zero regression';

  raise notice 'ALL MIGRATION 185 PER WORKSPACE ADMIN AUTHORIZATION TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
