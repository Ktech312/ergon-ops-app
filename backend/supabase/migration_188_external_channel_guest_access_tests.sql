-- Transaction-safe canonical test for migration 188 (external guest
-- access to a single created channel). Wrapped in begin;/rollback; --
-- nothing here ever commits. The synthetic guests, invites, projects, and
-- messages this script creates live ONLY inside this rolled-back
-- transaction.
--
-- Covers, at minimum, every scenario this task's own verification spec
-- requires: (a) the section-type guard trigger rejects a direct insert,
-- not just the RPC's own pre-check; (b) an authorized inviter can create
-- a guest invite for a project-type channel; (c) accepting the invite
-- creates a channel_guests row and creates NO workspace_members row;
-- (d) the guest can read/post messages and upload files in their one
-- channel; (e) the guest cannot read/post in a different channel in the
-- same workspace, a section-type channel, or another table entirely
-- (projects, clients); (f) revoking immediately removes both read and
-- write access; (g) an expired-but-not-revoked guest also loses access.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 188 EXTERNAL CHANNEL
-- GUEST ACCESS TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL
-- error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  project_a_id uuid;
  channel_a_id uuid;       -- the guest's one channel (project-type)
  project_b_id uuid;
  channel_b_id uuid;       -- a DIFFERENT channel in the SAME workspace
  section_channel_id uuid; -- a real seeded section-type channel
  guest_id uuid := gen_random_uuid();
  guest2_id uuid := gen_random_uuid(); -- for the expiry scenario
  invite_token text;
  invite_outcome text;
  v_invite_id uuid;
  accept_outcome text;
  accept_channel_id uuid;
  channel_guest_row_id uuid;
  setup_msg_id uuid;
  row_count integer;
  caught boolean;
  revoke_outcome text;
begin
  -- ============================================================
  -- Setup: a real, existing app_admin who is also an active workspace
  -- member (same discovery pattern as every other canonical test in this
  -- suite), two real projects (auto-creating two real project channels
  -- via the untouched create_project_channel() trigger), a real seeded
  -- section channel, and a synthetic guest auth.users row.
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
    (guest_id, 'zz-test-188-guest@example.com'),
    (guest2_id, 'zz-test-188-guest2@example.com');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (project_name) values ('ZZ_TEST_188 Project A') returning id into project_a_id;
  select id into channel_a_id from public.channels where type = 'project' and project_id = project_a_id;

  insert into public.projects (project_name) values ('ZZ_TEST_188 Project B') returning id into project_b_id;
  select id into channel_b_id from public.channels where type = 'project' and project_id = project_b_id;

  select id into section_channel_id from public.channels where type = 'section' and workspace_id = real_workspace_id limit 1;

  if channel_a_id is null or channel_b_id is null or section_channel_id is null then
    raise exception 'TEST SETUP FAILED: could not resolve channel_a_id (%), channel_b_id (%), or section_channel_id (%)', channel_a_id, channel_b_id, section_channel_id;
  end if;

  -- A pre-existing message in channel B, posted by the real employee
  -- before the guest ever exists -- used by Section (e) to prove the
  -- guest cannot read it.
  insert into public.channel_messages (channel_id, sender_id, body)
    values (channel_b_id, real_user_id, 'ZZ_TEST_188 pre-existing message in channel B')
    returning id into setup_msg_id;

  -- ============================================================
  -- Section (a): the BEFORE INSERT guard trigger rejects a guest invite
  -- targeting a section-type channel -- tested via a DIRECT table
  -- insert, not through the RPC, so this proves the data-layer guard
  -- itself, independent of any RPC-side pre-check.
  -- ============================================================

  caught := false;
  begin
    insert into public.channel_guest_invites (channel_id, invited_by_email)
      values (section_channel_id, 'real@example.com');
  exception when others then caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a channel_guest_invites row was created targeting a section-type channel -- the guard trigger did not fire'; end if;

  caught := false;
  begin
    insert into public.channel_guests (channel_id, user_id, display_name, invited_by_email)
      values (section_channel_id, guest_id, 'Should Not Exist', 'real@example.com');
  exception when others then caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a channel_guests row was created targeting a section-type channel -- the guard trigger did not fire'; end if;

  raise notice 'TEST PASSED: Section (a) -- the guard trigger rejects a direct insert into both new tables when the target channel is section-type';

  -- ============================================================
  -- Section (b): an authorized inviter (real_user_id, a global admin and
  -- active member of the owning workspace) CAN create a guest invite for
  -- a project-type channel, via the RPC.
  -- ============================================================

  select outcome, invite_id, token into invite_outcome, v_invite_id, invite_token
    from public.create_channel_guest_invite(channel_a_id, 'contractor@example.com', now() + interval '7 days');

  if invite_outcome <> 'created' or v_invite_id is null or invite_token is null then
    raise exception 'TEST FAILED: create_channel_guest_invite() did not succeed for an authorized inviter on a project-type channel (outcome=%)', invite_outcome;
  end if;

  -- Same RPC, same authorized caller, targeting the section channel --
  -- must be rejected by the RPC's own defense-in-depth pre-check with a
  -- clean outcome, not a raw exception.
  select outcome into invite_outcome from public.create_channel_guest_invite(section_channel_id, 'nope@example.com', null);
  if invite_outcome <> 'section_channel_forbidden' then
    raise exception 'TEST FAILED: create_channel_guest_invite() did not report section_channel_forbidden for a section-type channel target (got %)', invite_outcome;
  end if;

  raise notice 'TEST PASSED: Section (b) -- an authorized inviter can create a guest invite for a project-type channel, and the RPC itself also rejects a section-type target';

  -- ============================================================
  -- Section (c): accepting the invite (as the guest's own freshly
  -- authenticated session) creates a channel_guests row and creates NO
  -- workspace_members row for that user.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', guest_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, guest_channel_id into accept_outcome, accept_channel_id
    from public.accept_channel_guest_invite(invite_token, 'Contractor Bob');

  if accept_outcome <> 'accepted' or accept_channel_id <> channel_a_id then
    raise exception 'TEST FAILED: accept_channel_guest_invite() did not succeed for a valid, pending invite (outcome=%, channel=%)', accept_outcome, accept_channel_id;
  end if;

  perform set_config('role', 'postgres', true);

  select id into channel_guest_row_id from public.channel_guests where channel_id = channel_a_id and user_id = guest_id;
  if channel_guest_row_id is null then raise exception 'TEST FAILED: accepting the invite did not create a channel_guests row'; end if;

  select count(*) into row_count from public.workspace_members where user_id = guest_id;
  if row_count <> 0 then raise exception 'TEST FAILED: accepting a channel guest invite created a workspace_members row (% rows) -- a guest must NEVER become a workspace member', row_count; end if;

  select status into invite_outcome from public.channel_guest_invites where id = v_invite_id;
  if invite_outcome <> 'accepted' then raise exception 'TEST FAILED: the invite row status was not updated to accepted (got %)', invite_outcome; end if;

  raise notice 'TEST PASSED: Section (c) -- accepting the invite created a channel_guests row and zero workspace_members rows';

  -- ============================================================
  -- Section (d): the guest can read and post messages, and upload a
  -- file, in their one channel.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', guest_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.channels where id = channel_a_id;
  if row_count <> 1 then raise exception 'TEST FAILED: the guest could not read their own channel row'; end if;

  insert into public.channel_messages (channel_id, sender_id, body) values (channel_a_id, guest_id, 'ZZ_TEST_188 guest update: drawings attached');
  select count(*) into row_count from public.channel_messages where channel_id = channel_a_id and sender_id = guest_id;
  if row_count <> 1 then raise exception 'TEST FAILED: the guest could not post a message in their own channel'; end if;

  insert into storage.objects (bucket_id, name, owner) values ('message-attachments', channel_a_id::text || '/zz-test-188-drawing.pdf', guest_id);
  select count(*) into row_count from storage.objects where bucket_id = 'message-attachments' and name = channel_a_id::text || '/zz-test-188-drawing.pdf';
  if row_count <> 1 then raise exception 'TEST FAILED: the guest could not upload a file into their own channel''s message-attachments path'; end if;

  raise notice 'TEST PASSED: Section (d) -- the guest can read/post messages and upload a file in their one channel';

  -- ============================================================
  -- Section (e): the guest cannot read/post in a DIFFERENT channel in
  -- the same workspace, cannot read the section-type channel, and cannot
  -- read other unrelated tables (projects, clients).
  -- ============================================================

  select count(*) into row_count from public.channels where id = channel_b_id;
  if row_count <> 0 then raise exception 'TEST FAILED: the guest could read a different channel in the same workspace'; end if;

  select count(*) into row_count from public.channel_messages where id = setup_msg_id;
  if row_count <> 0 then raise exception 'TEST FAILED: the guest could read a message from a different channel'; end if;

  caught := false;
  begin
    insert into public.channel_messages (channel_id, sender_id, body) values (channel_b_id, guest_id, 'ZZ_TEST_188 should never be allowed');
  exception when others then caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: the guest was able to post a message into a different channel in the same workspace'; end if;

  select count(*) into row_count from public.channels where id = section_channel_id;
  if row_count <> 0 then raise exception 'TEST FAILED: the guest could read a section-type channel'; end if;

  select count(*) into row_count from public.projects;
  if row_count <> 0 then raise exception 'TEST FAILED: the guest could read the projects table (% rows visible)', row_count; end if;

  select count(*) into row_count from public.clients;
  if row_count <> 0 then raise exception 'TEST FAILED: the guest could read the clients table (% rows visible)', row_count; end if;

  raise notice 'TEST PASSED: Section (e) -- the guest is fully isolated from every other channel, the section channel, and unrelated tables (projects, clients)';

  -- ============================================================
  -- Section (f): revoking the guest immediately removes both read and
  -- write access.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome into revoke_outcome from public.revoke_channel_guest(channel_guest_row_id);
  if revoke_outcome <> 'revoked' then raise exception 'TEST FAILED: revoke_channel_guest() did not report revoked (got %)', revoke_outcome; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', guest_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.channels where id = channel_a_id;
  if row_count <> 0 then raise exception 'TEST FAILED: a revoked guest could still read their former channel'; end if;

  caught := false;
  begin
    insert into public.channel_messages (channel_id, sender_id, body) values (channel_a_id, guest_id, 'ZZ_TEST_188 should be revoked');
  exception when others then caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a revoked guest could still post a message in their former channel'; end if;

  raise notice 'TEST PASSED: Section (f) -- revocation immediately removes both read and write access';

  -- ============================================================
  -- Section (g): an EXPIRED-but-not-manually-revoked guest also loses
  -- access (inserted directly with a past expires_at, bypassing the
  -- invite flow, to isolate the expiry check itself).
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.channel_guests (channel_id, user_id, display_name, invited_by_email, expires_at)
    values (channel_a_id, guest2_id, 'Contractor Expired', real_user_id::text, now() - interval '1 hour');

  perform set_config('request.jwt.claims', json_build_object('sub', guest2_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.channels where id = channel_a_id;
  if row_count <> 0 then raise exception 'TEST FAILED: an expired (not revoked) guest could still read their channel'; end if;

  caught := false;
  begin
    insert into public.channel_messages (channel_id, sender_id, body) values (channel_a_id, guest2_id, 'ZZ_TEST_188 should be expired');
  exception when others then caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: an expired (not revoked) guest could still post a message'; end if;

  raise notice 'TEST PASSED: Section (g) -- an expired-but-not-revoked guest also loses both read and write access';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 188 EXTERNAL CHANNEL GUEST ACCESS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
