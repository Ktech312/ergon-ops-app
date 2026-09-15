-- Diagnostic only (2026-09-14, v2) -- not a migration, nothing here is
-- meant to be kept or reused. migration 143's get_quote_proposal_by_token()/
-- get_submittal_by_token() wrap their own insert into share_link_views in
-- `exception when others then null;` (deliberate -- a logging failure must
-- never block a real customer from reaching their document) -- which means
-- the canonical test's "found 0 share_link_views rows" failure gives zero
-- visibility into WHY the insert didn't happen. This script:
--   1. reports table/function ownership plus the live grant state, since
--      migration 141 (already applied) revoked all direct table privilege
--      on share_link_views from anon/authenticated/public;
--   2. attempts an insert into share_link_views OUTSIDE any exception
--      handler, using a token already registered in public_share_tokens
--      (v1 of this script used an unregistered token and hit
--      share_link_views_token_fkey instead of testing anything real --
--      fixed here);
--   3. separately calls the REAL function (get_submittal_by_token) against
--      that SAME registered token and checks whether a SECOND row landed
--      -- isolating whether the function's own SECURITY DEFINER execution
--      context behaves differently from this script's own direct insert,
--      which by then will have already proven whether a direct insert can
--      succeed at all under this role.
--
-- Wrapped in begin;/rollback; -- nothing here commits, including the
-- diagnostic inserts themselves if they succeed. Safe to run as many times
-- as needed.

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

  raise notice 'DIAGNOSTIC 1/4: caller role=% | share_link_views owner=% | get_quote_proposal_by_token owner=% | anon table privileges=% | authenticated table privileges=%',
    caller_role, table_owner, function_owner, coalesce(anon_table_priv, '(none)'), coalesce(authenticated_table_priv, '(none)');

  select user_id into admin_user_id from public.app_admins limit 1;
  if admin_user_id is null then
    raise exception 'DIAGNOSTIC ABORTED: no admin user found -- cannot build fixtures.';
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
  -- in public_share_tokens (unlike v1's mistake), with NO exception
  -- handler -- if this fails now, the real error is something other than
  -- the foreign key, and will show right here.
  insert into public.share_link_views (token, entity_type, entity_id, result)
    values (test_token, 'project_submittal', test_submittal_id, 'success');
  select count(*) into rows_after_direct_insert from public.share_link_views where token = test_token;
  raise notice 'DIAGNOSTIC 2/4: direct insert into share_link_views SUCCEEDED, % row(s) visible for this token immediately after.', rows_after_direct_insert;

  -- Step 3: now call the REAL function against the SAME token and check
  -- whether ITS internal insert (still wrapped in migration 143's own
  -- exception handler) adds a SECOND row -- this isolates whether
  -- SECURITY DEFINER execution context behaves differently from this
  -- script's own insert above, which just succeeded.
  select count(*) into rows_before_function_call from public.share_link_views where token = test_token;
  select * into r from public.get_submittal_by_token(test_token);
  select count(*) into rows_after_function_call from public.share_link_views where token = test_token;

  raise notice 'DIAGNOSTIC 3/4: get_submittal_by_token(...) returned outcome=%, submittal_id=%. share_link_views rows for this token: % before call, % after call.',
    r.outcome, r.submittal_id, rows_before_function_call, rows_after_function_call;

  if rows_after_function_call = rows_before_function_call then
    raise notice 'DIAGNOSTIC 4/4: CONFIRMED -- the function''s own internal insert did NOT add a row, even though this script''s own direct insert (step 2) succeeded moments earlier under the same role. The difference is specific to the function''s SECURITY DEFINER execution context, not a general RLS/grant problem for this role.';
  else
    raise notice 'DIAGNOSTIC 4/4: the function''s own internal insert DID add a row this time (% -> %) -- the mechanism works under this diagnostic''s conditions. If the canonical test still reports 0 rows, the difference is specific to that script''s exact sequencing or fixture state, not this general mechanism.', rows_before_function_call, rows_after_function_call;
  end if;
end;
$$;

rollback;
