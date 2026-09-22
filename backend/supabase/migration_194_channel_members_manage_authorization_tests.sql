-- Transaction-safe canonical test for migration 194 (channel_members'
-- INSERT/DELETE now gated by channel_guest_manage_authorized(), instead
-- of being open to any workspace member). Wrapped in begin;/rollback; --
-- nothing here ever commits. The synthetic channel, users, and membership
-- rows this script creates live ONLY inside this rolled-back transaction.
--
-- Covers: (a) a plain workspace member with none of the four authorized
-- roles (admin/workspace-admin/pm/channel-creator) cannot ADD a member to
-- a group channel they didn't create (a caught exception -- RLS WITH
-- CHECK denial on INSERT is NOT silent); (b) the channel's own creator
-- CAN add a member (the "creator" branch of channel_guest_manage_
-- authorized, exercised through this new policy for the first time); (c)
-- that same plain colleague cannot REMOVE a member either (affected-row-
-- count check -- RLS USING denial on DELETE is silent, same as UPDATE);
-- (d) a real app_admin who did NOT create the channel CAN remove a member
-- (the "admin" branch); (e) SELECT itself is completely unaffected by
-- this migration -- any workspace member can still see who is in a
-- channel, membership-gated or not, exactly as before.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 194 CHANNEL MEMBERS
-- MANAGE AUTHORIZATION TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard
-- SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;      -- real app_admin, real workspace (used for setup AND section (d))
  real_workspace_id uuid;
  creator_id uuid := gen_random_uuid();    -- creates channel_b itself, no admin/pm role
  colleague_id uuid := gen_random_uuid();  -- plain workspace member, none of the four roles
  target_id uuid := gen_random_uuid();     -- the user being added/removed
  creator_email text := 'zz-test-194-creator@example.com';
  colleague_email text := 'zz-test-194-colleague@example.com';
  target_email text := 'zz-test-194-target@example.com';
  channel_b_id uuid;
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
    (creator_id, creator_email),
    (colleague_id, colleague_email),
    (target_id, target_email);

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (real_workspace_id, creator_id, false),
    (real_workspace_id, colleague_id, false),
    (real_workspace_id, target_id, false);

  -- Create the channel AS creator_id, so channels.created_by is really
  -- creator_id (not the admin) -- this isolates the "creator" branch of
  -- channel_guest_manage_authorized from the "admin" branch, tested
  -- separately in section (d).
  perform set_config('request.jwt.claims', json_build_object('sub', creator_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.channels (type, name, private, created_by)
    values ('group', 'ZZ_TEST_194 Group', true, creator_id)
    returning id into channel_b_id;

  perform set_config('role', 'postgres', true);
  insert into public.channel_members (channel_id, user_id) values (channel_b_id, creator_id);

  -- ============================================================
  -- Section (a): a plain colleague (none of the four authorized roles)
  -- cannot ADD target_id to the channel.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.channel_members (channel_id, user_id) values (channel_b_id, target_id);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a plain workspace colleague (not admin/workspace-admin/pm/creator) could add a member to a group channel they did not create';
  end if;

  select count(*) into row_count from public.channel_members where channel_id = channel_b_id and user_id = target_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: target_id was actually added to channel_members despite the INSERT being expected to fail (% rows)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (a) -- a plain workspace colleague cannot add a member to a group channel they did not create';

  -- ============================================================
  -- Section (b): the channel's own creator CAN add a member.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', creator_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.channel_members (channel_id, user_id) values (channel_b_id, target_id);

  select count(*) into row_count from public.channel_members where channel_id = channel_b_id and user_id = target_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the channel''s own creator could not add a member (% rows, expected 1)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (b) -- the channel''s own creator can add a member';

  -- ============================================================
  -- Section (c): the same plain colleague cannot REMOVE target_id's
  -- membership either.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  delete from public.channel_members where channel_id = channel_b_id and user_id = target_id;
  get diagnostics affected_rows = row_count;
  if affected_rows is distinct from 0 then
    raise exception 'TEST FAILED: a plain workspace colleague''s DELETE against channel_members affected % rows (expected 0)', affected_rows;
  end if;

  select count(*) into row_count from public.channel_members where channel_id = channel_b_id and user_id = target_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: target_id''s membership row is missing after a DELETE that should have been denied (% rows, expected 1 still present)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (c) -- a plain workspace colleague cannot remove a member either';

  -- ============================================================
  -- Section (d): a real app_admin who did NOT create the channel CAN
  -- remove a member -- the "admin" branch of channel_guest_manage_
  -- authorized, exercised through this new policy.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  delete from public.channel_members where channel_id = channel_b_id and user_id = target_id;
  get diagnostics affected_rows = row_count;
  if affected_rows is distinct from 1 then
    raise exception 'TEST FAILED: a real app_admin (not the channel''s creator) could not remove a member (% rows affected, expected 1)', affected_rows;
  end if;

  raise notice 'TEST PASSED: Section (d) -- a real app_admin who did not create the channel can remove a member';

  -- ============================================================
  -- Section (e): SELECT itself is completely unaffected -- any workspace
  -- member (including one who was never a channel_members row holder)
  -- can still see who is in the channel.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.channel_members where channel_id = channel_b_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a workspace member could not SELECT channel_members for a group channel (% rows, expected 1 -- creator_id only, after target_id was removed in section d)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (e) -- SELECT on channel_members remains unaffected by this migration, still broadly workspace-readable';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 194 CHANNEL MEMBERS MANAGE AUTHORIZATION TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
