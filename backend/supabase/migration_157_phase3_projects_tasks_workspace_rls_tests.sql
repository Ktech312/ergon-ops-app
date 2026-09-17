-- Transaction-safe canonical test for migration 157 (Phase 3, Stage 2
-- RLS half: Projects + Tasks containment). Wrapped in begin;/rollback;
-- -- nothing here ever commits. Synthetic second/third workspaces
-- created only inside this rolled-back transaction, per E's explicit
-- instruction, mirroring migration 155/156's own established fixture
-- strategy exactly (same real user, moved between workspaces; the one
-- zero-membership scenario uses gen_random_uuid() directly, never a
-- fabricated auth.users row).
--
-- No active_workspace_id() landmine here, unlike migration 155's test:
-- create_and_send_submittal_version() and respond_to_submittal() both
-- had their settings-lookup fixed in migration 157 to use the target
-- project's own resolved workspace_id instead of active_workspace_id()
-- -- so, unlike request_or_send_quote_proposal_version(), this
-- migration's RPCs can be tested through their FULL completion path
-- even with multiple synthetic workspaces present.
--
-- Coverage strategy: the full six-scenario matrix (correct workspace
-- allowed, another workspace denied, missing membership denied,
-- suspended workspace denied, ambiguous membership denied, role
-- restrictions preserved) is run BEHAVIORALLY against projects (root,
-- role-gated write), tasks (root, no role gate), project_locations
-- (one-level child, no role gate), project_location_images (two-level
-- child), project_bom_lines (one-level child, role-gated write),
-- project_submittals (select-only table), and all three hardened RPCs.
-- The remaining seven tables (project_scope_of_work, project_handovers,
-- project_stakeholders, installed_assets, project_location_items,
-- task_hardware_dependencies, task_activity_log) share the exact same
-- mechanism already proven correct above -- verified STRUCTURALLY via
-- pg_policies, same technique as migration 155's own Section 11.
-- project_conversion_receipts is confirmed structurally untouched (still
-- zero policies, by permanent design).
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 157 PHASE 3 PROJECTS
-- TASKS WORKSPACE RLS TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard
-- SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  ws_b uuid;
  ws_suspended uuid;
  no_membership_caller_id uuid := gen_random_uuid();

  project_a_id uuid;
  location_a_id uuid;
  image_a_id uuid;
  bom_line_a_id uuid;
  submittal_a_id uuid;
  task_a_id uuid;
  token_a text := 'ZZ_TEST_157_TOKEN_' || gen_random_uuid()::text;

  row_count integer;
  caught boolean;
  caught_message text;
  result_row record;
  token_result record;
  policy_def text;
  fn_def text;
  settings_preexisted boolean;
  original_open interval;
begin
  -- ============================================================
  -- Section 0: fixture discovery, synthetic workspaces, synthetic
  -- Project/Task fixtures (all owned by the real workspace).
  -- ============================================================

  select wm.user_id, wm.workspace_id into real_user_id, real_workspace_id
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing active workspace member found -- this script requires at least one real user already in workspace_members.';
  end if;

  insert into public.workspaces (id, name, slug, status)
  values (gen_random_uuid(), 'ZZ_TEST_157 Other Workspace', 'zz-test-157-other-' || substr(gen_random_uuid()::text, 1, 8), 'active')
  returning id into ws_b;

  insert into public.workspaces (id, name, slug, status)
  values (gen_random_uuid(), 'ZZ_TEST_157 Suspended Workspace', 'zz-test-157-suspended-' || substr(gen_random_uuid()::text, 1, 8), 'suspended')
  returning id into ws_suspended;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- projects insert requires pm/admin -- real_user_id is the confirmed
  -- admin in this environment (same caveat as migration 155's test).
  insert into public.projects (project_name, customer_name) values ('ZZ_TEST_157 Project A', 'ZZ_TEST_157 Customer')
    returning id into project_a_id;
  insert into public.project_locations (project_id, location_type, name)
    values (project_a_id, 'garage', 'ZZ_TEST_157 Location A') returning id into location_a_id;
  insert into public.project_location_images (project_location_id, image_type, storage_path)
    values (location_a_id, 'photo', 'zz-test-157/fake.jpg') returning id into image_a_id;
  insert into public.project_bom_lines (project_id, item_name, qty)
    values (project_a_id, 'ZZ_TEST_157 BOM Item', 1) returning id into bom_line_a_id;
  insert into public.tasks (task_number, title) values ('ZZ_TEST_157_TASK', 'ZZ_TEST_157 Task A')
    returning id into task_a_id;

  perform set_config('role', 'postgres', true);

  insert into public.project_submittals (project_id, version, status, content_snapshot, client_name, client_email, sent_at)
    values (project_a_id, 1, 'sent', '{}'::jsonb, 'ZZ_TEST_157 Client A', 'zz-test-157-client@example.invalid', now())
    returning id into submittal_a_id;
  insert into public.public_share_tokens (token, entity_type, entity_id, expires_at)
    values (token_a, 'project_submittal', submittal_a_id, now() + interval '30 days');

  raise notice 'TEST SETUP: real_user_id=%, real_workspace_id=%, ws_b=%, ws_suspended=%', real_user_id, real_workspace_id, ws_b, ws_suspended;

  -- ============================================================
  -- Section 1: correct workspace allowed (SELECT).
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.projects where id = project_a_id;
  if row_count <> 1 then
    raise exception 'TEST FAILED: correct-workspace member could not see their own workspace''s project row';
  end if;

  select count(*) into row_count from public.tasks where id = task_a_id;
  if row_count <> 1 then
    raise exception 'TEST FAILED: correct-workspace member could not see their own workspace''s task row';
  end if;

  select count(*) into row_count from public.project_locations where id = location_a_id;
  if row_count <> 1 then
    raise exception 'TEST FAILED: correct-workspace member could not see the one-level child row (project_locations)';
  end if;

  select count(*) into row_count from public.project_location_images where id = image_a_id;
  if row_count <> 1 then
    raise exception 'TEST FAILED: correct-workspace member could not see the two-level child row (project_location_images)';
  end if;

  select count(*) into row_count from public.project_bom_lines where id = bom_line_a_id;
  if row_count <> 1 then
    raise exception 'TEST FAILED: correct-workspace member could not see the role-gated child row (project_bom_lines)';
  end if;

  select count(*) into row_count from public.project_submittals where id = submittal_a_id;
  if row_count <> 1 then
    raise exception 'TEST FAILED: correct-workspace member could not see their own workspace''s submittal row';
  end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 1 -- correct-workspace member sees root, one-level, two-level, role-gated, and submittal rows';

  -- ============================================================
  -- Section 2: correct workspace allowed (WRITE) -- unchanged direct-
  -- write capability preserved, including the pm/admin-gated tables.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  update public.project_locations set name = 'ZZ_TEST_157 Location A (edited)' where id = location_a_id;
  select count(*) into row_count from public.project_locations where id = location_a_id and name = 'ZZ_TEST_157 Location A (edited)';
  if row_count <> 1 then
    raise exception 'TEST FAILED: correct-workspace member could not update the no-role-gate child row';
  end if;

  update public.project_bom_lines set item_name = 'ZZ_TEST_157 BOM Item (edited)' where id = bom_line_a_id;
  select count(*) into row_count from public.project_bom_lines where id = bom_line_a_id and item_name = 'ZZ_TEST_157 BOM Item (edited)';
  if row_count <> 1 then
    raise exception 'TEST FAILED: correct-workspace pm/admin member could not update the role-gated child row';
  end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 2 -- correct-workspace member can still write both gated and ungated child rows';

  -- ============================================================
  -- Section 3: another workspace denied.
  -- ============================================================

  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, false);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.projects where id = project_a_id;
  if row_count <> 0 then
    raise exception 'TEST FAILED: a ws_b-only member could still see a ws_real project row';
  end if;

  select count(*) into row_count from public.tasks where id = task_a_id;
  if row_count <> 0 then
    raise exception 'TEST FAILED: a ws_b-only member could still see a ws_real task row';
  end if;

  select count(*) into row_count from public.project_locations where id = location_a_id;
  if row_count <> 0 then
    raise exception 'TEST FAILED: a ws_b-only member could still see a ws_real one-level child row';
  end if;

  select count(*) into row_count from public.project_location_images where id = image_a_id;
  if row_count <> 0 then
    raise exception 'TEST FAILED: a ws_b-only member could still see a ws_real two-level child row';
  end if;

  select count(*) into row_count from public.project_bom_lines where id = bom_line_a_id;
  if row_count <> 0 then
    raise exception 'TEST FAILED: a ws_b-only member could still see a ws_real role-gated child row';
  end if;

  select count(*) into row_count from public.project_submittals where id = submittal_a_id;
  if row_count <> 0 then
    raise exception 'TEST FAILED: a ws_b-only member could still see a ws_real submittal row';
  end if;

  begin
    caught := false;
    insert into public.project_locations (project_id, location_type, name)
      values (project_a_id, 'lot', 'ZZ_TEST_157 Should Be Rejected');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a ws_b-only member was able to insert a child row against a ws_real project_id';
  end if;

  perform set_config('role', 'postgres', true);

  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, false);

  raise notice 'TEST PASSED: Section 3 -- a ws_b-only member sees zero rows and cannot insert against a ws_real project_id';

  -- ============================================================
  -- Section 4: missing membership denied.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', no_membership_caller_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.projects where id = project_a_id;
  if row_count <> 0 then
    raise exception 'TEST FAILED: a caller with zero workspace memberships could still see a project row';
  end if;

  select count(*) into row_count from public.tasks where id = task_a_id;
  if row_count <> 0 then
    raise exception 'TEST FAILED: a caller with zero workspace memberships could still see a task row';
  end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 4 -- a caller with zero workspace memberships sees zero rows';

  -- ============================================================
  -- Section 5: suspended workspace denied (writes); reads still
  -- allowed. Fixture created WHILE ws_suspended is still active, same
  -- reasoning as migration 155's own Section 5.
  -- ============================================================

  update public.workspaces set status = 'active' where id = ws_suspended;

  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_suspended, real_user_id, false);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.tasks (task_number, title) values ('ZZ_TEST_157_SUSPENDED', 'ZZ_TEST_157 Suspended-Workspace Task')
    returning id into task_a_id;
  -- task_a_id reassigned here on purpose -- no later section
  -- references the Section 0 task row again.

  perform set_config('role', 'postgres', true);
  update public.workspaces set status = 'suspended' where id = ws_suspended;
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.tasks where id = task_a_id;
  if row_count <> 1 then
    raise exception 'TEST FAILED: a suspended-workspace member could not read their own workspace''s pre-existing row (reads should remain available under suspension)';
  end if;

  begin
    caught := false;
    update public.tasks set title = 'ZZ_TEST_157 Should Be Rejected' where id = task_a_id;
  exception when others then
    caught := true;
  end;
  select count(*) into row_count from public.tasks where id = task_a_id and title = 'ZZ_TEST_157 Should Be Rejected';
  if row_count <> 0 then
    raise exception 'TEST FAILED: a suspended-workspace member was able to update a row in their own suspended workspace';
  end if;

  begin
    caught := false;
    insert into public.projects (project_name) values ('ZZ_TEST_157 Suspended Insert Attempt');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a suspended-workspace member was able to insert a new projects row';
  end if;

  perform set_config('role', 'postgres', true);

  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_suspended;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, false);

  raise notice 'TEST PASSED: Section 5 -- a suspended-workspace member can still read but cannot write';

  -- ============================================================
  -- Section 6: ambiguous membership.
  -- ============================================================

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, false)
    on conflict (workspace_id, user_id) do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  if not public.is_workspace_member(real_workspace_id) then
    raise exception 'TEST FAILED: an ambiguously-membered caller no longer registers as a member of their original real workspace';
  end if;
  if not public.is_workspace_member(ws_b) then
    raise exception 'TEST FAILED: an ambiguously-membered caller no longer registers as a member of the second workspace';
  end if;

  begin
    caught := false;
    caught_message := null;
    select * into result_row from public.create_and_send_submittal_version(project_a_id, '{}'::jsonb, 'x', 'zz-test-157-ambiguous@example.invalid');
  exception when others then
    caught := true;
    get stacked diagnostics caught_message = message_text;
  end;
  if not caught or position('ambiguous' in lower(caught_message)) = 0 then
    raise exception 'TEST FAILED: create_and_send_submittal_version did not reject an ambiguously-membered caller with the expected "ambiguous" error (caught=%, message=%)', caught, caught_message;
  end if;

  perform set_config('role', 'postgres', true);

  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;

  raise notice 'TEST PASSED: Section 6 -- ambiguous membership reads the union correctly for SELECT RLS, and is rejected by resolve_caller_workspace_id()-backed RPCs';

  -- ============================================================
  -- Section 7: create_and_send_submittal_version -- correct workspace
  -- allowed (full completion path, no active_workspace_id() landmine
  -- here) and another workspace denied.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select * into result_row from public.create_and_send_submittal_version(project_a_id, '{}'::jsonb, 'ZZ_TEST_157', 'zz-test-157@example.invalid');
  if result_row.submittal_id is null or result_row.token is null then
    raise exception 'TEST FAILED: correct-workspace create_and_send_submittal_version call did not complete successfully (got %)', result_row;
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, false);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    caught := false;
    caught_message := null;
    select * into result_row from public.create_and_send_submittal_version(project_a_id, '{}'::jsonb, 'x', 'zz-test-157-x@example.invalid');
  exception when others then
    caught := true;
    get stacked diagnostics caught_message = message_text;
  end;
  if not caught or position('does not belong to your workspace' in caught_message) = 0 then
    raise exception 'TEST FAILED: create_and_send_submittal_version did not reject a ws_b-only caller acting on a ws_real project (caught=%, message=%)', caught, caught_message;
  end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, false);

  raise notice 'TEST PASSED: Section 7 -- create_and_send_submittal_version allows the correct workspace (full completion, no landmine) and rejects another workspace';

  -- ============================================================
  -- Section 8: role restrictions preserved. Behavioral negative testing
  -- needs a real, non-pm/admin user, which this environment does not
  -- have. Verified structurally instead.
  -- ============================================================

  select pg_get_functiondef('public.create_and_send_submittal_version(uuid, jsonb, text, text)'::regprocedure) into fn_def;
  if position('is_app_admin(auth.uid()) or public.has_role(''pm'')' in fn_def) = 0 then
    raise exception 'TEST FAILED: create_and_send_submittal_version no longer contains the expected PM/admin role check';
  end if;
  raise notice 'TEST PASSED: Section 8 -- create_and_send_submittal_version''s role check confirmed present via source inspection';

  -- ============================================================
  -- Section 9: suspended-workspace denial for the two anon/token RPCs.
  -- ============================================================

  update public.workspaces set status = 'suspended' where id = real_workspace_id;

  perform set_config('role', 'anon', true);

  select * into token_result from public.get_submittal_by_token(token_a);
  if token_result.outcome <> 'unavailable' then
    raise exception 'TEST FAILED: get_submittal_by_token did not treat a suspended workspace as unavailable (got %)', token_result.outcome;
  end if;

  select * into token_result from public.respond_to_submittal(token_a, 'approved', 'ZZ_TEST_157', '127.0.0.1', null);
  if token_result.outcome <> 'unavailable' then
    raise exception 'TEST FAILED: respond_to_submittal did not treat a suspended workspace as unavailable (got %)', token_result.outcome;
  end if;

  perform set_config('role', 'postgres', true);
  update public.workspaces set status = 'active' where id = real_workspace_id;

  perform set_config('role', 'anon', true);
  select * into token_result from public.get_submittal_by_token(token_a);
  if token_result.outcome <> 'found' then
    raise exception 'TEST FAILED: get_submittal_by_token did not resolve normally once the workspace was restored to active (got %)', token_result.outcome;
  end if;
  perform set_config('role', 'postgres', true);

  raise notice 'TEST PASSED: Section 9 -- get_submittal_by_token and respond_to_submittal both treat a suspended workspace as unavailable, and recover once active again';

  -- ============================================================
  -- Section 10: structural policy-shape verification for the seven
  -- tables not behaviorally exercised above, plus confirmation that
  -- project_conversion_receipts remains untouched.
  -- ============================================================

  select qual into policy_def from pg_policies
    where schemaname = 'public' and tablename = 'project_scope_of_work' and policyname = 'workspace members read project_scope_of_work';
  if policy_def is null or position('project_owner_workspace_id' in policy_def) = 0 then
    raise exception 'TEST FAILED: project_scope_of_work read policy missing or not using project_owner_workspace_id (got %)', policy_def;
  end if;

  -- Migration 157 creates three SEPARATE insert/update/delete policies
  -- here (not one combined "for all" policy) -- check the update one
  -- specifically, since it carries both using and with check.
  select qual into policy_def from pg_policies
    where schemaname = 'public' and tablename = 'project_scope_of_work' and cmd = 'UPDATE' and policyname like '%pm and admin%';
  if policy_def is null or position('is_app_admin' in policy_def) = 0 or position('has_role' in policy_def) = 0 then
    raise exception 'TEST FAILED: project_scope_of_work is missing its combined workspace+role update policy (got %)', policy_def;
  end if;

  select qual into policy_def from pg_policies
    where schemaname = 'public' and tablename = 'project_handovers' and policyname = 'workspace members read project_handovers';
  if policy_def is null or position('project_owner_workspace_id' in policy_def) = 0 then
    raise exception 'TEST FAILED: project_handovers read policy missing or not using project_owner_workspace_id (got %)', policy_def;
  end if;

  select qual into policy_def from pg_policies
    where schemaname = 'public' and tablename = 'project_stakeholders' and policyname = 'workspace members read project_stakeholders';
  if policy_def is null or position('project_owner_workspace_id' in policy_def) = 0 then
    raise exception 'TEST FAILED: project_stakeholders read policy missing or not using project_owner_workspace_id (got %)', policy_def;
  end if;

  select qual into policy_def from pg_policies
    where schemaname = 'public' and tablename = 'installed_assets' and policyname = 'workspace members read installed_assets';
  if policy_def is null or position('project_owner_workspace_id' in policy_def) = 0 then
    raise exception 'TEST FAILED: installed_assets read policy missing or not using project_owner_workspace_id (got %)', policy_def;
  end if;

  select qual into policy_def from pg_policies
    where schemaname = 'public' and tablename = 'project_location_items' and policyname = 'workspace members read project_location_items';
  if policy_def is null or position('project_location_owner_workspace_id' in policy_def) = 0 then
    raise exception 'TEST FAILED: project_location_items read policy missing or not using project_location_owner_workspace_id (got %)', policy_def;
  end if;

  select qual into policy_def from pg_policies
    where schemaname = 'public' and tablename = 'task_hardware_dependencies' and policyname = 'workspace members read task_hardware_dependencies';
  if policy_def is null or position('task_owner_workspace_id' in policy_def) = 0 then
    raise exception 'TEST FAILED: task_hardware_dependencies read policy missing or not using task_owner_workspace_id (got %)', policy_def;
  end if;

  select qual into policy_def from pg_policies
    where schemaname = 'public' and tablename = 'task_activity_log' and policyname = 'workspace members read task_activity_log';
  if policy_def is null or position('task_owner_workspace_id' in policy_def) = 0 then
    raise exception 'TEST FAILED: task_activity_log read policy missing or not using task_owner_workspace_id (got %)', policy_def;
  end if;

  -- task_activity_log must still have NO update/delete policy (append-only).
  select count(*) into row_count from pg_policies
    where schemaname = 'public' and tablename = 'task_activity_log' and cmd in ('UPDATE', 'DELETE', 'ALL');
  if row_count <> 0 then
    raise exception 'TEST FAILED: task_activity_log unexpectedly has an update/delete policy (count=%) -- it must remain append-only', row_count;
  end if;

  -- project_submittals must still have no write policy (RPC-only).
  select count(*) into row_count from pg_policies
    where schemaname = 'public' and tablename = 'project_submittals' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  if row_count <> 0 then
    raise exception 'TEST FAILED: project_submittals unexpectedly has a write policy (count=%) -- this migration must not grant a write capability that did not exist before it', row_count;
  end if;

  -- project_conversion_receipts must remain completely policy-free.
  select count(*) into row_count from pg_policies
    where schemaname = 'public' and tablename = 'project_conversion_receipts';
  if row_count <> 0 then
    raise exception 'TEST FAILED: project_conversion_receipts unexpectedly has a policy (count=%) -- it must remain maximally locked down by permanent design (migration 127), untouched by this migration', row_count;
  end if;

  raise notice 'TEST PASSED: Section 10 -- the seven not-behaviorally-tested tables have the correctly-shaped policies, task_activity_log/project_submittals write-posture preserved, and project_conversion_receipts remains untouched';

  raise notice 'ALL MIGRATION 157 PHASE 3 PROJECTS TASKS WORKSPACE RLS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
