# Share-Link Implementation Plan — Staged Build Order

Status: **design-only, produced as part of an overnight autonomous work pass. Production unchanged.** This assembles every decision already recorded in `PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md` (Parts 1–11) into one clean, execution-focused staging plan. That document remains the source of truth for *why* each decision was made; this one is the source of truth for *build order*.

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

- `public_share_tokens` gains: `status` (`active`/`temporarily_disabled`/`permanently_revoked`/`superseded`), `disabled_at`/`disabled_by`/`disabled_reason`, `revoked_at`/`revoked_by`/`revoked_reason`, a self-reference to whatever superseded it.
- Two-tier expiration: workspace settings table (keyed to the real workspace's immutable `id`, per Part 9.0's correction) with `default_expiration_open_documents` and `default_expiration_completed_documents` (initial value 2 years for the latter, per E's decision).
- Two audit-log tables: `share_link_views` (document reference, timestamp, result, minimal technical detail) and `share_link_actions` (actor, action type, timestamp, `reason` NOT NULL for override-category actions).

## Stage B — Link lifecycle RPCs (no Stage 2 dependency)

`disable_share_link`, `re_enable_share_link`, `revoke_share_link`, `regenerate_share_link` (creates a new token, marks the old one `superseded`), an auto-supersede trigger fired when a new document version is sent (invalidates the prior version's *response controls*, per E's precise wording — the content stays viewable, matching Part 9.6 item 4/5), and the view-logging write path added to `get_submittal_by_token`/`get_quote_proposal_by_token`.

Every one of these RPCs follows the same hardening discipline as migration 124: `security definer`, `search_path=''`, fully qualified, explicit narrow grants, server-derived authorization (never trust a caller-supplied "I'm allowed to do this" flag).

## Stage C — Quote-deletion cascade (no Stage 2 dependency)

Soft-deleting a quote immediately disables every active link on its proposals (auto-generates `disabled_by_quote_deletion` events, cross-referenced to a new `quote_soft_deleted` event). Restoring a quote does **not** auto-reactivate links — logs `quote_restored`, requires a deliberate Sales action (`link_reenabled_after_quote_restore`) to actually restore access.

## Stage D — Customer-facing messaging (no Stage 2 dependency)

Three-tier dead-link copy, exactly as decided: **superseded** ("a newer version was sent, check your email"), **expired** ("this link has expired, contact your representative"), **temporarily disabled OR permanently revoked** (shared neutral message — the client is never told which). The real reason is visible only to authorized internal users via the audit log.

## Stage E — Authority model *(BLOCKED on Stage 2 schema)*

- Proposals: Sales-only create/disable/revoke/regenerate. **Depends on**: the write-access narrowing already flagged in Part 9.6/9.7 (today, any authenticated employee can create a proposal) — this is the same access-tightening work Task 3/migration 125 covers for the authorization side generally.
- Submittals: Sales pre-handoff, the *specific* assigned PM post-handoff, Sales read-only after. **Depends on**: `projects.assigned_pm_workspace_member_id` (Stage 2 §5) existing and being reliably populated — without it, "the specific assigned PM" cannot be enforced, only "any PM-role holder," which is not what was decided.
- Handoff trigger itself (billing clearance + conversion approval + project exists + PM assigned) — **depends on all of Stage 2 §2–5**.

## Stage F — Internal screens

Settings → Document Links (workspace-scoped durations), Settings → Capabilities (Stage 2's capability-to-role matrix, admin-editable), per-version row controls (Temporarily Disable / Re-enable as one pair, Permanently Revoke & Generate New Link as a visually separate confirmation-gated action), an Activity expander (view summary + drill-in to full history), Reassign PM action (Stage 2 §5's `project_pm_reassignments`), quote-detail soft-delete timeline.

## Stage G — Testing & migration review

Transaction-safe SQL test scripts per stage above, matching the established pattern (migrations 119–124): real fixtures not fabricated accounts, snapshot-based atomicity assertions, hard-fail on any skipped section, presented for review before anything runs in Supabase — never run by the assistant directly.

---

## Explicit non-bypass note

Stages A–D can be built and reviewed independently of Stage 2 and of each other's completion. Stage E **cannot** be built correctly without Stage 2's schema existing first — attempting to hand-wave "the assigned PM" without a real `workspace_members`-backed field would silently fall back to "any PM-role employee," which is a different, unapproved authority model. If there is ever pressure to ship Stage E early, the correct response is to build Stage 2's minimum required piece (`assigned_pm_workspace_member_id` alone, without the full billing-clearance apparatus) rather than approximate the authority check with role-only logic.
