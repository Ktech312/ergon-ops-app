-- Transaction-safe canonical test for migration 175 (team_members
-- workspace scoping). Wrapped in begin;/rollback; -- nothing here ever
-- commits. The synthetic second workspace lives ONLY inside this
-- rolled-back transaction.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 175 TEAM MEMBERS
-- WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard
-- SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  caught boolean;
  member_a_id uuid;
  member_b_id uuid;
  visible_count int;
begin
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

  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_175 Other Workspace', 'zz-test-175-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: same-workspace email duplicate still rejected,
  -- cross-workspace duplicate now accepted.
  -- ============================================================

  insert into public.team_members (full_name, email) values ('ZZ_TEST_175 Person A', 'zz-test-175@example.com') returning id into member_a_id;

  caught := false;
  begin
    insert into public.team_members (full_name, email) values ('ZZ_TEST_175 Person A Dup', 'zz-test-175@example.com');
  exception when unique_violation then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: team_members email allowed a same-workspace duplicate'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = real_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_b, real_user_id, true);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    insert into public.team_members (full_name, email) values ('ZZ_TEST_175 Person B', 'zz-test-175@example.com') returning id into member_b_id;
  exception when unique_violation then
    caught := true;
  end;
  if caught then raise exception 'TEST FAILED: team_members email rejected an identical email in a DIFFERENT workspace'; end if;

  -- ============================================================
  -- Section 2: a workspace-B caller cannot read workspace A's roster
  -- (row-count check, not exception-based -- SELECT-side RLS denial is
  -- silent).
  -- ============================================================

  select count(*) into visible_count from public.team_members where id = member_a_id;
  if visible_count <> 0 then raise exception 'TEST FAILED: a workspace-B caller could read workspace A''s team_members row'; end if;

  perform set_config('role', 'postgres', true);
  delete from public.workspace_members where user_id = real_user_id and workspace_id = ws_b;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (real_workspace_id, real_user_id, real_member_was_admin);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into visible_count from public.team_members where id = member_a_id;
  if visible_count <> 1 then raise exception 'TEST FAILED: a workspace-A caller could not read their own team_members row after being restored'; end if;

  raise notice 'TEST PASSED: Section 1/2 -- team_members email is workspace-scoped and cross-workspace read is blocked';

  raise notice 'ALL MIGRATION 175 TEAM MEMBERS WORKSPACE SCOPING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
