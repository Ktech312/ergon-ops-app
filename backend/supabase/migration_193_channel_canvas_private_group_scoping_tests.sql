-- Transaction-safe canonical test for migration 193 (channel_canvas's
-- private-group membership gate on SELECT/INSERT/UPDATE). Wrapped in
-- begin;/rollback; -- nothing here ever commits. The synthetic channels,
-- users, membership, guest row, and canvas rows this script creates live
-- ONLY inside this rolled-back transaction.
--
-- Covers: (a) a plain workspace member with NO channel_members row for a
-- PRIVATE group channel cannot read its canvas (row-count check, RLS
-- SELECT denial is silent -- this repo's well-established migration-
-- 171/174 lesson), cannot update it (affected-row-count check, UPDATE
-- denial via USING is also silent), and cannot insert a fresh canvas row
-- for it (a caught exception -- RLS WITH CHECK denial on INSERT is NOT
-- silent); (b) the same shapes all succeed once that caller has a real
-- channel_members row; (c) a NON-PRIVATE group channel's canvas remains
-- readable without membership -- the regression check that this migration
-- only tightens the private-group case, not the already-correct broader
-- OR-branches it shares with channel_messages; (d) a channel guest can
-- still SELECT the canvas of their own one channel (unaffected by this
-- migration) but still cannot UPDATE it -- migration 188's own "read-only
-- for guests" decision is preserved, not reopened.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 193 CHANNEL CANVAS
-- PRIVATE GROUP SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard
-- SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;      -- real app_admin, real workspace (used only for setup)
  real_workspace_id uuid;
  colleague_id uuid := gen_random_uuid();  -- same workspace, NOT a member of the private channel
  member_id uuid := gen_random_uuid();     -- same workspace, IS a member of the private channel
  guest_id uuid := gen_random_uuid();
  colleague_email text := 'zz-test-193-colleague@example.com';
  member_email text := 'zz-test-193-member@example.com';
  guest_email text := 'zz-test-193-guest@example.com';
  channel_private_id uuid;  -- private group, has an existing canvas row
  channel_open_id uuid;     -- non-private group, has an existing canvas row
  channel_fresh_id uuid;    -- private group, NO canvas row yet (for INSERT tests)
  row_count integer;
  affected_rows integer;
  caught boolean;
begin
  -- ============================================================
  -- Setup
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

  insert into auth.users (id, email) values
    (colleague_id, colleague_email),
    (member_id, member_email),
    (guest_id, guest_email);

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (real_workspace_id, colleague_id, false),
    (real_workspace_id, member_id, false);

  -- Create the three test channels as the real admin, so channels'
  -- own workspace-stamping trigger resolves the right workspace_id and
  -- created_by is a real, unrelated user (not colleague/member/guest --
  -- isolates the "creator" branch of channel_guest_manage_authorized from
  -- this test, which is about channel_members'/channel_canvas' own
  -- membership check, not the creator escape hatch).
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.channels (type, name, private, created_by)
    values ('group', 'ZZ_TEST_193 Private Group', true, real_user_id)
    returning id into channel_private_id;

  insert into public.channels (type, name, private, created_by)
    values ('group', 'ZZ_TEST_193 Open Group', false, real_user_id)
    returning id into channel_open_id;

  insert into public.channels (type, name, private, created_by)
    values ('group', 'ZZ_TEST_193 Fresh Private Group', true, real_user_id)
    returning id into channel_fresh_id;

  perform set_config('role', 'postgres', true);

  insert into public.channel_members (channel_id, user_id) values (channel_private_id, member_id);
  insert into public.channel_guests (channel_id, user_id, display_name, invited_by_email)
    values (channel_private_id, guest_id, 'ZZ Test 193 Guest', 'real@example.com');

  insert into public.channel_canvas (channel_id, content) values
    (channel_private_id, 'private canvas content'),
    (channel_open_id, 'open canvas content');
  -- channel_fresh_id deliberately has NO canvas row yet -- used for the
  -- INSERT-denial/INSERT-success cases below.

  -- ============================================================
  -- Section (a): a plain workspace member with NO channel_members row for
  -- the PRIVATE channel cannot read, update, or insert its canvas.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.channel_canvas where channel_id = channel_private_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a non-member colleague could SELECT a private group channel''s canvas (% rows visible, expected 0)', row_count;
  end if;

  update public.channel_canvas set content = 'HACKED' where channel_id = channel_private_id;
  get diagnostics affected_rows = row_count;
  if affected_rows is distinct from 0 then
    raise exception 'TEST FAILED: a non-member colleague''s UPDATE against a private group channel''s canvas affected % rows (expected 0)', affected_rows;
  end if;

  caught := false;
  begin
    insert into public.channel_canvas (channel_id, content) values (channel_fresh_id, 'should not land');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a non-member colleague could INSERT a canvas row for a private group channel they are not a member of';
  end if;

  raise notice 'TEST PASSED: Section (a) -- a non-member workspace colleague cannot SELECT, UPDATE, or INSERT a private group channel''s canvas';

  -- ============================================================
  -- Section (b): the same three shapes all succeed for a caller with a
  -- real channel_members row.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.channel_members (channel_id, user_id) values (channel_fresh_id, member_id);

  perform set_config('request.jwt.claims', json_build_object('sub', member_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.channel_canvas where channel_id = channel_private_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a real member could not SELECT their own private group channel''s canvas (% rows, expected 1)', row_count;
  end if;

  update public.channel_canvas set content = 'edited by a real member' where channel_id = channel_private_id;
  get diagnostics affected_rows = row_count;
  if affected_rows is distinct from 1 then
    raise exception 'TEST FAILED: a real member''s UPDATE against their own private group channel''s canvas affected % rows (expected 1)', affected_rows;
  end if;

  insert into public.channel_canvas (channel_id, content) values (channel_fresh_id, 'first canvas content');
  select count(*) into row_count from public.channel_canvas where channel_id = channel_fresh_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a real member could not INSERT a fresh canvas row for their own private group channel';
  end if;

  raise notice 'TEST PASSED: Section (b) -- a real channel_members row grants SELECT, UPDATE, and INSERT on a private group channel''s canvas';

  -- ============================================================
  -- Section (c): a NON-PRIVATE group channel's canvas stays readable
  -- without any channel_members row -- confirms this migration only
  -- tightened the private-group branch, not the shared OR-branches.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.channel_canvas where channel_id = channel_open_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace member (not a channel_members row holder) could not SELECT a non-private group channel''s canvas (% rows, expected 1)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (c) -- a non-private group channel''s canvas remains readable to any workspace member, unaffected by this migration';

  -- ============================================================
  -- Section (d): a channel guest can still SELECT their own channel's
  -- canvas (unaffected), but still cannot UPDATE it (188's "read-only for
  -- guests" decision preserved, not reopened by this migration).
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', guest_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.channel_canvas where channel_id = channel_private_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: an active channel guest could not SELECT their own channel''s canvas (% rows, expected 1)', row_count;
  end if;

  update public.channel_canvas set content = 'guest tried to edit' where channel_id = channel_private_id;
  get diagnostics affected_rows = row_count;
  if affected_rows is distinct from 0 then
    raise exception 'TEST FAILED: a channel guest''s UPDATE against their own channel''s canvas affected % rows (expected 0 -- canvas must stay read-only for guests)', affected_rows;
  end if;

  raise notice 'TEST PASSED: Section (d) -- a channel guest can still read their channel''s canvas but still cannot edit it, matching migration 188''s decision';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 193 CHANNEL CANVAS PRIVATE GROUP SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
