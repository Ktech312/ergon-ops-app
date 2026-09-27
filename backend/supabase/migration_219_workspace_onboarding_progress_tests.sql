-- Transaction-safe canonical test for migration 219 (workspace_onboarding_
-- progress + set_onboarding_step_status()). Wrapped in begin;/rollback; --
-- nothing here ever commits. Two fully synthetic workspaces so cross-
-- workspace isolation can be proven directly rather than assumed.
--
-- Covers:
-- (a) Default behavior: with no row at all, a step's status is simply
--     absent (the frontend treats "no row" as pending -- this is the same
--     opt-out shape as migration 218's workspace_enabled_modules).
-- (b) An ordinary (non-admin) workspace member cannot call
--     set_onboarding_step_status for their own workspace.
-- (c) A workspace admin can mark a step done; the row records the right
--     status and actor.
-- (d) An invalid status value is rejected.
-- (e) Re-marking the SAME step (done -> skipped -> done again) updates
--     the same row in place (upsert), not a duplicate.
-- (f) Workspace isolation -- workspace A's progress has zero effect on
--     workspace B's, and a different workspace's member cannot read
--     workspace A's rows.
-- (g) A real global app_admin who is only an ordinary (non-admin-flagged)
--     member of a workspace can still update that workspace's onboarding
--     progress -- the is_app_admin() bypass.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 219 WORKSPACE ONBOARDING
-- PROGRESS TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  ws_a_id uuid;
  ws_b_id uuid;
  admin_a_id uuid := gen_random_uuid();
  member_a_id uuid := gen_random_uuid();
  global_admin_member_a_id uuid := gen_random_uuid();
  admin_b_id uuid := gen_random_uuid();
  member_b_id uuid := gen_random_uuid();
  row_count integer;
  caught boolean;
begin
  -- ============================================================
  -- Setup
  -- ============================================================

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (name, slug, status) values ('ZZ Test 219 Workspace A', 'zz-test-219-ws-a', 'active') returning id into ws_a_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 219 Workspace B', 'zz-test-219-ws-b', 'active') returning id into ws_b_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (admin_a_id, 'zz-test-219-admin-a@example.com', now()),
    (member_a_id, 'zz-test-219-member-a@example.com', now()),
    (global_admin_member_a_id, 'zz-test-219-global-admin-member-a@example.com', now()),
    (admin_b_id, 'zz-test-219-admin-b@example.com', now()),
    (member_b_id, 'zz-test-219-member-b@example.com', now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (ws_a_id, admin_a_id, true),
    (ws_a_id, member_a_id, false),
    (ws_a_id, global_admin_member_a_id, false),
    (ws_b_id, admin_b_id, true),
    (ws_b_id, member_b_id, false);

  insert into public.app_admins (user_id) values (global_admin_member_a_id);

  -- ============================================================
  -- Section (a): default -- no row at all means "not done yet".
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.workspace_onboarding_progress where workspace_id = ws_a_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a brand-new workspace already has onboarding progress rows before anything was marked';
  end if;

  raise notice 'TEST PASSED: Section (a) -- a brand-new workspace has no onboarding progress rows at all, treated as not-yet-done by the frontend';

  -- ============================================================
  -- Section (b): an ordinary member cannot update onboarding progress.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.set_onboarding_step_status('company_branding', 'done');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an ordinary workspace member could update onboarding progress';
  end if;

  raise notice 'TEST PASSED: Section (b) -- an ordinary member cannot call set_onboarding_step_status';

  -- ============================================================
  -- Section (c): a workspace admin can mark a step done.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.set_onboarding_step_status('company_branding', 'done');

  select count(*) into row_count from public.workspace_onboarding_progress
    where workspace_id = ws_a_id and step_key = 'company_branding' and status = 'done' and updated_by = admin_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: marking a step done did not record the right status and actor';
  end if;

  raise notice 'TEST PASSED: Section (c) -- a workspace admin can mark a step done, recorded with the right status and actor';

  -- ============================================================
  -- Section (d): an invalid status value is rejected.
  -- ============================================================

  caught := false;
  begin
    perform public.set_onboarding_step_status('company_branding', 'not_a_real_status');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an invalid status value was accepted';
  end if;

  raise notice 'TEST PASSED: Section (d) -- an invalid status value is rejected';

  -- ============================================================
  -- Section (e): re-marking the same step upserts in place, not a
  -- duplicate row.
  -- ============================================================

  perform public.set_onboarding_step_status('company_branding', 'skipped');
  perform public.set_onboarding_step_status('company_branding', 'done');

  select count(*) into row_count from public.workspace_onboarding_progress
    where workspace_id = ws_a_id and step_key = 'company_branding';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: re-marking the same step created a duplicate row instead of updating in place (% rows)', row_count;
  end if;

  select count(*) into row_count from public.workspace_onboarding_progress
    where workspace_id = ws_a_id and step_key = 'company_branding' and status = 'done';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: re-marking the same step did not end at the latest status';
  end if;

  raise notice 'TEST PASSED: Section (e) -- re-marking the same step updates the same row in place';

  -- ============================================================
  -- Section (f): workspace isolation.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_b_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.workspace_onboarding_progress where workspace_id = ws_a_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: workspace B''s admin could read workspace A''s onboarding progress';
  end if;

  perform public.set_onboarding_step_status('company_branding', 'done');

  select count(*) into row_count from public.workspace_onboarding_progress where workspace_id = ws_b_id and step_key = 'company_branding';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: workspace B''s own onboarding progress write did not take effect';
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_onboarding_progress where workspace_id = ws_a_id and step_key = 'company_branding' and status = 'done';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: workspace B''s write incorrectly affected workspace A''s own progress';
  end if;

  raise notice 'TEST PASSED: Section (f) -- a workspace''s onboarding progress is fully independent of any other workspace''s';

  -- ============================================================
  -- Section (g): a real global app_admin who is only an ordinary member
  -- of workspace A can still update its onboarding progress.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', global_admin_member_a_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.set_onboarding_step_status('team_invited', 'done');

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_onboarding_progress
    where workspace_id = ws_a_id and step_key = 'team_invited' and status = 'done' and updated_by = global_admin_member_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a global app_admin who is only an ordinary workspace member could not update that workspace''s onboarding progress';
  end if;

  raise notice 'TEST PASSED: Section (g) -- a global app_admin can act on a workspace they belong to even without the workspace-admin flag';

  raise notice 'ALL MIGRATION 219 WORKSPACE ONBOARDING PROGRESS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
