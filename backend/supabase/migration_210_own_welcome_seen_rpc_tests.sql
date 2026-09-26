-- Transaction-safe canonical test for migration 210 (mark_own_welcome_seen
-- RPC, fixing the same class of bug migration 209 fixed for the sign-in
-- gate -- a workspace-only admin's has_seen_welcome update was silently
-- rejected by app_user_status's admin/manager-only UPDATE policy).
-- Wrapped in begin;/rollback; -- nothing here ever commits.
--
-- Covers:
-- (a) a workspace-admin-only user (no app_admins, no app_manager role)
--     can mark their OWN welcome seen -- the actual bug this migration
--     fixes.
-- (b) an entirely ordinary user (no admin/manager/workspace-admin flags
--     at all) can ALSO mark their own welcome seen -- this was never
--     meant to be an admin-only action, it's a per-user preference.
-- (c) the function only ever touches the CALLER's own row -- a second
--     user's app_user_status row is completely unaffected.
-- (d) an anonymous caller is rejected outright.
-- (e) the function cannot be used to change approval_status -- proves
--     this fix does not reopen a self-approval hole (the exact risk a
--     naive "broaden the UPDATE policy" fix would have created).
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 210 OWN WELCOME SEEN RPC
-- TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error naming
-- what failed or was skipped.

begin;

do $$
declare
  workspace_admin_user_id uuid := gen_random_uuid();
  ordinary_user_id uuid := gen_random_uuid();
  bystander_user_id uuid := gen_random_uuid();
  real_workspace_id uuid;
  row_count integer;
  seen boolean;
  status_after text;
  caught boolean;
begin
  select id into real_workspace_id from public.workspaces where status = 'active' limit 1;
  if real_workspace_id is null then
    raise exception 'TEST SETUP FAILED: no existing active workspace found.';
  end if;

  perform set_config('role', 'postgres', true);

  insert into auth.users (id, email, email_confirmed_at) values
    (workspace_admin_user_id, 'zz-test-210-workspace-admin@example.com', now()),
    (ordinary_user_id, 'zz-test-210-ordinary@example.com', now()),
    (bystander_user_id, 'zz-test-210-bystander@example.com', now());

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (real_workspace_id, workspace_admin_user_id, true);

  insert into public.app_user_status (user_id, approval_status, has_seen_welcome) values
    (workspace_admin_user_id, 'pending', false),
    (ordinary_user_id, 'pending', false),
    (bystander_user_id, 'pending', false);

  -- ============================================================
  -- Section (a): the actual bug -- a workspace-admin-only user (no
  -- app_admins, no app_manager) can mark their own welcome seen.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', workspace_admin_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.mark_own_welcome_seen();

  perform set_config('role', 'postgres', true);
  select has_seen_welcome into seen from public.app_user_status where user_id = workspace_admin_user_id;
  if seen is distinct from true then
    raise exception 'TEST FAILED: mark_own_welcome_seen did not set has_seen_welcome for a workspace-admin-only caller';
  end if;

  raise notice 'TEST PASSED: Section (a) -- a workspace-admin-only caller (no app_admins, no app_manager) can mark their own welcome seen';

  -- ============================================================
  -- Section (b): an entirely ordinary user, no elevated flags at all,
  -- can also mark their own welcome seen -- not an admin-only action.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.mark_own_welcome_seen();

  perform set_config('role', 'postgres', true);
  select has_seen_welcome into seen from public.app_user_status where user_id = ordinary_user_id;
  if seen is distinct from true then
    raise exception 'TEST FAILED: mark_own_welcome_seen did not set has_seen_welcome for an entirely ordinary caller';
  end if;

  raise notice 'TEST PASSED: Section (b) -- an ordinary caller with no admin/manager/workspace-admin flags can mark their own welcome seen';

  -- ============================================================
  -- Section (c): only ever touches the caller's own row.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  select has_seen_welcome into seen from public.app_user_status where user_id = bystander_user_id;
  if seen is distinct from false then
    raise exception 'TEST FAILED: mark_own_welcome_seen affected a bystander''s row it was never called for';
  end if;

  raise notice 'TEST PASSED: Section (c) -- only the caller''s own row is ever touched, a bystander''s row is unaffected';

  -- ============================================================
  -- Section (d): an anonymous caller is rejected outright.
  -- ============================================================

  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);

  caught := false;
  begin
    perform public.mark_own_welcome_seen();
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: mark_own_welcome_seen succeeded for an anonymous caller';
  end if;

  raise notice 'TEST PASSED: Section (d) -- an anonymous caller is rejected outright';

  -- ============================================================
  -- Section (e): cannot be used to change approval_status -- proves
  -- this fix does not reopen a self-approval hole.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.mark_own_welcome_seen();

  perform set_config('role', 'postgres', true);
  select approval_status into status_after from public.app_user_status where user_id = ordinary_user_id;
  if status_after is distinct from 'pending' then
    raise exception 'TEST FAILED: mark_own_welcome_seen changed approval_status (now %) -- a real self-approval hole', status_after;
  end if;

  raise notice 'TEST PASSED: Section (e) -- mark_own_welcome_seen cannot change approval_status, no self-approval hole reopened';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 210 OWN WELCOME SEEN RPC TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
