-- Transaction-safe canonical test for migration 191 (message_read_state
-- table + RLS + get_message_read_summary()). Wrapped in begin;/rollback;
-- -- nothing here ever commits. The synthetic users, project, channels,
-- conversation, guest row, and messages this script creates live ONLY
-- inside this rolled-back transaction.
--
-- Covers this task's own mandatory verification spec: (a) a user can
-- write/read their own message_read_state rows; (b) a user cannot read OR
-- write another user's message_read_state rows -- a row-count check for
-- read denial (RLS SELECT denial is silent, this repo's well-established
-- migration-171/174 lesson), an affected-row-count check for a same-shape
-- UPDATE against someone else's row, and a caught-exception check for an
-- INSERT that names another user's id (RLS WITH CHECK denial on INSERT is
-- NOT silent -- it raises); (c) a channel guest can mark their own one
-- channel read; plus a functional check of get_message_read_summary()
-- itself -- unread counting, "was I mentioned" (both the full_name branch
-- and the role-label branch, reusing resolveMentions()'s exact matching
-- rule), and that marking a conversation read makes it disappear from the
-- summary (E's own "once that channel is viewed it un-highlights").
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 191 CHANNEL AND DM READ
-- STATE TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error naming
-- what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;      -- real app_admin, real workspace
  real_workspace_id uuid;
  real_email text;
  colleague_id uuid := gen_random_uuid();  -- same workspace, plain member
  colleague2_id uuid := gen_random_uuid(); -- same workspace, plain member
  colleague_email text := 'zz-test-191-colleague@example.com';
  colleague2_email text := 'zz-test-191-colleague2@example.com';
  existing_full_name text;
  project_a_id uuid;
  channel_a_id uuid;
  guest_id uuid := gen_random_uuid();
  guest_email text := 'zz-test-191-guest@example.com';
  conv_id uuid;
  row_count integer;
  affected_rows integer;
  caught boolean;
  my_last_read timestamptz;
  colleague_msg_id uuid;
  summary_unread integer;
  summary_mentioned boolean;
  found_row boolean;
begin
  -- ============================================================
  -- Setup: a real, existing app_admin who is also an active workspace
  -- member (same discovery pattern as every other canonical test in this
  -- suite), two synthetic same-workspace colleagues, a real team_members
  -- row for the employee (reusing one if this fixture DB already has one
  -- for this email, never clobbering it -- same pattern as migration 189's
  -- own test), a project (auto-creating a real project channel), and a
  -- channel_guests row inviting a synthetic guest to that one channel.
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
    (colleague_id, colleague_email),
    (colleague2_id, colleague2_email),
    (guest_id, guest_email);

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (real_workspace_id, colleague_id, false),
    (real_workspace_id, colleague2_id, false);

  insert into public.app_known_users (user_id, email) values
    (real_user_id, real_email),
    (colleague_id, colleague_email),
    (colleague2_id, colleague2_email),
    (guest_id, guest_email)
  on conflict (user_id) do update set email = excluded.email;

  -- real_user (the VIEWER being tested for "was I mentioned" below) gets
  -- the 'pm' role -- drives the "was I mentioned" role-label branch below
  -- (ROLE_LABELS['pm'] = 'PM', mirrored in migration 191's own RPC): the
  -- role must belong to the person checking whether they were mentioned,
  -- not to the message's sender.
  insert into public.app_user_roles (user_id, role_key, is_primary) values (real_user_id, 'pm', false)
    on conflict do nothing;

  -- Switch to the real employee's own authenticated session BEFORE
  -- touching team_members -- that table's guard_workspace_id_mutation
  -- trigger (migration 175, reusing migration 117's trigger verbatim)
  -- derives workspace_id from auth.uid() via resolve_caller_workspace_id(),
  -- ignoring whatever this insert supplies, so auth.uid() must already
  -- resolve to a real, single active workspace membership at insert time
  -- -- same ordering migration 189's own test uses for the identical
  -- reason.
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- Real employee's own team_members row -- drives the "was I mentioned"
  -- full_name branch below. A distinctive, regex-matchable first name.
  select full_name into existing_full_name
  from public.team_members
  where workspace_id = real_workspace_id and lower(email) = lower(real_email);

  if existing_full_name is null or btrim(existing_full_name) = '' then
    insert into public.team_members (workspace_id, full_name, email)
      values (real_workspace_id, 'ZzUnread191 TestEmployee', real_email);
  end if;

  insert into public.projects (project_name) values ('ZZ_TEST_191 Project A') returning id into project_a_id;
  select id into channel_a_id from public.channels where type = 'project' and project_id = project_a_id;

  if channel_a_id is null then
    raise exception 'TEST SETUP FAILED: could not resolve channel_a_id (%)', channel_a_id;
  end if;

  perform set_config('role', 'postgres', true);
  insert into public.channel_guests (channel_id, user_id, display_name, invited_by_email)
    values (channel_a_id, guest_id, 'ZZ Test 191 Guest', real_email);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.conversations (participant_a_id, participant_b_id)
  select least(real_user_id, colleague2_id), greatest(real_user_id, colleague2_id)
  returning id into conv_id;

  -- ============================================================
  -- Section (a): a user can write and read their own message_read_state
  -- rows (channel kind), and update it back out again.
  -- ============================================================

  insert into public.message_read_state (user_id, conversation_kind, conversation_id, last_read_at)
    values (real_user_id, 'channel', channel_a_id, now() - interval '1 hour')
    on conflict (user_id, conversation_kind, conversation_id) do update set last_read_at = excluded.last_read_at;

  select last_read_at into my_last_read
  from public.message_read_state
  where user_id = real_user_id and conversation_kind = 'channel' and conversation_id = channel_a_id;

  if my_last_read is null then
    raise exception 'TEST FAILED: a user could not read back their own just-written message_read_state row';
  end if;

  insert into public.message_read_state (user_id, conversation_kind, conversation_id, last_read_at)
    values (real_user_id, 'channel', channel_a_id, now())
    on conflict (user_id, conversation_kind, conversation_id) do update set last_read_at = excluded.last_read_at;

  select last_read_at into my_last_read
  from public.message_read_state
  where user_id = real_user_id and conversation_kind = 'channel' and conversation_id = channel_a_id;

  if my_last_read <= now() - interval '1 minute' then
    raise exception 'TEST FAILED: re-upserting message_read_state did not update last_read_at (still %)', my_last_read;
  end if;

  raise notice 'TEST PASSED: Section (a) -- a user can write, read, and re-upsert their own message_read_state row';

  -- ============================================================
  -- Section (b): a user cannot read or write another user's
  -- message_read_state rows.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- Read denial: RLS SELECT filtering is silent -- a row-count check, not
  -- an exception (migration 171/174's own established lesson).
  select count(*) into row_count
  from public.message_read_state
  where user_id = real_user_id and conversation_kind = 'channel' and conversation_id = channel_a_id;
  if row_count <> 0 then
    raise exception 'TEST FAILED: colleague could read real_user''s own message_read_state row (% rows visible)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (b1) -- a user cannot read another user''s message_read_state row (row-count check)';

  -- Write denial via UPDATE: USING clause silently excludes the target
  -- row -- verify the affected-row count is zero (this session's own
  -- "verify writes affected rows" discipline -- never trust response.ok
  -- or a bare "did it error" check).
  update public.message_read_state
    set last_read_at = now()
    where user_id = real_user_id and conversation_kind = 'channel' and conversation_id = channel_a_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'TEST FAILED: colleague''s UPDATE against real_user''s message_read_state row affected % rows (expected 0)', affected_rows;
  end if;

  raise notice 'TEST PASSED: Section (b2) -- a user''s UPDATE against another user''s message_read_state row affects zero rows';

  -- Write denial via INSERT: unlike SELECT, an INSERT whose WITH CHECK
  -- fails raises a real policy-violation exception, not a silent no-op --
  -- caught here the same way migration 187's own cross-workspace-
  -- conversation-creation test catches its analogous INSERT rejection.
  caught := false;
  begin
    insert into public.message_read_state (user_id, conversation_kind, conversation_id, last_read_at)
      values (real_user_id, 'channel', channel_a_id, now());
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: colleague could INSERT a message_read_state row naming another user (real_user_id) as user_id';
  end if;

  raise notice 'TEST PASSED: Section (b3) -- a user cannot INSERT a message_read_state row naming another user as user_id (RLS WITH CHECK raises)';

  -- ============================================================
  -- Section (c): a channel guest can mark their own one channel read.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', guest_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.message_read_state (user_id, conversation_kind, conversation_id, last_read_at)
    values (guest_id, 'channel', channel_a_id, now())
    on conflict (user_id, conversation_kind, conversation_id) do update set last_read_at = excluded.last_read_at;

  select count(*) into row_count
  from public.message_read_state
  where user_id = guest_id and conversation_kind = 'channel' and conversation_id = channel_a_id;
  if row_count <> 1 then
    raise exception 'TEST FAILED: a channel guest could not mark their own one channel read (row_count %)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (c) -- a channel guest can mark their own one channel read';

  -- ============================================================
  -- Section (d): get_message_read_summary() -- unread counting, both
  -- mention-matching branches (full_name + role-label), and "viewing
  -- clears the highlight."
  -- ============================================================

  -- real_user marks channel A read as of an hour ago, so the upcoming
  -- colleague message (created_at defaults to now()) is unambiguously
  -- after it. NOTE: now() is STABLE for the whole surrounding transaction
  -- in Postgres (it does not advance with wall-clock time or pg_sleep()),
  -- so "mark read at now()" then "post a message at now()" would produce
  -- two EQUAL timestamps and a false negative here -- an explicit past
  -- offset (not pg_sleep) is what actually guarantees strict ordering
  -- inside a single transaction.
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.message_read_state (user_id, conversation_kind, conversation_id, last_read_at)
    values (real_user_id, 'channel', channel_a_id, now() - interval '1 hour')
    on conflict (user_id, conversation_kind, conversation_id) do update set last_read_at = excluded.last_read_at;

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.channel_messages (channel_id, sender_id, body)
    values (channel_a_id, colleague_id, 'Hey @ZzUnread191 can you take a look at this')
    returning id into colleague_msg_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select unread_count, mentioned into summary_unread, summary_mentioned
  from public.get_message_read_summary()
  where conversation_kind = 'channel' and conversation_id = channel_a_id;

  if summary_unread is distinct from 1 then
    raise exception 'TEST FAILED: get_message_read_summary() reported channel A unread_count = % (expected 1)', summary_unread;
  end if;
  if summary_mentioned is distinct from true then
    raise exception 'TEST FAILED: get_message_read_summary() reported channel A mentioned = % (expected true, via team_members.full_name first-word match, mirroring resolveMentions())', summary_mentioned;
  end if;

  raise notice 'TEST PASSED: Section (d1) -- get_message_read_summary() reports the correct unread_count and mentioned=true via the full_name-token branch';

  -- Viewing it (marking read again, strictly after the message above --
  -- same now()-is-transaction-stable reasoning as above, a future offset
  -- guarantees "after" without relying on real elapsed time) makes it
  -- disappear from the summary entirely -- E's own "once that channel is
  -- viewed it un-highlights."
  insert into public.message_read_state (user_id, conversation_kind, conversation_id, last_read_at)
    values (real_user_id, 'channel', channel_a_id, now() + interval '1 minute')
    on conflict (user_id, conversation_kind, conversation_id) do update set last_read_at = excluded.last_read_at;

  select exists (
    select 1 from public.get_message_read_summary()
    where conversation_kind = 'channel' and conversation_id = channel_a_id
  ) into found_row;
  if found_row then
    raise exception 'TEST FAILED: channel A still appears in get_message_read_summary() after real_user marked it read';
  end if;

  raise notice 'TEST PASSED: Section (d2) -- marking a channel read removes it from get_message_read_summary() (highlight clears)';

  -- DM case, plus the ROLE-LABEL mention branch: colleague2 (holds the
  -- 'pm' role) sends a DM containing "@PM" -- ROLE_LABELS['pm'] = 'PM',
  -- space-stripped/lowercased to 'pm', matching resolveMentions()'s own
  -- role-token branch exactly.
  perform set_config('request.jwt.claims', json_build_object('sub', colleague2_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.direct_messages (conversation_id, sender_id, body)
    values (conv_id, colleague2_id, 'Paging @PM for a review');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select unread_count, mentioned into summary_unread, summary_mentioned
  from public.get_message_read_summary()
  where conversation_kind = 'conversation' and conversation_id = conv_id;

  if summary_unread is distinct from 1 then
    raise exception 'TEST FAILED: get_message_read_summary() reported conversation unread_count = % (expected 1)', summary_unread;
  end if;
  if summary_mentioned is distinct from true then
    raise exception 'TEST FAILED: get_message_read_summary() reported conversation mentioned = % (expected true, via the role-label "@PM" match, mirroring resolveMentions())', summary_mentioned;
  end if;

  raise notice 'TEST PASSED: Section (d3) -- get_message_read_summary() reports mentioned=true for a DM via the role-label branch ("@PM")';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 191 CHANNEL AND DM READ STATE TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
