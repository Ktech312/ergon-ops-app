-- Transaction-safe tests for migration 143's share-link view-logging write
-- path. Wrapped in begin;/rollback; -- nothing here ever commits. Uses a
-- REAL, already-existing admin for fixture creation (never fabricates a
-- fake auth.users row); every project/submittal/quote/proposal/token this
-- script creates is synthetic, fresh inside this same rolled-back
-- transaction, clearly named "ZZ_TEST_...". Requires migrations 137-140
-- (+ corrective 141/142) to already be live. Fixture tokens are created by
-- direct INSERT (not through the create_*_share_token RPCs) -- this
-- script tests view-logging on lookup, not creation-time authorization,
-- which migration 138's own test already covers.
--
-- CORRECTED 2026-09-14, after a real production run failed with `ERROR:
-- 42501: new row violates row-level security policy for table
-- "project_submittals"`. Root cause: this script originally impersonated
-- 'authenticated' (as the real admin) for its own fixture INSERTs into
-- project_submittals/sales_quote_proposals, which worked when it was first
-- drafted (migration 025's "pm and admin write project_submittals" and
-- migration 053's "authenticated write sales_quote_proposals" policies
-- still existed then) -- but migration 144, applied and its own canonical
-- test proven correct the same day, deliberately dropped both of those
-- policies entirely. The exact thing 144's test proves (a direct
-- authenticated write is now rejected) is exactly what this script's own
-- fixture setup was still relying on. Fixed by never switching `role` to
-- 'authenticated' for fixture creation at all -- only the jwt claim GUCs
-- are set (the admin's id), so the script's own original (superuser) role
-- bypasses RLS regardless of which policies exist now or change later,
-- exactly matching migration 144's own test and every other test script's
-- established convention in this repo. auth.uid() (needed by sales_quotes'
-- migration-117 workspace-ownership trigger) reads only those jwt claim
-- GUCs, never `role`, so it still resolves correctly. Migration 143 itself
-- was NOT edited or rerun -- it only redefines two GET functions and never
-- touched these tables' RLS policies; this was purely a stale assumption
-- in the test script's own fixture setup, overtaken by later, unrelated
-- work (migration 144) landing after this script was first drafted.
--
-- EXTENDED 2026-09-14 (Section 0 added): this script's own real production
-- run subsequently proved that migration 143's logic could be recorded as
-- applied ("Success. No rows returned") while its actual function bodies
-- were NOT live -- the deployed get_quote_proposal_by_token()/get_
-- submittal_by_token() were still running migration 139's original logic,
-- with no view-logging insert anywhere in them (root cause undetermined;
-- fixed forward by migration 145's CREATE OR REPLACE, not by editing 143).
-- Section 1 below (an actual failed insert) already caught this once, but
-- only after a lengthy separate diagnostic investigation was needed to
-- explain WHY. Section 0 makes that diagnosis instant and structural next
-- time: it reads each function's own live source via pg_get_functiondef()
-- and asserts the view-logging insert is actually present in it, before
-- any fixture or functional check runs at all.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 143 SHARE-LINK VIEW
-- LOGGING TESTS PASSED -- ZERO SECTIONS SKIPPED", or a hard SQL error
-- naming what failed or was skipped.

begin;

do $$
declare
  admin_user_id uuid;
  skipped_count integer := 0;
  skipped_names text[] := array[]::text[];

  submittal_fn_source text;
  proposal_fn_source text;

  test_project_id uuid;
  test_submittal_id uuid;
  test_quote_id uuid;
  test_proposal_id uuid;

  active_proposal_token text := 'ZZ_TEST_PROP_ACTIVE_' || substr(md5(random()::text), 1, 12);
  disabled_proposal_token text := 'ZZ_TEST_PROP_DISABLED_' || substr(md5(random()::text), 1, 12);
  revoked_proposal_token text := 'ZZ_TEST_PROP_REVOKED_' || substr(md5(random()::text), 1, 12);
  expired_proposal_token text := 'ZZ_TEST_PROP_EXPIRED_' || substr(md5(random()::text), 1, 12);
  superseded_proposal_token text := 'ZZ_TEST_PROP_SUPERSEDED_' || substr(md5(random()::text), 1, 12);
  superseding_proposal_token text := 'ZZ_TEST_PROP_SUPERSEDING_' || substr(md5(random()::text), 1, 12);

  active_submittal_token text := 'ZZ_TEST_SUB_ACTIVE_' || substr(md5(random()::text), 1, 12);

  r record;
  view_count integer;
  before_count integer;
  after_count integer;
  anon_can_execute boolean;
begin
  -- Section 0: the deployed function bodies actually contain the
  -- view-logging insert -- checked before anything else, unconditionally
  -- (needs no admin/fixtures). This is the exact check that would have
  -- turned the original silent non-application into an immediate, obvious
  -- failure instead of a six-round diagnostic investigation.
  select pg_get_functiondef('public.get_quote_proposal_by_token(text)'::regprocedure) into proposal_fn_source;
  if position('insert into public.share_link_views' in proposal_fn_source) = 0 then
    raise exception 'TEST FAILED: the LIVE get_quote_proposal_by_token() does not contain the view-logging insert -- its deployed body does not match what migrations 143/145 specify.';
  end if;

  select pg_get_functiondef('public.get_submittal_by_token(text)'::regprocedure) into submittal_fn_source;
  if position('insert into public.share_link_views' in submittal_fn_source) = 0 then
    raise exception 'TEST FAILED: the LIVE get_submittal_by_token() does not contain the view-logging insert -- its deployed body does not match what migrations 143/145 specify.';
  end if;

  select user_id into admin_user_id from public.app_admins limit 1;

  if admin_user_id is null then
    skipped_count := skipped_count + 1;
    skipped_names := array_append(skipped_names, 'all-sections (no admin user found)');
  else
    -- Fixture creation identifies as the real admin via jwt claims only --
    -- `role` is deliberately never switched to 'authenticated' here, so
    -- these INSERTs run as the script's own original (superuser) role and
    -- bypass RLS entirely, regardless of which write policies exist on
    -- project_submittals/sales_quote_proposals now or in the future. This
    -- is required, not just defensive: migration 144 removed both tables'
    -- only direct-write policies, so an 'authenticated' INSERT here would
    -- now correctly be rejected by the very thing 144's own test proves.
    -- auth.uid() (needed by sales_quotes' migration-117 workspace-ownership
    -- trigger) reads only the jwt claim GUCs set below, never `role`, so it
    -- still resolves a real workspace membership for the admin either way.
    perform set_config('request.jwt.claims', json_build_object('sub', admin_user_id::text)::text, true);
    perform set_config('request.jwt.claim.sub', admin_user_id::text, true);

    insert into public.projects (project_name, customer_name, site_type, app_status)
      values ('ZZ_TEST_PROJECT_' || substr(md5(random()::text), 1, 10), 'ZZ Test Client', 'Parking Garage', 'Draft')
      returning id into test_project_id;
    insert into public.project_submittals (project_id, version, status, content_snapshot, client_name, client_email)
      values (test_project_id, 1, 'sent', '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com')
      returning id into test_submittal_id;

    insert into public.sales_quotes (client_name, site_name, status)
      values ('ZZ Test Client', 'ZZ_TEST_QUOTE_' || substr(md5(random()::text), 1, 10), 'open')
      returning id into test_quote_id;
    insert into public.sales_quote_proposals (quote_id, version, status, content_snapshot, client_name, client_email)
      values (test_quote_id, 1, 'sent', '{}'::jsonb, 'ZZ Test Client', 'zz-test@example.com')
      returning id into test_proposal_id;

    -- Direct-insert token fixtures in every lifecycle state this test
    -- needs -- bypassing the create_*_share_token RPCs deliberately (their
    -- own authorization is migration 138's test's job, not this one's).
    insert into public.public_share_tokens (token, entity_type, entity_id, status)
      values (active_proposal_token, 'sales_quote_proposal', test_proposal_id, 'active');
    insert into public.public_share_tokens (token, entity_type, entity_id, status)
      values (disabled_proposal_token, 'sales_quote_proposal', test_proposal_id, 'temporarily_disabled');
    insert into public.public_share_tokens (token, entity_type, entity_id, status)
      values (revoked_proposal_token, 'sales_quote_proposal', test_proposal_id, 'permanently_revoked');
    insert into public.public_share_tokens (token, entity_type, entity_id, status, expires_at)
      values (expired_proposal_token, 'sales_quote_proposal', test_proposal_id, 'active', now() - interval '1 day');
    insert into public.public_share_tokens (token, entity_type, entity_id, status)
      values (superseding_proposal_token, 'sales_quote_proposal', test_proposal_id, 'active');
    insert into public.public_share_tokens (token, entity_type, entity_id, status, superseded_by_token)
      values (superseded_proposal_token, 'sales_quote_proposal', test_proposal_id, 'superseded', superseding_proposal_token);

    insert into public.public_share_tokens (token, entity_type, entity_id, status)
      values (active_submittal_token, 'project_submittal', test_submittal_id, 'active');

    -- Section 1: a healthy ('found') proposal lookup logs one 'success'
    -- view row, entity-correct, without changing the outcome shape.
    select * into r from public.get_quote_proposal_by_token(active_proposal_token);
    if r.outcome <> 'found' or r.proposal_id <> test_proposal_id then
      raise exception 'TEST FAILED: expected outcome=found for the active proposal token, got outcome=% proposal_id=%.', r.outcome, r.proposal_id;
    end if;
    select count(*) into view_count from public.share_link_views
      where token = active_proposal_token and result = 'success' and entity_type = 'sales_quote_proposal' and entity_id = test_proposal_id;
    if view_count <> 1 then
      raise exception 'TEST FAILED: expected exactly one ''success'' share_link_views row for the active proposal token after one lookup, found %.', view_count;
    end if;

    -- Section 2: a second lookup of the SAME token logs a SECOND row --
    -- every view is its own row, never deduplicated/upserted.
    perform public.get_quote_proposal_by_token(active_proposal_token);
    select count(*) into view_count from public.share_link_views where token = active_proposal_token;
    if view_count <> 2 then
      raise exception 'TEST FAILED: expected two share_link_views rows for the active proposal token after two lookups, found %.', view_count;
    end if;

    -- Section 3: a temporarily-disabled link logs result='disabled' (not
    -- the collapsed public outcome='unavailable') -- this table is the
    -- internal audit trail that's allowed to know the real reason.
    select * into r from public.get_quote_proposal_by_token(disabled_proposal_token);
    if r.outcome <> 'unavailable' then
      raise exception 'TEST FAILED: expected outcome=unavailable for the disabled proposal token, got %.', r.outcome;
    end if;
    if not exists (select 1 from public.share_link_views where token = disabled_proposal_token and result = 'disabled') then
      raise exception 'TEST FAILED: expected a ''disabled'' share_link_views row for the temporarily-disabled proposal token.';
    end if;

    -- Section 4: a permanently-revoked link logs result='revoked',
    -- distinguishable internally from 'disabled' even though both are the
    -- same public outcome='unavailable'.
    select * into r from public.get_quote_proposal_by_token(revoked_proposal_token);
    if r.outcome <> 'unavailable' then
      raise exception 'TEST FAILED: expected outcome=unavailable for the revoked proposal token, got %.', r.outcome;
    end if;
    if not exists (select 1 from public.share_link_views where token = revoked_proposal_token and result = 'revoked') then
      raise exception 'TEST FAILED: expected a ''revoked'' share_link_views row for the permanently-revoked proposal token.';
    end if;

    -- Section 5: an expired link logs result='expired'.
    select * into r from public.get_quote_proposal_by_token(expired_proposal_token);
    if r.outcome <> 'expired' then
      raise exception 'TEST FAILED: expected outcome=expired for the expired proposal token, got %.', r.outcome;
    end if;
    if not exists (select 1 from public.share_link_views where token = expired_proposal_token and result = 'expired') then
      raise exception 'TEST FAILED: expected an ''expired'' share_link_views row for the expired proposal token.';
    end if;

    -- Section 6: a superseded link logs result='superseded'.
    select * into r from public.get_quote_proposal_by_token(superseded_proposal_token);
    if r.outcome <> 'superseded' then
      raise exception 'TEST FAILED: expected outcome=superseded for the superseded proposal token, got %.', r.outcome;
    end if;
    if not exists (select 1 from public.share_link_views where token = superseded_proposal_token and result = 'superseded') then
      raise exception 'TEST FAILED: expected a ''superseded'' share_link_views row for the superseded proposal token.';
    end if;

    -- Section 7: a genuinely unknown token is never logged at all --
    -- there is no entity to attach the row to (share_link_views.entity_id
    -- is NOT NULL), so the row count must not change.
    select count(*) into before_count from public.share_link_views;
    select * into r from public.get_quote_proposal_by_token('ZZ_DOES_NOT_EXIST_AT_ALL');
    if r.outcome <> 'invalid_token' then
      raise exception 'TEST FAILED: expected outcome=invalid_token for a nonexistent token, got %.', r.outcome;
    end if;
    select count(*) into after_count from public.share_link_views;
    if after_count <> before_count then
      raise exception 'TEST FAILED: a nonexistent token''s lookup changed the share_link_views row count (% -> %) -- it must never be logged (no entity to attach it to).', before_count, after_count;
    end if;

    -- Section 8: the submittal side logs the same way (entity_type
    -- correctness specifically, since it's a different table/join).
    select * into r from public.get_submittal_by_token(active_submittal_token);
    if r.outcome <> 'found' or r.submittal_id <> test_submittal_id then
      raise exception 'TEST FAILED: expected outcome=found for the active submittal token, got outcome=% submittal_id=%.', r.outcome, r.submittal_id;
    end if;
    if not exists (
      select 1 from public.share_link_views
      where token = active_submittal_token and result = 'success' and entity_type = 'project_submittal' and entity_id = test_submittal_id
    ) then
      raise exception 'TEST FAILED: expected a ''success'' share_link_views row for the active submittal token, entity-correct as project_submittal.';
    end if;
  end if;

  -- Section 9 (checked regardless): grants are unchanged by this
  -- migration -- anon can still execute both GET RPCs, authenticated
  -- still cannot.
  select has_function_privilege('anon', 'public.get_quote_proposal_by_token(text)', 'execute') into anon_can_execute;
  if not anon_can_execute then
    raise exception 'TEST FAILED: anon lost execute privilege on get_quote_proposal_by_token -- expected anon-only, unchanged from migration 139.';
  end if;
  select has_function_privilege('authenticated', 'public.get_submittal_by_token(text)', 'execute') into anon_can_execute;
  if anon_can_execute then
    raise exception 'TEST FAILED: authenticated has execute privilege on get_submittal_by_token -- expected anon-only, unchanged from migration 139.';
  end if;

  if skipped_count > 0 then
    raise exception 'SECTIONS SKIPPED (%): %', skipped_count, array_to_string(skipped_names, ', ');
  end if;

  raise notice 'ALL MIGRATION 143 SHARE-LINK VIEW LOGGING TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
