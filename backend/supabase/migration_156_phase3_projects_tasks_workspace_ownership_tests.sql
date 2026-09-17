-- Transaction-safe canonical test for migration 156 (Phase 3, Stage 2
-- ownership half: projects.workspace_id / tasks.workspace_id). Wrapped
-- in begin;/rollback; -- nothing here ever commits.
--
-- Scope: this migration does NOT touch RLS at all -- `tasks` keeps its
-- existing using(true) read/write policies, and `projects` keeps its
-- existing split shape (using(true) read, role-gated write via
-- migration 023's `is_app_admin()/has_role('pm')`), both exactly
-- unchanged -- so this test verifies ownership-metadata correctness
-- (backfill completeness, trigger stamping/immutability, that gate
-- failing closed for a caller with no membership at all), not access
-- containment. RLS/workspace tightening for this table group gets its
-- own later migration and its own canonical test, mirroring how
-- migration 155 followed migration 117.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 156 PHASE 3 PROJECTS
-- TASKS WORKSPACE OWNERSHIP TESTS PASSED -- ZERO SECTIONS SKIPPED", or a
-- hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  null_count integer;
  new_project_id uuid;
  new_task_id uuid;
  caught boolean;
  row_count integer;
begin
  -- ============================================================
  -- Section 1: backfill completeness.
  -- ============================================================

  select count(*) into null_count from public.projects where workspace_id is null;
  if null_count <> 0 then
    raise exception 'TEST FAILED: % project row(s) still have a null workspace_id after migration 156', null_count;
  end if;

  select count(*) into null_count from public.tasks where workspace_id is null;
  if null_count <> 0 then
    raise exception 'TEST FAILED: % task row(s) still have a null workspace_id after migration 156', null_count;
  end if;

  raise notice 'TEST PASSED: Section 1 -- zero null workspace_id rows in projects and tasks';

  -- ============================================================
  -- Section 2: missing-membership denial on write. A caller with zero
  -- workspace_members rows cannot insert into either table -- the
  -- trigger's resolve_caller_workspace_id() call fails closed before
  -- the row is ever written. (An explicit-null insert is not a
  -- separately testable case here: guard_workspace_id_mutation() always
  -- overwrites new.workspace_id on INSERT before the NOT NULL constraint
  -- is ever evaluated, so a null value never actually reaches that
  -- constraint check -- the trigger itself is the real, and only
  -- reachable, gate. This section tests that gate directly with a
  -- realistic caller identity instead of asserting a constraint that
  -- can never be exercised in isolation.)
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    caught := false;
    insert into public.projects (project_name) values ('ZZ_TEST_156 No-Membership Attempt');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert a project';
  end if;

  begin
    caught := false;
    insert into public.tasks (task_number, title) values ('ZZ_TEST_156_NOWS', 'ZZ_TEST_156 No-Membership Attempt');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a caller with zero workspace memberships was able to insert a task';
  end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 2 -- a caller with zero workspace memberships cannot insert into projects or tasks';

  -- ============================================================
  -- Section 3: trigger correctly stamps workspace_id on insert
  -- (ignoring/overwriting any client-supplied value), and rejects any
  -- attempt to change it on update -- exactly the same guarantee
  -- already proven for clients/sales_quotes, now reused verbatim for
  -- these two root tables. `projects`' own write policy (unaffected by
  -- migration 156, unlike tasks it was narrowed by migration 023 to
  -- `is_app_admin(auth.uid()) or has_role('pm')`) means this section's
  -- projects insert/update only succeeds for a discovered real_user_id
  -- who is an admin or has the pm role -- true for the one confirmed
  -- real admin account in this environment; if this script is ever run
  -- against an environment where the first active-workspace member
  -- found happens to be neither, this section's projects assertions
  -- would fail with a permission error rather than the intended
  -- assertion, which is a real, documented limitation of reusing "any
  -- active member" fixture discovery for a role-gated table -- not a
  -- migration 156 defect.
  -- ============================================================

  select wm.user_id, wm.workspace_id into real_user_id, real_workspace_id
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing active workspace member found -- this script requires at least one real user already in workspace_members.';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- A spoofed workspace_id supplied by the client must be silently
  -- overwritten with the caller's own real one, not honored.
  insert into public.projects (project_name, workspace_id)
    values ('ZZ_TEST_156 Trigger Stamp', gen_random_uuid())
    returning id into new_project_id;

  select count(*) into row_count from public.projects where id = new_project_id and workspace_id = real_workspace_id;
  if row_count <> 1 then
    raise exception 'TEST FAILED: projects insert did not get stamped with the caller''s real workspace_id (spoofed value was not overwritten)';
  end if;

  insert into public.tasks (task_number, title, workspace_id)
    values ('ZZ_TEST_156_STAMP', 'ZZ_TEST_156 Trigger Stamp', gen_random_uuid())
    returning id into new_task_id;

  select count(*) into row_count from public.tasks where id = new_task_id and workspace_id = real_workspace_id;
  if row_count <> 1 then
    raise exception 'TEST FAILED: tasks insert did not get stamped with the caller''s real workspace_id (spoofed value was not overwritten)';
  end if;

  -- Attempting to change workspace_id on an existing row must be
  -- rejected outright, no exceptions.
  begin
    caught := false;
    update public.projects set workspace_id = gen_random_uuid() where id = new_project_id;
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: projects.workspace_id was mutable via a plain UPDATE';
  end if;

  begin
    caught := false;
    update public.tasks set workspace_id = gen_random_uuid() where id = new_task_id;
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: tasks.workspace_id was mutable via a plain UPDATE';
  end if;

  perform set_config('role', 'postgres', true);
  raise notice 'TEST PASSED: Section 3 -- both triggers correctly stamp workspace_id on insert and reject mutation on update';

  -- ============================================================
  -- Section 4: RLS on both tables is UNCHANGED by this migration.
  -- `tasks` is still using(true)/with check(true) on both its read and
  -- write policies (never touched by any migration since 015). `projects`
  -- keeps its own SPLIT shape exactly as migration 023 left it: read is
  -- using(true), but its write ("for all") policy is role-gated
  -- (is_app_admin/has_role('pm')), not using(true) -- this migration
  -- must not have accidentally widened that write policy back to
  -- using(true) as a side effect of anything it changed. This is a
  -- structural check, not a behavioral one: RLS/workspace tightening
  -- for this group is a separate, later migration.
  -- ============================================================

  select count(*) into row_count from pg_policies
    where schemaname = 'public' and tablename = 'projects' and cmd = 'SELECT'
      and position('true' in lower(coalesce(qual, ''))) > 0;
  if row_count = 0 then
    raise exception 'TEST FAILED: projects no longer has a using(true) SELECT policy -- this migration should not have touched RLS';
  end if;

  select count(*) into row_count from pg_policies
    where schemaname = 'public' and tablename = 'projects' and cmd = 'ALL'
      and position('is_app_admin' in coalesce(qual, '')) > 0
      and position('has_role' in coalesce(qual, '')) > 0;
  if row_count = 0 then
    raise exception 'TEST FAILED: projects no longer has its pre-existing role-gated write policy (is_app_admin/has_role(''pm'')) -- either widened to using(true) or narrowed further, either way not what migration 156 should have done';
  end if;

  select count(*) into row_count from pg_policies
    where schemaname = 'public' and tablename = 'tasks'
      and position('true' in lower(coalesce(qual, ''))) > 0;
  if row_count < 2 then
    raise exception 'TEST FAILED: tasks no longer has both its using(true) read and write policies (found %) -- this migration should not have touched RLS', row_count;
  end if;

  raise notice 'TEST PASSED: Section 4 -- RLS on projects (split read/role-gated-write) and tasks (fully using(true)) confirmed unchanged';

  raise notice 'ALL MIGRATION 156 PHASE 3 PROJECTS TASKS WORKSPACE OWNERSHIP TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
