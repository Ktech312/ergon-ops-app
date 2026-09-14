-- Queue C2.7 part 2 (2026-09-14): narrows direct writes on
-- public_share_tokens, project_submittals, and sales_quote_proposals now
-- that every legitimate write path goes through a sanctioned,
-- security-definer RPC -- create_submittal_share_token,
-- create_quote_proposal_share_token, create_and_send_submittal_version,
-- create_and_send_quote_proposal_version, disable_share_link,
-- re_enable_share_link, permanently_revoke_share_link,
-- regenerate_share_link (migrations 138/139/140), and respond_to_submittal/
-- respond_to_quote_proposal (migration 139). The frontend switch to the
-- new create_and_send_* RPCs (Queue C2.7 part 1) is already deployed and
-- confirmed live in production, closing the one remaining real dependency
-- on the old direct-write paths -- this migration only removes what
-- nothing legitimate still needs, per this repo's own "never close a path
-- the frontend still depends on" sequencing rule.
--
-- Every one of the RPCs above is `security definer`, so none of them are
-- affected by this migration -- they bypass RLS for their own writes
-- regardless of what table-level policy exists. Read access is entirely
-- unchanged: public_share_tokens gets an explicit read-only replacement
-- policy; project_submittals/sales_quote_proposals already have their own
-- separate, untouched "authenticated read" policies (migrations 025/053).
--
-- Confirmed via a full trace of every direct fetch() call in
-- src/persistence.ts against these three tables (2026-09-14): the only
-- writes were the two-step createSubmittal+createSubmittalShareToken /
-- createQuoteProposal+createQuoteProposalShareToken functions, all four
-- already removed from the frontend in the same batch as the RPC switch.
-- No other direct INSERT/UPDATE/DELETE exists against any of these three
-- tables anywhere in the current codebase.
--
-- Confirm 144 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- public_share_tokens: "authenticated manage" (migration 025) was a
-- single FOR ALL policy covering SELECT/INSERT/UPDATE/DELETE together --
-- replaced with a SELECT-only policy so read access for
-- loadSubmittalsForProject/loadProposalsForQuote/the Activity panel is
-- unaffected, while every direct write (INSERT a token, flip its status,
-- change its expiration) is now rejected outright for any role except the
-- RPCs' own security-definer context.
drop policy if exists "authenticated manage public_share_tokens" on public.public_share_tokens;

create policy "authenticated read public_share_tokens"
  on public.public_share_tokens for select to authenticated using (true);

-- project_submittals: "pm and admin write" (migration 025) already
-- matched the decided PM/admin authority by role, but still let a raw
-- INSERT bypass create_and_send_submittal_version's atomicity guarantees
-- (server-computed version number, auto-supersession of every prior
-- version's still-live link) and let a raw UPDATE bypass
-- respond_to_submittal's replay protection. Dropped entirely -- no direct
-- write policy remains; the two security-definer RPCs are now the only
-- write path. The separate "authenticated read project_submittals" policy
-- is untouched.
drop policy if exists "pm and admin write project_submittals" on public.project_submittals;

-- sales_quote_proposals: "authenticated write" (migration 053) was wide
-- open to ANY authenticated user, not even role-gated -- the exact gap
-- PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md Part 9.6/9.7 named
-- explicitly ("today, any authenticated employee can create a proposal").
-- Dropped entirely -- create_and_send_quote_proposal_version and
-- respond_to_quote_proposal (both security definer, both already
-- enforcing the decided Sales/manager/admin authority) are now the only
-- write path. The separate "authenticated read sales_quote_proposals"
-- policy is untouched.
drop policy if exists "authenticated write sales_quote_proposals" on public.sales_quote_proposals;

-- ============================================================
-- Deliberately NOT done by this migration:
--   - The authorization-table policy closure (app_user_roles/app_admins'
--     own wide-open admin write policies, PRODUCT_SHARE_LINK_EXPIRATION_
--     REVOCATION_DECISION.md Part 12) and the bridge-aware accept_invite()
--     replacement are a separate, pre-existing body of work, not
--     share-link-specific -- out of scope for this migration even though
--     an earlier planning pass grouped them under the same "C2.7" label.
--     Tracked separately, not silently dropped.
--   - No SELECT policy anywhere is touched -- read-access narrowing and
--     Phase 3 tenant containment remain explicitly out of scope, per
--     C2.7's own task description.
-- ============================================================

commit;
