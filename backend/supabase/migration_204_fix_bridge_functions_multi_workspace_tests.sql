-- Canonical test for migration 204 (fix the legacy bridge functions for a real multi-workspace
-- world). Wrapped in begin;/rollback; -- nothing commits. Deliberately exercises the EXACT
-- condition that broke in production: 2 real workspaces existing simultaneously (not 1) --
-- every section below would have failed with "Bridge functions require exactly one workspace
-- row to exist in total, found 2" before this migration, on the unpatched migration 124
-- functions. Synthetic fixtures throughout (own workspaces/users), matching this session's own
-- established convention (see migration_200/201/203's own test files) rather than migration
-- 124's older real-row convention -- deterministic regardless of production's actual state.
--
-- IMPORTANT: this can only run AFTER migration 204 has actually been applied.

begin;

do $$
declare
  ws_a_id uuid;
  ws_b_id uuid;
  admin_a_id uuid;      -- global admin, member of workspace A -- the caller throughout
  target_new_id uuid;   -- has no workspace_members row yet
  target_in_b_id uuid;  -- already a member of workspace B (a DIFFERENT workspace than the caller)
  member_id uuid;
  resolved_ws_id uuid;
  role_count int;
  v_count int;
begin
  -- ============================================================
  -- Fixtures: 2 real workspaces (the exact broken condition), a global admin who is a member
  -- of workspace A, a brand-new target with no workspace membership, and a second target
  -- already belonging to workspace B specifically (proving the fix doesn't force everyone into
  -- the caller's own workspace when that would be wrong).
  -- ============================================================
  insert into public.workspaces (name, slug, status) values ('Test WS 204 A', 'test-ws-204-a-' || substr(gen_random_uuid()::text, 1, 8), 'active')
    returning id into ws_a_id;
  insert into public.workspaces (name, slug, status) values ('Test WS 204 B', 'test-ws-204-b-' || substr(gen_random_uuid()::text, 1, 8), 'active')
    returning id into ws_b_id;

  insert into auth.users (id, email) values (gen_random_uuid(), 'test204-admin-a@example.com') returning id into admin_a_id;
  insert into auth.users (id, email) values (gen_random_uuid(), 'test204-new@example.com') returning id into target_new_id;
  insert into auth.users (id, email) values (gen_random_uuid(), 'test204-in-b@example.com') returning id into target_in_b_id;

  insert into public.app_admins (user_id) values (admin_a_id);
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_a_id, admin_a_id, true);
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b_id, target_in_b_id, false);

  -- ============================================================
  -- (a) bridge_set_primary_role: with 2 workspaces existing, this must now SUCCEED (was the
  -- exact production failure) and must create the new member's workspace_members row in the
  -- CALLER's own workspace (A), not workspace B or any other.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.bridge_set_primary_role(target_new_id, 'pm');

  set local role postgres;
  select workspace_id, id into resolved_ws_id, member_id from public.workspace_members where user_id = target_new_id;
  if resolved_ws_id is distinct from ws_a_id then
    raise exception 'TEST FAILED (a): bridge_set_primary_role put the new member in workspace %, expected the caller''s own workspace %', resolved_ws_id, ws_a_id;
  end if;
  select count(*) into role_count from public.workspace_member_roles where workspace_member_id = member_id and role_key = 'pm' and is_primary;
  if role_count <> 1 then
    raise exception 'TEST FAILED (a): workspace_member_roles was not correctly mirrored';
  end if;
  select count(*) into role_count from public.app_user_roles where user_id = target_new_id and role_key = 'pm' and is_primary;
  if role_count <> 1 then
    raise exception 'TEST FAILED (a): legacy app_user_roles was not correctly written';
  end if;

  -- ============================================================
  -- (b) bridge_set_secondary_roles: must also succeed with 2 workspaces existing, and must
  -- correctly find the target's own membership without needing to resolve any single
  -- workspace.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.bridge_set_secondary_roles(target_new_id, array['engineering']);

  set local role postgres;
  select count(*) into role_count from public.workspace_member_roles where workspace_member_id = member_id and role_key = 'engineering' and not is_primary;
  if role_count <> 1 then
    raise exception 'TEST FAILED (b): bridge_set_secondary_roles did not correctly mirror the secondary role';
  end if;

  -- ============================================================
  -- (c) bridge_set_user_allowed_views: must succeed with 2 workspaces existing (this
  -- function never touches a workspace table at all -- its own gate was pure dead weight).
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.bridge_set_user_allowed_views(target_new_id, array['projects', 'sales']);

  set local role postgres;
  select count(*) into v_count from public.app_user_roles where user_id = target_new_id and is_primary and allowed_views = array['projects', 'sales'];
  if v_count <> 1 then
    raise exception 'TEST FAILED (c): bridge_set_user_allowed_views did not write the expected allowed_views';
  end if;

  -- ============================================================
  -- (d) bridge_revoke_admin acting on a target who belongs to workspace B specifically (NOT
  -- the caller's own workspace A) -- proves the fix correctly finds and updates the target's
  -- OWN membership rather than forcing everything through the caller's workspace, which would
  -- silently no-op or corrupt a different company's data.
  -- ============================================================
  insert into public.app_admins (user_id) values (target_in_b_id);
  update public.workspace_members set is_workspace_admin = true where workspace_id = ws_b_id and user_id = target_in_b_id;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_a_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.bridge_revoke_admin(target_in_b_id);

  set local role postgres;
  select count(*) into v_count from public.app_admins where user_id = target_in_b_id;
  if v_count <> 0 then
    raise exception 'TEST FAILED (d): bridge_revoke_admin did not remove the target from app_admins';
  end if;
  if exists (select 1 from public.workspace_members where workspace_id = ws_b_id and user_id = target_in_b_id and is_workspace_admin = true) then
    raise exception 'TEST FAILED (d): bridge_revoke_admin did not clear is_workspace_admin on the target''s OWN (workspace B) membership row';
  end if;

  -- ============================================================
  -- (e) Regression guard: a non-admin caller is still rejected. The last-remaining-admin
  -- protection (bridge_revoke_admin's advisory-lock logic) is completely unchanged byte-for-
  -- byte from migration 124 and already has its own dedicated coverage in
  -- migration_124_bridge_tests.sql -- not re-tested here. (First draft of this section tried to
  -- assert app_admins had exactly 1 row at this point, which is wrong: app_admins is a real,
  -- already-populated production table, not scoped to this test's own fixtures -- caught live,
  -- 2026-09-24, "found 3" instead of the assumed 1.)
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', target_new_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.bridge_set_primary_role(target_in_b_id, 'sales');
    raise exception 'TEST FAILED (e): a non-admin caller was able to change a primary role';
  exception when others then
    if sqlerrm not like '%Only an admin%' then
      raise exception 'TEST FAILED (e): rejected for the wrong reason: %', sqlerrm;
    end if;
  end;

  set local role postgres;
  raise notice 'ALL MIGRATION 204 BRIDGE TESTS PASSED (a)-(e), including the exact 2-workspace condition that broke production.';
end $$;

rollback;
