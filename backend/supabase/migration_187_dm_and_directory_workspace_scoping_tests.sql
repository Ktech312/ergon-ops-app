-- Transaction-safe canonical test for migration 187 (app_known_users
-- directory + conversations/direct_messages workspace scoping). Wrapped
-- in begin;/rollback; -- nothing here ever commits. The synthetic second
-- workspace and synthetic users live ONLY inside this rolled-back
-- transaction.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 187 DM AND DIRECTORY
-- WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard
-- SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;      -- real app_admin, workspace A
  real_workspace_id uuid; -- workspace A (real, pre-existing)
  ws_b uuid := gen_random_uuid();
  colleague_id uuid := gen_random_uuid();  -- workspace A, same company as real_user_id
  colleague2_id uuid := gen_random_uuid(); -- workspace A, a second plain (non-admin) member
  stranger_id uuid := gen_random_uuid();   -- workspace B, different company
  visible_count int;
  caught boolean;
  conv_ab_id uuid;   -- conversation between real_user_id (A) and colleague_id (A) -- should succeed
  msg_id uuid;
  conv_workspace_id uuid;
begin
  select am.user_id, wm.workspace_id
    into real_user_id, real_workspace_id
  from public.app_admins am
  join public.workspace_members wm on wm.user_id = am.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin who is also an active workspace member found -- this script requires at least one real app_admins row that is also present in workspace_members.';
  end if;

  -- ============================================================
  -- Setup: a synthetic second workspace, and two synthetic real users
  -- (auth.users rows, since conversations/app_known_users both FK to
  -- auth.users) -- colleague_id shares workspace A with real_user_id,
  -- stranger_id lives only in the synthetic workspace B.
  -- ============================================================

  perform set_config('role', 'postgres', true);

  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_187 Other Workspace', 'zz-test-187-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  insert into auth.users (id, email) values
    (colleague_id, 'zz-test-187-colleague@example.com'),
    (colleague2_id, 'zz-test-187-colleague2@example.com'),
    (stranger_id, 'zz-test-187-stranger@example.com');

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (real_workspace_id, colleague_id, false),
    (real_workspace_id, colleague2_id, false),
    (ws_b, stranger_id, false);

  insert into public.app_known_users (user_id, email) values
    (real_user_id, (select email from auth.users where id = real_user_id)),
    (colleague_id, 'zz-test-187-colleague@example.com'),
    (colleague2_id, 'zz-test-187-colleague2@example.com'),
    (stranger_id, 'zz-test-187-stranger@example.com')
  on conflict (user_id) do update set email = excluded.email;

  -- ============================================================
  -- Section 1: app_known_users -- a workspace-A caller cannot see a
  -- workspace-B stranger's directory row (row-count check, not
  -- exception -- RLS SELECT denial is silent, this repo's well-
  -- established lesson from migrations 171/174), but can still see
  -- their own row and a same-workspace colleague's row. Deliberately
  -- uses a PLAIN (non-admin) caller (colleague_id) for this section --
  -- real_user_id is a global app_admin, whose is_app_admin() bypass
  -- clause would trivially make every row visible regardless of
  -- workspace, which would not actually exercise the new
  -- shared-workspace clause at all.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.app_known_users where user_id = stranger_id;
  if visible_count <> 0 then raise exception 'TEST FAILED: a workspace-A caller could read a workspace-B stranger''s app_known_users row'; end if;

  select count(*) into visible_count from public.app_known_users where user_id = colleague_id;
  if visible_count <> 1 then raise exception 'TEST FAILED: a caller could not read their own app_known_users row'; end if;

  select count(*) into visible_count from public.app_known_users where user_id = colleague2_id;
  if visible_count <> 1 then raise exception 'TEST FAILED: a workspace-A caller could not read a same-workspace colleague''s app_known_users row'; end if;

  raise notice 'TEST PASSED: Section 1 -- app_known_users is workspace-scoped (self + colleague visible, cross-workspace stranger hidden)';

  -- ============================================================
  -- Section 2: conversations -- creating a conversation between two
  -- users who do NOT share a workspace is rejected outright.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.conversations (participant_a_id, participant_b_id)
    select least(real_user_id, stranger_id), greatest(real_user_id, stranger_id);
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a conversation was created between two users who do not share a workspace'; end if;

  raise notice 'TEST PASSED: Section 2 -- cross-workspace conversation creation is rejected';

  -- ============================================================
  -- Section 3: conversations -- two users who DO share a workspace can
  -- create a conversation, it is stamped with that shared workspace_id,
  -- and its messages are workspace-contained (a third user in a
  -- different workspace cannot read the conversation or its messages --
  -- row-count checks, not exceptions).
  -- ============================================================

  insert into public.conversations (participant_a_id, participant_b_id)
  select least(real_user_id, colleague_id), greatest(real_user_id, colleague_id)
  returning id, workspace_id into conv_ab_id, conv_workspace_id;

  if conv_workspace_id <> real_workspace_id then
    raise exception 'TEST FAILED: conversation workspace_id (%) did not match the participants'' shared workspace (%)', conv_workspace_id, real_workspace_id;
  end if;

  insert into public.direct_messages (conversation_id, sender_id, body)
    values (conv_ab_id, real_user_id, 'ZZ_TEST_187 hello colleague')
    returning id into msg_id;

  -- Caller (real_user_id, a participant) can read both.
  select count(*) into visible_count from public.conversations where id = conv_ab_id;
  if visible_count <> 1 then raise exception 'TEST FAILED: a participant could not read their own conversation'; end if;

  select count(*) into visible_count from public.direct_messages where id = msg_id;
  if visible_count <> 1 then raise exception 'TEST FAILED: a participant could not read their own message'; end if;

  -- Switch to stranger_id (workspace B, not a participant) -- must see
  -- neither the conversation nor its message.
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.conversations where id = conv_ab_id;
  if visible_count <> 0 then raise exception 'TEST FAILED: a third user in a different workspace could read a conversation they are not part of'; end if;

  select count(*) into visible_count from public.direct_messages where id = msg_id;
  if visible_count <> 0 then raise exception 'TEST FAILED: a third user in a different workspace could read a message from a conversation they are not part of'; end if;

  raise notice 'TEST PASSED: Section 3 -- same-workspace conversation creation succeeds, is workspace-stamped, and is contained from a cross-workspace third party';

  raise notice 'ALL MIGRATION 187 DM AND DIRECTORY WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
