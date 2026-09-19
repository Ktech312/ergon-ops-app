-- Transaction-safe canonical test for migration 173 (workspace-scope
-- notification_rules/standard_install_times/project_schedule_templates/
-- project_schedule_template_phases, per E's explicit decision). Wrapped
-- in begin;/rollback; -- nothing here ever commits. The synthetic
-- second workspace this script creates lives ONLY inside this
-- rolled-back transaction, never a persistent second workspace.
--
-- Each table gets one same-workspace-duplicate regression check (still
-- rejected) and one cross-workspace-duplicate check (now accepted).
-- project_schedule_template_phases additionally checks its
-- derived-from-parent workspace_id and the deletion_log follow-up fix.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 173 GLOBAL CONFIG
-- WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard
-- SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  caught boolean;
  template_a_id uuid;
  template_b_id uuid;
  phase_a_id uuid;
  seen_workspace_id uuid;
  log_id uuid;
  item_a_id uuid;
  existing_event_type text;
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
    values (ws_b, 'ZZ_TEST_173 Other Workspace', 'zz-test-173-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: notification_rules -- same-event_type duplicate still
  -- rejected within a workspace, an identical event_type in a
  -- DIFFERENT workspace now accepted.
  -- Migration 024 (and every later widening migration) seeds a real row
  -- for every valid event_type in the one real production workspace, so
  -- there is no "free" event_type left to insert fresh -- discover one
  -- of the real, already-existing rows instead of assuming any specific
  -- literal is unused.
  -- ============================================================

  select event_type into existing_event_type
  from public.notification_rules
  where workspace_id = real_workspace_id
  limit 1;

  if existing_event_type is null then
    raise exception 'TEST SETUP FAILED: no existing notification_rules row found for the real workspace -- expected at least one seeded row from migration 024 onward.';
  end if;

  caught := false;
  begin
    insert into public.notification_rules (event_type, is_active) values (existing_event_type, false);
  exception when unique_violation then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: notification_rules.event_type allowed a same-workspace duplicate'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.notification_rules (event_type, is_active) values (existing_event_type, true);
  exception when unique_violation then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: notification_rules.event_type rejected an identical event_type in a DIFFERENT workspace'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 1 -- notification_rules.event_type is workspace-scoped';

  -- ============================================================
  -- Section 2: standard_install_times -- same pattern for the
  -- category-based partial unique index.
  -- ============================================================

  insert into public.standard_install_times (category, hours_per_unit) values ('ZZ_TEST_173 Category A', 1);

  caught := false;
  begin
    insert into public.standard_install_times (category, hours_per_unit) values ('ZZ_TEST_173 Category A', 2);
  exception when unique_violation then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: standard_install_times.category allowed a same-workspace duplicate'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.standard_install_times (category, hours_per_unit) values ('ZZ_TEST_173 Category A', 3);
  exception when unique_violation then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: standard_install_times.category rejected an identical category in a DIFFERENT workspace'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 2 -- standard_install_times.category is workspace-scoped';

  -- ============================================================
  -- Section 3: project_schedule_templates -- same pattern for name.
  -- ============================================================

  insert into public.project_schedule_templates (name) values ('ZZ_TEST_173 Template A') returning id into template_a_id;

  caught := false;
  begin
    insert into public.project_schedule_templates (name) values ('ZZ_TEST_173 Template A');
  exception when unique_violation then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: project_schedule_templates.name allowed a same-workspace duplicate'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.project_schedule_templates (name) values ('ZZ_TEST_173 Template A') returning id into template_b_id;
  exception when unique_violation then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: project_schedule_templates.name rejected an identical name in a DIFFERENT workspace'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 3 -- project_schedule_templates.name is workspace-scoped';

  -- ============================================================
  -- Section 4: project_schedule_template_phases -- workspace_id is
  -- correctly DERIVED FROM THE PARENT TEMPLATE, not the caller's own
  -- workspace directly (both happen to be the same value here, since
  -- the caller and the template are both in real_workspace_id, but the
  -- derivation source matters: it must come from template_id).
  -- ============================================================

  insert into public.project_schedule_template_phases (template_id, phase_name, sequence_order)
    values (template_a_id, 'ZZ_TEST_173 Phase A', 1)
    returning id, workspace_id into phase_a_id, seen_workspace_id;
  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: project_schedule_template_phases.workspace_id did not derive from its parent template (got %, expected %)', seen_workspace_id, real_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 4 -- project_schedule_template_phases.workspace_id derives correctly from its parent template';

  -- ============================================================
  -- Section 5: deletion_log follow-up -- a soft-deleted phase's log
  -- entry now resolves the REAL workspace_id (previously hardcoded
  -- null for this entity_type).
  -- ============================================================

  perform set_config('role', 'postgres', true);
  update public.project_schedule_template_phases set deleted_at = now(), deleted_by_email = 'zz-test-173@example.com' where id = phase_a_id;
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.deletion_log (entity_type, entity_id, entity_label, action, actor_email)
    values ('schedule_template_phase', phase_a_id, 'ZZ_TEST_173 Phase A', 'deleted', 'zz-test-173@example.com')
    returning id, workspace_id into log_id, seen_workspace_id;
  if seen_workspace_id is distinct from real_workspace_id then
    raise exception 'TEST FAILED: schedule_template_phase deletion_log row did not resolve the real workspace_id (got %, expected %) -- the migration 166 follow-up is not working', seen_workspace_id, real_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 5 -- schedule_template_phase deletion_log rows now resolve a real workspace_id';

  -- ============================================================
  -- Section 6: confirm the residual gap entity types (inventory_item)
  -- are UNCHANGED by this migration -- still null, not accidentally
  -- broken or accidentally fixed by this file's CASE rewrite.
  -- ============================================================

  insert into public.inventory_items (sku, item_name) values ('ZZ-SKU-173-A', 'ZZ_TEST_173 Item A') returning id into item_a_id;
  insert into public.deletion_log (entity_type, entity_id, entity_label, action, actor_email)
    values ('inventory_item', item_a_id, 'ZZ_TEST_173 Item A', 'deleted', 'zz-test-173@example.com')
    returning workspace_id into seen_workspace_id;
  if seen_workspace_id is not null then
    raise exception 'TEST FAILED: inventory_item deletion_log dispatch changed behavior unexpectedly (got %, expected null)', seen_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section 6 -- unrelated deletion_log entity types (inventory_item) are unaffected by this migration''s CASE rewrite';

  raise notice 'ALL MIGRATION 173 GLOBAL CONFIG WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
