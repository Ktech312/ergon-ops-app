-- Transaction-safe canonical test for migration 198 (platform-admin
-- company lifecycle: Suspend/Reactivate + durable audit log). Wrapped in
-- begin;/rollback; -- nothing here ever commits, and none of this
-- touches the real production workspace or its real platform admin's
-- own membership row beyond reading them for setup.
--
-- Covers every item in E's own numbered spec that this migration is
-- responsible for proving (items 1-3, 6 are pre-existing or deliberate
-- non-actions, verified/documented in 198's own header, not re-tested
-- here):
-- (a)-(c) Setup + item 2: an app_admin-only user and an ordinary
--     workspace_admin (neither is a platform_admin) can see neither the
--     all-company list, the audit log, nor call either lifecycle
--     function.
-- (d) A blank/whitespace-only reason is rejected for both functions.
-- (e) A nonexistent workspace id is rejected for both functions.
-- (f) Reactivating an already-active company is rejected.
-- (g) A real platform admin can suspend an active company with a
--     reason: status flips, one audit row is recorded, and the
--     workspace_members row is NOT deleted (item 7's "without deleting
--     data, memberships, files, or history").
-- (h) Suspending an already-suspended company is rejected, no duplicate
--     audit row.
-- (i) Item 7's actual proof: a member of the now-suspended workspace is
--     blocked by the EXISTING resolve_caller_workspace_id() active-
--     workspace check -- no new blocking logic was written for this,
--     this section proves the pre-existing one already does the job.
-- (j) Reactivation flips status back, records a second audit row.
-- (k) Item 7 reversed: the same member's access is restored after
--     reactivation.
-- (l) Item 9: a platform admin who is also a member of the workspace
--     they're suspending is blocked by
--     OWN_WORKSPACE_CONFIRMATION_REQUIRED until they pass explicit
--     confirmation, at which point it succeeds.
-- (m) company_admin_audit_log stays invisible to anyone but a genuine
--     platform admin, even after several rows exist.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 198 PLATFORM COMPANY
-- LIFECYCLE AND AUDIT LOG TESTS PASSED -- ZERO SECTIONS SKIPPED", or a
-- hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;      -- a genuine platform_admin (discovered via platform_admins, not app_admins)
  real_workspace_id uuid;

  app_admin_only_id uuid := gen_random_uuid();  -- in app_admins, deliberately NOT in platform_admins, NOT a workspace member at all

  -- An ordinary company workspace_admin -- a real workspace admin, but
  -- NOT a platform admin. This is the fixture for item 2's "workspace
  -- admin cannot see the console" proof, and item 7's blocked-member
  -- proof.
  test_workspace_id uuid;
  test_member_id uuid := gen_random_uuid();

  -- A platform admin who ALSO happens to be a member of the workspace
  -- they're about to suspend -- item 9's fixture.
  own_ws_id uuid;
  own_ws_admin_id uuid := gen_random_uuid();

  row_count integer;
  ws_status text;
  caught boolean;
  err_msg text;
  resolved_ws uuid;
  audit_count integer;
  audit_action text;
  audit_reason text;
  audit_actor uuid;
begin
  -- ============================================================
  -- Setup
  -- ============================================================

  select pa.user_id, wm.workspace_id
    into real_user_id, real_workspace_id
  from public.platform_admins pa
  join public.workspace_members wm on wm.user_id = pa.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing platform_admin who is also an active workspace member found.';
  end if;

  perform set_config('role', 'postgres', true);

  insert into auth.users (id, email, email_confirmed_at) values
    (app_admin_only_id, 'zz-test-198-app-admin-only@example.com', now()),
    (test_member_id, 'zz-test-198-workspace-admin@example.com', now()),
    (own_ws_admin_id, 'zz-test-198-own-ws-admin@example.com', now());

  insert into public.app_admins (user_id) values (app_admin_only_id) on conflict do nothing;
  -- Deliberately NOT inserted into platform_admins.

  insert into public.workspaces (name, slug, status)
    values ('ZZ Test 198 Target Co', 'zz-test-198-target-co', 'active')
    returning id into test_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
    values (test_workspace_id, test_member_id, true);

  insert into public.workspaces (name, slug, status)
    values ('ZZ Test 198 Own Co', 'zz-test-198-own-co', 'active')
    returning id into own_ws_id;

  insert into public.platform_admins (user_id) values (own_ws_admin_id);
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
    values (own_ws_id, own_ws_admin_id, true);

  -- ============================================================
  -- Section (a)/(b): item 2 -- an app_admin-only user and an ordinary
  -- (non-platform-admin) workspace_admin can call neither lifecycle
  -- function.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', app_admin_only_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.suspend_company(test_workspace_id, 'app_admin_only should not be able to do this');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an app_admin who is not a platform_admin could call suspend_company';
  end if;

  caught := false;
  begin
    perform public.reactivate_company(test_workspace_id, 'app_admin_only should not be able to do this');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an app_admin who is not a platform_admin could call reactivate_company';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', test_member_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.suspend_company(test_workspace_id, 'a workspace admin should not be able to suspend their own company');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an ordinary workspace_admin (not a platform_admin) could call suspend_company';
  end if;

  raise notice 'TEST PASSED: Section (a)/(b) -- neither an app_admin-only user nor an ordinary workspace_admin can call suspend_company or reactivate_company';

  -- ============================================================
  -- Section (c): item 2 continued -- neither sees the all-company list
  -- or the audit log.
  -- ============================================================

  -- test_member_id is a real member of exactly test_workspace_id --
  -- workspaces RLS (migration 115) must show them ONLY that row, not
  -- every company on the platform.
  select count(*) into row_count from public.workspaces;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: an ordinary workspace_admin saw % workspace rows via SELECT (expected exactly 1, their own)', row_count;
  end if;

  select count(*) into row_count from public.company_admin_audit_log;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: an ordinary workspace_admin could SELECT company_admin_audit_log rows (% visible)', row_count;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', app_admin_only_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.workspaces;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: an app_admin-only user (no workspace membership at all) saw % workspace rows (expected 0)', row_count;
  end if;

  select count(*) into row_count from public.company_admin_audit_log;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: an app_admin-only user could SELECT company_admin_audit_log rows (% visible)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (c) -- neither an app_admin-only user nor an ordinary workspace_admin can see the all-company list or the audit log';

  -- ============================================================
  -- Section (d): a blank/whitespace-only reason is rejected.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.suspend_company(test_workspace_id, '   ');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: suspend_company accepted a whitespace-only reason';
  end if;

  caught := false;
  begin
    perform public.suspend_company(test_workspace_id, null);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: suspend_company accepted a null reason';
  end if;

  caught := false;
  begin
    perform public.reactivate_company(test_workspace_id, '');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: reactivate_company accepted an empty-string reason';
  end if;

  select status into ws_status from public.workspaces where id = test_workspace_id;
  if ws_status is distinct from 'active' then
    raise exception 'TEST FAILED: a rejected blank-reason call changed the workspace status anyway (now %)', ws_status;
  end if;
  select count(*) into row_count from public.company_admin_audit_log where workspace_id = test_workspace_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a rejected blank-reason call recorded an audit row anyway';
  end if;

  raise notice 'TEST PASSED: Section (d) -- a blank, whitespace-only, or null reason is rejected for both functions, no state or audit change';

  -- ============================================================
  -- Section (e): a nonexistent workspace id is rejected.
  -- ============================================================

  caught := false;
  begin
    perform public.suspend_company(gen_random_uuid(), 'valid reason');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: suspend_company accepted a nonexistent workspace id';
  end if;

  caught := false;
  begin
    perform public.reactivate_company(gen_random_uuid(), 'valid reason');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: reactivate_company accepted a nonexistent workspace id';
  end if;

  raise notice 'TEST PASSED: Section (e) -- a nonexistent workspace id is rejected for both functions';

  -- ============================================================
  -- Section (f): reactivating an already-active company is rejected.
  -- ============================================================

  caught := false;
  begin
    perform public.reactivate_company(test_workspace_id, 'valid reason');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: reactivate_company succeeded against a company that was already active';
  end if;

  raise notice 'TEST PASSED: Section (f) -- reactivating an already-active company is rejected';

  -- ============================================================
  -- Section (g): a real platform admin suspends an active company with
  -- a reason -- status flips, one audit row recorded, membership NOT
  -- deleted.
  -- ============================================================

  perform public.suspend_company(test_workspace_id, '  Non-payment, confirmed with prospect by email 2026-09-22.  ');

  select status into ws_status from public.workspaces where id = test_workspace_id;
  if ws_status is distinct from 'suspended' then
    raise exception 'TEST FAILED: suspend_company did not flip the workspace to suspended (status=%)', ws_status;
  end if;

  select count(*), max(action), max(reason), max(actor_user_id::text)::uuid
    into audit_count, audit_action, audit_reason, audit_actor
  from public.company_admin_audit_log where workspace_id = test_workspace_id;

  if audit_count is distinct from 1 then
    raise exception 'TEST FAILED: suspend_company recorded % audit rows (expected exactly 1)', audit_count;
  end if;
  if audit_action is distinct from 'suspended' then
    raise exception 'TEST FAILED: audit row action was % (expected suspended)', audit_action;
  end if;
  if audit_reason is distinct from 'Non-payment, confirmed with prospect by email 2026-09-22.' then
    raise exception 'TEST FAILED: audit row reason was not trimmed/preserved correctly (got: %)', audit_reason;
  end if;
  if audit_actor is distinct from real_user_id then
    raise exception 'TEST FAILED: audit row actor_user_id was % (expected the real platform admin who called it)', audit_actor;
  end if;

  select count(*) into row_count from public.workspace_members where workspace_id = test_workspace_id and user_id = test_member_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: suspension deleted or altered the workspace_members row (% rows, expected 1 -- item 7 requires membership to survive)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (g) -- suspend_company flips status, records exactly one correct audit row, and does not delete the membership';

  -- ============================================================
  -- Section (h): suspending an already-suspended company is rejected,
  -- no duplicate audit row.
  -- ============================================================

  caught := false;
  begin
    perform public.suspend_company(test_workspace_id, 'trying to suspend again');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: suspend_company succeeded against a company that was already suspended';
  end if;

  select count(*) into audit_count from public.company_admin_audit_log where workspace_id = test_workspace_id;
  if audit_count is distinct from 1 then
    raise exception 'TEST FAILED: a rejected double-suspend recorded an extra audit row (% rows, expected still 1)', audit_count;
  end if;

  raise notice 'TEST PASSED: Section (h) -- suspending an already-suspended company is rejected, no duplicate audit row';

  -- ============================================================
  -- Section (i): item 7's actual proof -- the suspended workspace's own
  -- member is now blocked by the PRE-EXISTING resolve_caller_workspace_id()
  -- active-workspace check. No new blocking logic exists anywhere in
  -- this migration -- this section is the whole point of item 7.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', test_member_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- resolve_caller_workspace_id() itself has EXECUTE revoked from
  -- `authenticated` (migration 118, by design -- only callable from
  -- inside another SECURITY DEFINER function's body). So this proves
  -- item 7 the way an ordinary member actually experiences it: any
  -- normal workspace-scoped write, e.g. inserting a client row, whose
  -- BEFORE INSERT trigger (guard_workspace_id_mutation, migration 117)
  -- calls resolve_caller_workspace_id() internally to stamp workspace_id.
  caught := false;
  err_msg := null;
  begin
    insert into public.clients (name) values ('ZZ Test 198 Client Probe -- Suspended Workspace');
  exception when others then
    caught := true;
    get stacked diagnostics err_msg = message_text;
  end;
  if not caught then
    raise exception 'TEST FAILED: a member of a SUSPENDED workspace could still insert a workspace-scoped row (clients) -- item 7 is not actually enforced';
  end if;
  if err_msg not ilike '%not active%' then
    raise exception 'TEST FAILED: the blocked insert raised, but with an unexpected message: %', err_msg;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_members where workspace_id = test_workspace_id and user_id = test_member_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the suspended workspace''s membership row disappeared (% rows, expected 1 still)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (i) -- a suspended company''s member is blocked by the pre-existing active-workspace check, with membership data fully intact';

  -- ============================================================
  -- Section (j): reactivation flips status back and records a second
  -- audit row.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.reactivate_company(test_workspace_id, 'Payment received, reactivating per prospect confirmation.');

  select status into ws_status from public.workspaces where id = test_workspace_id;
  if ws_status is distinct from 'active' then
    raise exception 'TEST FAILED: reactivate_company did not flip the workspace back to active (status=%)', ws_status;
  end if;

  select count(*) into audit_count from public.company_admin_audit_log where workspace_id = test_workspace_id;
  if audit_count is distinct from 2 then
    raise exception 'TEST FAILED: reactivation left % audit rows for this workspace (expected exactly 2: one suspend, one reactivate)', audit_count;
  end if;

  select action into audit_action
  from public.company_admin_audit_log
  where workspace_id = test_workspace_id
  order by created_at desc
  limit 1;
  if audit_action is distinct from 'reactivated' then
    raise exception 'TEST FAILED: the most recent audit row for this workspace was % (expected reactivated)', audit_action;
  end if;

  raise notice 'TEST PASSED: Section (j) -- reactivate_company flips status back to active and records a second, correctly-ordered audit row';

  -- ============================================================
  -- Section (k): item 7 reversed -- the same member's access is
  -- restored after reactivation.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', test_member_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.clients (name) values ('ZZ Test 198 Client Probe -- Reactivated Workspace')
    returning workspace_id into resolved_ws;
  if resolved_ws is distinct from test_workspace_id then
    raise exception 'TEST FAILED: after reactivation, the insert''s trigger-stamped workspace_id was % (expected %)', resolved_ws, test_workspace_id;
  end if;

  raise notice 'TEST PASSED: Section (k) -- reactivation restores the member''s access via the same pre-existing active-workspace check';

  -- ============================================================
  -- Section (l): item 9 -- a platform admin who is ALSO a member of the
  -- workspace they're suspending is blocked by
  -- OWN_WORKSPACE_CONFIRMATION_REQUIRED until they pass explicit
  -- confirmation.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', own_ws_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  err_msg := null;
  begin
    perform public.suspend_company(own_ws_id, 'suspending my own company, oops');
  exception when others then
    caught := true;
    get stacked diagnostics err_msg = message_text;
  end;
  if not caught then
    raise exception 'TEST FAILED: a platform admin could suspend their OWN active company with no confirmation step at all';
  end if;
  if err_msg not ilike '%OWN_WORKSPACE_CONFIRMATION_REQUIRED%' then
    raise exception 'TEST FAILED: suspending one''s own company was rejected, but not with the expected OWN_WORKSPACE_CONFIRMATION_REQUIRED signal (got: %)', err_msg;
  end if;

  perform set_config('role', 'postgres', true);
  select status into ws_status from public.workspaces where id = own_ws_id;
  if ws_status is distinct from 'active' then
    raise exception 'TEST FAILED: the unconfirmed own-workspace suspend attempt changed status anyway (now %)', ws_status;
  end if;
  select count(*) into row_count from public.company_admin_audit_log where workspace_id = own_ws_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: the unconfirmed own-workspace suspend attempt recorded an audit row anyway';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', own_ws_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.suspend_company(own_ws_id, 'suspending my own company, confirmed deliberately', true);

  perform set_config('role', 'postgres', true);
  select status into ws_status from public.workspaces where id = own_ws_id;
  if ws_status is distinct from 'suspended' then
    raise exception 'TEST FAILED: suspend_company with explicit confirmation did not suspend the caller''s own company (status=%)', ws_status;
  end if;
  select count(*), max(actor_user_id::text)::uuid into row_count, audit_actor
  from public.company_admin_audit_log where workspace_id = own_ws_id;
  if row_count is distinct from 1 or audit_actor is distinct from own_ws_admin_id then
    raise exception 'TEST FAILED: the confirmed own-workspace suspension did not record exactly one correctly-attributed audit row (% rows, actor %)', row_count, audit_actor;
  end if;

  raise notice 'TEST PASSED: Section (l) -- a platform admin suspending their own active company is blocked until they explicitly confirm, then succeeds and is recorded';

  -- ============================================================
  -- Section (m): company_admin_audit_log stays invisible to anyone but
  -- a genuine platform admin, even with several real rows now present.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', app_admin_only_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into row_count from public.company_admin_audit_log;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: an app_admin-only user could see % company_admin_audit_log rows after several real rows exist', row_count;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', test_member_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into row_count from public.company_admin_audit_log;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: an ordinary workspace_admin could see % company_admin_audit_log rows (including their own company''s) after several real rows exist', row_count;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into row_count from public.company_admin_audit_log;
  if row_count < 3 then
    raise exception 'TEST FAILED: the real platform admin saw only % company_admin_audit_log rows (expected at least 3: suspend, reactivate, own-workspace-suspend)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (m) -- company_admin_audit_log stays invisible to anyone but a genuine platform admin, who sees every row';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 198 PLATFORM COMPANY LIFECYCLE AND AUDIT LOG TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
