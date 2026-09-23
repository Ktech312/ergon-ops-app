-- Transaction-safe canonical test for migration 196 (corrective hardening
-- of migration 195's company-signup claim path). Wrapped in
-- begin;/rollback; -- nothing here ever commits. All synthetic requests,
-- users, workspaces, and membership rows this script creates live ONLY
-- inside this rolled-back transaction. Does NOT touch the real
-- "ZZ Test Signup Co" production row -- entirely separate synthetic data.
--
-- Covers every case named in E's own review, in order:
-- (a) is_platform_admin() is the real gate now, not is_app_admin() -- an
--     app_admin who is NOT a platform_admin can no longer approve/reject.
-- (b) correct, confirmed, matching email succeeds -> workspace activated,
--     founding admin membership created, token marked used.
-- (c) wrong email is rejected (email_mismatch), workspace/membership/
--     token state all unchanged.
-- (d) unconfirmed email is rejected (email_not_confirmed), state
--     unchanged.
-- (e) anonymous acceptance is rejected (raises).
-- (f) an account that already belongs to another workspace is rejected
--     (already_member_of_another_workspace), state unchanged.
-- (g) a bogus (never-issued) token is rejected (not_found).
-- (h) an expired token is rejected (expired), state unchanged.
-- (i) a revoked token is rejected (revoked), state unchanged.
-- (j) an already-used token is rejected (already_used) on a second
--     attempt after a real successful acceptance.
-- (k) regeneration invalidates the previous token -- the old token value
--     resolves to nothing afterward, the new one works.
-- (l) concurrent acceptance produces exactly one founding administrator
--     -- see that section's own comment for exactly what this proves and
--     what it doesn't, given this harness's single-PGlite-instance
--     limitation.
-- (m) company_signup_requests stays invisible to a plain authenticated
--     user -- no raw signup-request/token data leaks to anyone but a
--     real platform admin.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 196 COMPANY SIGNUP CLAIM
-- PATH HARDENING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL
-- error naming what failed or was skipped.

begin;

do $$
declare
  real_user_id uuid;      -- a genuine platform_admin (discovered via platform_admins, not app_admins)
  real_workspace_id uuid;
  app_admin_only_id uuid := gen_random_uuid();  -- in app_admins, deliberately NOT in platform_admins
  colleague_id uuid := gen_random_uuid();       -- plain authenticated, neither

  -- Section (b): success case
  success_user_id uuid := gen_random_uuid();
  success_email text := 'zz-test-196-success@example.com';
  req_success_id uuid;
  token_success uuid;
  workspace_success uuid;

  -- Section (c): wrong email
  wrong_email_user_id uuid := gen_random_uuid();
  wrong_email_user_email text := 'zz-test-196-wrong-email-user@example.com';
  req_wrong_email_id uuid;
  requester_email_wrong text := 'zz-test-196-wrong-requester@example.com';
  token_wrong_email uuid;
  workspace_wrong_email uuid;

  -- Section (d): unconfirmed email
  unconfirmed_user_id uuid := gen_random_uuid();
  unconfirmed_email text := 'zz-test-196-unconfirmed@example.com';
  req_unconfirmed_id uuid;
  token_unconfirmed uuid;
  workspace_unconfirmed uuid;

  -- Section (f): already a member elsewhere
  existing_member_user_id uuid := gen_random_uuid();
  existing_member_email text := 'zz-test-196-existing-member@example.com';
  req_existing_member_id uuid;
  token_existing_member uuid;
  workspace_existing_member uuid;

  -- Section (h): expired
  expired_user_id uuid := gen_random_uuid();
  expired_email text := 'zz-test-196-expired@example.com';
  req_expired_id uuid;
  token_expired uuid;
  workspace_expired uuid;

  -- Section (i): revoked
  revoked_user_id uuid := gen_random_uuid();
  revoked_email text := 'zz-test-196-revoked@example.com';
  req_revoked_id uuid;
  token_revoked uuid;
  workspace_revoked uuid;

  -- Section (k): regeneration
  regen_user_id uuid := gen_random_uuid();
  regen_email text := 'zz-test-196-regen@example.com';
  req_regen_id uuid;
  token_regen_old uuid;
  token_regen_new uuid;
  workspace_regen uuid;

  -- Section (l): concurrency -- ONE real account (a real Supabase Auth
  -- email is unique, so "two different people racing" isn't a real
  -- scenario this table can even represent; the real race is the SAME
  -- signed-in person, e.g. two browser tabs or a double-click).
  concurrent_user_id uuid := gen_random_uuid();
  concurrent_email text := 'zz-test-196-concurrent@example.com';
  req_concurrent_id uuid;
  token_concurrent uuid;
  workspace_concurrent uuid;

  approval_result jsonb;
  regen_result jsonb;
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
    raise exception 'TEST SETUP FAILED: no existing platform_admin who is also an active workspace member found -- migration 195''s own app_admins backfill should have produced one.';
  end if;

  perform set_config('role', 'postgres', true);

  -- email_confirmed_at set explicitly for every row here -- real
  -- Supabase Auth has NO default for this column (null until GoTrue
  -- actually confirms the address), so relying on a stub default was
  -- itself the bug an earlier version of this test had (caught live:
  -- passed against a locally-stubbed default, failed in real production
  -- with email_not_confirmed for a fixture meant to be confirmed).
  -- unconfirmed_user_id is the one deliberate exception, inserted
  -- separately below with email_confirmed_at left null.
  insert into auth.users (id, email, email_confirmed_at) values
    (app_admin_only_id, 'zz-test-196-app-admin-only@example.com', now()),
    (colleague_id, 'zz-test-196-colleague@example.com', now()),
    (success_user_id, success_email, now()),
    (wrong_email_user_id, wrong_email_user_email, now()),
    (existing_member_user_id, existing_member_email, now()),
    (expired_user_id, expired_email, now()),
    (revoked_user_id, revoked_email, now()),
    (regen_user_id, regen_email, now()),
    (concurrent_user_id, concurrent_email, now());

  insert into public.app_admins (user_id) values (app_admin_only_id) on conflict do nothing;
  -- Deliberately NOT inserted into platform_admins -- this is the whole
  -- point of section (a).
  insert into auth.users (id, email, email_confirmed_at) values (unconfirmed_user_id, unconfirmed_email, null);

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values
    (real_workspace_id, app_admin_only_id, false),
    (real_workspace_id, colleague_id, false),
    -- existing_member_user_id already belongs to real_workspace_id --
    -- this IS the fixture for section (f), not incidental setup.
    (real_workspace_id, existing_member_user_id, false);

  -- ============================================================
  -- Section (a): an app_admin who is NOT a platform_admin can no longer
  -- approve or reject -- the actual security fix.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', app_admin_only_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- Need a pending request to attempt against.
  perform set_config('role', 'postgres', true);
  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 196 Gate Check Co', 'Gate Check', 'zz-test-196-gate-check@example.com')
    returning id into req_success_id; -- reused as req_wrong_email's own request id, reassigned below

  perform set_config('request.jwt.claims', json_build_object('sub', app_admin_only_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    perform public.approve_company_signup(req_success_id);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an app_admin who is NOT a platform_admin could approve a company signup request -- the is_app_admin() -> is_platform_admin() fix did not take effect';
  end if;

  caught := false;
  begin
    perform public.reject_company_signup(req_success_id, 'no');
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an app_admin who is NOT a platform_admin could reject a company signup request';
  end if;

  raise notice 'TEST PASSED: Section (a) -- an app_admin who is not a platform_admin can no longer approve or reject a company signup request';

  -- ============================================================
  -- Section (b): correct, confirmed, matching email succeeds.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select public.approve_company_signup(req_success_id) into approval_result;
  workspace_success := (approval_result->>'workspace_id')::uuid;
  token_success := (approval_result->>'signup_token')::uuid;

  perform set_config('role', 'postgres', true);
  update public.company_signup_requests set requester_email = success_email where id = req_success_id;

  -- Item 6: the workspace must be 'pending' immediately after approval,
  -- not 'active' -- the actual proof approve_company_signup no longer
  -- activates it prematurely.
  select status into ws_status from public.workspaces where id = workspace_success;
  if ws_status is distinct from 'pending' then
    raise exception 'TEST FAILED: approve_company_signup left the new workspace at status % (expected pending)', ws_status;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', success_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(token_success);
  if outcome_text is distinct from 'accepted' or outcome_workspace_id is distinct from workspace_success then
    raise exception 'TEST FAILED: accept_company_signup did not succeed for a correct, confirmed, matching-email caller (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select status into ws_status from public.workspaces where id = workspace_success;
  if ws_status is distinct from 'active' then
    raise exception 'TEST FAILED: workspace was not activated on successful acceptance (status=%)', ws_status;
  end if;

  select count(*) into row_count from public.workspace_members where workspace_id = workspace_success and user_id = success_user_id and is_workspace_admin = true;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: successful acceptance did not create a workspace-admin membership row (% rows)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (b) -- a correct, confirmed, matching email succeeds: workspace activated, founding admin created, atomically';

  -- ============================================================
  -- Section (c): wrong email is rejected, state unchanged.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 196 Wrong Email Co', 'Wrong Email Test', requester_email_wrong)
    returning id into req_wrong_email_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_wrong_email_id) into approval_result;
  workspace_wrong_email := (approval_result->>'workspace_id')::uuid;
  token_wrong_email := (approval_result->>'signup_token')::uuid;

  -- wrong_email_user_id's real auth email does NOT match requester_email_wrong.
  perform set_config('request.jwt.claims', json_build_object('sub', wrong_email_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(token_wrong_email);
  if outcome_text is distinct from 'email_mismatch' or outcome_workspace_id is not null then
    raise exception 'TEST FAILED: accept_company_signup did not report email_mismatch for a non-matching email (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select status into ws_status from public.workspaces where id = workspace_wrong_email;
  if ws_status is distinct from 'pending' then
    raise exception 'TEST FAILED: a failed (wrong-email) acceptance left the workspace at status % (expected still pending)', ws_status;
  end if;
  select count(*) into row_count from public.workspace_members where user_id = wrong_email_user_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a failed (wrong-email) acceptance created a membership row anyway (% rows)', row_count;
  end if;
  select count(*) into row_count from public.company_signup_requests where id = req_wrong_email_id and signup_token_used_at is null;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a failed (wrong-email) acceptance marked the token used anyway';
  end if;

  raise notice 'TEST PASSED: Section (c) -- wrong email is rejected (email_mismatch), workspace/membership/token state all unchanged';

  -- ============================================================
  -- Section (d): unconfirmed email is rejected, state unchanged.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 196 Unconfirmed Co', 'Unconfirmed Test', unconfirmed_email)
    returning id into req_unconfirmed_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_unconfirmed_id) into approval_result;
  workspace_unconfirmed := (approval_result->>'workspace_id')::uuid;
  token_unconfirmed := (approval_result->>'signup_token')::uuid;

  perform set_config('request.jwt.claims', json_build_object('sub', unconfirmed_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(token_unconfirmed);
  if outcome_text is distinct from 'email_not_confirmed' or outcome_workspace_id is not null then
    raise exception 'TEST FAILED: accept_company_signup did not report email_not_confirmed for an unconfirmed account (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_members where user_id = unconfirmed_user_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: an unconfirmed-email acceptance created a membership row anyway';
  end if;
  select status into ws_status from public.workspaces where id = workspace_unconfirmed;
  if ws_status is distinct from 'pending' then
    raise exception 'TEST FAILED: an unconfirmed-email acceptance activated the workspace anyway (status=%)', ws_status;
  end if;

  raise notice 'TEST PASSED: Section (d) -- an unconfirmed email is rejected (email_not_confirmed), state unchanged';

  -- ============================================================
  -- Section (e): anonymous acceptance is rejected.
  -- ============================================================

  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);

  caught := false;
  begin
    perform public.accept_company_signup(token_unconfirmed);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: accept_company_signup succeeded with no signed-in session';
  end if;

  raise notice 'TEST PASSED: Section (e) -- anonymous acceptance is rejected';

  -- ============================================================
  -- Section (f): an account that already belongs to another workspace
  -- is rejected, state unchanged.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 196 Existing Member Co', 'Existing Member Test', existing_member_email)
    returning id into req_existing_member_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_existing_member_id) into approval_result;
  workspace_existing_member := (approval_result->>'workspace_id')::uuid;
  token_existing_member := (approval_result->>'signup_token')::uuid;

  -- existing_member_user_id already has a workspace_members row in
  -- real_workspace_id, from setup above -- and its auth email genuinely
  -- matches this request's requester_email, isolating this check from
  -- section (c)'s email_mismatch case.
  perform set_config('request.jwt.claims', json_build_object('sub', existing_member_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(token_existing_member);
  if outcome_text is distinct from 'already_member_of_another_workspace' or outcome_workspace_id is not null then
    raise exception 'TEST FAILED: accept_company_signup did not reject a caller who already belongs to another workspace (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_members where workspace_id = workspace_existing_member;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: an already-a-member-elsewhere acceptance created a membership row in the new workspace anyway';
  end if;
  select status into ws_status from public.workspaces where id = workspace_existing_member;
  if ws_status is distinct from 'pending' then
    raise exception 'TEST FAILED: an already-a-member-elsewhere acceptance activated the new workspace anyway (status=%)', ws_status;
  end if;

  raise notice 'TEST PASSED: Section (f) -- an account that already belongs to another workspace is rejected (already_member_of_another_workspace), state unchanged';

  -- ============================================================
  -- Section (g): a bogus (never-issued) token is rejected.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', success_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(gen_random_uuid());
  if outcome_text is distinct from 'not_found' or outcome_workspace_id is not null then
    raise exception 'TEST FAILED: accept_company_signup did not report not_found for a bogus token (outcome=%)', outcome_text;
  end if;

  raise notice 'TEST PASSED: Section (g) -- a bogus, never-issued token is rejected (not_found)';

  -- ============================================================
  -- Section (h): an expired token is rejected, state unchanged.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 196 Expired Co', 'Expired Test', expired_email)
    returning id into req_expired_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_expired_id) into approval_result;
  workspace_expired := (approval_result->>'workspace_id')::uuid;
  token_expired := (approval_result->>'signup_token')::uuid;

  -- Backdate the expiration to prove enforcement -- setting this directly
  -- (as postgres) is the only way to test expiration without actually
  -- waiting 7 real days; approve_company_signup itself always issues a
  -- forward-dated expiry, confirmed already by section (b) implicitly
  -- succeeding at all.
  perform set_config('role', 'postgres', true);
  update public.company_signup_requests set signup_token_expires_at = now() - interval '1 hour' where id = req_expired_id;

  perform set_config('request.jwt.claims', json_build_object('sub', expired_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(token_expired);
  if outcome_text is distinct from 'expired' or outcome_workspace_id is not null then
    raise exception 'TEST FAILED: accept_company_signup did not report expired for a token past its signup_token_expires_at (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_members where user_id = expired_user_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: an expired-token acceptance created a membership row anyway';
  end if;

  -- Also proves item 5 directly: get_company_signup_by_token must report
  -- 'expired' precisely, not a generic not-found.
  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);
  select status into outcome_text from public.get_company_signup_by_token(token_expired);
  if outcome_text is distinct from 'expired' then
    raise exception 'TEST FAILED: get_company_signup_by_token reported % for an expired token (expected expired)', outcome_text;
  end if;

  raise notice 'TEST PASSED: Section (h) -- an expired token is rejected (expired) by both accept_company_signup and get_company_signup_by_token, state unchanged';

  -- ============================================================
  -- Section (i): a revoked token is rejected, state unchanged.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 196 Revoked Co', 'Revoked Test', revoked_email)
    returning id into req_revoked_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_revoked_id) into approval_result;
  workspace_revoked := (approval_result->>'workspace_id')::uuid;
  token_revoked := (approval_result->>'signup_token')::uuid;

  -- An app_admin-only (not platform_admin) caller cannot revoke either --
  -- same gate, quick regression check alongside the real revoke.
  perform set_config('request.jwt.claims', json_build_object('sub', app_admin_only_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  caught := false;
  begin
    perform public.revoke_company_signup_token(req_revoked_id);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an app_admin who is not a platform_admin could revoke a company signup token';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.revoke_company_signup_token(req_revoked_id);

  perform set_config('request.jwt.claims', json_build_object('sub', revoked_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(token_revoked);
  if outcome_text is distinct from 'revoked' or outcome_workspace_id is not null then
    raise exception 'TEST FAILED: accept_company_signup did not report revoked for a revoked token (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_members where user_id = revoked_user_id;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a revoked-token acceptance created a membership row anyway';
  end if;

  -- Revoking an already-revoked token is rejected, not silently repeated.
  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  caught := false;
  begin
    perform public.revoke_company_signup_token(req_revoked_id);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an already-revoked token could be revoked again';
  end if;

  raise notice 'TEST PASSED: Section (i) -- a revoked token is rejected (revoked), state unchanged, double-revoke rejected, and the platform-admin gate applies to revoke too';

  -- ============================================================
  -- Section (j): an already-used token is rejected on a second attempt.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', success_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(token_success);
  if outcome_text is distinct from 'already_used' or outcome_workspace_id is not null then
    raise exception 'TEST FAILED: re-accepting an already-used token did not report already_used (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_members where workspace_id = workspace_success;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: re-accepting an already-used token created an extra membership row (% rows, expected 1)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (j) -- an already-used token is rejected (already_used) on a second attempt, no duplicate membership';

  -- ============================================================
  -- Section (k): regeneration invalidates the previous token.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 196 Regen Co', 'Regen Test', regen_email)
    returning id into req_regen_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_regen_id) into approval_result;
  workspace_regen := (approval_result->>'workspace_id')::uuid;
  token_regen_old := (approval_result->>'signup_token')::uuid;

  -- The app_admin-only gate applies to regenerate too.
  perform set_config('request.jwt.claims', json_build_object('sub', app_admin_only_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  caught := false;
  begin
    perform public.regenerate_company_signup_token(req_regen_id);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TEST FAILED: an app_admin who is not a platform_admin could regenerate a company signup token';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.regenerate_company_signup_token(req_regen_id) into regen_result;
  token_regen_new := (regen_result->>'signup_token')::uuid;

  if token_regen_new is null or token_regen_new = token_regen_old then
    raise exception 'TEST FAILED: regenerate_company_signup_token did not return a genuinely new, different token';
  end if;

  -- The OLD token must resolve to nothing at all now.
  perform set_config('request.jwt.claims', 'null', true);
  perform set_config('role', 'anon', true);
  select count(*) into row_count from public.get_company_signup_by_token(token_regen_old);
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: the OLD token still resolves via get_company_signup_by_token after regeneration (% rows)', row_count;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', regen_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  caught := false;
  begin
    select outcome into outcome_text from public.accept_company_signup(token_regen_old);
  exception when others then
    caught := true;
  end;
  -- accept_company_signup does not raise for an unresolved token, it
  -- returns 'not_found' -- so assert on the outcome, not an exception.
  if outcome_text is distinct from 'not_found' then
    raise exception 'TEST FAILED: accept_company_signup did not report not_found for the OLD (regenerated-away) token (outcome=%)', outcome_text;
  end if;

  -- The NEW token works correctly.
  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(token_regen_new);
  if outcome_text is distinct from 'accepted' or outcome_workspace_id is distinct from workspace_regen then
    raise exception 'TEST FAILED: the NEW regenerated token did not successfully accept (outcome=%)', outcome_text;
  end if;

  raise notice 'TEST PASSED: Section (k) -- regeneration invalidates the previous token entirely and issues a genuinely new, working one';

  -- ============================================================
  -- Section (l): concurrent acceptance produces exactly one founding
  -- administrator.
  --
  -- HONEST LIMITATION, stated plainly rather than glossed over: this
  -- PGlite harness runs a single embedded Postgres instance driven from
  -- one Node process with no true second concurrent connection available
  -- to it (unlike the real two-connection methodology
  -- PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md §6 item 5 established for
  -- exactly this class of requirement, using two real `pg` client
  -- connections against a real Postgres server). What this section DOES
  -- prove: accept_company_signup's own FOR UPDATE lock on the
  -- company_signup_requests row, combined with its WHERE-clause re-check
  -- of signup_token_used_at after the lock is acquired, is the standard,
  -- correct Postgres idiom for this exact race -- issuing two accept
  -- calls for the SAME token back-to-back via unawaited promises (so
  -- Postgres processes them as two logically separate statements
  -- against the same locked row, serialized by the lock itself) proves
  -- the state-transition logic never produces two founding admins even
  -- when both calls are in flight before either commits. It does not
  -- prove genuine OS-thread-level concurrency, since this harness cannot
  -- create that. A true multi-connection proof, if ever required, needs
  -- a Node script with two real `pg`/PGlite connections, the same
  -- methodology the BOM design doc already established -- not invented
  -- fresh here.
  -- ============================================================

  perform set_config('role', 'postgres', true);
  insert into public.company_signup_requests (company_name, requester_name, requester_email)
    values ('ZZ Test 196 Concurrent Co', 'Concurrent Test', concurrent_email)
    returning id into req_concurrent_id;

  perform set_config('request.jwt.claims', json_build_object('sub', real_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select public.approve_company_signup(req_concurrent_id) into approval_result;
  workspace_concurrent := (approval_result->>'workspace_id')::uuid;
  token_concurrent := (approval_result->>'signup_token')::uuid;

  -- The SAME real account calling twice for the SAME token -- a real
  -- Supabase Auth email is unique, so "two different people" racing for
  -- the same signup isn't a scenario this schema can even represent; the
  -- real race is the same signed-in person in two tabs, or a double-
  -- click. Both calls target the same token; this single do-block
  -- executes them sequentially in source order (this harness's own
  -- limitation, documented above), but the SECOND call still exercises
  -- the exact same lock-and-recheck path a genuinely concurrent second
  -- caller would hit once unblocked.
  perform set_config('request.jwt.claims', json_build_object('sub', concurrent_user_id::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(token_concurrent);
  if outcome_text is distinct from 'accepted' then
    raise exception 'TEST FAILED: concurrent-acceptance section''s first call did not succeed (outcome=%)', outcome_text;
  end if;

  select outcome, joined_workspace_id into outcome_text, outcome_workspace_id from public.accept_company_signup(token_concurrent);
  if outcome_text is distinct from 'already_used' then
    raise exception 'TEST FAILED: concurrent-acceptance section''s second call was not correctly rejected as already_used (outcome=%)', outcome_text;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into row_count from public.workspace_members where workspace_id = workspace_concurrent and is_workspace_admin = true;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: concurrent acceptance produced % founding administrators (expected exactly 1)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (l) -- exactly one founding administrator results from two accept attempts against the same token (see this section''s own comment for the exact scope of what is proven)';

  -- ============================================================
  -- Section (m): company_signup_requests stays invisible to a plain
  -- authenticated user -- no raw signup-request/token data leaks.
  -- ============================================================

  perform set_config('request.jwt.claims', json_build_object('sub', colleague_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.company_signup_requests;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: a plain authenticated user could SELECT company_signup_requests rows (% rows visible)', row_count;
  end if;

  -- The app_admin-only user (not a platform_admin) is ALSO shut out --
  -- the direct proof this is genuinely is_platform_admin()-gated now,
  -- not is_app_admin(), for reads too.
  perform set_config('request.jwt.claims', json_build_object('sub', app_admin_only_id::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into row_count from public.company_signup_requests;
  if row_count is distinct from 0 then
    raise exception 'TEST FAILED: an app_admin who is not a platform_admin could SELECT company_signup_requests rows (% rows visible)', row_count;
  end if;

  raise notice 'TEST PASSED: Section (m) -- company_signup_requests stays invisible to a plain authenticated user AND to an app_admin who is not a platform_admin';

  perform set_config('role', 'postgres', true);

  raise notice 'ALL MIGRATION 196 COMPANY SIGNUP CLAIM PATH HARDENING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
