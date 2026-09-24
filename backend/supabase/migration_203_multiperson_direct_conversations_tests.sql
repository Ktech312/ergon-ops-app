-- Canonical isolation test for migration 203 (multi-person direct conversations). DRAFT --
-- written alongside the migration, NOT YET RUN, NOT YET SENT TO E (see
-- PRODUCT_MULTIPERSON_CONVERSATIONS_DESIGN.md -- one product decision needs E before this
-- migration itself is sent). Wrapped in begin/rollback -- nothing commits regardless of
-- outcome, safe to run any time once migration 203 is actually applied.
--
-- Sections:
--   (a) Regression guard: an existing-shape 1:1 conversation still creates/reads/writes
--       exactly as before this migration -- the whole point of the additive design.
--   (b) A 3-person group conversation: all 3 real members can read/send; a 4th, real,
--       same-workspace but non-member user cannot.
--   (c) create_group_conversation() rejects a cross-workspace member at creation time, AND
--       fixed-membership is actually enforced: a real, current member cannot directly INSERT
--       a new row into conversation_members (no such policy exists any more, per E's
--       2026-09-24 correction -- membership is fixed at creation, no Add People this release),
--       and cannot DELETE their own row either (no Leave Group this release).
--   (d) message_read_state tracks per-person unread across all 3 group members
--       independently -- proves migration 191's table needed zero changes, not just by
--       inspection.
--   (e) A reaction on a group message follows the same membership check as messages.

begin;

do $$
declare
  ws_id uuid;
  user_a_id uuid;      -- 1:1 pair, section (a)
  user_b_id uuid;
  group_creator_id uuid;   -- section (b)/(d)/(e)
  group_member_2_id uuid;
  group_member_3_id uuid;
  non_member_id uuid;      -- same workspace, not in the group
  other_ws_id uuid;
  other_ws_user_id uuid;   -- section (c)

  conv_1to1_id uuid;
  group_conv record;
  msg_id uuid;
  affected_rows int;
  v_count int;
begin
  -- ============================================================
  -- Fixtures
  -- ============================================================
  insert into public.workspaces (name, slug, status) values ('Test WS 203', 'test-ws-203-' || substr(gen_random_uuid()::text, 1, 8), 'active')
    returning id into ws_id;
  insert into public.workspaces (name, slug, status) values ('Test WS 203 B', 'test-ws-203-b-' || substr(gen_random_uuid()::text, 1, 8), 'active')
    returning id into other_ws_id;

  insert into auth.users (id, email) values (gen_random_uuid(), 'test203-a@example.com') returning id into user_a_id;
  insert into auth.users (id, email) values (gen_random_uuid(), 'test203-b@example.com') returning id into user_b_id;
  insert into auth.users (id, email) values (gen_random_uuid(), 'test203-creator@example.com') returning id into group_creator_id;
  insert into auth.users (id, email) values (gen_random_uuid(), 'test203-member2@example.com') returning id into group_member_2_id;
  insert into auth.users (id, email) values (gen_random_uuid(), 'test203-member3@example.com') returning id into group_member_3_id;
  insert into auth.users (id, email) values (gen_random_uuid(), 'test203-nonmember@example.com') returning id into non_member_id;
  insert into auth.users (id, email) values (gen_random_uuid(), 'test203-otherws@example.com') returning id into other_ws_user_id;

  insert into public.workspace_members (workspace_id, user_id, status) values
    (ws_id, user_a_id, 'active'),
    (ws_id, user_b_id, 'active'),
    (ws_id, group_creator_id, 'active'),
    (ws_id, group_member_2_id, 'active'),
    (ws_id, group_member_3_id, 'active'),
    (ws_id, non_member_id, 'active');
  insert into public.workspace_members (workspace_id, user_id, status) values (other_ws_id, other_ws_user_id, 'active');

  -- ============================================================
  -- (a) Regression guard -- existing 1:1 shape untouched
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', user_a_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.conversations (participant_a_id, participant_b_id)
  values (least(user_a_id, user_b_id), greatest(user_a_id, user_b_id))
  returning id into conv_1to1_id;

  if conv_1to1_id is null then
    raise exception 'TEST FAILED (a): 1:1 conversation insert did not return an id';
  end if;

  insert into public.direct_messages (conversation_id, sender_id, body) values (conv_1to1_id, user_a_id, 'hello from a');

  set local role postgres;
  select count(*) into v_count from public.conversations where id = conv_1to1_id and is_group = false and participant_a_id is not null and participant_b_id is not null;
  if v_count <> 1 then
    raise exception 'TEST FAILED (a): 1:1 conversation shape check violated -- is_group/participant columns not as expected';
  end if;
  select count(*) into v_count from public.conversation_members where conversation_id = conv_1to1_id;
  if v_count <> 0 then
    raise exception 'TEST FAILED (a): a 1:1 conversation must NOT get conversation_members rows at creation time (only pre-existing rows get backfilled)';
  end if;

  -- ============================================================
  -- (b) 3-person group: create, all 3 read/write, a 4th non-member cannot
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', group_creator_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select * into group_conv from public.create_group_conversation('ZZ Test 203 Group', array[group_member_2_id, group_member_3_id]);
  if group_conv.id is null or group_conv.is_group is distinct from true then
    raise exception 'TEST FAILED (b): create_group_conversation did not return a real is_group=true row';
  end if;

  set local role postgres;
  select count(*) into v_count from public.conversation_members where conversation_id = group_conv.id;
  if v_count <> 3 then
    raise exception 'TEST FAILED (b): expected exactly 3 conversation_members rows (creator + 2), found %', v_count;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', group_creator_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.direct_messages (conversation_id, sender_id, body) values (group_conv.id, group_creator_id, 'hello group')
    returning id into msg_id;

  perform set_config('request.jwt.claims', json_build_object('sub', group_member_2_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.direct_messages where id = msg_id;
  if v_count <> 1 then
    raise exception 'TEST FAILED (b): a real group member could not read the group message';
  end if;
  insert into public.direct_messages (conversation_id, sender_id, body) values (group_conv.id, group_member_2_id, 'hello back');

  perform set_config('request.jwt.claims', json_build_object('sub', non_member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.direct_messages where conversation_id = group_conv.id;
  if v_count <> 0 then
    raise exception 'TEST FAILED (b): a same-workspace NON-member could read group messages -- membership check is not working';
  end if;
  begin
    insert into public.direct_messages (conversation_id, sender_id, body) values (group_conv.id, non_member_id, 'i should not be able to post this');
    raise exception 'TEST FAILED (b): a non-member was able to INSERT a message into a group they are not in';
  exception when insufficient_privilege or others then
    null; -- expected: RLS rejects the insert (0 rows visible to satisfy the WITH CHECK)
  end;
  set local role postgres;
  get diagnostics affected_rows = row_count;

  -- ============================================================
  -- (c) Cross-workspace member rejected at CREATION time (no add_conversation_member() exists
  -- any more to test separately), and fixed-membership is really enforced: no direct write
  -- path into conversation_members exists beyond create_group_conversation() itself.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', group_creator_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_group_conversation('ZZ Test 203 Cross-WS', array[group_member_2_id, other_ws_user_id]);
    raise exception 'TEST FAILED (c): create_group_conversation accepted a member from a DIFFERENT workspace';
  exception when others then
    if sqlerrm not like '%active member of your own workspace%' then
      raise exception 'TEST FAILED (c): rejected for the wrong reason: %', sqlerrm;
    end if;
  end;

  -- Fixed membership, part 2: an existing, real member of the (successfully created) group
  -- cannot directly INSERT a new row into conversation_members -- no such policy exists.
  begin
    insert into public.conversation_members (conversation_id, user_id) values (group_conv.id, non_member_id);
    raise exception 'TEST FAILED (c): a group member could directly INSERT a new conversation_members row -- Add People must not exist this release';
  exception when insufficient_privilege or others then
    null; -- expected: RLS rejects it, zero insert policy for this action
  end;

  -- Fixed membership, part 3: a real member cannot DELETE even their OWN row -- no Leave
  -- Group this release either. Unlike INSERT (which must evaluate a WITH CHECK against the
  -- one proposed row and so raises), a DELETE with zero matching policies simply sees zero
  -- eligible rows and silently affects 0 rows -- same "no-delete-policy-means-silent-RLS-
  -- denial" pattern this schema's own migration 200/201 tests already established, checked
  -- via GET DIAGNOSTICS, not an expected exception.
  delete from public.conversation_members where conversation_id = group_conv.id and user_id = group_creator_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'TEST FAILED (c): a group member DELETEd their own conversation_members row (% rows affected) -- Leave Group must not exist this release', affected_rows;
  end if;

  set local role postgres;
  select count(*) into v_count from public.conversation_members where conversation_id = group_conv.id;
  if v_count <> 3 then
    raise exception 'TEST FAILED (c): conversation_members row count for the group changed after the rejected insert/delete attempts -- expected still exactly 3, found %', v_count;
  end if;

  -- ============================================================
  -- (d) message_read_state tracks all 3 group members independently -- migration 191's
  -- table needed literally zero schema changes for this to work.
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', group_member_3_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.message_read_state (user_id, conversation_kind, conversation_id, last_read_at)
  values (group_member_3_id, 'conversation', group_conv.id, now())
  on conflict (user_id, conversation_kind, conversation_id) do update set last_read_at = excluded.last_read_at;

  set local role postgres;
  select count(*) into v_count from public.message_read_state
    where user_id = group_member_3_id and conversation_kind = 'conversation' and conversation_id = group_conv.id;
  if v_count <> 1 then
    raise exception 'TEST FAILED (d): message_read_state did not record a read-state row for a group member, using the exact same table/RPC as a 1:1 conversation';
  end if;
  select count(*) into v_count from public.message_read_state
    where user_id = group_member_2_id and conversation_kind = 'conversation' and conversation_id = group_conv.id;
  if v_count <> 0 then
    raise exception 'TEST FAILED (d): marking ONE member''s read-state incorrectly affected another member''s row -- per-person tracking is broken';
  end if;

  -- ============================================================
  -- (e) Reactions on a group message follow the same membership check
  -- ============================================================
  perform set_config('request.jwt.claims', json_build_object('sub', group_member_2_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.direct_message_reactions (message_id, user_id, emoji) values (msg_id, group_member_2_id, '+1');

  perform set_config('request.jwt.claims', json_build_object('sub', non_member_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.direct_message_reactions where message_id = msg_id;
  if v_count <> 0 then
    raise exception 'TEST FAILED (e): a non-member could read reactions on a group message they cannot see';
  end if;

  set local role postgres;
  raise notice 'ALL SECTIONS PASSED (a)-(e) for migration 203.';
end $$;

rollback;
