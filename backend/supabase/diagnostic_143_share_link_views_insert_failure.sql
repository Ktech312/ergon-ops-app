-- Diagnostic only (2026-09-14, v4) -- not a migration, nothing here is
-- meant to be kept or reused. v1/v2 reported findings via RAISE NOTICE,
-- which Supabase's SQL Editor shows in a separate Logs/Notices panel, not
-- the main results grid -- the query itself just reported "Success. No
-- rows returned" either way, so the finding was invisible. v3 tried a
-- temporary table + trailing SELECT, but a multi-statement script's final
-- displayed result in Supabase's editor is uncertain (the trailing
-- `rollback;` risks being what's shown, same invisibility problem again).
--
-- v4 fixes this for good: it ALWAYS ends by deliberately RAISING AN
-- EXCEPTION whose message contains every finding, all four steps
-- concatenated into one block of text. This is the exact delivery
-- mechanism that has already worked reliably every other time in this
-- session -- every `raise exception 'TEST FAILED: ...'` in every canonical
-- test script has shown up in full as "Failed to run sql query: ERROR:
-- ..." with the complete message intact, copy-pasteable. This script uses
-- that same guaranteed-visible channel on purpose, regardless of whether
-- the underlying finding is "the bug is confirmed" or "everything actually
-- works" -- either way, the error message itself IS the answer. Raising an
-- exception also auto-rolls-back everything the DO block did, with no
-- separate rollback statement needed to guarantee nothing commits.
--
-- migration 143's get_quote_proposal_by_token()/get_submittal_by_token()
-- wrap their own insert into share_link_views in `exception when others
-- then null;` (deliberate -- a logging failure must never block a real
-- customer) -- which is why the canonical test's "found 0 rows" failure
-- gave zero visibility into WHY. This script:
--   1. reports table/function ownership plus the live grant state, since
--      migration 141 (already applied) revoked all direct table privilege
--      on share_link_views from anon/authenticated/public;
--   2. attempts an insert into share_link_views OUTSIDE any exception
--      handler, using a token already registered in public_share_tokens;
--   3. separately calls the REAL function (get_submittal_by_token) against
--      that SAME token and checks whether a SECOND row landed -- isolating
--      whether the function's own SECURITY DEFINER execution context
--      behaves differently from this script's own direct insert.
--
-- Copy-paste the FULL error message back, including everything after
-- "ERROR:" -- that text block is the complete answer.

begin;

do $$
declare
  admin_user_id uuid;
  test_project_id uuid;
  test_submittal_id uuid;
  test_token text := 'ZZ_DIAG_143_' || substr(md5(random()::text), 1, 12);
  caller_role text;
  table_owner text;
  function_owner text;
  anon_table_priv text;
  authenticated_table_priv text;
  rows_after_direct_insert integer;
  rows_before_function_call integer;
  rows_after_function_call integer;
  r record;
  finding_1 text;
  finding_2 text;
  finding_3 text;
  finding_4 text;
begin
  select current_setting('role') into caller_role;

  select rolname into table_owner
  from pg_roles
  where oid = (select relowner from pg_class where relname = 'share_link_views' and relnamespace = 'public'::regnamespace);

  select rolname into function_owner
  from pg_roles
  where oid = (select proowner from pg_proc where proname = 'get_quote_proposal_by_token' and pronamespace = 'public'::regnamespace);

  select string_agg(privilege_type, ', ') into anon_table_priv
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'share_link_views' and grantee = 'anon';

  select string_agg(privilege_type, ', ') into authenticated_table_priv
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'share_link_views' and grantee = 'authenticated';

  finding_1 := format(
    'STEP 1: caller role=%s | share_link_views owner=%s | get_quote_proposal_by_token owner=%s | anon table privileges=%s | authenticated table privileges=%s',
    caller_role, table_owner, function_owner, coalesce(anon_table_priv, '(none)'), coalesce(authenticated_table_priv, '(none)')
  );

  select user_id into admin_user_id from public.app_admins limit 1;
  if admin_user_id is null then
    raise exception E'DIAGNOSTIC RESULT:\n%\nSTEP 2-4: ABORTED -- no admin user found, cannot build fixtures.', finding_1;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
  perform set_config('request.jwt.claim.sub', admin_user_id::text, true);

  insert into public.projects (project_name, customer_name, site_type, app_status)
    values ('ZZ_DIAG_PROJECT_' || substr(md5(random()::text), 1, 10), 'ZZ Diag Client', 'Parking Garage', 'Draft')
    returning id into test_project_id;
  insert into public.project_submittals (project_id, version, status, content_snapshot, client_name, client_email)
    values (test_project_id, 1, 'sent', '{}'::jsonb, 'ZZ Diag Client', 'zz-diag@example.com')
    returning id into test_submittal_id;
  insert into public.public_share_tokens (token, entity_type, entity_id, status)
    values (test_token, 'project_submittal', test_submittal_id, 'active');

  -- Step 2: an insert into share_link_views using a token that DOES exist
  -- in public_share_tokens, with NO exception handler -- if this fails,
  -- the block aborts right here and Postgres's own real error (not this
  -- script's) is what Supabase shows, same as before.
  insert into public.share_link_views (token, entity_type, entity_id, result)
    values (test_token, 'project_submittal', test_submittal_id, 'success');
  select count(*) into rows_after_direct_insert from public.share_link_views where token = test_token;
  finding_2 := format(
    'STEP 2: direct insert into share_link_views SUCCEEDED, %s row(s) visible for this token immediately after.',
    rows_after_direct_insert
  );

  -- Step 3: call the REAL function against the SAME token and check
  -- whether ITS internal insert (still wrapped in migration 143's own
  -- exception handler) adds a SECOND row.
  select count(*) into rows_before_function_call from public.share_link_views where token = test_token;
  select * into r from public.get_submittal_by_token(test_token);
  select count(*) into rows_after_function_call from public.share_link_views where token = test_token;

  finding_3 := format(
    'STEP 3: get_submittal_by_token(...) returned outcome=%s, submittal_id=%s. share_link_views rows for this token: %s before call, %s after call.',
    r.outcome, r.submittal_id, rows_before_function_call, rows_after_function_call
  );

  if rows_after_function_call = rows_before_function_call then
    finding_4 := 'STEP 4: CONFIRMED BUG -- the function''s own internal insert did NOT add a row, even though this script''s own direct insert (step 2) succeeded moments earlier under the same role. The difference is specific to the function''s SECURITY DEFINER execution context, not a general RLS/grant problem for this role.';
  else
    finding_4 := format(
      'STEP 4: mechanism WORKS here -- the function''s own internal insert DID add a row this time (%s -> %s). If the canonical test still reports 0 rows, the difference is specific to that script''s exact sequencing or fixture state, not this general mechanism.',
      rows_before_function_call, rows_after_function_call
    );
  end if;

  -- Always raise -- this is the guaranteed-visible delivery channel, not a
  -- real failure. Everything above (fixtures, both inserts) rolls back
  -- automatically the instant this fires.
  raise exception E'DIAGNOSTIC RESULT (not a real failure -- read every line below):\n%\n%\n%\n%', finding_1, finding_2, finding_3, finding_4;
end;
$$;

rollback;
