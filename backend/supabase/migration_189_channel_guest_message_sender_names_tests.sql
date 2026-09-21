-- Transaction-safe canonical test for migration 189 (channel guest
-- message sender-name resolution, get_channel_message_sender_names).
-- Wrapped in begin;/rollback; -- nothing here ever commits. The synthetic
-- users, projects, channels, guest row, and messages this script creates
-- live ONLY inside this rolled-back transaction.
--
-- Covers this task's own containment spec: (a) a guest of channel A can
-- resolve real display names for channel A's real senders -- both a
-- normal employee sender (via the team_members.full_name branch) and a
-- sender with no team_members match (via the email-local-part fallback
-- branch, mirroring senderNameFor's own real client-side logic); (b) that
-- SAME guest CANNOT resolve names for channel B, a different channel they
-- have no access to, even though channel B has a real message in it;
-- (c) a normal workspace member with real channel access can also call
-- this RPC for their own channels; (d) a caller with neither workspace
-- membership nor any channel_guests row at all resolves nothing for
-- either channel.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 189 CHANNEL GUEST MESSAGE
-- SENDER NAMES TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_email text;
  existing_full_name text;
  existing_role_title text;
  expected_real_display_name text;
  project_a_id uuid;
  channel_a_id uuid;
  project_b_id uuid;
  channel_b_id uuid;
  guest_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  guest_email text := 'zz-test-189-guest@example.com';
  row_count integer;
  resolved_name text;
begin
  -- ============================================================
  -- Setup: a real, existing app_admin who is also an active workspace
  -- member (same discovery pattern as every other canonical test in this
  -- suite), two real projects (auto-creating two real project channels),
  -- a real team_members row for the employee (reusing one if this fixture
  -- DB already has one for this email, never clobbering it), a synthetic
  -- guest auth.users row invited to channel A only, and a third
  -- "outsider" auth.users row with neither workspace membership nor any
  -- channel_guests row at all.
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

  select email into real_email from auth.users where id = real_user_id;

  perform set_config('role', 'postgres', true);
  insert into auth.users (id, email) values
    (guest_id, guest_email),
    (outsider_id, 'zz-test-189-outsider@example.com');

  -- app_known_users rows -- the new RPC reads this directly (SECURITY
  -- DEFINER), but in production it's upserted on every real sign-in, so
  -- seed it explicitly here rather than relying on any other migration's
  -- test-fixture side effects.
  insert into public.app_known_users (user_id, email) values
    (real_user_id, real_email),
    (guest_id, guest_email)
  on conflict (user_id) do update set email = excluded.email;

  -- Switch to the real employee's own authenticated session BEFORE
  -- touching team_members -- that table's guard_workspace_id_mutation
  -- trigger (migration 175, reusing migration 117's trigger verbatim)
  -- derives workspace_id from auth.uid() via resolve_caller_workspace_id(),
  -- ignoring whatever this insert supplies, so auth.uid() must already
  -- resolve to a real, single active workspace membership at insert time.
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select full_name, role_title into existing_full_name, existing_role_title
  from public.team_members
  where workspace_id = real_workspace_id and lower(email) = lower(real_email);

  if existing_full_name is null or btrim(existing_full_name) = '' then
    insert into public.team_members (workspace_id, full_name, email)
      values (real_workspace_id, 'ZZ Test 189 Sender Employee', real_email);
    expected_real_display_name := 'ZZ Test 189 Sender Employee';
  else
    expected_real_display_name := btrim(existing_full_name) || case
      when existing_role_title is not null and btrim(existing_role_title) <> '' then ' ' || btrim(existing_role_title)
      else ''
    end;
  end if;

  insert into public.projects (project_name) values ('ZZ_TEST_189 Project A') returning id into project_a_id;
  select id into channel_a_id from public.channels where type = 'project' and project_id = project_a_id;

  insert into public.projects (project_name) values ('ZZ_TEST_189 Project B') returning id into project_b_id;
  select id into channel_b_id from public.channels where type = 'project' and project_id = project_b_id;

  if channel_a_id is null or channel_b_id is null then
    raise exception 'TEST SETUP FAILED: could not resolve channel_a_id (%) or channel_b_id (%)', channel_a_id, channel_b_id;
  end if;

  -- Real employee messages in BOTH channels (channel B's message exists
  -- specifically so Section (b) proves the guest's empty result is an
  -- authorization gate, not just "channel B happens to have no messages").
  insert into public.channel_messages (channel_id, sender_id, body)
    values (channel_a_id, real_user_id, 'ZZ_TEST_189 real employee message in channel A');
  insert into public.channel_messages (channel_id, sender_id, body)
    values (channel_b_id, real_user_id, 'ZZ_TEST_189 real employee message in channel B');

  perform set_config('role', 'postgres', true);
  insert into public.channel_guests (channel_id, user_id, display_name, invited_by_email)
    values (channel_a_id, guest_id, 'ZZ Test 189 Guest', real_email);

  perform set_config('request.jwt.claims', json_build_object('sub', guest_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.channel_messages (channel_id, sender_id, body)
    values (channel_a_id, guest_id, 'ZZ_TEST_189 guest message in channel A');

  -- ============================================================
  -- Section (a): the guest can resolve real display names for channel A's
  -- real senders -- both the team_members.full_name branch (the real
  -- employee) and the email-local-part fallback branch (the guest's own
  -- message -- no team_members row matches their email).
  -- ============================================================

  select count(*) into row_count from public.get_channel_message_sender_names(channel_a_id);
  if row_count <> 2 then
    raise exception 'TEST FAILED: guest resolving channel A sender names expected 2 rows, got %', row_count;
  end if;

  select display_name into resolved_name
  from public.get_channel_message_sender_names(channel_a_id)
  where user_id = real_user_id;
  if resolved_name is distinct from expected_real_display_name then
    raise exception 'TEST FAILED: guest resolved the real employee''s name as % (expected %, via team_members.full_name)', resolved_name, expected_real_display_name;
  end if;

  select display_name into resolved_name
  from public.get_channel_message_sender_names(channel_a_id)
  where user_id = guest_id;
  if resolved_name is distinct from split_part(guest_email, '@', 1) then
    raise exception 'TEST FAILED: guest resolved their own name (no team_members match) as % (expected email-local-part fallback %)', resolved_name, split_part(guest_email, '@', 1);
  end if;

  raise notice 'TEST PASSED: Section (a) -- a channel guest can resolve real display names for their own channel''s real senders, via both the full_name and email-local-part-fallback branches';

  -- ============================================================
  -- Section (b): that SAME guest CANNOT resolve names for channel B, a
  -- different channel they have no access to, even though channel B has a
  -- real message in it.
  -- ============================================================

  select count(*) into row_count from public.get_channel_message_sender_names(channel_b_id);
  if row_count <> 0 then
    raise exception 'TEST FAILED: a guest of channel A could resolve % sender name(s) for channel B, a channel they have no access to', row_count;
  end if;

  raise notice 'TEST PASSED: Section (b) -- a channel guest cannot resolve sender names for a different channel they have no access to';

  -- ============================================================
  -- Section (c): a normal workspace member with real channel access can
  -- also call this RPC for their own channels (both A and B).
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.get_channel_message_sender_names(channel_a_id);
  if row_count <> 2 then
    raise exception 'TEST FAILED: a normal workspace member with real access to channel A expected 2 resolved sender names, got %', row_count;
  end if;

  select count(*) into row_count from public.get_channel_message_sender_names(channel_b_id);
  if row_count <> 1 then
    raise exception 'TEST FAILED: a normal workspace member with real access to channel B expected 1 resolved sender name, got %', row_count;
  end if;

  raise notice 'TEST PASSED: Section (c) -- a normal workspace member with real channel access can resolve sender names for their own channels';

  -- ============================================================
  -- Section (d): a caller with neither workspace membership nor any
  -- channel_guests row at all gets nothing back, for either channel.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', outsider_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.get_channel_message_sender_names(channel_a_id);
  if row_count <> 0 then
    raise exception 'TEST FAILED: a caller with no workspace membership and no channel_guests row at all could resolve % sender name(s) for channel A', row_count;
  end if;

  select count(*) into row_count from public.get_channel_message_sender_names(channel_b_id);
  if row_count <> 0 then
    raise exception 'TEST FAILED: a caller with no workspace membership and no channel_guests row at all could resolve % sender name(s) for channel B', row_count;
  end if;

  raise notice 'TEST PASSED: Section (d) -- a caller with no workspace membership and no channel_guests row at all resolves zero sender names for any channel';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 189 CHANNEL GUEST MESSAGE SENDER NAMES TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
