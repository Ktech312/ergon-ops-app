-- Transaction-safe canonical test for migration 162 (Phase 3, Stage 4 --
-- messaging channels workspace scoping). Wrapped in begin;/rollback; --
-- nothing here ever commits. Any synthetic second workspace this script
-- creates lives ONLY inside this rolled-back transaction, never a
-- persistent second workspace.
--
-- Strategy: full behavioral round-trip for the two riskiest resolver
-- shapes this migration introduces -- a `project`-type channel (its
-- workspace_id must be DERIVED from the linked project, authoritatively,
-- via create_project_channel()'s own real production trigger, not
-- caller-supplied) and a `group`-type channel (its workspace_id must
-- come from the caller's own resolved workspace, and must NOT be
-- spoofable via a caller-supplied value). `client`-type channels use the
-- identical derivation code path as `project`-type (same trigger
-- function, same shape) and are covered structurally, not re-tested
-- behaviorally. Every child table (channel_messages/channel_members/
-- channel_canvas/channel_message_reactions/the message-attachments
-- storage policies) uses the same is_workspace_member(...)/
-- is_active_workspace_member(...) wrapper around channel_owner_workspace_id()
-- or a direct join to channels -- covered structurally (Section 4).
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 162 PHASE 3 MESSAGING
-- CHANNELS WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED", or
-- a hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  row_count integer;
  caught boolean;
  v_project_id uuid;
  project_channel_id uuid;
  group_channel_id uuid;
  project_b_id uuid;
  project_b_channel_id uuid;
  policy_check text;
begin
  -- ============================================================
  -- Discover a real, existing app_admin who is also an active workspace
  -- member.
  -- ============================================================

  select am.user_id, wm.workspace_id, wm.is_workspace_admin
    into real_user_id, real_workspace_id, real_member_was_admin
  from public.app_admins am
  join public.workspace_members wm on wm.user_id = am.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing app_admin who is also an active workspace member found -- this script requires at least one real app_admins row that is also present in workspace_members.';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: correct-workspace access, and the two type-dependent
  -- derivation paths.
  -- ============================================================

  -- 1a: creating a project auto-creates its channel via the real
  -- production create_project_channel() trigger (migration 101,
  -- untouched by this migration) -- its workspace_id must be derived
  -- from the project, not from resolve_caller_workspace_id() directly
  -- (both happen to agree here since the caller and the project are in
  -- the same real workspace, but the DERIVATION PATH is what Section 2
  -- actually distinguishes).
  insert into public.projects (project_name) values ('ZZ_TEST_162 Project') returning id into v_project_id;
  select id into project_channel_id from public.channels where channels.type = 'project' and channels.project_id = v_project_id;
  if project_channel_id is null then
    raise exception 'TEST FAILED: creating a project did not auto-create its channel (create_project_channel() trigger)';
  end if;
  select count(*) into row_count from public.channels where id = project_channel_id and workspace_id = real_workspace_id;
  if row_count <> 1 then raise exception 'TEST FAILED: the auto-created project channel was not stamped with the project''s own workspace_id'; end if;

  -- 1b: a group channel, with a SPOOFED workspace_id in the insert
  -- payload -- must be silently overwritten with the caller's own real
  -- one, not honored (same guarantee already proven for every other
  -- ownership-trigger table since migration 117).
  insert into public.channels (type, name, private, created_by, workspace_id)
    values ('group', 'ZZ_TEST_162 Group', false, real_user_id, gen_random_uuid())
    returning id into group_channel_id;
  select count(*) into row_count from public.channels where id = group_channel_id and workspace_id = real_workspace_id;
  if row_count <> 1 then raise exception 'TEST FAILED: group channel insert did not get stamped with the caller''s real workspace_id (spoofed value was not overwritten)'; end if;

  -- Both channels readable and updatable by the real-workspace caller.
  select count(*) into row_count from public.channels where id in (project_channel_id, group_channel_id);
  if row_count <> 2 then raise exception 'TEST FAILED: real-workspace caller could not read back both new channels'; end if;
  update public.channels set name = 'ZZ_TEST_162 Group Renamed' where id = group_channel_id;
  select count(*) into row_count from public.channels where id = group_channel_id and name = 'ZZ_TEST_162 Group Renamed';
  if row_count <> 1 then raise exception 'TEST FAILED: real-workspace caller could not update their own group channel'; end if;

  -- workspace_id is immutable through an ordinary UPDATE.
  begin
    caught := false;
    update public.channels set workspace_id = gen_random_uuid() where id = group_channel_id;
  exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: channels.workspace_id was mutable via a plain UPDATE'; end if;

  raise notice 'TEST PASSED: Section 1 -- project-type derivation, group-type spoofed-value overwrite, read/update, and workspace_id immutability all correct';

  -- ============================================================
  -- Section 2: another-workspace denied. A genuine second active
  -- workspace, created and torn down entirely inside this rolled-back
  -- transaction, the same real admin temporarily moved into it.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_162 Other Workspace', 'zz-test-162-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.projects (project_name) values ('ZZ_TEST_162 Project B') returning id into project_b_id;
  select id into project_b_channel_id from public.channels where channels.type = 'project' and channels.project_id = project_b_id;
  if project_b_channel_id is null then raise exception 'TEST SETUP FAILED: project B''s auto-created channel not found'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.channels where id = project_b_channel_id;
  if row_count <> 0 then raise exception 'TEST FAILED: a real-workspace caller could read a channel belonging to another workspace'; end if;

  begin
    caught := false;
    update public.channels set name = 'hijacked' where id = project_b_channel_id;
  exception when others then caught := true; end;
  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.channels where id = project_b_channel_id and name = 'hijacked';
  if row_count <> 0 then raise exception 'TEST FAILED: a real-workspace caller was able to modify a channel belonging to another workspace'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 2 -- another-workspace channels are invisible and unwritable';

  -- ============================================================
  -- Section 3: missing-membership denied.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.channels where id = group_channel_id;
  if row_count <> 0 then raise exception 'TEST FAILED: a caller with zero workspace memberships could read an existing channel'; end if;

  begin
    caught := false;
    insert into public.channels (type, name, private, created_by) values ('group', 'ZZ_TEST_162 No-Membership Group', false, gen_random_uuid());
  exception when others then caught := true; end;
  if not caught then raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert a group channel'; end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 3 -- a caller with zero workspace memberships sees zero channels and cannot insert one';

  -- ============================================================
  -- Section 4: structural sweep -- children and the storage bucket.
  -- ============================================================

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'channel_messages' and cmd = 'SELECT' and position('is_workspace_member' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: channel_messages SELECT policy does not reference is_workspace_member'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'channel_members' and cmd = 'SELECT' and position('channel_owner_workspace_id' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: channel_members SELECT policy does not reference channel_owner_workspace_id'; end if;

  -- 2026-09-22 (migration 193): channel_canvas's SELECT policy was
  -- rewritten from a channel_owner_workspace_id()-resolver call to a
  -- direct join against channels (matching channel_messages' own exact
  -- predicate shape, so a private group channel's canvas can also check
  -- real channel_members) -- this assertion follows that legitimate
  -- structural change rather than asserting a substring that's simply no
  -- longer true. The workspace predicate itself (is_workspace_member) is
  -- still there, just reached via the join instead of the resolver;
  -- migration 193's own canonical test proves the actual authorization
  -- behavior end-to-end, this sweep only needs to confirm SOME workspace
  -- check exists in the policy body.
  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'channel_canvas' and cmd = 'SELECT' and position('is_workspace_member' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: channel_canvas SELECT policy does not reference is_workspace_member'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'channel_message_reactions' and cmd = 'SELECT' and position('is_workspace_member' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: channel_message_reactions SELECT policy does not reference is_workspace_member'; end if;

  select count(*) into row_count from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'workspace members read channel message-attachments' and position('is_workspace_member' in coalesce(qual, '')) > 0;
  if row_count = 0 then raise exception 'TEST FAILED: channel message-attachments storage read policy does not reference is_workspace_member'; end if;

  -- direct_message_reactions and the DM-participant storage/message
  -- policies must be completely untouched -- no workspace predicate,
  -- per E's cross-workspace decision.
  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'direct_message_reactions' and position('workspace' in lower(coalesce(qual, '') || coalesce(with_check, ''))) > 0;
  if row_count <> 0 then raise exception 'TEST FAILED: direct_message_reactions policies were touched -- DMs must stay workspace-unrelated'; end if;

  -- The trigger function derives project/client-type workspace_id from
  -- the linked row, not from resolve_caller_workspace_id() for those two
  -- types -- confirmed structurally via its own source text.
  select count(*) into row_count from pg_proc
    where proname = 'guard_channel_workspace_id_mutation'
      and pg_get_functiondef(oid) like '%from public.projects where id = new.project_id%'
      and pg_get_functiondef(oid) like '%from public.clients where id = new.client_id%';
  if row_count = 0 then raise exception 'TEST FAILED: guard_channel_workspace_id_mutation() does not derive project/client-type workspace_id from the linked row'; end if;

  -- Section-channel uniqueness is now per-workspace.
  select count(*) into row_count from pg_constraint where conname = 'channels_type_section_key_key' and pg_get_constraintdef(oid) like '%workspace_id%';
  if row_count = 0 then raise exception 'TEST FAILED: channels_type_section_key_key does not include workspace_id'; end if;

  -- Every channel table's overall policy count is exactly what this
  -- migration leaves it at -- no leftover using(true) policy.
  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'channels';
  if row_count <> 4 then raise exception 'TEST FAILED: channels has % policies after migration 162, expected exactly 4', row_count; end if;

  select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = 'channel_messages';
  if row_count <> 2 then raise exception 'TEST FAILED: channel_messages has % policies after migration 162, expected exactly 2', row_count; end if;

  for policy_check in select unnest(array['channel_members', 'channel_canvas'])
  loop
    select count(*) into row_count from pg_policies where schemaname = 'public' and tablename = policy_check;
    if row_count <> 3 then
      raise exception 'TEST FAILED: % has % policies after migration 162, expected exactly 3', policy_check, row_count;
    end if;
  end loop;

  raise notice 'TEST PASSED: Section 4 -- structural sweep confirms correct predicate on every child table/storage policy, DM tables untouched, and the trigger''s type-dependent derivation logic';

  raise notice 'ALL MIGRATION 162 PHASE 3 MESSAGING CHANNELS WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
