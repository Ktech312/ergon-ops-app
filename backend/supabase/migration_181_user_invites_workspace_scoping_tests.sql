-- Transaction-safe canonical test for migration 181 (user_invites
-- workspace scoping + accept_invite() workspace_members insert).
-- Wrapped in begin;/rollback; -- nothing here ever commits. The
-- synthetic second workspace this script creates lives ONLY inside this
-- rolled-back transaction. No fake auth.users row is ever fabricated --
-- every "identity" used below is a REAL, already-existing auth.users
-- row (same discipline as migration_124_bridge_tests.sql and
-- migration_133_..._tests.sql), since user_invites.accepted_user_id and
-- workspace_members.user_id both carry a real FK to auth.users.
--
-- Section 1 confirms guard_workspace_id_mutation() stamps a new invite
-- with the CREATING ADMIN's own workspace_id, exactly like every other
-- root table this session has scoped this way.
--
-- Section 2 confirms accept_invite()'s new behavior: accepting a
-- pending invite now also creates a real workspace_members row, scoped
-- to the INVITE's own workspace_id (not the accepting user's, since they
-- have none yet) -- this is the actual functional gap migration 181
-- exists to close. It also re-confirms 065's carried-forward behavior
-- (app_user_roles primary role + app_user_status approval) is untouched.
--
-- Section 3 confirms cross-workspace containment on user_invites using
-- ROW-COUNT checks, not exception checks, for the SELECT and UPDATE
-- (revoke) denials -- a lesson this session learned the hard way in
-- migrations 171/174: RLS silently returns zero rows / affects zero
-- rows on a blocked SELECT/UPDATE/DELETE, it never raises. Only a
-- blocked INSERT (no matching row exists yet to filter) raises.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 181 USER INVITES
-- WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard
-- SQL error naming what failed or was skipped.

begin;

do $$
declare
  original_role text;
  admin_user_id uuid;
  workspace_a_id uuid;
  admin_was_workspace_admin boolean;
  ws_b uuid := gen_random_uuid();
  invitee_user_id uuid;
  invitee_had_membership_a boolean;
  invite_id uuid;
  invite_token text;
  invite_workspace_id uuid;
  visible_count int;
  affected_rows int;
  member_count int;
  member_is_admin boolean;
  invite_status text;
  invite_accepted_user_id uuid;
  primary_role_count int;
  approval_status_val text;
begin
  original_role := current_setting('role');

  -- ============================================================
  -- Discover a real, existing app_admin who is also an active workspace
  -- member -- same discovery idiom as migrations 171/174/175's tests.
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

  -- A second real, existing auth.users row, distinct from the admin, to
  -- act as the brand-new invitee accepting the invite. Never fabricated
  -- -- same discipline as migration_133's target_user_id lookup.
  select au.id into invitee_user_id
  from auth.users au
  where au.id <> admin_user_id
  order by au.created_at
  limit 1;

  if invitee_user_id is null then
    raise exception 'TEST SETUP FAILED: no second real auth.users row distinct from the admin found -- this script requires at least two real users to exist.';
  end if;

  select exists (
    select 1 from public.workspace_members
    where workspace_id = workspace_a_id and user_id = invitee_user_id
  ) into invitee_had_membership_a;

  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_181 Other Workspace', 'zz-test-181-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  -- Start from a clean slate: the invitee must NOT already have a
  -- workspace_members row for workspace A, or Section 2's "a real row
  -- gets created" assertion would prove nothing. Moot once this
  -- transaction rolls back, restored explicitly anyway to match this
  -- repo's established discipline of never leaving a real row mutated
  -- for longer than the test actually needs it mutated.
  delete from public.workspace_members where workspace_id = workspace_a_id and user_id = invitee_user_id;

  -- ============================================================
  -- Section 1: an invite created while acting as workspace-A's admin
  -- gets workspace_id = workspace A automatically, via
  -- guard_workspace_id_mutation() (the client never sends workspace_id
  -- -- confirmed from src/persistence.ts:1094 createInvite's real POST
  -- body -- so this also proves the no-frontend-change claim).
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.user_invites (email, full_name, primary_role, secondary_roles, invited_by_email)
  values ('zz-test-181-invitee@example.com', 'ZZ_TEST_181 Invitee', 'warehouse', '{}', 'zz-test-181-admin@example.com')
  returning id, token, workspace_id into invite_id, invite_token, invite_workspace_id;

  if invite_workspace_id is distinct from workspace_a_id then
    raise exception 'TEST FAILED: a new user_invites row was stamped with workspace_id % instead of the creating admin''s own workspace %', invite_workspace_id, workspace_a_id;
  end if;

  raise notice 'TEST PASSED: Section 1 -- user_invites.workspace_id is auto-derived from the creating admin''s own workspace';

  -- ============================================================
  -- Section 2: simulating accept_invite() for that invite's token, as
  -- the (real, distinct) invitee, results in a real workspace_members
  -- row for workspace A -- the actual functional gap this migration
  -- fixes. 065's carried-forward app_user_roles/app_user_status
  -- behavior is re-confirmed in the same pass.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', invitee_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform public.accept_invite(invite_token);

  perform set_config('role', 'postgres', true);

  select status, accepted_user_id into invite_status, invite_accepted_user_id
  from public.user_invites where id = invite_id;

  if invite_status is distinct from 'accepted' or invite_accepted_user_id is distinct from invitee_user_id then
    raise exception 'TEST FAILED: accept_invite() did not mark the invite accepted by the calling user (status=%, accepted_user_id=%)', invite_status, invite_accepted_user_id;
  end if;

  select count(*), bool_and(is_workspace_admin) into member_count, member_is_admin
  from public.workspace_members
  where workspace_id = workspace_a_id and user_id = invitee_user_id;

  if member_count <> 1 then
    raise exception 'TEST FAILED: accept_invite() did not create exactly one workspace_members row for the invitee in workspace A (found %)', member_count;
  end if;

  if member_is_admin is distinct from false then
    raise exception 'TEST FAILED: accept_invite() created the invitee''s workspace_members row with is_workspace_admin=true -- expected false (matching bridge_set_primary_role''s own default for a non-explicitly-promoted user)';
  end if;

  select count(*) into primary_role_count
  from public.app_user_roles
  where user_id = invitee_user_id and role_key = 'warehouse' and is_primary = true;

  if primary_role_count <> 1 then
    raise exception 'TEST FAILED: accept_invite()''s carried-forward app_user_roles behavior regressed -- expected exactly one primary ''warehouse'' row for the invitee';
  end if;

  select approval_status into approval_status_val from public.app_user_status where user_id = invitee_user_id;
  if approval_status_val is distinct from 'approved' then
    raise exception 'TEST FAILED: accept_invite()''s carried-forward app_user_status behavior regressed -- expected approval_status=''approved'', found %', approval_status_val;
  end if;

  raise notice 'TEST PASSED: Section 2 -- accept_invite() creates a real workspace_members row scoped to the invite''s own workspace, and its pre-existing app_user_roles/app_user_status behavior is unchanged';

  -- Idempotency check: calling on_conflict do nothing must not error if
  -- a workspace_members row already exists (e.g. an admin added them
  -- some other way first). Re-run the workspace_members insert shape
  -- directly (accept_invite() itself can't be called twice -- the first
  -- call already flipped the invite's status away from 'pending').
  perform set_config('role', 'postgres', true);
  begin
    insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
    values (workspace_a_id, invitee_user_id, false)
    on conflict (workspace_id, user_id) do nothing;
  exception when others then
    raise exception 'TEST FAILED: re-inserting an already-existing workspace_members row via the same on-conflict shape accept_invite() uses should be a silent no-op, not an error (%)', sqlerrm;
  end;

  -- ============================================================
  -- Section 3: a workspace-B admin cannot read or revoke workspace A's
  -- invite. Row-count / affected-row checks, not exception checks --
  -- RLS SELECT/UPDATE denial is silent (migrations 171/174's own
  -- lesson, re-applied here).
  -- ============================================================

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = admin_user_id and workspace_id = workspace_a_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, admin_user_id, true);

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.user_invites where id = invite_id;
  if visible_count <> 0 then
    raise exception 'TEST FAILED: a workspace-B admin could read workspace A''s user_invites row';
  end if;

  update public.user_invites set status = 'revoked' where id = invite_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'TEST FAILED: a workspace-B admin was able to revoke (UPDATE) workspace A''s user_invites row -- % row(s) affected', affected_rows;
  end if;

  -- Restore the admin to workspace A and re-confirm they regain both
  -- read and revoke access -- proves Section 3's denial was genuinely
  -- caused by workspace membership, not some other broken policy path.
  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = admin_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (workspace_a_id, admin_user_id, admin_was_workspace_admin);

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.user_invites where id = invite_id;
  if visible_count <> 1 then
    raise exception 'TEST FAILED: workspace-A''s own admin could not read their own user_invites row after being restored to workspace A';
  end if;

  update public.user_invites set status = 'revoked' where id = invite_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'TEST FAILED: workspace-A''s own admin could not revoke their own user_invites row after being restored to workspace A -- % row(s) affected', affected_rows;
  end if;

  raise notice 'TEST PASSED: Section 3 -- user_invites read/revoke is workspace-contained, confirmed via row-count checks, with a positive-control restore proving the denial was genuinely workspace-scoped';

  -- ------------------------------------------------------------
  -- Cleanup (moot under this transaction's rollback, done anyway to
  -- match this repo's established discipline).
  -- ------------------------------------------------------------
  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where workspace_id = workspace_a_id and user_id = invitee_user_id;
  if invitee_had_membership_a then
    insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (workspace_a_id, invitee_user_id, false)
    on conflict (workspace_id, user_id) do nothing;
  end if;
  perform set_config('role', original_role, true);

  raise notice 'ALL MIGRATION 181 USER INVITES WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
