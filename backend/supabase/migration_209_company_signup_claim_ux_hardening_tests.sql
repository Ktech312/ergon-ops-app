-- Transaction-safe canonical test for migration 209 (company-signup claim
-- UX hardening after the real K-Tech Systems onboarding test failed to
-- complete end-to-end). Wrapped in begin;/rollback; -- nothing here ever
-- commits. All synthetic requests, users, workspaces, and membership rows
-- this script creates live ONLY inside this rolled-back transaction.
--
-- Covers:
-- (a) get_company_signup_by_token now also returns requester_email and
--     account_exists=false when no auth.users row matches it yet.
-- (b) account_exists flips to true once a real auth.users row exists for
--     that exact requester_email.
-- (c) claim_own_pending_company_signup() with no session raises
--     (not_signed_in outcome path is unreachable without auth.uid(), same
--     posture as accept_company_signup's anonymous-caller check).
-- (d) an ordinary signed-in user with no pending approved company signup
--     gets 'none_pending' -- the overwhelmingly common case on every
--     regular sign-in -- with zero side effects.
-- (e) a signed-in user whose OWN confirmed email matches an approved,
--     unused, unexpired, unrevoked request succeeds with NO token
--     supplied at all: workspace activated, founding admin membership
--     created, exactly like accept_company_signup(token) directly.
-- (f) delegated rejection still applies: an unconfirmed account matching
--     a pending request is rejected (email_not_confirmed), not silently
--     accepted just because this path skips the token.
-- (g) after a successful claim, calling claim_own_pending_company_signup()
--     again for the same now-signed-in user returns 'none_pending' (the
--     token is used, so it no longer resolves) -- no duplicate membership,
--     idempotent on repeat sign-ins.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 209 COMPANY SIGNUP CLAIM
-- UX HARDENING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;
  real_workspace_id uuid;

  -- Section (a)/(b): account_exists before/after a real auth.users row
  -- shows up for the same requester_email.
  no_account_email text := 'zz-test-209-no-account@example.com';
  req_no_account_id uuid;
  token_no_account uuid;
  later_user_id uuid := gen_random_uuid();

  -- Section (d): ordinary user, nothing pending.
  ordinary_user_id uuid := gen_random_uuid();
  ordinary_email text := 'zz-test-209-ordinary@example.com';

  -- Section (e)/(g): the real success + idempotent-replay path.
  success_user_id uuid := gen_random_uuid();
  success_email text := 'zz-test-209-success@example.com';
  req_success_id uuid;
  workspace_success uuid;

  -- Section (f): unconfirmed account, delegated rejection.
  unconfirmed_user_id uuid := gen_random_uuid();
  unconfirmed_email text := 'zz-test-209-unconfirmed@example.com';
  req_unconfirmed_id uuid;
  workspace_unconfirmed uuid;

  approval_result jsonb;
  lookup_email text;
  lookup_exists boolean;
  lookup_status text;
  outcome_text text;
  outcome_workspace_id uuid;
  row_count integer;
  caught boolean;
  ws_status text;
begin
  -- ============================================================
  -- Setup
  -- ============================================================

  select pa.user_id, wm.workspace_id
    into real_user_id, real_workspace_id
  from public.platform_admins pa
  join public.workspace_members wm on wm.user_id = pa.user_id
  join public.workspaces w on w.id = wm.workspace_id
  where w.status = 'active'
  limit 1;

  if real_user_id is null then
    raise exception 'TEST SETUP FAILED: no existing platform_admin who is also an active workspace member found.';
  end if;

  perform set_config('role', 'postgres', true);

  insert into auth.users (id, email, email_confirmed_at) values
    (ordinary_user_id, ordinary_email, now()),
    (success_user_id, success_email, now());
  insert into auth.users (id, email, email_confirmed_at) values
    (unconfirmed_user_id, unconfirmed_email, null);

  -- ============================================================
  -- Section (a)/(b): requester_email + account_exists on the lookup RPC.
  -- ============================================================

  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 209 No Account Co', 'No Account Test', no_account_email)
    returning id into req_no_account_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_no_account_id) into approval_result;
  token_no_account := (approval_result->>'signup_token')::uuid;

  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);

  select company_name is not null, status, requester_email, account_exists
    into caught, lookup_status, lookup_email, lookup_exists
    from public.get_company_signup_by_token(token_no_account);

  if lookup_email is distinct from no_account_email then
    raise exception 'TEST FAILED: get_company_signup_by_token returned requester_email=% (expected %)', lookup_email, no_account_email;
  end if;
  if lookup_exists is distinct from false then
    raise exception 'TEST FAILED: get_company_signup_by_token reported account_exists=true before any matching auth.users row exists';
  end if;

  raise notice 'TEST PASSED: Section (a) -- get_company_signup_by_token returns the approved requester_email and account_exists=false when no account exists yet';

  perform set_config('role', 'postgres', true);
  insert into auth.users (id, email, email_confirmed_at) values (later_user_id, no_account_email, now());

  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);
  select account_exists into lookup_exists from public.get_company_signup_by_token(token_no_account);
  if lookup_exists is distinct from true then
    raise exception 'TEST FAILED: get_company_signup_by_token still reports account_exists=false after a matching auth.users row was created';
  end if;

  raise notice 'TEST PASSED: Section (b) -- account_exists flips to true once a real account exists for that exact requester_email';

  -- ============================================================
  -- Section (c): no session at all -- rejected, same posture as
  -- accept_company_signup's own anonymous-caller check.
  -- ============================================================

  caught := false;
  begin
    perform public.claim_own_pending_company_signup();
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: claim_own_pending_company_signup succeeded with no signed-in session';
  end if;

  raise notice 'TEST PASSED: Section (c) -- an anonymous caller is rejected outright';

  -- ============================================================
  -- Section (d): an ordinary signed-in user with nothing pending gets
  -- none_pending, zero side effects -- the common case on every regular
  -- sign-in.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', ordinary_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.claim_own_pending_company_signup();
  if outcome_text is distinct from 'none_pending' or outcome_workspace_id is not null then
    raise exception 'TEST FAILED: claim_own_pending_company_signup did not report none_pending for an ordinary user with nothing pending (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_members where user_id = ordinary_user_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: claim_own_pending_company_signup created a membership row for a user with nothing pending';
  end if;

  raise notice 'TEST PASSED: Section (d) -- an ordinary signed-in user with no pending company signup gets none_pending, no side effects';

  -- ============================================================
  -- Section (e): the real success path -- no token supplied at all,
  -- resolved purely from the caller's own confirmed email.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 209 Success Co', 'Success Test', success_email)
    returning id into req_success_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_success_id) into approval_result;
  workspace_success := (approval_result->>'workspace_id')::uuid;

  select status into ws_status from public.workspaces where id = workspace_success;
  if ws_status is distinct from 'pending' then
    raise exception 'TEST FAILED: approve_company_signup left the new workspace at status % (expected pending)', ws_status;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', success_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.claim_own_pending_company_signup();
  if outcome_text is distinct from 'accepted' or outcome_workspace_id is distinct from workspace_success then
    raise exception 'TEST FAILED: claim_own_pending_company_signup did not succeed for a correct, confirmed, matching-email caller with no token supplied (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select status into ws_status from public.workspaces where id = workspace_success;
  if ws_status is distinct from 'active' then
    raise exception 'TEST FAILED: workspace was not activated via claim_own_pending_company_signup (status=%)', ws_status;
  end if;

  select count(*) into row_count from public.workspace_members where workspace_id = workspace_success and user_id = success_user_id and is_workspace_admin = true;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: claim_own_pending_company_signup did not create a workspace-admin membership row (% rows)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (e) -- a correct, confirmed, matching-email caller succeeds with NO token supplied at all -- resolved purely from their own authenticated email, closing the cross-tab/cross-browser gap';

  -- ============================================================
  -- Section (f): delegated rejection still applies -- an unconfirmed
  -- account matching a pending request is rejected, not silently waved
  -- through just because this path has no explicit token argument.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 209 Unconfirmed Co', 'Unconfirmed Test', unconfirmed_email)
    returning id into req_unconfirmed_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_unconfirmed_id) into approval_result;
  workspace_unconfirmed := (approval_result->>'workspace_id')::uuid;

  perform set_config('request.jwt.claims', json_build_object('sub', unconfirmed_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.claim_own_pending_company_signup();
  if outcome_text is distinct from 'email_not_confirmed' or outcome_workspace_id is not null then
    raise exception 'TEST FAILED: claim_own_pending_company_signup did not delegate to accept_company_signup''s email_not_confirmed rejection (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select status into ws_status from public.workspaces where id = workspace_unconfirmed;
  if ws_status is distinct from 'pending' then
    raise exception 'TEST FAILED: an unconfirmed-account claim attempt activated the workspace anyway (status=%)', ws_status;
  end if;

  raise notice 'TEST PASSED: Section (f) -- an unconfirmed account is still rejected (email_not_confirmed), delegated correctly with no token argument';

  -- ============================================================
  -- Section (g): idempotent on repeat sign-ins -- once used, a second
  -- call for the same now-signed-in user reports none_pending, no
  -- duplicate membership.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', success_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.claim_own_pending_company_signup();
  if outcome_text is distinct from 'none_pending' or outcome_workspace_id is not null then
    raise exception 'TEST FAILED: a second claim_own_pending_company_signup call for an already-claimed user did not report none_pending (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_members where workspace_id = workspace_success;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a repeat claim_own_pending_company_signup call produced % membership rows (expected 1)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (g) -- a repeat call after a successful claim is idempotent (none_pending, no duplicate membership) -- safe to run unconditionally on every sign-in';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 209 COMPANY SIGNUP CLAIM UX HARDENING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
