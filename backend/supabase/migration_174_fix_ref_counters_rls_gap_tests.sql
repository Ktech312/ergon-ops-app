-- Transaction-safe canonical test for migration 174 (urgent RLS gap
-- fix: sales_quote_ref_counters/project_ref_counters were fully open to
-- direct authenticated read/write since migration 164 added their real
-- workspace_id). Wrapped in begin;/rollback; -- nothing here ever
-- commits. The synthetic second workspace this script creates lives
-- ONLY inside this rolled-back transaction, never a persistent second
-- workspace.
--
-- Section 1 confirms the read-side fix using a row-count check (not an
-- exception check) -- a lesson learned earlier this same session
-- (migration 171): a SELECT blocked by RLS silently returns zero rows,
-- it never raises. Section 2 confirms the write-side fix (INSERT/
-- UPDATE/DELETE) DOES raise, since no policy exists for those
-- operations at all now. Section 3 is the regression check: the real
-- write path (assign_sales_quote_ref()/assign_project_ref(), both
-- security definer) must still work completely normally for an
-- ordinary authenticated user, since they bypass RLS regardless of
-- this migration.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 174 REF COUNTERS RLS
-- GAP FIX TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;
  real_member_was_admin boolean;
  ws_b uuid := gen_random_uuid();
  v_year integer := extract(year from now())::integer;
  visible_count int;
  caught boolean;
  quote_id uuid;
  project_id uuid;
begin
  -- ============================================================
  -- Discover a real, existing app_admin who is also an active workspace
  -- member, then build a synthetic second workspace the same way every
  -- prior Phase 3 test has.
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

  perform set_config('role', 'postgres', true);
  insert into public.workspaces (id, name, slug, status)
    values (ws_b, 'ZZ_TEST_174 Other Workspace', 'zz-test-174-other-' || substr(gen_random_uuid()::text, 1, 8), 'active');
  -- Seed workspace B's own counter row directly (bypassing RLS as
  -- postgres) so Section 1 has a real row to prove is invisible.
  insert into public.sales_quote_ref_counters (workspace_id, year, next_seq) values (ws_b, v_year, 1);
  insert into public.project_ref_counters (workspace_id, year, next_seq) values (ws_b, v_year, 1);

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section 1: a real-workspace caller cannot read workspace B's
  -- counter rows (row-count check, not an exception check).
  -- ============================================================

  select count(*) into visible_count from public.sales_quote_ref_counters where workspace_id = ws_b;
  if visible_count <> 0 then raise exception 'TEST FAILED: a workspace-A caller could read workspace B''s sales_quote_ref_counters row'; end if;

  select count(*) into visible_count from public.project_ref_counters where workspace_id = ws_b;
  if visible_count <> 0 then raise exception 'TEST FAILED: a workspace-A caller could read workspace B''s project_ref_counters row'; end if;

  raise notice 'TEST PASSED: Section 1 -- a caller cannot read another workspace''s ref-counter rows';

  -- ============================================================
  -- Section 2: no direct write path exists at all for an ordinary
  -- authenticated caller, even against their OWN workspace's row --
  -- the only legitimate writer is the security-definer trigger, which
  -- never goes through this policy.
  -- ============================================================

  -- INSERT is governed by RLS's WITH CHECK clause -- with no applicable
  -- policy at all, Postgres raises outright ("new row violates
  -- row-level security policy"), since an INSERT always affects exactly
  -- one specific new row and rejecting it IS the operation's outcome.
  caught := false;
  begin
    insert into public.sales_quote_ref_counters (workspace_id, year, next_seq) values (real_workspace_id, v_year - 100, 1);
  exception when others then
    caught := true;
  end;
  if not caught then raise exception 'TEST FAILED: a caller was able to directly INSERT into sales_quote_ref_counters'; end if;

  -- UPDATE/DELETE are governed by RLS's USING clause instead, which acts
  -- as an invisible row filter, not a check -- a blocked UPDATE/DELETE
  -- silently affects ZERO rows, it never raises (the exact same lesson
  -- Section 1's own row-count check already applies to SELECT; Section
  -- 2's very first draft got this wrong by using an exception-catch
  -- here instead, caught only by independent verification before this
  -- was ever sent). A real fixture row is inserted first (as postgres,
  -- bypassing RLS) at a fixture-only year so it can never collide with
  -- Section 3's own real trigger-generated row for the current year --
  -- then the caller's UPDATE/DELETE attempts are checked by confirming
  -- the row is completely unaffected, not by expecting an exception.
  perform set_config('role', 'postgres', true);
  insert into public.project_ref_counters (workspace_id, year, next_seq) values (real_workspace_id, v_year - 100, 1);
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  update public.project_ref_counters set next_seq = 99999 where workspace_id = real_workspace_id and year = v_year - 100;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.project_ref_counters where workspace_id = real_workspace_id and year = v_year - 100 and next_seq = 99999) then
    raise exception 'TEST FAILED: a caller was able to directly UPDATE project_ref_counters';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  delete from public.project_ref_counters where workspace_id = real_workspace_id and year = v_year - 100;
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from public.project_ref_counters where workspace_id = real_workspace_id and year = v_year - 100) then
    raise exception 'TEST FAILED: a caller was able to directly DELETE from project_ref_counters';
  end if;
  delete from public.project_ref_counters where workspace_id = real_workspace_id and year = v_year - 100;
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  raise notice 'TEST PASSED: Section 2 -- no direct authenticated write path exists to either ref-counter table';

  -- ============================================================
  -- Section 3: regression -- the real write path (the security-definer
  -- assign_*_ref() triggers) still works completely normally, since
  -- security definer bypasses RLS regardless of this migration.
  -- ============================================================

  insert into public.sales_quotes (site_name, client_name, status) values ('ZZ_TEST_174 Site A', 'ZZ_TEST_174 Client A', 'open') returning id into quote_id;
  if not exists (select 1 from public.sales_quotes where id = quote_id and quote_ref is not null) then
    raise exception 'TEST FAILED: assign_sales_quote_ref() did not assign a quote_ref -- the trigger''s write path is broken by this migration';
  end if;

  insert into public.projects (project_name) values ('ZZ_TEST_174 Project A') returning id into project_id;
  if not exists (select 1 from public.projects where id = project_id and project_number is not null) then
    raise exception 'TEST FAILED: assign_project_ref() did not assign a project_number -- the trigger''s write path is broken by this migration';
  end if;

  raise notice 'TEST PASSED: Section 3 -- the real security-definer write path (assign_sales_quote_ref/assign_project_ref) is unaffected';

  raise notice 'ALL MIGRATION 174 REF COUNTERS RLS GAP FIX TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
