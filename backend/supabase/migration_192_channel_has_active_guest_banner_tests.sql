-- Transaction-safe canonical test for migration 192 (channel_has_active_
-- guest, the narrowly-scoped boolean RPC behind the "external guests have
-- access to this channel" banner). Wrapped in begin;/rollback; -- nothing
-- here ever commits. The synthetic second workspace, synthetic users,
-- projects, channels, and guest rows this script creates live ONLY inside
-- this rolled-back transaction.
--
-- Covers this task's own verification spec: (a) a real, ORDINARY workspace
-- member (not admin/PM/the channel's creator) sees `true` for a channel
-- with an active guest and `false` for one without; (b) a caller from a
-- DIFFERENT workspace gets `false` even for a channel with an active
-- guest, never an error and never a leak; (c) a revoked guest and an
-- expired (but not revoked) guest both correctly make the function return
-- `false` again.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 192 CHANNEL HAS ACTIVE
-- GUEST BANNER TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;      -- real app_admin, workspace A (used only for setup)
  real_workspace_id uuid; -- workspace A (real, pre-existing)
  ws_b uuid := gen_random_uuid();
  colleague_id uuid := gen_random_uuid();  -- workspace A, PLAIN (non-admin) member -- the banner's real audience
  stranger_id uuid := gen_random_uuid();   -- workspace B, different company
  guest_id uuid := gen_random_uuid();
  expired_guest_id uuid := gen_random_uuid();
  project_a_id uuid;
  channel_a_id uuid;  -- has an active guest
  project_b_id uuid;
  channel_b_id uuid;  -- no guest at all
  result boolean;
begin
  -- ============================================================
  -- Setup: a real, existing app_admin who is also an active workspace
  -- member (same discovery pattern as every other canonical test in this
  -- suite), a synthetic second workspace with its own plain member
  -- ("stranger"), a plain (non-admin, non-PM, non-channel-creator)
  -- colleague in workspace A -- the actual intended audience of this
  -- banner -- and two real project channels in workspace A.
  -- ============================================================

  select am.user_id, wm.workspace_id
    into real_user_id, real_workspace_id
  from public.app_admins am
  join public.workspace_members wm on wm.user_id = am.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin who is also an active workspace member found.';
  end if;

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_192 Other Workspace', 'zz-test-192-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  insert into auth.users (id, email) values
    (colleague_id, 'zz-test-192-colleague@example.com'),
    (stranger_id, 'zz-test-192-stranger@example.com'),
    (guest_id, 'zz-test-192-guest@example.com'),
    (expired_guest_id, 'zz-test-192-expired-guest@example.com');

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (real_workspace_id, colleague_id, false),
    (ws_b, stranger_id, false);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (project_name) values ('ZZ_TEST_192 Project A') returning id into project_a_id;
  select id into channel_a_id from public.channels where type = 'project' and project_id = project_a_id;

  insert into public.projects (project_name) values ('ZZ_TEST_192 Project B') returning id into project_b_id;
  select id into channel_b_id from public.channels where type = 'project' and project_id = project_b_id;

  if channel_a_id is null or channel_b_id is null then
    raise exception 'TEST SETUP FAILED: could not resolve channel_a_id (%) or channel_b_id (%)', channel_a_id, channel_b_id;
  end if;

  perform set_config('role', 'postgres', true);
  insert into public.channel_guests (channel_id, user_id, display_name, invited_by_email)
    values (channel_a_id, guest_id, 'ZZ Test 192 Guest', 'real@example.com');

  -- ============================================================
  -- Section (a): a real, ORDINARY workspace member (colleague_id -- not
  -- admin, not PM, not the channel's creator) sees TRUE for channel A
  -- (has an active guest) and FALSE for channel B (no guest at all).
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.channel_has_active_guest(channel_a_id) into result;
  if result is distinct from true then
    raise exception 'TEST FAILED: an ordinary workspace member expected TRUE for a channel with an active guest, got %', result;
  end if;

  select public.channel_has_active_guest(channel_b_id) into result;
  if result is distinct from false then
    raise exception 'TEST FAILED: an ordinary workspace member expected FALSE for a channel with no guest, got %', result;
  end if;

  raise notice 'TEST PASSED: Section (a) -- an ordinary (non-admin/PM) workspace member correctly sees true/false for channels with/without an active guest';

  -- ============================================================
  -- Section (b): a caller from a DIFFERENT workspace (stranger_id, in
  -- ws_b) gets FALSE for channel A even though it has a real active
  -- guest -- never an error, never a leak.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.channel_has_active_guest(channel_a_id) into result;
  if result is distinct from false then
    raise exception 'TEST FAILED: a caller from a different workspace expected FALSE for a channel with an active guest in someone else''s workspace, got %', result;
  end if;

  raise notice 'TEST PASSED: Section (b) -- a caller from a different workspace gets FALSE for a channel with an active guest, never an error and never a leak';

  -- ============================================================
  -- Section (c): a revoked guest, and a separate expired (but not
  -- revoked) guest, both correctly make the function return FALSE again
  -- for the channel they'd otherwise flag as having an active guest.
  -- ============================================================

  perform set_config('role', 'postgres', true);

  -- Revoke the only active guest on channel A, then re-check as the
  -- ordinary colleague.
  update public.channel_guests
  set revoked_at = now(), revoked_by_email = 'real@example.com'
  where channel_id = channel_a_id and user_id = guest_id;

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.channel_has_active_guest(channel_a_id) into result;
  if result is distinct from false then
    raise exception 'TEST FAILED: channel_has_active_guest() expected FALSE after the channel''s only guest was revoked, got %', result;
  end if;

  raise notice 'TEST PASSED: Section (c) part 1 -- a revoked guest no longer makes the channel report an active guest';

  -- Fresh channel with ONLY an expired (not revoked) guest, isolating the
  -- expiry check itself from the revocation check above.
  perform set_config('role', 'postgres', true);
  insert into public.channel_guests (channel_id, user_id, display_name, invited_by_email, expires_at)
    values (channel_b_id, expired_guest_id, 'ZZ Test 192 Expired Guest', 'real@example.com', now() - interval '1 hour');

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.channel_has_active_guest(channel_b_id) into result;
  if result is distinct from false then
    raise exception 'TEST FAILED: channel_has_active_guest() expected FALSE for a channel whose only guest is expired-but-not-revoked, got %', result;
  end if;

  raise notice 'TEST PASSED: Section (c) part 2 -- an expired-but-not-revoked guest does not make the channel report an active guest';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 192 CHANNEL HAS ACTIVE GUEST BANNER TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
