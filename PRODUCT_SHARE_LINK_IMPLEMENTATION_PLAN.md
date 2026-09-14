# Share-Link Implementation Plan — Staged Build Order

Status: **Stages A–D, the proposal/submittal write-policy narrowing half of Stage E, and part of Stage F are DONE AND VERIFIED IN PRODUCTION (2026-09-14, Queue C2.2–C2.7).** Migrations 137 (+ corrective 141), 138, 139, 140 (+ corrective 142), 143 implement Stages A–D exactly as staged below (schema, RPCs, quote-deletion cascade, customer-facing messaging, view-logging), all applied in production (137-140's canonical tests confirmed passed; 143's sent and independently verified, E's run result pending). Migration 144 (Queue C2.7 part 2) closed `sales_quote_proposals`'/`project_submittals`' own direct-write policies entirely, going beyond Stage E's original "narrow the write-access gap" framing to remove direct writes outright. The Stage F per-version-row controls and Activity expander, and Queue C2.7's Create & Send RPC switch, are also shipped and deployed. What remains blocked on `PRODUCT_STAGE2_SCHEMA_PLAN.md` exactly as this document originally specified: the *specific assigned PM* submittal cutover (as opposed to "any PM-role holder," already enforced). The Settings → Document Links and Settings → Capabilities screens (the rest of Stage F) are also not yet built. See `CONTINUOUS_CODER_HANDOFF.md` C2.2–C2.7 for the full per-migration/per-commit detail. This assembles every decision already recorded in `PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md` (Parts 1–11) into one clean, execution-focused staging plan. That document remains the source of truth for *why* each decision was made; this one is the source of truth for *build order*.

**Hard prerequisite, not bypassable**: every stage below that touches Sales/PM authority, billing clearance, or conversion approval depends on `PRODUCT_STAGE2_SCHEMA_PLAN.md` being built first — specifically `assigned_pm_workspace_member_id`, `billing_clearance_history`, and `quote_conversion_requests`. Stages that only touch link lifecycle (expiration, disable/revoke, audit log) do **not** depend on Stage 2 and can proceed independently once the authorization bridge (migration 124) is confirmed live.

## Reconciliation (Queue B3, `CONTINUOUS_CODER_HANDOFF.md`, 2026-09-12)

Re-checked every claim above against the current schema and against
`PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md`'s Part 8 (all eight recorded decisions), Part
9.7.1, and Parts 12–13 (written in later sessions than this plan, and not yet folded back in here).

1. **The authorization bridge is now confirmed live**, closing that specific "once confirmed live"
   condition on Stage E's prerequisite text: migrations 124/125/126 are deployed and verified, and
   migration 133 (this session, Queue-A-adjacent work) has already exercised
   `bridge_set_primary_role` in production. Nothing in Stage E needs to wait on that condition any
   longer — it still waits on Stage 2's schema, unchanged.
2. **A second, still-open prerequisite the original text didn't separate out**: the decision doc's
   own Part 12 ("migration 129 policy-closure") — narrowing `app_user_roles`/`app_admins`'s wide-open
   admin write policies to force all role changes through the bridge RPCs — remains **design-only,
   never drafted as a real file**, and its slot number has been reused four times by unrelated urgent
   fixes (124→126→127→128→129, per Part 12's own header) — the next real draft must confirm a free
   number at execution time, not assume 129. This migration is a prerequisite for *trusting* the
   bridge as the only write path, which Stage E's authority model implicitly assumes; it does not
   block Stages A–D.
3. **The identical class of gap exists on the share-link tables themselves, not just the roles
   tables** — checked directly against the live migration SQL, not assumed:
   - `public_share_tokens`: `"authenticated manage public_share_tokens" for all to authenticated using
     (true) with check (true)` (migration 025) — still fully open to any authenticated user, exactly
     as Part 8 item 7 describes needing to close.
   - `sales_quote_proposals`: `"authenticated write sales_quote_proposals" for all to authenticated
     using (true) with check (true)` (migration 053, explicitly commented as deliberately matching
     Sales Quotes' existing openness) — still fully open.
   - `project_submittals`: `"pm and admin write project_submittals" using (is_app_admin(auth.uid()) or
     has_role('pm'))` (migration 025) — already narrower than the other two, but **does not match the
     decided model at all**: Part 8 item 2 requires Sales to create/manage the quote-stage submittal
     *before* handoff, and this policy gives Sales zero write access at any stage. Today, only PM/admin
     can touch a submittal — which is actually *more* restrictive than decided for the pre-handoff
     case, not less. Stage E's authority model must correct this policy, not just add to it.
   
   None of these three tables currently enforce anything close to the decided ownership model. Stage
   E is the only stage that changes this, and (per point 2) should reuse whatever narrowing pattern
   migration 129 eventually establishes rather than inventing a second one.
4. **Stage 2's three fields confirmed still fully absent** — grepped every migration and
   `persistence.ts`: zero matches for `assigned_pm_workspace_member_id`, `billing_clearance_history`,
   or `quote_conversion_requests` anywhere. `PRODUCT_STAGE2_SCHEMA_PLAN.md` remains exactly as
   undone as this plan already assumed; no drift to correct here.
5. **A precise correction to Stage A/B's scope, found by reading the actual current RPCs**: the
   claim that expiration/status enforcement is entirely missing is not quite right.
   `get_quote_proposal_by_token`/`get_submittal_by_token` (migrations 119/122) **already** filter on
   `t.expires_at is null or t.expires_at > now()` in their `where` clause — the enforcement code path
   exists today. The real gap (matching Part 1.3 exactly) is that **nothing has ever written a real
   value into `expires_at`**, so the check is permanently a no-op. Stage A/B's actual scope is
   therefore narrower than "add expiration enforcement": (a) add the new `status` column and extend
   that *same, already-proven* `where` clause with `and t.status = 'active'`, rather than building new
   enforcement machinery; (b) add the writer that actually populates `expires_at` from the two-tier
   workspace defaults for the first time. This is lower-risk than the original phrasing implied — one
   proven enforcement pattern is being reused and extended, not invented.

### Exact dependency order (supersedes the informal per-stage notes above)

1. Stage A schema (`status`/`disabled_*`/`revoked_*` columns, workspace expiration-defaults table,
   the two audit-log tables) — no dependency.
2. Stage A's default-expiration writer (sets `expires_at` on token creation using the workspace
   default) — depends on step 1 only.
3. **The `where`-clause extension to `get_quote_proposal_by_token`/`get_submittal_by_token`** (add
   `and t.status = 'active'`) — depends on step 1. **This is the exact step that first changes real,
   customer-facing behavior**: every step before it only adds inert columns/tables nothing reads or
   writes yet; the moment this lands, a token whose `status` is ever set to anything but `'active'`
   stops resolving for a real client. Steps 4–7 below add the *ways* `status` gets changed, but this
   step is what makes any of them matter.
4. Stage B's remaining RPCs (`disable_share_link`, `re_enable_share_link`, `revoke_share_link`,
   `regenerate_share_link`, auto-supersede trigger) and view-logging writes — depend on step 3
   existing (no point disabling a link the read path doesn't yet check) and step 1's audit tables.
5. Stage D customer-facing messaging (the three-tier dead-link copy) — depends on step 3: until the
   `where` clause actually rejects a non-active token, there is no "dead link" state to word at all.
   **Ship steps 3–5 together**, not spread across separate reviewable batches — a gap between them
   would leave "Temporarily Disable" clickable in the UI while silently doing nothing to what the
   customer sees.
6. Stage C (quote-deletion cascade) — depends on step 4 (`disable_share_link` must exist for the
   cascade to call).
7. Migration 129-equivalent policy narrowing, applied to `public_share_tokens`/
   `sales_quote_proposals`/`project_submittals` (point 3 above) — depends on step 4 (the bridge-style
   RPCs must exist and be the sanctioned write path before the direct-write policy can be safely
   closed without breaking the app itself). Independent of Stage 2.
8. Stage 2 schema (`assigned_pm_workspace_member_id`, `billing_clearance_history`,
   `quote_conversion_requests`) — no dependency on anything above; can be built in parallel with
   steps 1–7.
9. Stage E authority model — depends on step 7 (narrowed table policies) **and** step 8 (Stage 2
   fields) both being live; cannot be correctly built on either alone.
10. Stage F internal screens — depend on whichever of steps 4/7/9 they expose controls for; can be
    built incrementally per control rather than as one batch.
11. Stage G test scripts — written alongside each step above, not deferred to the end.

---

## Stage A — Link lifecycle schema (no Stage 2 dependency)

**Status: DONE AND VERIFIED — migration 137 (+ corrective 141), 2026-09-13.**

- `public_share_tokens` gains: `status` (`active`/`temporarily_disabled`/`permanently_revoked`/`superseded`), `disabled_at`/`disabled_by`/`disabled_reason`, `revoked_at`/`revoked_by`/`revoked_reason`, a self-reference to whatever superseded it.
- Two-tier expiration: workspace settings table (keyed to the real workspace's immutable `id`, per Part 9.0's correction) with `default_expiration_open_documents` and `default_expiration_completed_documents` (initial value 2 years for the latter, per E's decision).
- Two audit-log tables: `share_link_views` (document reference, timestamp, result, minimal technical detail) and `share_link_actions` (actor, action type, timestamp, `reason` NOT NULL for override-category actions).

## Stage B — Link lifecycle RPCs (no Stage 2 dependency)

**Status: DONE AND VERIFIED — migrations 138 (creation) and 139 (lifecycle actions), 2026-09-13.**
Implemented as `disable_share_link`/`re_enable_share_link`/`permanently_revoke_share_link` (named
`permanently_revoke_share_link`, not `revoke_share_link`, to make the terminal nature explicit in
the function name itself) plus `regenerate_share_link` for the auto-supersede case specifically
(migration 140's `create_and_send_submittal_version`/`create_and_send_quote_proposal_version` do the
actual "new version → supersede prior version's link" work, not a trigger on the document tables —
achieves the same outcome the trigger idea described, just via an atomic RPC that also creates the
new version row and its token in one call, since that ordering can't be split across a trigger
safely). Every one of `get_quote_proposal_by_token`/`get_submittal_by_token`/
`respond_to_quote_proposal`/`respond_to_submittal` gained the `outcome` column described in Stage D
below (migration 139); the view-logging write path (`share_link_views`) is schema-ready (migration
137) but not yet wired into these RPCs' read path — recording a view on every public page load
remains unbuilt, tracked as a gap for a later pass, not silently dropped.

`disable_share_link`, `re_enable_share_link`, `revoke_share_link`, `regenerate_share_link` (creates a new token, marks the old one `superseded`), an auto-supersede trigger fired when a new document version is sent (invalidates the prior version's *response controls*, per E's precise wording — the content stays viewable, matching Part 9.6 item 4/5), and the view-logging write path added to `get_submittal_by_token`/`get_quote_proposal_by_token`.

Every one of these RPCs follows the same hardening discipline as migration 124: `security definer`, `search_path=''`, fully qualified, explicit narrow grants, server-derived authorization (never trust a caller-supplied "I'm allowed to do this" flag).

## Stage C — Quote-deletion cascade (no Stage 2 dependency)

**Status: DONE AND VERIFIED — migration 140, 2026-09-13.** Implemented as a trigger
(`cascade_quote_soft_delete`) on `sales_quotes`, not a client-driven RPC, so the existing
`deleteSalesQuote`/`restoreSalesQuote` direct-write calls keep working unchanged.

Soft-deleting a quote immediately disables every active link on its proposals (auto-generates `disabled_by_quote_deletion` events, cross-referenced to a new `quote_soft_deleted` event). Restoring a quote does **not** auto-reactivate links — logs `quote_restored`, requires a deliberate Sales action (`link_reenabled_after_quote_restore`) to actually restore access.

## Stage D — Customer-facing messaging (no Stage 2 dependency)

**Status: DONE AND VERIFIED — migration 139's `outcome` column plus the frontend fix shipped the
same day (2026-09-13), after checking that migration's live effect surfaced an active production
defect (see `HANDOFF.md`).** `SubmittalPublicPage`/`ProposalPublicPage` now render the three decided
messages below.

Three-tier dead-link copy, exactly as decided: **superseded** ("a newer version was sent, check your email"), **expired** ("this link has expired, contact your representative"), **temporarily disabled OR permanently revoked** (shared neutral message — the client is never told which). The real reason is visible only to authorized internal users via the audit log.

## Stage E — Authority model *(BLOCKED on Stage 2 schema; link creation/lifecycle AND document writes now both closed)*

**Status update (2026-09-14):** migrations 138/139 implement Sales-only (or PM-only for submittals)
authority for *link creation and every lifecycle action* — `create_quote_proposal_share_token`,
`disable_share_link`/`re_enable_share_link`/`permanently_revoke_share_link`/`regenerate_share_link`
all gate proposal-link actions to Sales/manager/admin and submittal-link actions to PM/admin.
Migration 144 (Queue C2.7 part 2) then closed the remaining gap this section originally
flagged: `sales_quote_proposals`' own row-level write policy (the old wide-open "authenticated
write," migration 053) is now dropped entirely — creating/editing the PROPOSAL DOCUMENT itself, not
just its share link, is no longer reachable by any authenticated user's direct write at all; only
`create_and_send_quote_proposal_version`/`respond_to_quote_proposal` (both already Sales/manager/admin-
or client-token-gated) can write it. `project_submittals`' equivalent policy is also closed the same
way. What remains genuinely blocked, unchanged from this document's original text: the *specific
assigned PM* concept for submittals (as opposed to "any PM-role holder," which is what's actually
enforced today) remains blocked on Stage 2 exactly as below — narrowing the table's write access
further than "any PM" requires the assigned-PM field this section describes, which doesn't exist yet.

- Proposals: Sales-only create/disable/revoke/regenerate. **Depends on**: the write-access narrowing already flagged in Part 9.6/9.7 (today, any authenticated employee can create a proposal) — this is the same access-tightening work Task 3/migration 125 covers for the authorization side generally.
- Submittals: Sales pre-handoff, the *specific* assigned PM post-handoff, Sales read-only after. **Depends on**: `projects.assigned_pm_workspace_member_id` (Stage 2 §5) existing and being reliably populated — without it, "the specific assigned PM" cannot be enforced, only "any PM-role holder," which is not what was decided.
- Handoff trigger itself (billing clearance + conversion approval + project exists + PM assigned) — **depends on all of Stage 2 §2–5**.

## Stage F — Internal screens

**Status: per-version row controls and the Activity expander are DONE AND DEPLOYED (Queue C2.6,
2026-09-13)** — `ShareLinkLifecycleControls` (`src/main.tsx`) implements Temporarily Disable /
Re-enable as one pair and Permanently Revoke & Generate New Link as a visually separate,
confirmation-gated action, plus the Activity expander (view summary; full per-action history, not
yet a separate "drill-in" screen since the summary view already shows the complete action log). Not
built: Settings → Document Links, Settings → Capabilities (both blocked on Stage 2's
capability-to-role matrix), Reassign PM action (blocked on Stage 2 §5), and the quote-detail
soft-delete timeline (the cascade itself is live per Stage C; a dedicated timeline UI showing it is
not).

Settings → Document Links (workspace-scoped durations), Settings → Capabilities (Stage 2's capability-to-role matrix, admin-editable), per-version row controls (Temporarily Disable / Re-enable as one pair, Permanently Revoke & Generate New Link as a visually separate confirmation-gated action), an Activity expander (view summary + drill-in to full history), Reassign PM action (Stage 2 §5's `project_pm_reassignments`), quote-detail soft-delete timeline.

## Stage G — Testing & migration review

**Status: DONE for Stages A–D, exactly as specified below.** Every one of migrations 137–140 (+
corrective 141/142) shipped with its own canonical transaction-safe test script, given to E one file
at a time, run by E in the Supabase SQL editor, never by the assistant directly — matching this
section's own convention precisely. Two real production-only failures (a role-contamination gap in
the 139/140 test fixtures; a real ambiguous-column bug in migration 140 itself) were found via E's
actual runs and fixed same-day; see `CONTINUOUS_CODER_HANDOFF.md` C2.2–C2.5 for the full history.

Transaction-safe SQL test scripts per stage above, matching the established pattern (migrations 119–124): real fixtures not fabricated accounts, snapshot-based atomicity assertions, hard-fail on any skipped section, presented for review before anything runs in Supabase — never run by the assistant directly.

---

## Explicit non-bypass note

Stages A–D can be built and reviewed independently of Stage 2 and of each other's completion. Stage E **cannot** be built correctly without Stage 2's schema existing first — attempting to hand-wave "the assigned PM" without a real `workspace_members`-backed field would silently fall back to "any PM-role employee," which is a different, unapproved authority model. If there is ever pressure to ship Stage E early, the correct response is to build Stage 2's minimum required piece (`assigned_pm_workspace_member_id` alone, without the full billing-clearance apparatus) rather than approximate the authority check with role-only logic.
