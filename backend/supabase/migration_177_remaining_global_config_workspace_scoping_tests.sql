-- Transaction-safe canonical test for migration 177
-- (presales_hardware_rules / site_hardware_rules / form_schemas /
-- form_schema_fields workspace scoping). Wrapped in begin;/rollback; --
-- nothing here ever commits. The synthetic second workspace lives ONLY
-- inside this rolled-back transaction.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 177 REMAINING GLOBAL
-- CONFIG WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a
-- hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  caught boolean;
  schema_a_id uuid;
  field_a_id uuid;
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

  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_177 Other Workspace', 'zz-test-177-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: presales_hardware_rules (tier, base_item_name) --
  -- same-workspace duplicate rejected, cross-workspace accepted.
  -- ============================================================

  insert into public.presales_hardware_rules (tier, base_item_name) values ('ZZ_TEST_177_TIER', 'ZZ_TEST_177_ITEM');

  caught := false;
  begin
    insert into public.presales_hardware_rules (tier, base_item_name) values ('ZZ_TEST_177_TIER', 'ZZ_TEST_177_ITEM');
  exception when unique_violation then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: presales_hardware_rules allowed a same-workspace duplicate (tier, base_item_name)'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.presales_hardware_rules (tier, base_item_name) values ('ZZ_TEST_177_TIER', 'ZZ_TEST_177_ITEM');
  exception when unique_violation then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: presales_hardware_rules rejected an identical (tier, base_item_name) in a DIFFERENT workspace'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 1 -- presales_hardware_rules is workspace-scoped';

  -- ============================================================
  -- Section 2: site_hardware_rules (metric, item_name) -- same pattern.
  -- ============================================================

  insert into public.site_hardware_rules (metric, item_name) values ('fli', 'ZZ_TEST_177_ITEM');

  caught := false;
  begin
    insert into public.site_hardware_rules (metric, item_name) values ('fli', 'ZZ_TEST_177_ITEM');
  exception when unique_violation then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: site_hardware_rules allowed a same-workspace duplicate (metric, item_name)'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.site_hardware_rules (metric, item_name) values ('fli', 'ZZ_TEST_177_ITEM');
  exception when unique_violation then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: site_hardware_rules rejected an identical (metric, item_name) in a DIFFERENT workspace'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 2 -- site_hardware_rules is workspace-scoped';

  -- ============================================================
  -- Section 3: form_schemas.form_key -- same pattern.
  -- ============================================================

  insert into public.form_schemas (form_key, name) values ('zz_test_177_form', 'ZZ_TEST_177 Form') returning id into schema_a_id;

  caught := false;
  begin
    insert into public.form_schemas (form_key, name) values ('zz_test_177_form', 'ZZ_TEST_177 Form Dup');
  exception when unique_violation then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: form_schemas.form_key allowed a same-workspace duplicate'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.form_schemas (form_key, name) values ('zz_test_177_form', 'ZZ_TEST_177 Form in B');
  exception when unique_violation then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: form_schemas.form_key rejected an identical key in a DIFFERENT workspace'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 3 -- form_schemas.form_key is workspace-scoped';

  -- ============================================================
  -- Section 4: form_schema_fields -- workspace_id derives from its
  -- mandatory parent (form_schemas), and cross-workspace read is
  -- blocked (row-count check, not exception-based).
  -- ============================================================

  insert into public.form_schema_fields (form_schema_id, field_key, label, field_type, sequence_order)
    values (schema_a_id, 'zz_test_field', 'ZZ Test Field', 'text', 1)
    returning id, workspace_id into field_a_id, seen_workspace_id;
  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: form_schema_fields.workspace_id did not derive from its parent form_schemas row (got %, expected %)', seen_workspace_id, real_workspace_id;
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.form_schema_fields where id = field_a_id;
  if visible_count <> 0 then raise exception 'TEST FAILED: a workspace-B caller could read workspace A''s form_schema_fields row'; end if;

  select count(*) into visible_count from public.form_schemas where id = schema_a_id;
  if visible_count <> 0 then raise exception 'TEST FAILED: a workspace-B caller could read workspace A''s form_schemas row'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 4 -- form_schema_fields derives its workspace_id from its parent and both are correctly contained';

  raise notice 'ALL MIGRATION 177 REMAINING GLOBAL CONFIG WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
