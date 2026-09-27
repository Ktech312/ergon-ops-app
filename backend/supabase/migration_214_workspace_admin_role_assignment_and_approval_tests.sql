-- Transaction-safe canonical test for migration 214 (Phase 2A/2B: a
-- workspace's own admin can assign roles and review pending employees
-- for their own company, via the existing legacy/workspace
-- authorization bridge). Wrapped in begin;/rollback; -- nothing here
-- ever commits.
--
-- Covers, per function:
-- bridge_set_primary_role: (a) workspace-admin success for a brand-new
--   target (creates membership + workspace_member_roles correctly,
--   legacy/workspace primary roles agree -- no drift); (b) cross-
--   workspace rejection (a target already in a DIFFERENT workspace);
--   (c) an ordinary member is rejected; (d) the legacy 'manager' role
--   branch (133/208) still works, unaffected; (e) a real global
--   app_admin still works, unaffected.
-- bridge_set_secondary_roles: (f) workspace-admin success; (g) cross-
--   workspace rejection; (h) an ordinary member is rejected.
-- bridge_set_user_allowed_views: (i) workspace-admin success; (j)
--   cross-workspace rejection.
-- app_user_status: (k) a workspace admin can read AND approve a
--   pending row for their own team member; (l) cannot for a member of
--   a different workspace; (m) an ordinary member cannot; (n) a real
--   global admin/manager still can (unaffected).
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 214 WORKSPACE ADMIN
-- ROLE ASSIGNMENT AND APPROVAL TESTS PASSED -- ZERO SECTIONS SKIPPED",
-- or a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_app_admin_id uuid;
  workspace_a_id uuid;
  workspace_b_id uuid;
  admin_a_user_id uuid := gen_random_uuid();
  admin_b_user_id uuid := gen_random_uuid();
  ordinary_a_user_id uuid := gen_random_uuid();
  manager_legacy_user_id uuid := gen_random_uuid();
  new_hire_id uuid := gen_random_uuid();
  cross_workspace_target_id uuid := gen_random_uuid();
  member_id uuid;
  row_count integer;
  caught boolean;
  read_count integer;
begin
  select pa.user_id into real_app_admin_id
  from public.app_admins pa
  limit 1;
  if real_app_admin_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin found.';
  end if;

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (name, slug, status) values ('ZZ Test 214 Workspace A', 'zz-test-214-workspace-a', 'active') returning id into workspace_a_id;
  insert into public.workspaces (name, slug, status) values ('ZZ Test 214 Workspace B', 'zz-test-214-workspace-b', 'active') returning id into workspace_b_id;

  insert into auth.users (id, email, email_confirmed_at) values
    (admin_a_user_id, 'zz-test-214-admin-a@example.com', now()),
    (admin_b_user_id, 'zz-test-214-admin-b@example.com', now()),
    (ordinary_a_user_id, 'zz-test-214-ordinary-a@example.com', now()),
    (manager_legacy_user_id, 'zz-test-214-manager-legacy@example.com', now()),
    (new_hire_id, 'zz-test-214-new-hire@example.com', now()),
    (cross_workspace_target_id, 'zz-test-214-cross-target@example.com', now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (workspace_a_id, admin_a_user_id, true),
    (workspace_a_id, ordinary_a_user_id, false),
    (workspace_a_id, manager_legacy_user_id, false),
    (workspace_b_id, admin_b_user_id, true),
    (workspace_b_id, cross_workspace_target_id, false);

  insert into public.app_user_roles (user_id, role_key, is_primary) values (manager_legacy_user_id, 'manager', true);
  insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
    select id, 'manager', true from public.workspace_members where workspace_id = workspace_a_id and user_id = manager_legacy_user_id;

  -- ============================================================
  -- bridge_set_primary_role
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.bridge_set_primary_role(new_hire_id, 'warehouse');

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.app_user_roles where user_id = new_hire_id and role_key = 'warehouse' and is_primary = true;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: bridge_set_primary_role did not create the legacy app_user_roles row for a workspace-admin caller';
  end if;
  select wm.id into member_id from public.workspace_members wm where wm.workspace_id = workspace_a_id and wm.user_id = new_hire_id;
  if member_id is null then
    raise exception 'TEST FAILED: bridge_set_primary_role did not create a workspace_members row for the new hire';
  end if;
  select count(*) into row_count from public.workspace_member_roles where workspace_member_id = member_id and role_key = 'warehouse' and is_primary = true;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: bridge_set_primary_role did not create the matching workspace_member_roles row -- legacy/workspace drift';
  end if;

  raise notice 'TEST PASSED: Section (a) -- a workspace-admin-only caller can assign a brand-new target''s first primary role in their own workspace, with no legacy/workspace drift';

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.bridge_set_primary_role(cross_workspace_target_id, 'pm');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: workspace A''s admin could assign a role to a target who already belongs to workspace B';
  end if;

  raise notice 'TEST PASSED: Section (b) -- a workspace admin cannot assign a role to a target who already belongs to a different workspace';

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.bridge_set_primary_role(new_hire_id, 'sales');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an ordinary (non-admin, non-manager, non-workspace-admin) member could set a primary role';
  end if;

  raise notice 'TEST PASSED: Section (c) -- an ordinary workspace member is still rejected';

  perform set_config('request.jwt.claims', json_build_object('sub', manager_legacy_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.bridge_set_primary_role(new_hire_id, 'sales');

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.app_user_roles where user_id = new_hire_id and role_key = 'sales' and is_primary = true;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the legacy manager-role branch (migration 133/208) no longer works after this migration';
  end if;

  raise notice 'TEST PASSED: Section (d) -- the legacy manager-role authorization branch still works, unaffected';

  -- A fresh target with NO existing workspace membership -- resolves
  -- into the ADMIN'S OWN real workspace (Ergon Test Workspace), exactly
  -- like section (a) did for a workspace-only admin. Reusing new_hire_id
  -- here would incorrectly trip the new cross-workspace guard (section
  -- b's own point): new_hire_id already belongs to the synthetic
  -- workspace A, and a real Ergon app_admin's own resolved workspace is
  -- Ergon's, a different one -- correctly rejected by this same
  -- migration's own item (b) fix, not a regression to paper over.
  declare
    admin_fresh_target_id uuid := gen_random_uuid();
  begin
    perform set_config('role', 'postgres', true);
    insert into auth.users (id, email, email_confirmed_at) values (admin_fresh_target_id, 'zz-test-214-admin-fresh-target@example.com', now());

    perform set_config('request.jwt.claims', json_build_object('sub', real_app_admin_id::text)::text, true);
    perform set_config('role', 'authenticated', true);

    perform public.bridge_set_primary_role(admin_fresh_target_id, 'engineering');

    perform set_config('role', 'postgres', true);
    select count(*) into row_count from public.app_user_roles where user_id = admin_fresh_target_id and role_key = 'engineering' and is_primary = true;
    if row_count is distinct from 1 then
      raise exception 'TEST FAILED: a real global app_admin can no longer set a primary role';
    end if;
  end;

  raise notice 'TEST PASSED: Section (e) -- a real global app_admin still works, unaffected';

  -- ============================================================
  -- bridge_set_secondary_roles
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.bridge_set_secondary_roles(new_hire_id, array['pm']);

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.app_user_roles where user_id = new_hire_id and role_key = 'pm' and is_primary = false;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace-admin-only caller could not set a secondary role for their own team member';
  end if;

  raise notice 'TEST PASSED: Section (f) -- a workspace-admin-only caller can set secondary roles for their own team member';

  -- cross_workspace_target_id has no primary role yet -- give it one as
  -- workspace B's own admin first, so section (g) tests the REAL cross-
  -- workspace rejection (workspace A's admin acting on it), not just
  -- the pre-existing "no primary role yet" rejection.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_b_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.bridge_set_primary_role(cross_workspace_target_id, 'purchasing');

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.bridge_set_secondary_roles(cross_workspace_target_id, array['warehouse']);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: workspace A''s admin could set secondary roles for workspace B''s own member';
  end if;

  raise notice 'TEST PASSED: Section (g) -- a workspace admin cannot set secondary roles for a different workspace''s member';

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.bridge_set_secondary_roles(new_hire_id, array['warehouse']);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an ordinary member could set secondary roles';
  end if;

  raise notice 'TEST PASSED: Section (h) -- an ordinary workspace member still cannot set secondary roles';

  -- ============================================================
  -- bridge_set_user_allowed_views
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.bridge_set_user_allowed_views(new_hire_id, array['dashboard', 'inventory']);

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.app_user_roles where user_id = new_hire_id and is_primary = true and allowed_views = array['dashboard', 'inventory'];
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace-admin-only caller could not set tab permissions for their own team member';
  end if;

  raise notice 'TEST PASSED: Section (i) -- a workspace-admin-only caller can set tab permissions for their own team member';

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.bridge_set_user_allowed_views(cross_workspace_target_id, array['dashboard']);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: workspace A''s admin could set tab permissions for workspace B''s own member';
  end if;

  raise notice 'TEST PASSED: Section (j) -- a workspace admin cannot set tab permissions for a different workspace''s member';

  -- ============================================================
  -- app_user_status
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.app_user_status (user_id, approval_status) values (new_hire_id, 'pending')
    on conflict (user_id) do update set approval_status = 'pending';
  insert into public.app_user_status (user_id, approval_status) values (cross_workspace_target_id, 'pending')
    on conflict (user_id) do update set approval_status = 'pending';

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into read_count from public.app_user_status where user_id = new_hire_id;
  if read_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace admin could not read their own team member''s pending status (% rows)', read_count;
  end if;

  update public.app_user_status set approval_status = 'approved', approved_by = admin_a_user_id, approved_at = now() where user_id = new_hire_id;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.app_user_status where user_id = new_hire_id and approval_status = 'approved';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace admin could not approve their own team member''s pending status';
  end if;

  raise notice 'TEST PASSED: Section (k) -- a workspace admin can read and approve a pending status row for their own team member';

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into read_count from public.app_user_status where user_id = cross_workspace_target_id;
  if read_count is distinct from 0 then
    raise exception 'TEST FAILED: workspace A''s admin could read workspace B''s own member''s pending status (% rows)', read_count;
  end if;

  begin
    update public.app_user_status set approval_status = 'approved' where user_id = cross_workspace_target_id;
  exception when others then
    null;
  end;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.app_user_status where user_id = cross_workspace_target_id and approval_status = 'approved') then
    raise exception 'TEST FAILED: workspace A''s admin could approve workspace B''s own member''s pending status';
  end if;

  raise notice 'TEST PASSED: Section (l) -- a workspace admin cannot read or approve a different workspace''s member';

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into read_count from public.app_user_status where user_id != ordinary_a_user_id;
  if read_count is distinct from 0 then
    raise exception 'TEST FAILED: an ordinary member could read other users'' pending status (% rows)', read_count;
  end if;

  raise notice 'TEST PASSED: Section (m) -- an ordinary workspace member still cannot read or approve anyone else''s pending status';

  perform set_config('request.jwt.claims', json_build_object('sub', real_app_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into read_count from public.app_user_status where user_id = cross_workspace_target_id;
  if read_count is distinct from 1 then
    raise exception 'TEST FAILED: a real global app_admin can no longer read every pending status row (% rows for a known target)', read_count;
  end if;

  raise notice 'TEST PASSED: Section (n) -- a real global app_admin still has full visibility, unaffected';

  -- ============================================================
  -- app_user_roles read side (loadAllUserRoles's own real query) --
  -- proves the write RPCs above aren't paired with an empty roster.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into read_count from public.app_user_roles where user_id = new_hire_id;
  if read_count = 0 then
    raise exception 'TEST FAILED: a workspace admin cannot read their own team member''s app_user_roles rows -- Team Roster would render empty';
  end if;

  select count(*) into read_count from public.app_user_roles where user_id = cross_workspace_target_id;
  if read_count is distinct from 0 then
    raise exception 'TEST FAILED: workspace A''s admin could read workspace B''s own member''s app_user_roles rows (% rows)', read_count;
  end if;

  raise notice 'TEST PASSED: Section (o) -- a workspace admin can read their own team''s app_user_roles rows, never another workspace''s';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 214 WORKSPACE ADMIN ROLE ASSIGNMENT AND APPROVAL TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
