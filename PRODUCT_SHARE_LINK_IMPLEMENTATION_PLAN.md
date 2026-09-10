# Share-Link Implementation Plan — Staged Build Order

Status: **design-only, produced as part of an overnight autonomous work pass. Production unchanged.** This assembles every decision already recorded in `PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md` (Parts 1–11) into one clean, execution-focused staging plan. That document remains the source of truth for *why* each decision was made; this one is the source of truth for *build order*.

**Hard prerequisite, not bypassable**: every stage below that touches Sales/PM authority, billing clearance, or conversion approval depends on `PRODUCT_STAGE2_SCHEMA_PLAN.md` being built first — specifically `assigned_pm_workspace_member_id`, `billing_clearance_history`, and `quote_conversion_requests`. Stages that only touch link lifecycle (expiration, disable/revoke, audit log) do **not** depend on Stage 2 and can proceed independently once the authorization bridge (migration 124) is confirmed live.

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
