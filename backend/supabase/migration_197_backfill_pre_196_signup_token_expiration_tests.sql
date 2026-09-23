-- Transaction-safe canonical test for migration 197 (backfill
-- signup_token_expires_at for pre-196 approved/unused company_signup_requests
-- rows). Wrapped in begin;/rollback; -- nothing here ever commits.
--
-- Why this test reproduces the migration's own UPDATE statement rather
-- than just re-reading already-migrated data: this is a ONE-TIME data
-- backfill, and the PGlite replay this suite runs against starts from a
-- completely empty company_signup_requests table -- by the moment
-- migration 197 actually executed during the replay (Stage 3, before any
-- Stage 4 test runs), there was nothing in the table yet to backfill (no
-- other canonical test leaves persistent rows behind; every one of them
-- wraps its own inserts in begin;/rollback;). So the real, historical
-- effect 197 will have on production's actual pre-existing rows (most
-- notably "ZZ Test Signup Co") cannot be observed from inside this
-- harness at all -- there is no equivalent historical row here to
-- re-check. What CAN be verified, and is verified below: the exact same
-- UPDATE logic 197 uses, applied to freshly-inserted rows SHAPED like
-- the historical case (approved, unused, null expires_at, a real,
-- backdated reviewed_at), produces the correct result and touches
-- nothing it shouldn't.
--
-- Covers: (a) a pre-196-shaped row (approved, unused, null expires_at,
-- backdated reviewed_at) gets backfilled to exactly reviewed_at + 7 days;
-- (b) a row that already has a real expires_at (simulating a post-196
-- approval) is left completely untouched, not overwritten; (c) a
-- rejected row and a still-pending row are both untouched (no token to
-- expire, and the status filter excludes them); (d) an already-used row
-- with a null expires_at (a genuinely odd historical shape, but possible
-- if a pre-196 acceptance somehow completed) is untouched -- signup_token_used_at
-- is not null excludes it, matching the real migration's own WHERE
-- clause; (e) the backfill never touches workspaces or workspace_members
-- -- no membership row is created, no workspace status changes, for any
-- row this section touches.
--
-- A production-acceptance run of this script ends in exactly one of two
-- ways: the final notice reading "ALL MIGRATION 197 BACKFILL PRE-196
-- SIGNUP TOKEN EXPIRATION TESTS PASSED -- ZERO SECTIONS SKIPPED", or a
-- hard SQL error naming what failed or was skipped.

begin;

do $$
declare
  any_workspace_id uuid;
  req_pre196_id uuid;
  req_already_expiring_id uuid;
  req_rejected_id uuid;
  req_pending_id uuid;
  req_used_id uuid;
  backdated_reviewed_at timestamptz := now() - interval '3 days';
  already_set_expiry timestamptz := now() + interval '2 days';
  computed_expiry timestamptz;
  row_count integer;
  ws_status_before text;
  ws_status_after text;
  member_count_before integer;
  member_count_after integer;
begin
  perform set_config('role', 'postgres', true);

  select id into any_workspace_id from public.workspaces where status = 'active' limit 1;
  if any_workspace_id is null then
    raise exception 'TEST SETUP FAILED: no active workspace found to reference as created_workspace_id.';
  end if;

  select status into ws_status_before from public.workspaces where id = any_workspace_id;
  select count(*) into member_count_before from public.workspace_members where workspace_id = any_workspace_id;

  -- Section (a) fixture: pre-196-shaped -- approved, unused, null
  -- expires_at, a real backdated reviewed_at.
  insert into public.company_signup_requests
    (company_name, requester_name, requester_email, status, reviewed_at, created_workspace_id, signup_token, signup_token_expires_at, signup_token_used_at)
  values
    ('ZZ Test 197 Pre-196 Co', 'Pre 196 Test', 'zz-test-197-pre196@example.com', 'approved', backdated_reviewed_at, any_workspace_id, gen_random_uuid(), null, null)
  returning id into req_pre196_id;

  -- Section (b) fixture: already has a real expires_at (a post-196
  -- approval) -- must NOT be overwritten.
  insert into public.company_signup_requests
    (company_name, requester_name, requester_email, status, reviewed_at, created_workspace_id, signup_token, signup_token_expires_at, signup_token_used_at)
  values
    ('ZZ Test 197 Already Expiring Co', 'Already Expiring Test', 'zz-test-197-already-expiring@example.com', 'approved', backdated_reviewed_at, any_workspace_id, gen_random_uuid(), already_set_expiry, null)
  returning id into req_already_expiring_id;

  -- Section (c) fixtures: rejected and still-pending -- no token to
  -- expire, both excluded by the status filter.
  insert into public.company_signup_requests
    (company_name, requester_name, requester_email, status, reviewed_at)
  values
    ('ZZ Test 197 Rejected Co', 'Rejected Test', 'zz-test-197-rejected@example.com', 'rejected', backdated_reviewed_at)
  returning id into req_rejected_id;

  insert into public.company_signup_requests
    (company_name, requester_name, requester_email, status)
  values
    ('ZZ Test 197 Pending Co', 'Pending Test', 'zz-test-197-pending@example.com', 'pending')
  returning id into req_pending_id;

  -- Section (d) fixture: already used, with a null expires_at (an odd
  -- but possible historical shape) -- excluded by signup_token_used_at
  -- is not null, same as the real migration's own WHERE clause.
  insert into public.company_signup_requests
    (company_name, requester_name, requester_email, status, reviewed_at, created_workspace_id, signup_token, signup_token_expires_at, signup_token_used_at)
  values
    ('ZZ Test 197 Already Used Co', 'Already Used Test', 'zz-test-197-already-used@example.com', 'approved', backdated_reviewed_at, any_workspace_id, gen_random_uuid(), null, backdated_reviewed_at + interval '1 hour')
  returning id into req_used_id;

  -- ============================================================
  -- Reproduce migration 197's own UPDATE, verbatim, against this test's
  -- own fixtures -- see this file's header for why this is the correct
  -- way to verify a one-time backfill's logic inside this harness.
  -- ============================================================

  update public.company_signup_requests
  set signup_token_expires_at = reviewed_at + interval '7 days'
  where status = 'approved'
    and signup_token_used_at is null
    and signup_token_expires_at is null
    and reviewed_at is not null
    and id in (req_pre196_id, req_already_expiring_id, req_rejected_id, req_pending_id, req_used_id);

  -- ============================================================
  -- Section (a): the pre-196-shaped row is backfilled to exactly
  -- reviewed_at + 7 days.
  -- ============================================================

  select signup_token_expires_at into computed_expiry from public.company_signup_requests where id = req_pre196_id;
  if computed_expiry is distinct from backdated_reviewed_at + interval '7 days' then
    raise exception 'TEST FAILED: pre-196-shaped row was not backfilled to reviewed_at + 7 days (got %, expected %)', computed_expiry, backdated_reviewed_at + interval '7 days';
  end if;

  raise notice 'TEST PASSED: Section (a) -- a pre-196-shaped approved/unused row is backfilled to exactly reviewed_at + 7 days';

  -- ============================================================
  -- Section (b): a row that already had a real expires_at is untouched.
  -- ============================================================

  select signup_token_expires_at into computed_expiry from public.company_signup_requests where id = req_already_expiring_id;
  if computed_expiry is distinct from already_set_expiry then
    raise exception 'TEST FAILED: a row that already had a real signup_token_expires_at was overwritten (got %, expected the original %)', computed_expiry, already_set_expiry;
  end if;

  raise notice 'TEST PASSED: Section (b) -- a row that already has a real expires_at (a post-196 approval) is never overwritten';

  -- ============================================================
  -- Section (c): rejected and pending rows are untouched.
  -- ============================================================

  select count(*) into row_count from public.company_signup_requests where id = req_rejected_id and signup_token_expires_at is null;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a rejected row was touched by the backfill';
  end if;

  select count(*) into row_count from public.company_signup_requests where id = req_pending_id and signup_token_expires_at is null;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: a still-pending row was touched by the backfill';
  end if;

  raise notice 'TEST PASSED: Section (c) -- rejected and still-pending rows are both left untouched';

  -- ============================================================
  -- Section (d): an already-used row (even with a null expires_at) is
  -- untouched -- the backfill only ever targets UNUSED tokens.
  -- ============================================================

  select count(*) into row_count from public.company_signup_requests where id = req_used_id and signup_token_expires_at is null;
  if row_count is distinct from 1 then
    raise exception 'TEST FAILED: an already-used row was touched by the backfill even though its token is already spent';
  end if;

  raise notice 'TEST PASSED: Section (d) -- an already-used row is left untouched regardless of its expires_at';

  -- ============================================================
  -- Section (e): the backfill never touches workspaces or
  -- workspace_members -- no membership row created, no workspace status
  -- changed, for the real workspace referenced by these fixtures.
  -- ============================================================

  select status into ws_status_after from public.workspaces where id = any_workspace_id;
  select count(*) into member_count_after from public.workspace_members where workspace_id = any_workspace_id;

  if ws_status_after is distinct from ws_status_before then
    raise exception 'TEST FAILED: the backfill changed the referenced workspace''s status (was %, now %)', ws_status_before, ws_status_after;
  end if;
  if member_count_after is distinct from member_count_before then
    raise exception 'TEST FAILED: the backfill changed workspace_members row count for the referenced workspace (was %, now %) -- no owner should ever be fabricated', member_count_before, member_count_after;
  end if;

  raise notice 'TEST PASSED: Section (e) -- the backfill never touches workspaces or workspace_members -- no workspace deleted, no owner fabricated';

  raise notice 'ALL MIGRATION 197 BACKFILL PRE-196 SIGNUP TOKEN EXPIRATION TESTS PASSED -- ZERO SECTIONS SKIPPED';
end;
$$;

rollback;
