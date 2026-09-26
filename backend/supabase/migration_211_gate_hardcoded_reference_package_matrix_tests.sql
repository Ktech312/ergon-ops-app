-- Transaction-safe canonical test for migration 211 (a real per-workspace
-- flag gating the hardcoded, Ergon-specific "Package Matrix" reference
-- content). Wrapped in begin;/rollback; -- nothing here ever commits.
--
-- Covers:
-- (a) a workspace that was never created via company_signup_requests
--     (a pre-existing workspace, exactly Ergon's own real shape) is
--     backfilled to show_reference_packages = true.
-- (b) a workspace that WAS created via company_signup_requests (exactly
--     K-Tech Systems' own real shape) is backfilled to
--     show_reference_packages = false -- the actual bug this migration
--     fixes.
-- (c) a brand-new company approved AFTER this migration already runs
--     defaults to false too (the column default, not just the one-time
--     backfill) -- so this stays fixed for every future company, not
--     just the two that existed when this migration ran.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 211 GATE HARDCODED
-- REFERENCE PACKAGE MATRIX TESTS PASSED -- ZERO SECTIONS SKIPPED", or a
-- hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  pre_existing_workspace_id uuid;
  pre_existing_branding_flag boolean;
  signup_workspace_id uuid;
  signup_branding_flag boolean;
  real_platform_admin_id uuid;
  req_id uuid;
  approval_result jsonb;
  new_workspace_id uuid;
  new_branding_flag boolean;
row_count integer;
begin
  -- ============================================================
  -- Setup: a synthetic pre-existing workspace (never referenced by any
  -- company_signup_requests row) alongside a synthetic company-signup
  -- workspace, both created the same way approve_company_signup creates
  -- one, so this test proves the real backfill predicate, not a
  -- hand-wired substitute.
  -- ============================================================

  insert into public.workspaces (name, slug, status) values ('ZZ Test 211 Pre-existing Co', 'zz-test-211-pre-existing', 'active')
    returning id into pre_existing_workspace_id;
  insert into public.company_branding (workspace_id, company_name, show_reference_packages)
    values (pre_existing_workspace_id, 'ZZ Test 211 Pre-existing Co', false)
    on conflict (workspace_id) do update set company_name = excluded.company_name;

  select pa.user_id into real_platform_admin_id from public.platform_admins pa limit 1;
  if real_platform_admin_id is null then
    raise exception 'TEST SETUP FAILED: no existing platform_admin found.';
  end if;

  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 211 Signup Co', 'Signup Test', 'zz-test-211-signup@example.com')
    returning id into req_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_platform_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_id) into approval_result;
  signup_workspace_id := (approval_result->>'workspace_id')::uuid;

  perform set_config('role', 'postgres', true);

  -- Re-run this migration's own backfill logic directly (not just trust
  -- it ran once historically) -- this is exactly the update statement
  -- migration 211 itself contains.
  update public.company_branding
  set show_reference_packages = true
  where workspace_id not in (
    select created_workspace_id
    from public.company_signup_requests
    where created_workspace_id is not null
  );

  -- ============================================================
  -- Section (a): a pre-existing workspace (never a company_signup_requests
  -- target) is backfilled to true.
  -- ============================================================

  select show_reference_packages into pre_existing_branding_flag
  from public.company_branding where workspace_id = pre_existing_workspace_id;
  if pre_existing_branding_flag is distinct from true then
    raise exception 'TEST FAILED: a pre-existing workspace was not backfilled to show_reference_packages = true (got %)', pre_existing_branding_flag;
  end if;

  raise notice 'TEST PASSED: Section (a) -- a pre-existing workspace (never created via company_signup_requests) is backfilled to show_reference_packages = true';

  -- ============================================================
  -- Section (b): the real bug -- a company-signup-created workspace
  -- (K-Tech Systems' own real shape) stays/becomes false.
  -- ============================================================

  select show_reference_packages into signup_branding_flag
  from public.company_branding where workspace_id = signup_workspace_id;
  if signup_branding_flag is distinct from false then
    raise exception 'TEST FAILED: a company-signup-created workspace has show_reference_packages = % (expected false -- this IS the bug, Ergon-specific hardcoded content leaking into an unrelated company)', signup_branding_flag;
  end if;

  raise notice 'TEST PASSED: Section (b) -- a company-signup-created workspace (K-Tech Systems'' own real shape) never shows Ergon''s hardcoded reference content';

  -- ============================================================
  -- Section (c): a brand-new company approved AFTER the backfill
  -- already ran also defaults to false -- the column default itself,
  -- proving this stays fixed for every future company forever, not
  -- just a one-time cleanup of the two workspaces that existed when
  -- this migration ran.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 211 Future Co', 'Future Test', 'zz-test-211-future@example.com')
    returning id into req_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_platform_admin_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_id) into approval_result;
  new_workspace_id := (approval_result->>'workspace_id')::uuid;

  perform set_config('role', 'postgres', true);
  select show_reference_packages into new_branding_flag
  from public.company_branding where workspace_id = new_workspace_id;
  if new_branding_flag is distinct from false then
    raise exception 'TEST FAILED: a brand-new company approved after the backfill defaults to show_reference_packages = % (expected false)', new_branding_flag;
  end if;

  raise notice 'TEST PASSED: Section (c) -- a brand-new company approved after the backfill also defaults to false, not just the workspaces that existed when the migration ran';

  raise notice 'ALL MIGRATION 211 GATE HARDCODED REFERENCE PACKAGE MATRIX TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
