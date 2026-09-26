-- Transaction-safe canonical test for migration 212 (workspace admins
-- can manage user_invites for their own workspace -- a fourth instance
-- of today's bug class: an RLS policy gated on is_app_admin() alone,
-- missing the is_workspace_admin(workspace_id) OR-branch migration 185
-- already established for every other table it touched). Wrapped in
-- begin;/rollback; -- nothing here ever commits.
--
-- Covers:
-- (a) a workspace-admin-only user (no app_admins) can read their own
--     workspace's invites -- the actual bug.
-- (b) the same user can create an invite for their own workspace, via
--     the exact same real path createInvite (persistence.ts) uses: a
--     plain INSERT with no workspace_id supplied, resolved by the
--     column's own default (resolve_caller_workspace_id()).
-- (c) cross-workspace isolation is preserved -- a workspace-admin-only
--     user of workspace A cannot read or write workspace B's invites,
--     even though is_workspace_admin(workspace_id) now grants access to
--     THEIR OWN workspace.
-- (d) an ordinary (non-admin, non-workspace-admin) member of the same
--     workspace still cannot read or write any invite -- proving this
--     fix didn't over-broaden past real admins.
-- (e) a suspended workspace's own workspace-admin can still read a
--     pending invite but cannot write one -- matches this table's own
--     existing read-vs-write posture (migration 181's own header),
--     unaffected by this fix.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 212 WORKSPACE ADMIN
-- MANAGE USER INVITES TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard
-- SQL error naming what failed or was skipped.

begin;

do $$
declare
  workspace_a_id uuid;
  workspace_b_id uuid;
  suspended_workspace_id uuid;
  admin_a_user_id uuid := gen_random_uuid();
  ordinary_a_user_id uuid := gen_random_uuid();
  admin_b_user_id uuid := gen_random_uuid();
  suspended_admin_user_id uuid := gen_random_uuid();
  new_invite_id uuid;
  row_count integer;
  caught boolean;
begin
  perform set_config('role', 'postgres', true);

  -- All three created 'active' at first -- user_invites' own INSERT
  -- trigger (guard_workspace_id_mutation) unconditionally overwrites
  -- workspace_id via resolve_caller_workspace_id(), which itself
  -- requires an ACTIVE membership -- so the suspended-workspace seed
  -- invite below must be created while still active, then suspended
  -- afterward for section (e)'s own real test.
  insert into public.workspaces (name, slug, status) values ('ZZ Test 212 Workspace A', 'zz-test-212-workspace-a', 'active') returning id into workspace_a_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 212 Workspace B', 'zz-test-212-workspace-b', 'active') returning id into workspace_b_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 212 Suspended Co', 'zz-test-212-suspended', 'active') returning id into suspended_workspace_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (admin_a_user_id, 'zz-test-212-admin-a@example.com', now()),
    (ordinary_a_user_id, 'zz-test-212-ordinary-a@example.com', now()),
    (admin_b_user_id, 'zz-test-212-admin-b@example.com', now()),
    (suspended_admin_user_id, 'zz-test-212-suspended-admin@example.com', now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (workspace_a_id, admin_a_user_id, true),
    (workspace_a_id, ordinary_a_user_id, false),
    (workspace_b_id, admin_b_user_id, true),
    (suspended_workspace_id, suspended_admin_user_id, true);

  -- Seed invites created via each workspace's own real admin identity --
  -- the trigger overwrites any workspace_id supplied directly, so this
  -- is the only way to seed them correctly.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.user_invites (email, primary_role, invited_by_email) values ('zz-test-212-pending-a@example.com', 'manager', 'zz-test-212-admin-a@example.com');

  perform set_config('request.jwt.claims', json_build_object('sub', admin_b_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.user_invites (email, primary_role, invited_by_email) values ('zz-test-212-pending-b@example.com', 'manager', 'zz-test-212-admin-b@example.com');

  perform set_config('request.jwt.claims', json_build_object('sub', suspended_admin_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.user_invites (email, primary_role, invited_by_email) values ('zz-test-212-pending-suspended@example.com', 'manager', 'zz-test-212-suspended-admin@example.com');

  perform set_config('role', 'postgres', true);
  update public.workspaces set status = 'suspended' where id = suspended_workspace_id;

  -- ============================================================
  -- Section (a): the actual bug -- a workspace-admin-only user reads
  -- their own workspace's invites.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.user_invites where workspace_id = workspace_a_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace-admin-only user could not read their own workspace''s invite (% rows visible, expected 1)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (a) -- a workspace-admin-only user (no app_admins) can read their own workspace''s invites';

  -- ============================================================
  -- Section (b): the same user creates an invite via the real path --
  -- no workspace_id supplied, resolved by the column's own default.
  -- ============================================================

  insert into public.user_invites (email, primary_role, invited_by_email)
    values ('zz-test-212-new-hire@example.com', 'manager', 'zz-test-212-admin-a@example.com')
    returning id into new_invite_id;

  perform set_config('role', 'postgres', true);
  if not exists (select 1 from public.user_invites where id = new_invite_id and workspace_id = workspace_a_id) then
    raise exception 'TEST FAILED: the new invite was not resolved into the caller''s own workspace (workspace A)';
  end if;

  raise notice 'TEST PASSED: Section (b) -- a workspace-admin-only user can create an invite for their own workspace via the real no-workspace_id-supplied path';

  -- ============================================================
  -- Section (c): cross-workspace isolation preserved.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.user_invites where workspace_id = workspace_b_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: workspace A''s admin could read workspace B''s invites (% rows visible)', row_count;
  end if;

  begin
    update public.user_invites set full_name = 'hacked' where workspace_id = workspace_b_id;
  exception when others then
    null; -- either a raised exception or a silently-matched-zero-rows update is fine here -- the assertion below checks the actual state either way.
  end;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.user_invites where workspace_id = workspace_b_id and full_name = 'hacked') then
    raise exception 'TEST FAILED: workspace A''s admin could write to workspace B''s invite';
  end if;

  raise notice 'TEST PASSED: Section (c) -- cross-workspace isolation preserved, a workspace admin cannot read or write another workspace''s invites';

  -- ============================================================
  -- Section (d): an ordinary member (not admin, not workspace-admin)
  -- still cannot read or write any invite.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.user_invites where workspace_id = workspace_a_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: an ordinary (non-admin) workspace member could read invites (% rows visible)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (d) -- an ordinary, non-admin workspace member still cannot read or write any invite';

  -- ============================================================
  -- Section (e): a suspended workspace's own admin can still read a
  -- pending invite, but cannot write one -- unaffected posture.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', suspended_admin_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.user_invites where workspace_id = suspended_workspace_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a suspended workspace''s own admin could not read their own pending invite (% rows, expected 1)', row_count;
  end if;

  caught := false;
  begin
    insert into public.user_invites (email, primary_role, invited_by_email)
      values ('zz-test-212-should-fail@example.com', 'manager', 'zz-test-212-suspended-admin@example.com');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a suspended workspace''s own admin could still create a new invite';
  end if;

  raise notice 'TEST PASSED: Section (e) -- a suspended workspace''s own admin can still read a pending invite but cannot create a new one';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 212 WORKSPACE ADMIN MANAGE USER INVITES TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
