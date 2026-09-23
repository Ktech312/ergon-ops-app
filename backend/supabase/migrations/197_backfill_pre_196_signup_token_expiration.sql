-- Migration 197: backfill signup_token_expires_at for every approved,
-- unused company_signup_requests row that predates migration 196's own
-- expiration logic. 196's canonical test (already run and passed in
-- production) proved the RULE going forward is correct -- new approvals
-- always get a real 7-day expiration -- but it could not retroactively
-- fix rows approved BEFORE it existed, which were left with
-- signup_token_expires_at = null. Under 196's own accept_company_signup
-- logic, a null expires_at means "never expires" -- an honest gap this
-- migration closes with a real value rather than leaving it open-ended.
--
-- E's own instruction: base the backfilled expiration on each row's REAL
-- review date, using the same 7-day-from-issuance policy 196 already
-- established for new approvals -- not a blanket "expire everything
-- right now," and not a different policy invented fresh for old rows.
--
-- Scope: only rows where signup_token_expires_at IS NULL are touched.
-- Any row approved on or after 196 already has a real, freshly-set
-- expiration from approve_company_signup itself and must not be
-- overwritten. Rejected/pending rows have no token to expire and are
-- excluded by the status filter regardless.
--
-- Deliberately does NOT touch workspaces or workspace_members -- E's own
-- explicit instruction: do not delete the workspace, do not fabricate an
-- owner. `ZZ Test Signup Co` (the one such row in real production) keeps
-- its already-provisioned 'active' workspace, its own real reviewed_at,
-- and gains a real signup_token_expires_at seven days out from that
-- date, exactly like every other row this backfill touches. Nothing else
-- about it changes -- no membership row is created, no workspace status
-- is altered.
--
-- This is a one-time, idempotent data backfill (re-running it is a
-- harmless no-op once every matching row already has a real
-- expires_at) -- not a schema or function change, so it needs no
-- create-or-replace, no RLS touch, nothing beyond the single UPDATE
-- below.

begin;

update public.company_signup_requests
set signup_token_expires_at = reviewed_at + interval '7 days'
where status = 'approved'
  and signup_token_used_at is null
  and signup_token_expires_at is null
  and reviewed_at is not null;

commit;
