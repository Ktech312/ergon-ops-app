-- Transaction-safe canonical test for migration 190 (forward_attachment --
-- channel/DM attachment forwarding, smallest-useful-first-release scope).
-- Wrapped in begin;/rollback; -- nothing here ever commits. Every
-- synthetic workspace/user/channel/conversation/message this script
-- creates lives ONLY inside this rolled-back transaction.
--
-- Covers this task's own verification spec: (a) a workspace member can
-- forward a message they can see into another channel they can write to;
-- (a2) ...and into a DM they can write to; (b) forwarding into a
-- destination they CANNOT write to is rejected -- both "a channel in a
-- workspace they're not a member of" AND "a private group channel in
-- their OWN workspace they were never added to" (the destination's own
-- real INSERT policy, not just a workspace-membership shortcut); (c) a
-- caller cannot forward a source message they cannot read (source in a
-- workspace they are not a member of) -- resolves to 'source_not_found',
-- not an exception, matching RLS's own safe-empty posture; (d) a channel
-- guest cannot call this RPC AT ALL, not even to "forward" within their
-- own one channel, and not to reach any destination outside it.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 190 CHANNEL DM ATTACHMENT
-- FORWARDING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  colleague_id uuid := gen_random_uuid();       -- workspace A, DM destination partner
  private_group_owner_id uuid := gen_random_uuid(); -- workspace A, owns a private group real_user_id is NOT in
  guest_id uuid := gen_random_uuid();           -- guest of channel_a only
  ws_b uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();        -- workspace B only
  project_a_id uuid;
  channel_a_id uuid;   -- source channel (workspace A, real_user_id has full access)
  project_c_id uuid;
  channel_c_id uuid;   -- destination channel (workspace A, real_user_id has full access)
  channel_b_id uuid;   -- destination/source channel, workspace B (real_user_id has NO access)
  private_group_id uuid; -- workspace A, private group real_user_id was never added to
  conv_ac_id uuid;     -- conversation real_user_id <-> colleague_id, workspace A
  source_msg_id uuid;  -- channel_a message with an attachment, sender real_user_id
  ws_b_msg_id uuid;    -- workspace B message with an attachment, sender stranger_id
  outcome_val text;
  new_id_val uuid;
  row_count integer;
  caught boolean;
  forwarded_row record;
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

  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_190 Other Workspace', 'zz-test-190-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  insert into auth.users (id, email) values
    (colleague_id, 'zz-test-190-colleague@example.com'),
    (private_group_owner_id, 'zz-test-190-private-owner@example.com'),
    (guest_id, 'zz-test-190-guest@example.com'),
    (stranger_id, 'zz-test-190-stranger@example.com');

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (real_workspace_id, colleague_id, false),
    (real_workspace_id, private_group_owner_id, false),
    (ws_b, stranger_id, false);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (project_name) values ('ZZ_TEST_190 Project A') returning id into project_a_id;
  select id into channel_a_id from public.channels where type = 'project' and project_id = project_a_id;

  insert into public.projects (project_name) values ('ZZ_TEST_190 Project C') returning id into project_c_id;
  select id into channel_c_id from public.channels where type = 'project' and project_id = project_c_id;

  if channel_a_id is null or channel_c_id is null then
    raise exception 'TEST SETUP FAILED: could not resolve channel_a_id (%) or channel_c_id (%)', channel_a_id, channel_c_id;
  end if;

  -- A private group channel in the SAME workspace, owned by someone else,
  -- that real_user_id was never added to -- exercises the destination's
  -- real "private group, not a member" rejection, not just a coarse
  -- workspace-membership check. channels.workspace_id is ALWAYS
  -- trigger-derived from the inserting caller's own resolved workspace
  -- for a 'group' type (guard_channel_workspace_id_mutation(), migration
  -- 162) -- never trust a caller-supplied value -- so this must be done
  -- as an authenticated insert by private_group_owner_id (whose one and
  -- only membership is real_workspace_id), not as a raw postgres-role
  -- insert with an explicit workspace_id column.
  perform set_config('request.jwt.claims', json_build_object('sub', private_group_owner_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.channels (type, name, private, created_by)
    values ('group', 'ZZ_TEST_190 Private Group', true, private_group_owner_id)
    returning id into private_group_id;

  -- A group channel + message entirely inside workspace B -- real_user_id
  -- has no membership there at all. Same trigger-derivation reasoning as
  -- above: created as an authenticated insert by stranger_id (whose one
  -- and only membership is ws_b), not a raw postgres-role insert.
  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.channels (type, name, private, created_by)
    values ('group', 'ZZ_TEST_190 Workspace B Channel', false, stranger_id)
    returning id into channel_b_id;

  insert into public.channel_messages (channel_id, sender_id, body, attachment_storage_path, attachment_file_name, attachment_mime_type, attachment_size_bytes)
    values (channel_b_id, stranger_id, null, channel_b_id::text || '/zz-test-190-stranger-file.pdf', 'stranger-file.pdf', 'application/pdf', 4096)
    returning id into ws_b_msg_id;

  -- Confirm the trigger actually derived the workspaces this test relies
  -- on -- a silent misderivation here would make Sections (b1)/(c) pass
  -- for the wrong reason (or not exercise cross-workspace isolation at
  -- all), so fail loudly instead of trusting it.
  perform set_config('role', 'postgres', true);
  if (select workspace_id from public.channels where id = private_group_id) <> real_workspace_id then
    raise exception 'TEST SETUP FAILED: private_group_id was not stamped with real_workspace_id as expected';
  end if;
  if (select workspace_id from public.channels where id = channel_b_id) <> ws_b then
    raise exception 'TEST SETUP FAILED: channel_b_id was not stamped with ws_b as expected';
  end if;

  -- Back to real_user_id: the actual source message being forwarded
  -- throughout this test, posted in channel_a with a real attachment.
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.channel_messages (channel_id, sender_id, body, attachment_storage_path, attachment_file_name, attachment_mime_type, attachment_size_bytes)
    values (channel_a_id, real_user_id, 'ZZ_TEST_190 original message', channel_a_id::text || '/zz-test-190-drawing.pdf', 'drawing.pdf', 'application/pdf', 123456)
    returning id into source_msg_id;

  insert into public.conversations (participant_a_id, participant_b_id)
    select least(real_user_id, colleague_id), greatest(real_user_id, colleague_id)
    returning id into conv_ac_id;

  -- channel_guests row (migration 188) -- a guest of channel_a ONLY.
  perform set_config('role', 'postgres', true);
  insert into public.channel_guests (channel_id, user_id, display_name, invited_by_email)
    values (channel_a_id, guest_id, 'ZZ Test 190 Guest', (select email from auth.users where id = real_user_id));

  -- ============================================================
  -- Section (a): a workspace member can forward a message they can see
  -- into another channel they can write to (channel_a -> channel_c).
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, new_id into outcome_val, new_id_val
  from public.forward_attachment('channel_message', source_msg_id, 'channel', channel_c_id, 'fyi');

  if outcome_val <> 'forwarded' or new_id_val is null then
    raise exception 'TEST FAILED: forwarding into a writable destination channel did not succeed (outcome=%)', outcome_val;
  end if;

  select * into forwarded_row from public.channel_messages where id = new_id_val;
  if forwarded_row.channel_id <> channel_c_id
     or forwarded_row.sender_id <> real_user_id
     or forwarded_row.body <> 'fyi'
     or forwarded_row.attachment_storage_path <> (channel_a_id::text || '/zz-test-190-drawing.pdf')
     or forwarded_row.attachment_file_name <> 'drawing.pdf'
     or forwarded_row.attachment_size_bytes <> 123456
     or forwarded_row.forwarded_from_message_id <> source_msg_id
     or forwarded_row.forwarded_from_kind <> 'channel_message'
  then
    raise exception 'TEST FAILED: the forwarded channel_messages row did not carry the expected copied attachment fields / lineage columns (got %)', to_jsonb(forwarded_row);
  end if;

  raise notice 'TEST PASSED: Section (a) -- a workspace member can forward a message into another channel they can write to, with attachment fields and lineage columns copied correctly';

  -- ============================================================
  -- Section (a2): the same source message can also be forwarded into a DM
  -- the caller is a participant in (channel -> conversation).
  -- ============================================================

  select outcome, new_id into outcome_val, new_id_val
  from public.forward_attachment('channel_message', source_msg_id, 'conversation', conv_ac_id, null);

  if outcome_val <> 'forwarded' or new_id_val is null then
    raise exception 'TEST FAILED: forwarding into a writable DM did not succeed (outcome=%)', outcome_val;
  end if;

  select count(*) into row_count
  from public.direct_messages
  where id = new_id_val
    and conversation_id = conv_ac_id
    and sender_id = real_user_id
    and attachment_file_name = 'drawing.pdf'
    and forwarded_from_message_id = source_msg_id
    and forwarded_from_kind = 'channel_message';
  if row_count <> 1 then
    raise exception 'TEST FAILED: the forwarded direct_messages row did not carry the expected copied attachment fields / lineage columns';
  end if;

  raise notice 'TEST PASSED: Section (a2) -- the same source message can also be forwarded into a DM the caller participates in';

  -- ============================================================
  -- Section (b): forwarding into a destination the caller CANNOT write to
  -- is rejected -- (b1) a channel in a workspace they are not a member
  -- of, (b2) a private group channel in their OWN workspace they were
  -- never added to. Both must surface as a raised exception, per this
  -- RPC's own design (destination rejection is not a soft outcome).
  -- ============================================================

  caught := false;
  begin
    perform public.forward_attachment('channel_message', source_msg_id, 'channel', channel_b_id, null);
  exception when others then caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: forwarding into a channel in a workspace the caller is not a member of was NOT rejected'; end if;

  caught := false;
  begin
    perform public.forward_attachment('channel_message', source_msg_id, 'channel', private_group_id, null);
  exception when others then caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: forwarding into a private group channel the caller was never added to was NOT rejected'; end if;

  -- Neither rejected attempt should have left a stray row anywhere.
  select count(*) into row_count from public.channel_messages where channel_id in (channel_b_id, private_group_id) and forwarded_from_message_id = source_msg_id;
  if row_count <> 0 then raise exception 'TEST FAILED: a rejected forward attempt still left % row(s) at the destination', row_count; end if;

  raise notice 'TEST PASSED: Section (b) -- forwarding into a destination the caller cannot write to is rejected, both cross-workspace and same-workspace-but-not-a-member cases, with no stray rows left behind';

  -- ============================================================
  -- Section (c): a caller cannot forward a source message they cannot
  -- read at all (a message that lives entirely in a workspace they are
  -- not a member of) -- resolves to 'source_not_found', matching RLS's
  -- own safe-empty posture, not an exception.
  -- ============================================================

  select outcome, new_id into outcome_val, new_id_val
  from public.forward_attachment('channel_message', ws_b_msg_id, 'channel', channel_c_id, null);

  if outcome_val <> 'source_not_found' or new_id_val is not null then
    raise exception 'TEST FAILED: forwarding an unreadable source message expected outcome=source_not_found/new_id=null, got outcome=%, new_id=%', outcome_val, new_id_val;
  end if;

  raise notice 'TEST PASSED: Section (c) -- a caller cannot forward a source message they cannot read (resolves to source_not_found, not an exception)';

  -- ============================================================
  -- Section (d): a channel guest cannot call this RPC AT ALL -- not to
  -- "forward" within their own one channel, and not to reach any
  -- destination outside it. Every call as the guest must raise.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', guest_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- (d1) the guest CAN read source_msg_id directly (it's in their own
  -- channel, migration 188's own guarantee) -- confirms this isn't a
  -- vacuous test because the guest can't see the source at all.
  select count(*) into row_count from public.channel_messages where id = source_msg_id;
  if row_count <> 1 then raise exception 'TEST SETUP INVALID: the guest could not read source_msg_id directly via normal RLS -- Section (d) would not meaningfully exercise the RPC''s own guest exclusion'; end if;

  caught := false;
  begin
    perform public.forward_attachment('channel_message', source_msg_id, 'channel', channel_a_id, null);
  exception when others then caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a channel guest was able to call forward_attachment targeting their OWN channel as the destination'; end if;

  caught := false;
  begin
    perform public.forward_attachment('channel_message', source_msg_id, 'channel', channel_c_id, null);
  exception when others then caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a channel guest was able to call forward_attachment targeting a destination outside their one channel'; end if;

  caught := false;
  begin
    perform public.forward_attachment('channel_message', source_msg_id, 'conversation', conv_ac_id, null);
  exception when others then caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a channel guest was able to call forward_attachment targeting a DM'; end if;

  -- No stray rows anywhere as a result of the guest's attempts.
  select count(*) into row_count from public.channel_messages where forwarded_from_message_id = source_msg_id and sender_id = guest_id;
  if row_count <> 0 then raise exception 'TEST FAILED: a channel guest''s forward attempts left % stray row(s)', row_count; end if;

  raise notice 'TEST PASSED: Section (d) -- a channel guest cannot call forward_attachment at all, regardless of destination, even though they can read the source message directly';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 190 CHANNEL DM ATTACHMENT FORWARDING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
