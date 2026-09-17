# Ergon Ops — Master Completion Plan

> **Execution handoff:** Use [`CONTINUOUS_CODER_HANDOFF.md`](CONTINUOUS_CODER_HANDOFF.md) for the
> full session-by-session queue history, delivery conventions, and the consolidated decision
> register (§8, D1-D18). Use [`HANDOFF.md`](HANDOFF.md) for the most recent session's own summary
> and exact next task. This document is the authoritative, always-current product roadmap: what's
> live, what's staged, what's left, in what order, and what's explicitly off-limits without E.

Status: **AUTHORITATIVE, RECONCILED 2026-09-17** (D5/D6/D8/D9/D12/D18 shipped; standing authorization
given for the full Phase 3 rollout, D11/D13/D14 now approved, see §11 — Stages 1 and 2 (Clients+Sales,
Projects+Tasks; migrations 155/156/157) plus the cross-cutting `active_workspace_id()` cleanup
(migration 158) are all confirmed applied and tested live; Stage 3 (Purchasing/Inventory/Vendors/
Warehouses) ownership migration 159 is implemented locally and queued as the current manual-action
item, awaiting application) against `HANDOFF.md`, `CONTINUOUS_CODER_HANDOFF.md` §8's
full D1-D18 decision register, every applied migration (115
through 158, plus 159 pending), and
`PROPOSAL_PDF_AND_ESIGNATURE_DECISION.md`. This is a **corrective** reconciliation, not additive —
three rows were found drifted from confirmed production state during this pass (see §7). The
document consolidates every `PRODUCT_*.md` design/audit file into one ordered roadmap; go to the
named source document for full detail on any one workstream. **No completion dates are stated or
implied anywhere in this document** — every date is an authoring or decision date, never a
projection. Priority and ordering reflect risk and dependency, not calendar time.

## 0. Evidence labels — used throughout this document

Every item below is tagged with which of these it has satisfied, most-partial-first:

- **Designed** — a decision or spec exists; nothing built.
- **Implemented locally** — code/migration written and passing local checks (`tsc -b`, `vitest`,
  `eslint`), not yet deployed or applied.
- **Migration applied** — the `.sql` file has been run in production Supabase by E (never by the
  coder — see §5).
- **Tests passed** — the item's canonical test (SQL or `vitest`) has actually been executed and
  passed, not merely written.
- **Deployed** — pushed to `main`; Vercel's auto-deploy (push-triggered, no manual step) has shipped
  it.
- **Production verified** — checked against the live deployment (Vercel-CLI/curl/browser pattern, or
  Claude-in-Chrome for authenticated surfaces).
- **User accepted** — E has actually used the feature in real operational use and confirmed it
  behaves as expected, not just passed automated checks.

A row missing a label genuinely hasn't reached that stage — this document does not round up.

## 1. Product lifecycle this plan covers

Marketing → Sales → Proposal/quote acceptance → Billing review & down-payment clearance → Project
creation & execution → Project closeout → Service & Support → future Engineering/Product
Development. Ergon today has strong coverage of Project creation/execution, full coverage of
Sales quote-to-proposal-to-acceptance (pricing, approval gate, Q&A, optional lines, share-link
lifecycle all shipped), and partial coverage of Project closeout (Client Ledger). Marketing,
Billing review/down-payment clearance as a real gate, Service/Support as its own module, and
Engineering/Product Development remain thin placeholders or entirely undesigned.

## 2. Phases and completion gates

### Phase 1 — Reliability closeout — **GATE MET**
Equipment Recipe save, Project BOM replace, and quote-to-project conversion are atomic and
race-safe (migrations 127/128/130/131/132, deployed, production verified). Backup restore reports
accurate per-section success/failure (`RestoreOutcome`, deployed). Every confirmed-critical write
has a check+plain-error+log. System Health is real, admin-visible, and now alerts (Phase A+B+alert
wiring, migrations 151/152, both applied and tested in production 2026-09-16). Backup restore's own
checkpoint/resume (D9) is implemented and deployed, degraded-safe until migration 154 is applied
(§4/§5). The gate itself (no silent data loss, no partial writes) was already satisfied before either
of these shipped; both now extend it further, not merely "open, non-blocking follow-on" — they're
done.

### Phase 2 — Tenant containment and Phase 3 RLS — **NOT STARTED, explicitly blocked**
**Gate**: a second real workspace can be created with data provably invisible to the first
workspace's users, verified by an automated cross-tenant test, not a spot check. Zero of 86 tables
have a tenant column outside the Phase 1/2 workspace tables; most RLS is `using(true)`; 8 of 9
Storage buckets are fully open; several global-uniqueness constraints would block a second company
outright. `PRODUCT_PHASE3_PLAN.md` is a full 16-threat design; **no RLS has been written.**
**Standing stop boundary (§6): do not start this phase's code or migrations without first
discussing the process with E.**

### Phase 3 — Sales → Billing → Project handoff — **GATE PARTIALLY MET**
Quote-to-project conversion is atomic and idempotent (migrations 127/128). Customer-visible,
frozen, per-line pricing is shipped (migration 136). A configurable discount-approval gate sits in
front of Create & Send (D4, migration 147). **Still open**: no billing-review or down-payment gate
of any kind exists between quote acceptance and project creation — that specific part of this
phase's gate remains unmet. Commercial Billing itself (§2 Phase 9) is a separate, explicitly
deferred phase, not part of this gate.

### Phase 4 — Product onboarding and no-code configuration — **DESIGN ONLY**
`PRODUCT_ONBOARDING_CONFIG.md` is a full 10-step flow + responsibility matrix, **entirely
undesigned in code**. Blocked in practice on Phase 2/3 RLS landing first or in parallel (onboarding
a real second company needs isolation to mean something).

### Phase 5 — Sales presentation/template experience — **GATE MET, two items deliberately scoped closed, not deferred**
A PM/salesperson can today generate a priced, branded, approval-gated, Q&A-capable, share-link-
controlled proposal from Ergon end-to-end (pricing, in-place BOM editing, searchable catalog
picker, branding, mobile labels, `client_id`/`source_quote_ref` carry-through, section reordering,
share-link expiry/revocation, version comparison, client Q&A, optional BOM lines, acceptance IP/email
hardening, print-output fixes — see §3 for the full shipped list). **D12 (revised) and D18 are both
APPROVED and FULLY SHIPPED as of 2026-09-16** — not awaiting confirmation. Typed-name+hash acceptance
with server-observed IP/verified email was deliberately kept as v1 in place of a regulated
e-signature product; `window.print()` from the frozen snapshot was deliberately kept as v1 in place
of a server-generated PDF pipeline, since no stored-file/attachment/integration requirement has ever
emerged to justify one — see `PROPOSAL_PDF_AND_ESIGNATURE_DECISION.md` §1/§2 for the full reasoning.
Neither is a gap; both are closed, scoped decisions. The phase's actual measurement gate ("stop
needing HubSpot/PandaDoc for this step, one real deal closed end-to-end") is a usage milestone, not a
code gate, and remains open pending real use — that is the only thing still open in this phase.

### Phase 6 — Mobile and accessibility — **GATE MET**
Every modal has focus trap/return/Escape-close (`useModalA11y`, source-wide, zero remaining
unconverted). Every flagged desktop clickable row is keyboard-operable. Photo uploads are resized
client-side. Two real bugs were found and fixed in this work, not just polish (mobile
`stack-table-mobile` overflow; `saveBuildTransactions` equipment-lookup key mismatch). **All five
mechanical items from `PRODUCT_ACCESSIBILITY_MOBILE_PERF_AUDIT.md` Part A are DONE (2026-09-16)** —
A4 (accessible names on filter/search inputs), A5 (WCAG AA contrast on "muted" text colors), A6, and
A7 (44px mobile tap targets) all shipped; see §3/§7 item 3. A3's remaining scope (generic
dual-purpose status-message `<div>`s beyond the class-identified error sites) is a separate, later,
non-mechanical follow-up, not part of this gate.

### Phase 7 — Service/Support and client ledger expansion — **CLIENT LEDGER RELIABILITY DONE, MODULE NOT DESIGNED**
Client Ledger's save path is serialized/queued and surfaces failures (Queue A10). No dedicated
Support/Service module or ticket workflow exists anywhere in the app; `PRODUCT_SUPPORT_MODULE_DESIGN.md`
is a design document, not started.

### Phase 8 — Engineering/Product Development — **NOT DESIGNED**
Not mentioned anywhere in the live app. `PRODUCT_ENGINEERING_MODULE_DESIGN.md` exists as a
placeholder scoping document.

### Phase 9 — Commercial SaaS readiness — **EXPLICITLY DEFERRED, standing stop boundary**
Subscription tiers, usage metering, payment processing for Ergon itself (distinct from a customer's
own operational Billing/Client Ledger, which Ergon already tracks for the customer). **Do not begin
design work on this phase without an explicit go-ahead — standing instruction, unchanged.**

## 3. Completed and live — migration range 115 through 150, plus 152 through 158

Everything below is **deployed and production-verified** unless a narrower label is given. Full
turn-by-turn history lives in `git log` and the relevant design doc, not reproduced here (this
session's own established discipline — see `HANDOFF.md`'s 2026-09-15 consolidation).

**Reliability core** (migrations 127, 128, 130, 131, 132, 133, 135): atomic quote-to-project
conversion, atomic Equipment Recipe save, atomic Project BOM replace, manager-assignable primary
role + admin bootstrap, `has_role()` search-path hardening. All applied, canonical-tested, zero
skips. — *Migration applied, Tests passed, Deployed, Production verified.*

**Queue C2 — Share-link lifecycle** (migrations 137+141, 138, 139, 140+142, 143, 144, 145 — every
one applied with a passing canonical test, zero sections skipped): full status/expiration/disable/
re-enable/permanently-revoke/regenerate/version-supersession/quote-delete-cascade/view-logging
lifecycle; server-owned Create & Send RPCs; direct-write-bypass closure on `sales_quote_proposals`
and its RPC. Migration 143's own view-logging insert was recorded applied but never actually went
live — root-caused via a six-round diagnostic and fixed forward by migration 145 without touching
143. Internal lifecycle-controls UI and version-comparison share-link status badges shipped. **No
open items.** — *Migration applied, Tests passed, Deployed, Production verified.*

**Sales pricing — Queue C1** (migration 136): frozen per-line `unit_price`/`price_source`,
`discount_percent`/`tax_rate`, `accepted_proposal_total`, frozen subtotal/discount/tax/grand total
in every proposal snapshot. — *Migration applied, Tests passed, Deployed, Production verified. User
acceptance (one real priced proposal) still pending.*

**D3 — `source_quote_ref` carry-through** (migration 146): nullable `projects.source_quote_ref`,
populated from the source quote at conversion; `source_sales_quote_id` stays the durable link.
Frontend shipped `3d8452d`. — *Migration applied, Tests passed, Deployed, Production verified.*

**D4 — Discount-approval gate** (migration 147): configurable per-workspace gate in front of
Create & Send (disabled by default, 10% threshold, Sales Manager/admin only, never PM), reusing the
existing Catalog Price Change Requests propose/review/approve pattern. Canonical test caught two
real live-data test-fixture bugs (a person holding both "pm" and "sales" roles; a "sales" holder
already holding "manager") — both test-script-only fixes, migration 147 itself untouched. Frontend
(`requestOrSendQuoteProposalVersion`, Admin settings panel, Approval Requests review queue,
pending-approval indicator) shipped `f0bc686`. — *Migration applied, Tests passed, Deployed,
Production verified.*

**D16 — Client Proposal Q&A** (migrations 149 + corrective 150): dedicated
`sales_quote_proposal_questions` table + two token/role-gated RPCs; scoped to one proposal
*version*, not the quote; Sales/manager/admin may answer, never PM; read-only after
approval/rejection/supersession/expiration/disablement/revocation, explicitly still open through
`revision_requested`. Migration 149's own canonical test found a real bug (a `RETURNS TABLE`
column name colliding with a real table column — the same class migration 121 already fixed once),
corrected by migration 150, 149 itself never touched. Frontend shipped `997ec7b`. — *Migration
applied, Tests passed, Deployed, Production verified.*

**D17 — Optional BOM lines** (migration 148): `is_optional` boolean; required lines always
included; optional lines begin **unselected**; live client-side recompute from the frozen snapshot;
selection + server-computed final totals stored atomically with the one terminal response, immutable
after. Canonical test needed two test-script-only fixes (a stale direct-write fixture pattern
predating migrations 144/147's write-path closure; a missing `created_by_email` on fixture quotes).
Frontend shipped `2fc3a6e`. — *Migration applied, Tests passed, Deployed, Production verified.*

**Accessibility/performance batch** (no migration): modal focus-trap/Escape-close on every
`role="dialog"` (source-wide `useModalA11y`); all 11 flagged desktop clickable rows keyboard-
operable; photo resize-before-upload on all three real upload paths; Dashboard activity-feed
memoization and bounded `loadTasks`; `loadInventoryItems` internally paginated (closing the silent-
truncation risk); mobile `stack-table-mobile` overflow bug fixed sitewide. — *Implemented locally,
Tests passed, Deployed, Production verified where checked; full user acceptance still pending for
modal-focus (most of ~38 modals need real Supabase-backed data to click through live).*

**Dependency remediation — Queue A13**: `nodemailer`/`pdfjs-dist` bumped, remaining transitive
advisories cleared via `npm audit fix`. Only `xlsx` remains flagged (D6, no in-place fix exists —
see §4 Queue R2). — *Deployed, Production verified (`npm audit` output).*

**Also shipped 2026-09-15** (`8b4a6b6`): Product Catalog's Bundle components field now carries a
"reference only, doesn't auto-populate a BOM" disclaimer — copy-only, per D5's interim direction.

**Accessibility remediation — Queue R1 item 3, ALL FIVE ITEMS DONE (2026-09-16)** (`f930f39`,
`6b42ca1`, plus A3's own commit): A5 (the three hardcoded "muted" text colors that failed WCAG AA
against both page backgrounds — most-used one was ~2.8:1 — replaced with darker same-hue-family
shades, each verified by computing sRGB relative luminance against both backgrounds, ≥4.5:1 margin);
A6 (the four icon-only delete buttons relying on `title` alone now also carry `aria-label`); A7
(`.icon-button`/`.compact-remove`/checkboxes reach 44px/22-24px under a 760px mobile media query,
desktop untouched); A4 (nine filter/search `<input>`s across Inventory, Purchasing, Purchasing
Reports, and Product Catalog now carry a real `aria-label` instead of relying on `placeholder` alone);
**A3** — every genuine inline form-submission error in the app (all 9 sites using the `.error-text`/
`.modal-error-text` classes, including both public unauthenticated pages — Proposal and Submittal
response forms — the Task Editor, and this session's own D16 Q&A question-submit error) now carries
`role="alert"`, so a screen reader announces it without the user needing to find and re-read the
field. **Deliberately scoped**: this covers every error display using those two named CSS classes
(the audit's own concrete, class-identified finding) — it does not attempt every generic
status-message `<div>` sitewide that sometimes shows an error and sometimes a success string (e.g.
`discountApprovalReviewStatus`, `systemHealthEventsStatus`), since retrofitting `role="alert"` onto a
dual-purpose status string needs case-by-case judgment about what should and shouldn't interrupt a
screen reader, not a mechanical class-based sweep — flagged as a separate, later, non-mechanical
follow-up if wanted, not silently done. — *Implemented locally, Tests passed (`tsc -b`/445
vitest/eslint 0 errors/build all clean), Deployed. Production verification is a screen-reader check,
not yet performed.*

**Inventory pagination — Queue R1 item 2, DONE (2026-09-16)** (`1e6eb7a`,
`PRODUCT_INVENTORY_PAGINATION_DESIGN.md`): `loadInventoryItemsPage` — a second, independent,
server-side-searched, cursor-paginated query, wired into only the Inventory page's own desktop table
and mobile card list (50-item pages, "Load more," debounced 300ms). `loadInventoryItems`/
`inventoryItems` and `filteredInventoryItems` (CSV export, the export button's enabled state) are
completely untouched, so nothing that relied on the full set lost functionality. The one deliberate
scope cut: the derived "status" filter (Retired/Not Tracked/Reorder/Healthy, dependent on a joined
`allocated` aggregate) is applied client-side per fetched page rather than server-side — documented in
code, not silently approximated. — *Implemented locally, Tests passed (`tsc -b`/453 vitest, 8 new
tests/eslint 0 errors/build all clean), Deployed. Production verification (a real large filtered
result set) still pending real use.*

**System Health Phase B, steps 1-4 — FULLY DONE (2026-09-16)** (`9a90903`, `d1e8d24`,
`PRODUCT_SYSTEM_HEALTH_PLAN.md`): migration 151 (`system_health_events` + monthly summary table, the
dedup-upsert `record_system_health_event` RPC that never throws to its caller, admin-only
acknowledge/resolve RPCs, a service-role-only retention rollup function) **applied by E and its
canonical test run clean** ("Success. No rows returned" — the correct, expected result for a
`do $$ ... $$; rollback;` block that completes with no exception). **All four named
`recordSystemHealthEvent` call sites are wired**: restore per-section failures
(`restoreFullBackupSnapshot`), notification-delivery write failures (`recordNotificationDelivery`),
cron job failures (`api/cron/task-overdue.js`'s own systemic load failure, not routine per-task
hiccups), and rate-limit hits (`checkRateLimit`, every caller, via a new shared
`api/_lib/systemHealth.js` helper). The admin panel and retention cron
(`api/cron/system-health-retention.js`, weekly) are deployed with a live table to read/write. — *Migration
applied, Tests passed, Deployed. Production verification (a real failure showing up in the Admin
panel) still pending real use — nothing has failed yet to display.* **Step 5 (alert wiring) is
deliberately NOT built** — see §7 item 1 for exactly why (a spec-precision gap in the threshold
rule, not simply D8's channel question).

**Migration 152 — System Health alert wiring (D8 approved 2026-09-16)** (`c6de0fa`,
`PRODUCT_SYSTEM_HEALTH_PLAN.md` §9, extended by E's explicit threshold decision): `alerted_at` column,
`record_system_health_event`'s return type changed to jsonb (event_id + alert_worthy + admin_emails),
new `record_system_health_recovery` and `list_admin_emails` RPCs. Application layer fully wired and
deployed: `api/send-system-health-alert.js` (browser-triggered call sites), `api/_lib/systemHealth.js`
extended for the 3 server-side call sites, `persistence.ts`'s `recordSystemHealthEvent`/new
`recordSystemHealthRecovery`. All 4 original failure call sites now also call recovery on their
success path. — *Migration applied and canonical test PASSED in production (E confirmed
2026-09-16: "Success. No rows returned" for both the migration and its test), 18 new/updated TS-side
tests all passing, Deployed. D8 is fully shipped end-to-end. Production verification of a real
alert firing (not just the SQL test) still pending real use — nothing has failed 3x within 5 minutes
yet to trigger one.*

**Migration 153 — Proposal acceptance hardening (D12 approved 2026-09-16)** (`eecb8b1`,
`PROPOSAL_PDF_AND_ESIGNATURE_DECISION.md` §2): new `approval_email` column set from the proposal's own
`client_email` (verified by construction, not a client parameter); `respond_to_quote_proposal`'s `anon`
direct-call grant revoked. `api/respond-to-proposal.js` captures the real client IP server-side
(Vercel's `x-forwarded-for`) and calls the RPC via service role — deployed and is the frontend's
only path now (`respondToPublicQuoteProposal` no longer calls the RPC directly). — *Migration applied
and canonical test PASSED in production (E confirmed 2026-09-16: "Success. No rows returned" for
both), 11 new/updated TS-side tests all passing, Deployed. D12 is fully shipped end-to-end.*

**Migration 154 — Resumable backup restore checkpointing (D9 approved 2026-09-16)** (`a889b60`,
`67b6cb6`, `PRODUCT_BACKUP_RESTORE_CHECKPOINT_SPEC.md` reconciled against E's exact spec): D9 shipped in
two parts. **Part 1 (required-vs-optional distinction) is fully live in code already** — every
reference in the restore path except a movement's own sku (schema-confirmed NOT NULL, migration 001) is
now saved-without-it-plus-warning instead of failing the whole section, when restore mode is active; no
migration needed, this part is pure application logic. **Part 2 (durable resumability)**:
`restore_runs`/`restore_run_sections` (extends the spec's schema with a `warnings text[]` column
for part 1's new outcome type) + 4 RPCs (start-or-resume, update-section, finalize, cancel).
`restoreFullBackupSnapshot`'s new `checkpoint` parameter is fully optional and backward compatible;
`importBackup` (main.tsx) hashes the file, offers Resume vs Start Over on a prior incomplete run.
**Deliberately not built**: a live mid-restore Cancel button — the backend fully supports cancellation,
only the UI trigger is deferred (this app's restores are fast enough today that this isn't a P0). —
*Migration applied and canonical test PASSED in production (E confirmed 2026-09-16: "Success. No rows
returned" for both), 23 new TS-side tests all passing, Deployed. D9 is fully shipped end-to-end.
Production verification of a real resumed restore (not just the SQL test) still pending real use —
no restore has failed mid-way yet to exercise resume against production.*

**Migration 155 — Phase 3 Group 1: Clients + Sales Quote workspace RLS (D11 approved 2026-09-16)**
(`0d05d03`, see §11 for the full staged-rollout tracker): workspace-scoped RLS on the 10-table
Clients/Sales ownership graph (`clients`, `sales_quotes`, and eight child/related tables), plus
workspace-containment hardening on four security-definer RPCs that had no caller-workspace check at
all (`request_or_send_quote_proposal_version`, `respond_to_proposal_approval_request`,
`get_quote_proposal_by_token`, `respond_to_quote_proposal` — the latter two also gain the
suspended-workspace check `PRODUCT_PHASE3_PLAN.md`'s own T8 called for). No frontend/API code change
accompanies this migration — every frontend loader for this table group already relies entirely on
RLS with no client-side workspace filtering, so scoping the database layer is sufficient by itself;
confirmed via direct source read, not assumed. — *Migration applied and canonical test PASSED in
production (E confirmed, 2026-09-17 — the test's Section 5 fixture-ordering bug found on the first
live run was corrected same-day, `3a7692a`, then re-run clean). D11 Stage 1 is fully shipped
end-to-end.*

**Migration 156 — Phase 3 Stage 2 ownership: `projects.workspace_id` + `tasks.workspace_id` (D11
approved 2026-09-16)** (`df9a6bf`, see §11): the ownership half of Stage 2, mirroring migration 117's
pattern exactly — adds and backfills `workspace_id` on the two root tables, does not touch RLS on
either (both keep their exact current policies, including `projects`' own role-gated write policy
from migration 023, confirmed unchanged by direct read). `tasks.workspace_id` derives from each task's
own creator's workspace membership rather than fuzzy-matching the loose `project_ref` text column — a
mechanical extension of the existing ownership-trigger pattern, not a new business decision. No
frontend/API code change accompanies this migration (pure ownership metadata, no access change). —
*Migration applied and canonical test PASSED in production (E confirmed, 2026-09-17: "156 - Success.
No rows returned" for the migration, then the test run separately, also "Success. No rows returned").
Stage 2's ownership half is fully shipped end-to-end; Stage 2's RLS half is separate, later work —
see §11.*

**Migration 157 — Phase 3 Stage 2 RLS: Projects + Tasks containment (D11 approved 2026-09-16)**
(`faee9d6`, see §11): workspace-scoped RLS on the 14-table Projects/Tasks ownership graph, following
migration 156's ownership half the way migration 155 followed 117 for Clients+Sales. Preserves every
existing access rule found by direct read: `projects`/`project_scope_of_work`/`project_bom_lines`
keep their pm/admin role-gated write policies (migration 023), ANDed with the workspace check, not
replaced; `project_submittals` stays SELECT-only (RPC-only writes since migration 144, no new write
capability granted); `task_activity_log` keeps its append-only shape (no update/delete policy);
`project_conversion_receipts` is left completely untouched (already maximally locked down by
permanent design, migration 127). Hardens 3 security-definer RPCs with zero caller-workspace check
(`create_and_send_submittal_version`, `get_submittal_by_token`, `respond_to_submittal` — the latter
two also gain the suspended-workspace check). Unlike migration 155's RPCs, no `active_workspace_id()`
landmine here — these two RPCs are submittal-only, not shared with proposals, so their settings
lookups were fixed to use the target project's own resolved `workspace_id` directly. — *Migration
applied and canonical test PASSED in production (E confirmed, 2026-09-17; two real test-script bugs
found on the first two live runs and corrected same-day — a `RAISE` call missing its argument plus a
structural check querying a nonexistent `cmd='ALL'` policy (`fd39b66`), then a fixture-ordering issue
where `create_and_send_submittal_version`'s own real supersession side effect flipped a token's status
out from under a later section (`ad18ef8`) — migration 157 itself was never touched by either fix).
Stage 2 (Projects/Tasks — ownership + RLS) is now fully shipped end-to-end.*

**Migration 158 — Phase 3 cross-cutting: share-link RPC family workspace containment (D11 approved
2026-09-16)** (`61706b7`, see §11): retires `active_workspace_id()` from every RPC where both sides'
real `workspace_id` now make it safely fixable (`create_submittal_share_token`,
`create_quote_proposal_share_token`, `regenerate_share_link`, `create_and_send_quote_proposal_version`).
While fixing each, found and fixed a second gap in the same pass: all 7 share-link lifecycle RPCs
checked the caller's role but never the caller's workspace against the target entity's own workspace —
two of the seven were directly callable with zero workspace check at all. Two new shared helpers
(`share_link_entity_workspace_id`, `assert_share_link_in_caller_workspace`) close this for all 7,
alongside their existing role checks, not instead of them. `active_workspace_id()` itself is
untouched — still needed by the legacy admin-role bridge and by `save_equipment_recipe()`/
`replace_project_bom_lines()` (`equipment_types` has no `workspace_id` yet). — *Migration applied and
canonical test PASSED in production (E confirmed, 2026-09-17: "Both - Success. No rows returned").
Phase 3's cross-cutting cleanup is now fully shipped end-to-end.*

## 4. Completed locally but not yet migrated/deployed/verified

**Migration 159** (`backend/supabase/migrations/159_phase3_purchasing_inventory_workspace_ownership.sql`,
commit `f9a5d33`) — Phase 3 Stage 3 ownership half. Adds real, trigger-enforced `workspace_id` to the
seven root tables of the Purchasing/Inventory/Vendors/Warehouses domain (`vendors`, `locations`,
`inventory_items`, `purchase_orders`, `purchase_requests`, `equipment_types`, `build_transactions`),
backfills every existing row, and retires `save_equipment_recipe()`'s `active_workspace_id()`
fail-closed guard in favor of real per-caller workspace containment — the exact retirement migration
158 predicted as pending for this stage. RLS on all seven tables is deliberately untouched (still
exactly what migration 023 left it, whether `using(true)` or role-gated); that tightening is migration
160, next. Canonical test:
`backend/supabase/migration_159_phase3_purchasing_inventory_workspace_ownership_tests.sql`. Not yet
applied — queued below.

## 5. Manual-action queue for E — one action at a time, in order

**One item queued: apply migration 159**
(`backend/supabase/migrations/159_phase3_purchasing_inventory_workspace_ownership.sql`), then run its
canonical test (`backend/supabase/migration_159_phase3_purchasing_inventory_workspace_ownership_tests.sql`).
Migrations 155, 156, 157, and 158 are all confirmed applied and their canonical tests all passed in
production, 2026-09-17. After 159 is confirmed, migration 160 (Stage 3 RLS) is next.

## 6. Explicit stop boundaries — do not cross without discussion, regardless of what else this plan authorizes

- **Phase 3 RLS** (tenant isolation) — **APPROVED 2026-09-16, standing authorization for the full
  staged rollout** (§11 below is now the authoritative tracker; this is no longer a stop boundary).
  The remaining boundaries in this list, and the authorized order/process §11 records (one coherent
  table group at a time, synthetic second-workspace fixtures only inside rolled-back test
  transactions, no persistent second workspace until the isolation suite passes), still govern how
  this work proceeds.
- **A second real workspace** — do not create one, seed it, or build onboarding flows that assume
  one exists, until Phase 3 is complete and its full automated cross-workspace isolation suite
  (§11 stage 6) passes. Still a hard boundary — the standing authorization explicitly defers this to
  after Phase 3, not alongside it.
- **Commercial SaaS subscription billing** (Phase 9) — no design work begins without an explicit
  go-ahead to even start designing it.
- **Any claim of legal signature weight beyond today's typed-name + IP + content-hash pattern** —
  no drawn signature, no third-party e-signature integration, no OTP/click-through identity
  verification, and no marketing or UI copy implying stronger legal weight than what's actually
  implemented, until D12 is explicitly approved with a specific direction.
- **Any change to who can approve, who can see what, or what a role is authorized to do** — every
  business-permission change (approval thresholds, role scope, RLS-adjacent authorization logic)
  requires E's explicit decision first, same standing rule applied throughout D1-D18.
- **Billing** (the customer's own operational Billing/Client Ledger's remaining design gaps, Phase
  3's down-payment gate) — tracked as open work, not blocked outright, but not to be conflated with
  Phase 9's commercial SaaS billing, which is fully off-limits.

## 7. Queue R1 — safe autonomous queue (no business decision, no stop boundary; a coder may execute this without asking E again)

Ordered by dependency and risk, smallest-safe-step first. Skip any row already shipped — verify
against §3 before starting, since this plan is only as trustworthy as its last reconciliation (see
§9's own lesson from this pass).

1. **System Health Phase B — steps 1-4 ALL DONE (2026-09-16, `9a90903`, `d1e8d24`); migration 151
   applied + canonical test passed the same day.** Table, dedup RPC, admin lifecycle RPCs, retention
   rollup, admin panel, retention cron, and **all four named `recordSystemHealthEvent` call sites**
   (restore per-section failures, notification-delivery write failures, cron job failures, rate-limit
   hits) are live. **Step 5 (alert wiring) deliberately NOT built — needs a spec-precision pass before
   implementation, not just a business decision.** The design doc's own threshold rule ("degraded
   after 2 consecutive failures... down after 3 consecutive failures spanning ≥5 minutes, alert only
   on that down transition") needs occurrence-*timing* logic this schema doesn't track (only
   `first_seen_at`/`last_seen_at`/`occurrence_count` on the aggregate row, no per-occurrence
   timestamps), and "spanning ≥5 minutes" is genuinely ambiguous (the 3rd failure being ≥5 minutes
   after the 1st? a rolling 5-minute window?) without re-deriving intent from the original A2.4
   discussion. This is a different risk category than the mechanical call-site wiring above — flagged
   as the next item requiring E's input (a spec question, not strictly D8's channel/recipient
   question, which already has a documented default: "email to every workspace admin"), not silently
   skipped.
2. **Inventory pagination — DONE (2026-09-16), see §3.** `loadInventoryItemsPage` wired into the
   Inventory page's own desktop table and mobile card list only, `loadInventoryItems`/
   `inventoryItems`/`filteredInventoryItems` untouched. **Reports page investigated under the
   standing authorization and concluded NOT a pagination candidate**: `Reports`'s `inventoryItems`
   prop feeds `filteredInventoryItems`, which in turn feeds aggregate calculations across the FULL
   set — `costHistoryRows` (top price-trend movers), `reorderRows` (every item below its reorder
   point, not just a visible page), category/vendor spend — every one of which needs the complete
   dataset, not one cursor page, to be correct. Reports already has its own working client-side
   search/project/vendor/date filters (`reportFilters`) over that full set. Converting its fetch to
   server-side cursor pagination would silently break these complete-data calculations — exactly the
   boundary the standing authorization protects ("preserving exports and complete-data
   calculations"). No further Inventory-pagination work remains; this closes the item, not defers it.
3. **Accessibility remediation, mechanical and decision-free** (`PRODUCT_ACCESSIBILITY_MOBILE_PERF_AUDIT.md`
   Part A) — **ALL FIVE ITEMS DONE (2026-09-16), see §3.** A3's remaining scope (generic dual-purpose
   status-message `<div>`s that sometimes show an error, not the class-identified `.error-text`/
   `.modal-error-text` sites) is a separate, later, non-mechanical follow-up — not part of this item.
   - A4 — DONE. A5 — DONE. A6 — DONE. A7 — DONE. (See §3 for exact commits/detail.)
4. **Regression coverage** — satisfied continuously: every item above shipped with its own new test
   coverage in the same commit (matching this repo's standing convention), and System Health Phase
   B's own canonical SQL test is run and passed (see §3). A fresh audit of Queue A8's six flows
   (`PRODUCT_CRITICAL_FLOW_COVERAGE_MATRIX.md`) for drift was not separately performed this pass — a
   reasonable next pass if a coder has spare capacity, not a known gap.

**Queue R1 is now fully exhausted as of 2026-09-16** — every item that could be built without a
business decision or a spec-precision pass has been built, tested, deployed, and (for the one item
needing it) migrated. What remains for a coder to pick up next is either: (a) System Health's step 5,
once E has clarified the exact threshold semantics named above, or (b) Queue R2 below, which is
entirely decision-gated and must not be started without E's answer, per §6's stop boundaries. A coder
resuming this plan should not invent new "safe autonomous" scope beyond what's named here without
first re-deriving it the way this plan's own items were derived — from a real, cited design document
or audit finding, not guesswork.

## 8. Queue R2 — decision status

**Standing authorization, 2026-09-16: D5, D6, D9, D12, D18 are all APPROVED** (E's own explicit
decisions, recorded verbatim in `CONTINUOUS_CODER_HANDOFF.md` §8's register). D12 is fully shipped
(§3/§4). D5 is fully closed (§9, no code change needed — the interim copy was already the correct
permanent copy). D6/D9/D18 are approved but not yet fully implemented — tracked in Queue R3 below, not
here. **D11/D13/D14 are now APPROVED under the 2026-09-16 standing Phase 3 authorization — see §11.**
Only D15 remains genuinely gated on a future E decision.

| Decision | Status |
|---|---|
| D5 — bundle-components | **APPROVED, FULLY CLOSED.** Remains reference-only, permanently — see §9. |
| D6 — `xlsx` → `exceljs` | **APPROVED, FULLY SHIPPED.** See §3/§9 — `13d9979`. |
| D9 — backup restore checkpointing | **APPROVED, FULLY SHIPPED (two parts).** Part 1 (required-vs-optional) and Part 2 (durable resumability, migration 154) both confirmed applied and tested in production 2026-09-16. See §3/§9. |
| D12 (revised) — e-signature hardening | **APPROVED, FULLY SHIPPED.** Migration 153 confirmed applied and tested in production 2026-09-16. See §3/§9. |
| D18 — frozen proposal PDF | **APPROVED, FULLY SHIPPED.** See §3/§9 — `d92a114`. |
| D11 — Phase 3 RLS | **APPROVED 2026-09-16 — standing authorization for the full staged rollout** (Clients/Sales → Projects/BOM → Purchasing/Inventory → Documents/Notifications/Storage → remaining indirect paths → full isolation suite), in that order, one coherent table group at a time. Group 1 (Clients + Sales) implemented — migration 155, §11. |
| D13/D14 — Support/Engineering modules | **APPROVED 2026-09-16 — first-release scope authorized**, to be built after Phase 3 completes, using the existing design documents (`PRODUCT_SUPPORT_MODULE_DESIGN.md`, `PRODUCT_ENGINEERING_MODULE_DESIGN.md`) and their recommended first-release boundaries. Not yet started — see §11. |
| D15 — Commercial SaaS billing | Still gated — explicitly deferred, no design work without an explicit go-ahead. Not part of this authorization. |

## 8b. Queue R3 — approved decisions (D5/D6/D9/D12/D18) — ALL IMPLEMENTED (2026-09-16)

Every item in this queue is now done. D5 and D12 were already fully closed (§3/§4/§9). D18, D6, and D9
were built in this same pass, in this order:

1. **D18 — proposal PDF: improve print output — DONE (`d92a114`).** Three real, traced gaps fixed:
   `.stack-table-mobile`'s own `@media (max-width: 760px)` rule (no `screen` qualifier) could silently
   switch the BOM table to its mobile stacked-card layout during print — forced back to a real table
   regardless of width; status-colored banners/pills lost their background color under print — fixed
   with `print-color-adjust: exact`; the optional-BOM-line "Include" checkbox is meaningless on paper —
   replaced with print-only text. No dedicated regression test (no visual/snapshot infra in this repo)
   — verification was `tsc -b`/eslint/build clean plus code review, noted explicitly, not overclaimed.
2. **D6 — `xlsx` → `exceljs` — DONE (`13d9979`).** Real parity proof before removing xlsx: both
   libraries run side by side against synthetic workbooks covering every edge case the evaluation doc
   named (blank cells, numeric-looking text, header-only file) — all matched, now a committed regression
   suite (`src/xlsx-import.test.ts`, 7 tests), not a throwaway script. Found and fixed a real
   transitive-dependency vulnerability (exceljs's own uuid@8.3.2) via a package.json `overrides` entry
   instead of arguing it away — `npm audit` now reports 0 vulnerabilities, not 1 traded for another.
   Honest cost noted: exceljs's own chunk (271KB gzip) is meaningfully larger than xlsx's was (143KB
   gzip), still lazy-loaded only on actual use.
3. **D9 — backup restore: resumable per-section checkpointing — DONE, two parts (`a889b60`,
   `67b6cb6`).** Part 1 (required-vs-optional distinction) is pure application logic, no migration,
   already fully live in code: every reference in the restore path except a movement's own sku
   (schema-confirmed NOT NULL) now warns-and-saves-without-it instead of failing the whole section.
   Part 2 (durable resumability) needed migration 154, confirmed applied and tested 2026-09-16 — `restore_runs`/
   `restore_run_sections` + 4 RPCs, a Resume-vs-Start-Over prompt in `importBackup`. Mid-restore
   cancellation is backend-ready but the UI trigger is deliberately deferred, flagged not hidden.

## 9. Sales workstream — batch reference (historical detail, current status only)

Full batch-by-batch design history lives in `PRODUCT_SALES_EXPERIENCE_PLAN.md` and the individual
decision documents; this table is a status index, not a re-derivation.

| Batch | What it is | Status |
|---|---|---|
| 1. Frozen per-line pricing | Sales pricing foundation | **SHIPPED** — §3 |
| 2. Customer-facing pricing display | Proposal totals shown to client | **SHIPPED** — §3 |
| 3. In-place BOM-line editing | Edit/Save/Cancel on existing lines | **SHIPPED** |
| 4. `client_id` carry-through | Migration 134 | **SHIPPED** |
| 4b. `quote_ref` carry-through | D3 | **SHIPPED** — §3 |
| 5. Internal approval-before-send gate | D4 | **SHIPPED** — §3 |
| 6. Bundle-components explosion | D5 | **FULLY CLOSED (2026-09-16)** — reference-only is the permanent behavior, no further work planned |
| 7. Searchable catalog picker | `CatalogItemPicker` | **SHIPPED** |
| 8. Branding wire-up | Frozen company name/logo on snapshot | **SHIPPED** |
| 9. Proposal-page mobile data-labels | `stack-table-mobile` | **SHIPPED** |
| 10. BOM/proposal-section reordering | Move up/down buttons | **SHIPPED** |
| 11. Share-link expiration/revocation | Full lifecycle | **SHIPPED** — §3 (Queue C2) |
| 12. Version-comparison view | `compareProposalSnapshots` | **SHIPPED** |
| 13. Client Q&A on a proposal | D16 | **SHIPPED** — §3 |
| 14. Optional/alternate BOM lines | D17 | **SHIPPED** — §3 |
| 15. Real e-signature | D12 (revised) | **APPROVED and SHIPPED as scoped** — typed-name acceptance stays v1; `approval_ip`/`approval_email` hardened (migration 153, §3/§4). No drawn signature/OTP/third-party service — not part of the approved scope. |
| 16. Server-generated PDF | D18 | **APPROVED and SHIPPED as scoped** — `window.print()` stays v1; three real print gaps fixed (`d92a114`). No server-generated PDF — not part of the approved scope. |

## 11. Phase 3 full-stack rollout (standing authorization, 2026-09-16) — authoritative tracker

E approved the complete staged Phase 3 rollout, superseding the §6 stop boundary that previously
blocked it. Authorized order, to be executed one coherent stage at a time, without stopping to ask
between stages:

1. **Clients and Sales containment — DONE.** Migration 155 (`0d05d03`) — workspace-scoped RLS on the
   10-table Clients/Sales Quote ownership graph, plus 4 hardened security-definer RPCs. Confirmed
   applied and its canonical test passed in production, 2026-09-17 (test-script fix `3a7692a` along
   the way, migration itself untouched). See §3.
2. **Projects, tasks, locations, BOM, and related delivery records — DONE.** Migration 156
   (`df9a6bf`, ownership) and migration 157 (`faee9d6`, RLS on the 14-table graph + 3 hardened RPCs:
   `create_and_send_submittal_version`, `get_submittal_by_token`, `respond_to_submittal`) are both
   confirmed applied and their canonical tests both passed in production, 2026-09-17. See §3. Scope
   confirmed by direct schema
   read: `project_locations`/`_images`/`_items`, `project_scope_of_work`, `project_bom_lines`,
   `project_submittals`, `project_handovers`, `project_stakeholders`, `installed_assets`,
   `project_conversion_receipts`, `task_hardware_dependencies`, `task_activity_log` inherit ownership
   through their FK (no new column). Deliberately excluded (topical stage match, not FK-graph
   inclusion): `project_documents` (Stage 4), the four `project_shipment*`/`_shipping_addresses`
   tables (Stage 3, "receiving"), `project_schedule_templates`/`_phases` (Stage 5, a global template
   library with no `project_id` column at all), `project_ref_counters` (Stage 5, a shared counter
   table).

**Cross-cutting cleanup (deferred from Stages 1/2, its own focused pass) — DONE.** Migration 158
(`61706b7`) retires `active_workspace_id()` from every share-link RPC now safely fixable
(`create_submittal_share_token`, `create_quote_proposal_share_token`, `regenerate_share_link`,
`create_and_send_quote_proposal_version`), and closes a second gap found in the same pass: all 7
share-link lifecycle RPCs checked caller role but never caller workspace — two were directly
callable with zero workspace check at all. Confirmed applied and its canonical test passed in
production, 2026-09-17. See §3. `active_workspace_id()` itself remains in use by the legacy
admin-role bridge and by `save_equipment_recipe()`/`replace_project_bom_lines()` (`equipment_types`
has no `workspace_id` yet) — genuinely still needed
there, not an oversight.
3. **Purchasing, inventory, vendors, warehouses, and receiving — IN PROGRESS.** Ownership migration
   159 (`f9a5d33`) implemented locally and queued for E's review (see §4/§5) — adds `workspace_id` to
   the seven root tables (`vendors`, `locations`, `inventory_items`, `purchase_orders`,
   `purchase_requests`, `equipment_types`, `build_transactions`) and retires
   `save_equipment_recipe()`'s `active_workspace_id()` guard. Scope confirmed by direct schema read
   (not assumed from this tracker's own earlier text): `purchase_order_lines`/`_files`/`_receipts`/
   `_holds`, `inventory_balances`, `inventory_movements`, `inventory_transactions`,
   `project_inventory_allocations`, `project_allocation_history`, `equipment_bom_components` inherit
   ownership through their FK (no new column) — RLS for the whole group, including these children, is
   migration 160, next. Deliberately excluded on inspection (topical match, not FK-graph inclusion):
   the four `project_shipment*`/`_shipping_addresses` tables, re-scoped from this stage to Stage 4
   (Documents/Notifications) after direct read showed they carry no purchasing/inventory data of their
   own.
4. **Documents, notifications, channels, jobs, share-link records, and storage — NOT STARTED.**
5. **Workspace-scoped uniqueness, reports, aggregates, functions, triggers, and remaining indirect
   access paths — NOT STARTED.**
6. **Full automated cross-workspace isolation suite and final Phase 3 reconciliation — NOT STARTED.**
   Gate: this must pass before a second real workspace may ever be created (§6).
7. **Company onboarding and no-code workspace configuration — NOT STARTED.** Blocked on stage 6.
8. **Support module first release (D13) — NOT STARTED.** Blocked on stage 7 per the authorized order
   (build after Phase 3 completes). Design doc: `PRODUCT_SUPPORT_MODULE_DESIGN.md`.
9. **Engineering/Product Development module first release (D14) — NOT STARTED.** Same gating as
   stage 8. Design doc: `PRODUCT_ENGINEERING_MODULE_DESIGN.md`.

**Cross-cutting finding from Group 1's revalidation, tracked here so it isn't lost across stages**:
`active_workspace_id()` (migration 124) is a deliberate, tested, fail-closed guard requiring exactly
one `workspaces` row to exist in the whole database — used by several RPCs precisely because the
tables THEY touch (`equipment_types`, `projects`, `project_submittals`) don't have their own
`workspace_id` yet. This is not a bug to fix once; it is retired incrementally, one call site at a
time, as each table group above gains real per-row workspace ownership:
- `save_equipment_recipe` (migration 130) — **DONE**, migration 159 retires this call site now that
  `equipment_types` has real `workspace_id`. `replace_project_bom_lines` (migration 131) still calls
  `active_workspace_id()`, but only incidentally (reads `inventory_items` for name/id resolution) —
  its own guard belongs to `project_bom_lines`, already workspace-owned since Stage 2; revisit whether
  that guard is still needed once Stage 3 is fully reconciled.
- Stage 2 should also retire the guard inside the SUBMITTAL-side branches of the share-link RPCs
  (`create_and_send_submittal_version`, `regenerate_share_link`, `permanently_revoke_share_link`,
  and their reissue/expiry paths, migrations 138-140) — these are shared with Proposals, which is why
  Group 1 deliberately did NOT touch them (a half-fix serving only one entity type adds branching
  complexity for no real benefit until both sides have real `workspace_id`).
- Stage 6 (final reconciliation) must confirm every remaining `active_workspace_id()` call site has
  been retired before stage 7 (onboarding) begins — a second real workspace cannot safely be created
  while any RPC still depends on "exactly one workspace in the whole database."
- `bridge_set_primary_role`/`bridge_set_secondary_roles`/`bridge_set_user_allowed_views`/
  `bridge_grant_admin`/`bridge_revoke_admin` (migration 124) depend on it for a DIFFERENT reason —
  they operate on the legacy `app_admins`/`app_user_roles` tables, which have no workspace dimension
  at all. Retiring these requires migrating away from those legacy tables entirely (replacing them
  with `workspace_members`/`workspace_member_roles`, already partially bridged) — a larger piece of
  work than any single table group above, tracked here as its own eventual stage-6-adjacent item, not
  assigned a stage number yet.

**Still deferred, per the standing authorization's own boundaries**: no SaaS subscription billing; no
persistent second workspace until stage 6 passes; no OTP, drawn-signature, third-party e-signature, or
regulated-signature claims; no messages to real customers or changes to real operational records for
testing.

## 10. What this reconciliation pass changed

- **Full rewrite of §3 onward** to reflect the confirmed-shipped state of D3, D4, D16, D17, and the
  complete migration range 115-150 (the prior version stopped at migration 145 and had no D-numbered
  entries for D3/D4/D16/D17 at all).
- **Corrected three genuinely stale rows found during this pass, all now fixed** (also corrected
  directly in `CONTINUOUS_CODER_HANDOFF.md` §8's own register, not just here): D3 and D4's decision-
  register rows had never been updated past their original open-question framing despite both being
  fully shipped and confirmed weeks... same-day prior in this session — corrected to match the D16/D17
  "APPROVED, FULLY CLOSED" format. (Two more stale rows from the *previous* reconciliation pass —
  share-link status and `client_id` carry-through — were already fixed 2026-09-15 and are reflected
  correctly here; see git history for that pass if needed.)
- **Replaced the old §4 "Next 20 implementation batches" and §5 "Sales batch breakdown" narrative
  structure** with the explicitly-requested structure: evidence labels (§0), completed-and-live (§3),
  completed-locally-not-deployed (§4, currently empty), a manual-action queue for E (§5), explicit
  stop boundaries (§6), a safe autonomous queue (§7), a decision-gated queue (§8), and a compact
  batch-status index (§9) replacing the old narrative table. The old narrative's real content (why
  each decision was made, exact citations) was not lost — it lives in `PRODUCT_SALES_EXPERIENCE_PLAN.md`
  and the individual decision documents, which this version points to explicitly instead of
  re-deriving.
- **The lesson from the prior pass stands and is reinforced by finding it happen again**: a document
  is only as trustworthy as its last reconciliation. This pass found the fix from the last pass
  (D3/D4) had not itself propagated into this same document's own decision-adjacent framing —
  meaning "reconciled once" is not "reconciled forever." The next coder should re-verify §3 against
  `CONTINUOUS_CODER_HANDOFF.md` §4's "Current production baseline" before trusting this document's
  own "shipped" claims if meaningful time has passed since 2026-09-15.
