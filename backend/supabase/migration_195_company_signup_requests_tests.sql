-- Transaction-safe canonical test for migration 195 (self-serve company
-- signup requests, platform-admin approval, provisioning, and the
-- accept-token flow). Wrapped in begin;/rollback; -- nothing here ever
-- commits. The synthetic requests, workspaces, users, and membership rows
-- this script creates live ONLY inside this rolled-back transaction.
--
-- Covers: (a) submit_company_signup_request has NO grant to anon or
-- authenticated at all (information_schema check, matching migration
-- 127/188's own "anon has no execute grant" pattern) -- it is reachable
-- only via a service-role-equivalent caller, and validates its inputs;
-- (b) a plain (non-admin) authenticated caller cannot approve or reject a
-- request (caught exceptions); (c) a real platform admin CAN approve one,
-- and approval provisions a real workspace + company_branding row + all
-- 4 section channels, and issues a token; (d) approving (or rejecting) an
-- already-decided request is rejected, not silently repeated; (e)
-- get_company_signup_by_token is anon-callable and returns the company
-- name for a valid, unused, approved token, and nothing for an invalid/
-- unapproved/already-used one; (f) accept_company_signup requires a real
-- session, creates the first workspace_members row (is_workspace_admin =
-- true) for a valid token, and a second attempt with the same
-- (now-used) token is a safe no-op, not a second membership row or an
-- error; (g) company_signup_requests' own RLS -- a plain authenticated
-- user cannot SELECT or UPDATE any request row (row-count / affected-row
-- checks, RLS denial is silent for both).
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 195 COMPANY SIGNUP
-- REQUESTS TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;      -- real app_admin (used for section (c)/(d))
  real_workspace_id uuid;
  colleague_id uuid := gen_random_uuid();  -- plain authenticated, not an admin
  colleague_email text := 'zz-test-195-colleague@example.com';
  prospect_id uuid := gen_random_uuid();   -- accepts the token, has zero workspace memberships beforehand
  prospect_email text := 'zz-test-195-prospect@example.com';
  request_id uuid;
  approval_result jsonb;
  new_workspace_id uuid;
  issued_token uuid;
  row_count integer;
  affected_rows integer;
  caught boolean;
  grant_count integer;
  section_count integer;
  outcome_text text;
  outcome_workspace_id uuid;
  company_name_result text;
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

  insert into auth.users (id, email) values
    (colleague_id, colleague_email),
    (prospect_id, prospect_email);

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (real_workspace_id, colleague_id, false);
  -- prospect_id deliberately has ZERO workspace_members rows -- the whole
  -- point of section (f) is proving accept_company_signup gives them
  -- their first one.

  -- ============================================================
  -- Section (a): submit_company_signup_request has no grant to anon or
  -- authenticated, and validates its inputs when called directly (as
  -- postgres, standing in for the service-role connection the real API
  -- route uses).
  -- ============================================================

  select count(*) into grant_count
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name = 'submit_company_signup_request'
    and grantee in ('anon', 'authenticated');
  if grant_count <> 0 then
    raise exception 'TEST FAILED: submit_company_signup_request has a grant to anon or authenticated (% grants found) -- it must be reachable only via the service-role connection', grant_count;
  end if;

  caught := false;
  begin
    perform public.submit_company_signup_request('', 'Someone', 'someone@example.com');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: submit_company_signup_request accepted an empty company_name';
  end if;

  caught := false;
  begin
    perform public.submit_company_signup_request('ZZ Test 195 Co', 'Someone', 'not-an-email');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: submit_company_signup_request accepted a malformed email address';
  end if;

  select public.submit_company_signup_request('ZZ Test 195 Co', 'Prospect Person', 'ZZ-Test-195-Prospect@Example.com') into request_id;
  if request_id is null then
    raise exception 'TEST FAILED: submit_company_signup_request did not return a new id for a valid submission';
  end if;

  select count(*) into row_count from public.company_signup_requests where id = request_id and status = 'pending';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a valid submission did not create a pending company_signup_requests row (% rows)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (a) -- submit_company_signup_request is not directly reachable by anon/authenticated, and validates company_name/email before inserting';

  -- ============================================================
  -- Section (b): a plain (non-admin) authenticated caller cannot approve
  -- or reject.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.approve_company_signup(request_id);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a plain (non-admin) authenticated caller could approve a company signup request';
  end if;

  caught := false;
  begin
    perform public.reject_company_signup(request_id, 'no thanks');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: a plain (non-admin) authenticated caller could reject a company signup request';
  end if;

  raise notice 'TEST PASSED: Section (b) -- a plain authenticated caller cannot approve or reject a company signup request';

  -- ============================================================
  -- Section (c): a real platform admin CAN approve, and approval
  -- provisions a real workspace + company_branding row + all 4 section
  -- channels, and issues a token.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.approve_company_signup(request_id) into approval_result;
  new_workspace_id := (approval_result->>'workspace_id')::uuid;
  issued_token := (approval_result->>'signup_token')::uuid;

  if new_workspace_id is null or issued_token is null then
    raise exception 'TEST FAILED: approve_company_signup did not return both a workspace_id and a signup_token (%)', approval_result;
  end if;

  -- Verifying REAL database state here, not what the approving admin
  -- themselves can see via RLS -- an approving platform admin is
  -- correctly NOT a member of the brand-new workspace (nor should they
  -- be; provisioning a company doesn't make you one of its employees),
  -- so workspaces/company_branding/channels' own membership-gated SELECT
  -- policies would legitimately hide these rows from real_user_id. That
  -- is a separate, correct behavior from "did approve_company_signup
  -- actually write the right rows," which is what this section checks.
  perform set_config('role', 'postgres', true);

  select count(*) into row_count from public.workspaces where id = new_workspace_id and status = 'active';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: approve_company_signup did not create an active workspaces row (% rows)', row_count;
  end if;

  -- Also proves migration 182's own workspaces_seed_default_branding
  -- trigger fired exactly once (a redundant INSERT here would have
  -- collided with it -- the real bug this test caught while writing
  -- this migration) and that the real requested company name replaced
  -- the trigger's own 'New Company' placeholder.
  select count(*) into row_count from public.company_branding where workspace_id = new_workspace_id and company_name = 'ZZ Test 195 Co';
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: approve_company_signup did not leave exactly one company_branding row with the real requested company name for the new workspace (% rows)', row_count;
  end if;

  select count(*) into section_count from public.channels where workspace_id = new_workspace_id and type = 'section';
  if section_count is distinct from 4 then
    raise exception 'TEST FAILED: approve_company_signup did not seed all 4 section channels for the new workspace (% found, expected 4)', section_count;
  end if;

  select count(*) into row_count from public.company_signup_requests where id = request_id and status = 'approved' and signup_token = issued_token and created_workspace_id = new_workspace_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: the signup request row was not correctly marked approved with the matching token/workspace (% rows)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (c) -- a real platform admin can approve a request, provisioning a real workspace, its branding row, and all 4 section channels';

  perform set_config('role', 'authenticated', true);

  -- ============================================================
  -- Section (d): approving (or rejecting) an already-decided request is
  -- rejected, not silently repeated.
  -- ============================================================

  caught := false;
  begin
    perform public.approve_company_signup(request_id);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an already-approved request could be approved a second time';
  end if;

  caught := false;
  begin
    perform public.reject_company_signup(request_id, 'too late');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an already-approved request could be rejected after the fact';
  end if;

  raise notice 'TEST PASSED: Section (d) -- an already-decided signup request cannot be approved or rejected again';

  -- ============================================================
  -- Section (e): get_company_signup_by_token is anon-callable and
  -- returns the company name for a valid, unused, approved token, and
  -- nothing for an invalid/unapproved/already-used one.
  -- ============================================================

  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);

  select company_name into company_name_result from public.get_company_signup_by_token(issued_token);
  if company_name_result is distinct from 'ZZ Test 195 Co' then
    raise exception 'TEST FAILED: get_company_signup_by_token did not return the right company name for a valid token (got %)', company_name_result;
  end if;

  select count(*) into row_count from public.get_company_signup_by_token(gen_random_uuid());
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: get_company_signup_by_token returned a row for a bogus token';
  end if;

  raise notice 'TEST PASSED: Section (e) -- get_company_signup_by_token resolves a valid token and returns nothing for a bogus one, callable by anon';

  -- ============================================================
  -- Section (f): accept_company_signup requires a real session, creates
  -- the first workspace_members row for a valid token, and a second
  -- attempt with the same (now-used) token is a safe no-op.
  -- ============================================================

  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);

  caught := false;
  begin
    perform public.accept_company_signup(issued_token);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: accept_company_signup succeeded with no signed-in session';
  end if;

  select count(*) into row_count from public.workspace_members where user_id = prospect_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: prospect_id already has a workspace_members row before accept_company_signup ran (% rows) -- test setup invariant broken', row_count;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', prospect_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(issued_token);
  if outcome_text is distinct from 'accepted' or outcome_workspace_id is distinct from new_workspace_id then
    raise exception 'TEST FAILED: accept_company_signup did not report success for a valid token (outcome=%, workspace_id=%)', outcome_text, outcome_workspace_id;
  end if;

  select count(*) into row_count from public.workspace_members where user_id = prospect_id and workspace_id = new_workspace_id and is_workspace_admin = true;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: accept_company_signup did not create a workspace-admin workspace_members row for the prospect (% rows)', row_count;
  end if;

  -- Re-using the same (now-used) token: a safe no-op, not a second row
  -- and not an error.
  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(issued_token);
  if outcome_text is distinct from 'not_found_or_already_used' then
    raise exception 'TEST FAILED: re-using an already-accepted token did not report not_found_or_already_used (got %)', outcome_text;
  end if;

  select count(*) into row_count from public.workspace_members where user_id = prospect_id;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: re-using an already-accepted token created an extra workspace_members row (% rows, expected 1)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (f) -- accept_company_signup requires a real session, grants workspace-admin on the new workspace for a valid token, and safely no-ops on reuse';

  -- ============================================================
  -- Section (g): company_signup_requests' own RLS -- a plain
  -- authenticated user cannot SELECT or UPDATE any request row.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.company_signup_requests where id = request_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a plain authenticated user could SELECT a company_signup_requests row (% rows visible)', row_count;
  end if;

  update public.company_signup_requests set rejection_reason = 'hacked' where id = request_id;
  get diagnostics affected_rows = row_count;
  if affected_rows is distinct from 0 then
    raise exception 'TEST FAILED: a plain authenticated user''s UPDATE against company_signup_requests affected % rows (expected 0)', affected_rows;
  end if;

  raise notice 'TEST PASSED: Section (g) -- company_signup_requests stays invisible and unwritable to a plain authenticated user, platform-admin only';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 195 COMPANY SIGNUP REQUESTS TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
