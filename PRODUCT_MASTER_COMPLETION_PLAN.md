# Ergon Ops — Master Completion Plan

> **Execution handoff:** Use [`CONTINUOUS_CODER_HANDOFF.md`](CONTINUOUS_CODER_HANDOFF.md) for the
> full session-by-session queue history, delivery conventions, and the consolidated decision
> register (§8, D1-D18). Use [`HANDOFF.md`](HANDOFF.md) for the most recent session's own summary
> and exact next task. This document is the authoritative, always-current product roadmap: what's
> live, what's staged, what's left, in what order, and what's explicitly off-limits without E.

Status: **AUTHORITATIVE, RECONCILED 2026-09-17** (D5/D6/D8/D9/D12/D18 shipped; standing authorization
given for the full Phase 3 rollout, D11/D13/D14 now approved, see §11 — Stages 1 through 4 in full
(Clients+Sales, Projects+Tasks, Purchasing/Inventory/Vendors/Warehouses, Documents/Shipments/
Share-links/Storage/Messaging-channels; migrations 155-162) plus the cross-cutting
`active_workspace_id()` cleanup (migration 158) are all confirmed applied and tested live; Stage 5
(workspace-scoped uniqueness, reports, aggregates, functions, triggers, remaining indirect access
paths) scoping is DONE, and its first migration (163, three real RPC workspace-containment gaps found
during that scoping) is implemented locally and queued as the current manual-action item; a new
group-DM feature request from E is tracked separately, not part of Phase 3, see §4) against
`HANDOFF.md`, `CONTINUOUS_CODER_HANDOFF.md` §8's
full D1-D18 decision register, every applied migration (115
through 162, plus 163 pending), and
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

### Phase 2/3 — Tenant containment and RLS — **ESSENTIALLY COMPLETE, migrations 115 through 185, all confirmed applied and tested in production**
**Gate**: a second real workspace can be created with data provably invisible to the first
workspace's users, verified by an automated cross-tenant test, not a spot check. This section
previously read "NOT STARTED, explicitly blocked" — "Zero of 86 tables have a tenant column... no
RLS has been written" — that snapshot is obsolete and superseded by everything in §3/§5/§11. Phase 3
RLS has been this session's entire focus across dozens of migrations, and the mechanical scoping
work the full schema inventory (triggered by migration 174) turned up is now closed: `team_members`,
`product_catalog`/`catalog_price_change_requests`, `presales_hardware_rules`/`site_hardware_rules`/
`form_schemas`/`form_schema_fields`, `one_off_reconciliations` (migrations 175-178); the last 3 of 9
originally-open Storage buckets, `project-location-images`/`project-shipment-photos`/`avatars`
(migration 179); `project-documents`/`catalog-datasheets` storage.objects (migration 180, dual-match
RLS keyed off the real anchor row id for new uploads, legacy sanitized-name matching preserved for
files uploaded before the fix); `user_invites`, including `accept_invite()` finally creating a real
`workspace_members` row on acceptance (migration 181); `company_branding`, converted from a global
Postgres singleton to one row per workspace (migration 182); `app_records`/`app_state_snapshots`,
the last fully-open tables in the schema (migration 183); a separately-discovered pre-existing bug
where the `catalog-datasheets` Storage bucket never actually existed in production (migration 184);
and per-workspace admin authorization additively OR'd into 9 admin-gated policies so a company's own
admin no longer needs a global platform admin for these actions (migration 185, plus its frontend
companion). **What remains open is genuinely decision-dependent or test-rigor work, not scoping** —
see §5a for the current, narrow remainder. **The §6 standing stop boundary on creating a second real
workspace remains in force** until §11 stage 6's full automated cross-workspace isolation suite
passes — that work is in progress, see recent commits, not yet complete.

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

## 3. Completed and live — migration range 115 through 150, plus 152 through 163

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

**Phase 3, Stage 3 ownership half** — migration 159
(`backend/supabase/migrations/159_phase3_purchasing_inventory_workspace_ownership.sql`, `f9a5d33`).
Adds real, trigger-enforced `workspace_id` to the seven root tables of the Purchasing/Inventory/
Vendors/Warehouses domain (`vendors`, `locations`, `inventory_items`, `purchase_orders`,
`purchase_requests`, `equipment_types`, `build_transactions`), backfills every existing row, and
retires `save_equipment_recipe()`'s `active_workspace_id()` fail-closed guard in favor of real
per-caller workspace containment — the exact retirement migration 158 predicted as pending for this
stage. RLS on all seven tables is deliberately untouched (still exactly what migration 023 left it,
whether `using(true)` or role-gated); that tightening is migration 160, next. — *Migration applied and
canonical test PASSED in production (E confirmed, 2026-09-17: "Success. No rows returned" for both,
after one same-day test-script fix, `e75306a` — the fixture-vendor insert for the purchase_orders
no-membership check needed a real caller identity, not the `postgres` role, since
`guard_workspace_id_mutation()` is a BEFORE INSERT trigger and role-switching bypasses RLS but not
trigger execution; migration 159 itself was never touched).*

**Phase 3, Stage 3 RLS half** — migration 160
(`backend/supabase/migrations/160_phase3_purchasing_inventory_workspace_rls.sql`, `df341ab`). Adds
workspace-scoped RLS to the seven root tables migration 159 gave real `workspace_id` to, plus their
ten children, via three new owner-resolver helper functions (`purchase_order_owner_workspace_id`,
`inventory_item_owner_workspace_id`, `equipment_type_owner_workspace_id`; migration 157's
`project_owner_workspace_id` is reused directly for `project_inventory_allocations`). Every
pre-existing role gate from migration 023 (warehouse/purchasing/admin) is preserved, ANDed with the
new workspace predicate, not replaced. No RPC changes — confirmed this domain has no RPC layer besides
`save_equipment_recipe()`, already hardened by migration 159. — *Migration applied and canonical test
PASSED in production (E confirmed, 2026-09-17: "both ran - Success. No rows returned").* **Stage 3
(Purchasing/Inventory/Vendors/Warehouses) is now fully shipped end-to-end.**

**Phase 3, Stage 4 (unblocked portion)** — migration 161
(`backend/supabase/migrations/161_phase3_documents_shipments_sharelinks_workspace_rls.sql`,
`d42190b`). Adds workspace-scoped RLS to `project_documents` (three-way coalesce anchor across
`project_id`/`purchase_order_id`/`purchase_request_id`), its child `sales_quote_extractions`, the four
`project_shipment*` tables, and closes a real gap in the share-link tables themselves: migration 158
hardened the RPC layer, but `public_share_tokens`/`share_link_views`/`share_link_actions` still had
bare `using(true)` SELECT policies — any authenticated user in any workspace could read every other
workspace's share-link rows. Also scopes the `purchase-order-files` storage bucket, explicitly
deferred by migration 160. Three new resolver functions (`purchase_request_owner_workspace_id`,
`project_shipment_owner_workspace_id`, `project_document_owner_workspace_id`); migration 158's
`share_link_entity_workspace_id` reused directly for the share-link tables. Does NOT cover messaging
channels or DMs (blocked on the two product decisions in §11's Stage 4 entry) or
`notification_rules`/`notifications`/`notification_deliveries`/`push_subscriptions` (confirmed
correctly scoped as-is, or likely Stage 5's job). — *Migration applied and canonical test PASSED in
production (E confirmed, 2026-09-17: "both came back - Success. No rows returned").*

**Phase 3, Stage 4 (messaging channels)** — migration 162
(`backend/supabase/migrations/162_phase3_messaging_channels_workspace_scoping.sql`, `862aa75`). Adds
real, trigger-enforced `workspace_id` to `channels` (a genuine column, not a resolver — `section`/
`group` channel types have no reliable FK anchor at all, unlike every other Stage 4 table), per E's
2026-09-17 decision that channels are per-workspace, not shared globally. A channel-specific guard
trigger derives `workspace_id` authoritatively from the linked project/client for those two channel
types, and from the caller's own resolved workspace for `section`/`group` types — never trusting a
caller-supplied value either way. `channel_messages`, `channel_members`, `channel_canvas`,
`channel_message_reactions`, and the `message-attachments` storage bucket's channel-specific policies
all inherit scoping through `channel_id`. Does NOT auto-seed a new workspace's own section channels
(no reviewed workspace-provisioning path exists yet — Stage 7) or touch `conversations`/
`direct_messages`/`direct_message_reactions` (stay cross-workspace per E's other 2026-09-17 decision).
— *Migration applied and canonical test PASSED in production (E confirmed, 2026-09-17: "both came
back - Success. No rows returned").* **Phase 3 Stage 4 (Documents/Notifications/Channels/Jobs/
Share-links/Storage) is now fully shipped end-to-end.**

**Migration 163**
(`backend/supabase/migrations/163_phase3_stage5_rpc_workspace_containment_gaps.sql`, commit
`88fa65b`) — Phase 3 Stage 5, first migration. Closes three real, confirmed cross-workspace
containment gaps found during Stage 5's scoping pass (same T2/T8 class already fixed elsewhere in
Phase 3, missed because these three RPCs live outside the file clusters those earlier passes
reviewed): `replace_project_bom_lines()` checked the caller's role but never that the target project
belongs to the caller's workspace (and its `inventory_items` lookups were entirely workspace-blind);
`respond_to_proposal_question()` checked role but never workspace (any Sales/manager/admin could
answer any other workspace's client Q&A by question id); `submit_proposal_question()` was missing the
suspended-workspace ("T8") check its own sibling RPCs already got in migration 155. All three carried
forward verbatim from their current live definitions with only the targeted fixes. Canonical test:
`backend/supabase/migration_163_phase3_stage5_rpc_workspace_containment_gaps_tests.sql`. One same-day
test-script fix, `9f342d4`: Section 2's fixture used `'draft'` for `sales_quotes.status` (a valid
`sales_quote_proposals.status` value, not `sales_quotes.status`, constrained to
`open`/`closed_won`/`closed_lost` since migration 048) — corrected to `'open'`, migration 163 itself
never touched. — *Migration applied and canonical test PASSED in production (E confirmed, 2026-09-18:
"Success. No rows returned" for both).* **Phase 3 Stage 5's first migration is now fully shipped.**

**Migration 173** (`backend/supabase/migrations/173_global_config_workspace_scoping.sql`) — **E's
governance call resolved, 2026-09-18: "each company should have its own separate copies, this should
not be a question."** `notification_rules`/`standard_install_times`/`project_schedule_templates` (+
child `project_schedule_template_phases`) get a real `workspace_id` each — they've had exactly one
shared, global copy since migrations 024/025, meaning every workspace was silently reading/writing the
SAME notification toggles, labor-time estimates, and schedule templates as every other workspace.
Existing role-gated write policies (`is_app_admin`/`is_app_manager`/`has_role('pm')`) are ANDed with a
new workspace-membership check, not replaced (confirmed these role checks are, and remain, completely
workspace-unaware on their own). Also fixes a real gap this uncovered: migration 166 classified
`'schedule_template_phase'` as genuinely global for `deletion_log` purposes — no longer true, fixed via
a plain lookup (this entity type is soft-deleted, so no atomic RPC needed, unlike migration 172's
`inventory_item`/`equipment_type`). Deliberately NOT done: auto-seeding a brand-new workspace's own
default rows — same reasoning as migration 162's deferral of default-channel seeding (no reviewed
workspace-provisioning path exists yet, Stage 7) — a new workspace will have every notification
silently off until seeded, a known/accepted consequence, not a technical blocker. Canonical test:
`backend/supabase/migration_173_global_config_workspace_scoping_tests.sql`. Independently verified
end-to-end against a real local PostgreSQL 18 engine (PGlite), reproduced on two separate runs. **One
test-fixture bug found on E's first live run** (not a migration bug): the test assumed
`'low_stock_reached'` was a free `event_type` to insert fresh, but migration 024 (and every later
widening migration) already seeds a real row for every valid value in the one real production
workspace — fixed by discovering an existing row's `event_type` dynamically (commit `d2d8047`),
re-verified against a sandbox seeded with realistic pre-existing data this time (the original sandbox's
empty table is why this didn't surface sooner). The companion `src/persistence.ts` fix
(`standard_install_times`'s upsert `on_conflict` target) was committed and pushed immediately after E
confirmed the migration, learning directly from the migration 172 incident (§3) — deploy confirmed live
via bundle hash within the same turn. — *Migration applied and canonical test PASSED in production (E
confirmed, 2026-09-18, "Success. No rows returned" for both).* **Do not run migration 173 or its
canonical test again.**

## 4. Completed locally but not yet migrated/deployed/verified

**Migration 189** (`backend/supabase/migrations/189_channel_guest_message_sender_names.sql`) —
follow-up to migration 188, closing a usability gap found while building that migration's frontend
(commit `9cd9faf`): a channel guest's `senderNameFor` resolution relies on `app_known_users`/
`team_members`, neither of which a guest can read (by design — migration 188 never widened either
table's RLS, since that would leak the whole company directory), so every OTHER person's message in the
guest's one channel showed "Unknown user." New narrowly-scoped RPC,
`get_channel_message_sender_names(p_channel_id uuid) returns table (user_id uuid, display_name text)`,
SECURITY DEFINER, resolves ONLY the real senders of messages that exist in the one channel the caller
(a normal member with real access, or `is_active_channel_guest()`) is authorized to see — never the
directory. Display-name preference order mirrors `senderNameFor`/`teamDisplayName`'s real client logic
exactly: `team_members.full_name` (+ `role_title`) if a match exists in the channel's own workspace,
else the email local-part fallback. Verified via the consolidated isolation suite (55/55 passing, zero
regressions) plus its own canonical test
(`backend/supabase/migration_189_channel_guest_message_sender_names_tests.sql`). See HANDOFF.md for
full detail. — *Not applied to production yet — kept local for E's review.* The matching frontend
(`GuestChannelShell` calling this RPC and merging the result into its local name map, plus a second,
independent fix for the "revoked/expired guest sees a broken normal-app fallthrough" dead-end) is
built but deliberately held back uncommitted until E confirms this migration is applied — see
`src/main.tsx`/`src/persistence.ts`.

## 5. Manual-action queue for E — one action at a time, in order

**None currently.** Migrations 155 through 192 are all confirmed applied and their canonical tests all
passed in production, 2026-09-17/21. Migration 189 (channel-guest sender-name resolution) and its
frontend are live. Migrations 190 (channel/DM attachment forwarding), 191 (channel/DM unread + mention
read-state), and 192 (channel-has-active-guest banner + add-member/guest-invite confirmation dialogs)
are all confirmed applied and their combined frontend shipped together in one deploy, commit `3e48b64`,
confirmed live in production (bundle hash verified, zero console errors). Migration 191's canonical test
needed one same-day test-file fix (commit `245fe8f` — a hardcoded mention string that didn't match E's
real, already-populated `team_members` name; migration 191 itself was correct). Migrations 175 through 179 — the overnight autonomous batch drafted
per E's "do all of them" instruction — were run in required order (175 first, since 179 depends on it,
through 179 last); E confirmed "all came back - Success. No rows returned" for all five migration+test
pairs. Migrations 180 through 185 — this session's closing batch, closing every remaining item §5a had
flagged as decision-dependent plus one separately-discovered bug (184) — are likewise all confirmed
applied and tested in production. Migration 186 (a low-severity `is_app_manager()` grant fix found via
an autonomous audit) and 187 (DM/directory workspace scoping, reversing migration 162's own recorded
decision after E's 2026-09-19/20 ruling) are both confirmed applied and tested. Migration 188 (external
guest access to a single created channel, `PRODUCT_EXTERNAL_GUEST_CHANNELS_DESIGN.md`) is confirmed
applied and tested; its matching frontend (guest invite UI inside `ChannelDiscussion`, the
`?channel-guest=<token>` guest accept-invite landing page, and the separate minimal `GuestChannelShell`
app shell) was built and shipped 2026-09-20 (`src/main.tsx`, `src/persistence.ts`) — see HANDOFF.md for
the commit hash and full detail. **The final Phase 3 cross-workspace isolation suite (§5a) is now
essentially closed** — only genuine test-rigor items remain open.

**Migration 180** (`backend/supabase/migrations/180_project_documents_and_catalog_datasheets_storage_containment.sql`,
commit `29acdd1`) — URGENT, same severity class as migrations 165/168/170/174: `storage.objects` RLS for
`project-documents` (migration 031) and `catalog-datasheets` (migration 052) had never been touched since
creation and was wide open to any authenticated user regardless of workspace. Fixed with a dual-match
policy per bucket, anchored directly to `public.projects`/`public.product_catalog` (never through the
per-file metadata tables, same "go straight to the real owning table" pattern as migrations 161→168/179):
the leading path segment is accepted as EITHER the anchor row's real `id` (what every new upload will
produce once the companion, held-back `src/persistence.ts` path-builder change ships) OR the anchor's
sanitized name/catalog-number (the LEGACY branch, kept only so pre-existing uploads keep working). E's
explicit, accepted decision: do not migrate/rename existing natural-key-path objects, leaving a dormant
residual risk — a name/catalog-number collision between two companies could in theory grant cross-company
access to an OLD file — accepted since exactly one workspace exists today and zero collisions have ever
occurred. `catalog-datasheets`' pre-existing public (anon) SELECT policy (migration 052) is deliberately
left untouched — a product-visibility question, not this migration's to decide. Canonical test:
`backend/supabase/migration_180_project_documents_and_catalog_datasheets_storage_containment_tests.sql`.
— *Migration applied and canonical test PASSED in production (E confirmed, 2026-09-19, "Success. No rows
returned" for both).* **Do not run migration 180 or its canonical test again.**

**Migration 181** (`backend/supabase/migrations/181_user_invites_workspace_scoping.sql`, commit
`6c00009`) — closes a real, currently-live functional gap: a brand-new user who accepted an invite was
approved into the app but got no `workspace_members` row, and thus could see no workspace-scoped data,
until an admin separately ran the unrelated "set primary role" action. Adds `user_invites.workspace_id`
(root table, no anchor of its own, same backfill-to-the-one-real-workspace pattern as every other Stage
1-5 root table this session); RLS keeps the existing `is_app_admin(auth.uid())` gate ANDed with the new
workspace check (never replaced — whether that flag is meant as global Ergon staff or per-company admin
is a judgment call deliberately left unresolved, since ANDing is correct either way); `accept_invite()`
rewritten via `create or replace function`, carrying its migration-065 `app_user_roles`/`app_user_status`
logic forward byte-for-byte, plus a new `workspace_members` insert keyed off the invite's own
`workspace_id` (`is_workspace_admin = false`, `on conflict (workspace_id, user_id) do nothing`).
Confirmed no frontend change needed — `createInvite`/`acceptInvite` (`src/persistence.ts:1094`/`:1196`)
already pass through to the RPC/table whose behavior changes server-side only. Canonical test:
`backend/supabase/migration_181_user_invites_workspace_scoping_tests.sql`. — *Migration applied and
canonical test PASSED in production (E confirmed, 2026-09-19, "Success. No rows returned" for both).*
**Do not run migration 181 or its canonical test again.**

**Migration 182** (`backend/supabase/migrations/182_company_branding_workspace_scoping.sql`, commit
`6a1d138`) — converts `company_branding` (migration 039) from a literal Postgres singleton
(`id boolean primary key default true`) to one row per workspace, per E's standing "each company should
have its own separate copies" default. Backfills the existing singleton row's real `company_name`/
`logo_storage_path` onto the production workspace (a plain UPDATE, real data carried forward untouched,
never reconstructed); drops the boolean PK, makes `workspace_id` the real primary key; adds a
`workspaces` `after insert` trigger (`workspaces_seed_default_branding`) seeding a `'New Company'`
placeholder default (JUDGMENT CALL, flagged for E) for every new workspace; RLS read becomes
`is_workspace_member(workspace_id)`, write keeps the existing admin-only gate ANDed with active
membership; the `company-branding` Storage bucket's public READ policy is left untouched (a product
decision, not this migration's to make), only its WRITE-side policies gain a workspace check keyed off
the path's leading `workspace_id` segment. One real design bug caught during PGlite verification: reusing
`guard_workspace_id_mutation()` (migration 117) verbatim broke new-workspace seeding (it derives
`workspace_id` from the *caller's* own membership, not the workspace being created) — fixed with a
dedicated `guard_company_branding_workspace_id_mutation()` enforcing only UPDATE immutability. Frontend
companion (`loadCompanyBranding`/`saveCompanyBranding`/`uploadCompanyLogo`) shipped in commit `4265f6c`
after this migration was confirmed live; one test-file bug found and fixed afterward — a hardcoded
fictional production-data assertion (commit `cbd875f`), migration itself untouched. Canonical test:
`backend/supabase/migration_182_company_branding_workspace_scoping_tests.sql`. — *Migration applied and
canonical test PASSED in production (E confirmed, 2026-09-19, "Success. No rows returned" for both).*
**Do not run migration 182 or its canonical test again.**

**Migration 183** (`backend/supabase/migrations/183_app_records_state_snapshots_workspace_scoping.sql`,
commit `a562817`) — closes the last fully-open tables in the schema: `app_records` (migration 009) and
`app_state_snapshots` (migration 003), both still `using(true)`/`with check(true)` (or equivalent) since
creation. `app_records`' primary key was already the composite `(workspace_key text default 'default',
record_key text)` — not a folded string key — so this migration adds a real `workspace_id uuid` column
and REPOINTS the primary key to `(workspace_id, record_key)`; the old `workspace_key` column is kept
(never dropped, no column-drop precedent in this repo) and becomes fully vestigial. `app_state_snapshots`'
separate `unique(workspace_key)` is repointed to `unique(workspace_id)` the same way; it stays read-only
(no `authenticated` write policy since migration 009). JUDGMENT CALL, flagged for E: backfills ALL
existing rows, not just live `roleMode` rows, to the one real production workspace — safe because there
has only ever been one physical `workspace_key` value in either table's history. Coordination risk (same
shape as migration 173's own Section 5 point 5): repointing the primary key means
`saveRemoteAppState()`'s `on_conflict=workspace_key,record_key` no longer names a real constraint the
instant this migration applies — the companion `src/persistence.ts` diff (dropping the
`workspace_key=eq.default` filters, changing `on_conflict` to `workspace_id,record_key`) shipped in
commit `4265f6c`, held back until this migration was confirmed live. Canonical test:
`backend/supabase/migration_183_app_records_state_snapshots_workspace_scoping_tests.sql`. — *Migration
applied and canonical test PASSED in production (E confirmed, 2026-09-19, "Success. No rows returned"
for both).* **Do not run migration 183 or its canonical test again.**

**Migration 184** (`backend/supabase/migrations/184_fix_missing_catalog_datasheets_bucket.sql`, commit
`72e1be6`) — URGENT-adjacent, separately-discovered bug found while E was applying migration 180.
Migration 052 already contained the statement to create the `catalog-datasheets` Storage bucket, but that
bucket never actually existed in production — applying migration 180's real `catalog-datasheets`
`storage.objects` RLS and its canonical test failed with `23503: insert or update on table "objects"
violates foreign key constraint "objects_bucketId_fkey"`. This means catalog-datasheet uploads had likely
never actually worked in production, independent of and unrelated to migration 180's own (otherwise
correct) RLS logic. Fix is the one `insert into storage.buckets ... on conflict (id) do nothing`
statement migration 052 was always supposed to have taken effect — migration 052 itself not edited or
rerun. No dedicated canonical test file; run before re-running migration 180's own canonical test (its
catalog-datasheets sections would otherwise keep failing on the same foreign-key violation). — *Migration
applied in production (E confirmed, 2026-09-19, "Success. No rows returned").* **Do not run migration 184
again.**

**Migration 185** (`backend/supabase/migrations/185_per_workspace_admin_authorization.sql`, commit
`bcc48d8`) — E's explicit decision: each company's own admin should be able to invite teammates, manage
company branding, and manage catalog pricing/hardware-rules/form-schema config for their own company,
without going through E personally. A real per-workspace admin mechanism already existed and needed no
new schema — `workspace_members.is_workspace_admin` + `public.is_workspace_admin(workspace_id)`
(migration 115:121-134) — it simply wasn't wired into the policies gating these actions. This migration
purely OR's `is_workspace_admin(workspace_id)` into the existing admin gate (never replaces or removes
anything) on 9 policies across `user_invites` (181), `company_branding` table + its `company-branding`
storage bucket (182), `product_catalog` + `catalog_price_change_requests` (176), and
`presales_hardware_rules`/`site_hardware_rules`/`form_schemas`/`form_schema_fields` (177). Two judgment
calls, flagged for E: (1) `catalog_price_change_requests`' read policy also got the OR, not just its
update/review policy — a workspace admin who could approve/reject a request but not read it to review it
would be a functionally broken grant; (2) the `company-branding` storage policies needed a new helper,
`safe_workspace_id_from_object_path()`, casting the path's leading segment to uuid without breaking
migration 182's own "malformed path fails cleanly, never a raw cast error" property. **Flagged
prominently, not silently shipped as done**: this migration alone does not achieve E's stated goal
end-to-end — `checkIsAdmin()` (`src/persistence.ts:1252-1267`) queried only `app_admins`, so a
workspace-admin-only user still wouldn't see these UI affordances at all. The companion frontend change
(a new `isWorkspaceAdmin` state, loaded alongside `checkIsAdmin()`, OR'd into each of the 9 gated UI
affordances) shipped separately in commit `e0f0932` after this migration was confirmed live. Canonical
test: `backend/supabase/migration_185_per_workspace_admin_authorization_tests.sql` — exercises a
workspace-admin-only member (no `app_admins` row) succeeding for their own workspace and still being
rejected for a second, synthetic workspace; a global admin still passes every gate exactly as before. —
*Migration applied and canonical test PASSED in production (E confirmed, 2026-09-19, "Success. No rows
returned" for both).* **Do not run migration 185 or its canonical test again.**

**Migration 186** (`backend/supabase/migrations/186_fix_is_app_manager_missing_grants.sql`, commit
`627b946`) — found via an autonomous security-grant audit (Queue R1-class, no business decision
involved). `is_app_manager(uuid)` (migration 014) never had any grant/revoke statement applied to it,
in 014 or any later migration — migration 124 flagged this as a deferred twin of `is_app_admin()`/
`has_role()`, migration 125 closed the identical gap for those, but `is_app_manager()` fell through
both passes. Since it's a plain SQL function (not a trigger), any fully unauthenticated caller could
pass an arbitrary user id and learn whether that user holds the manager role — low severity (boolean
role-probe, no write path), but real and live. Verified via PGlite with a negative control confirming
the sandbox genuinely reproduces Postgres' default PUBLIC-grant behavior pre-fix. Canonical test:
`backend/supabase/migration_186_fix_is_app_manager_missing_grants_tests.sql`. — *Migration applied and
canonical test PASSED in production (E confirmed, 2026-09-20, "Success. No rows returned" for both).*
**Do not run migration 186 or its canonical test again.**

**Migration 187** (`backend/supabase/migrations/187_dm_and_directory_workspace_scoping.sql`, commit
`c961482`) — reverses migration 162's own recorded decision after E, alarmed by an audit finding
tonight, decided direct messages and the user directory should be scoped per company after all, not
global across the platform. Closes two things: `app_known_users`' wide-open `"authenticated read
app_known_users for messaging"` policy (migration 094, `using(true)`) — any authenticated user could
read every user's name/email across every company — replaced with self-or-global-admin-or-
shares-a-workspace, via a new `shares_workspace_with()` security-definer helper (an inline `exists`
query against `workspace_members` doesn't work here, since that table's own RLS restricts a plain
member to their own row — found and fixed during verification). `conversations`/`direct_messages` gain
real workspace containment: `conversations.workspace_id` derives from the two participants' shared
active workspace at creation time via a new guard trigger, rejecting creation outright if they share
none; `direct_messages` inherits via `conversation_id`, same pattern as `channel_messages`/`channel_id`
(migration 162). No frontend change needed — confirmed by reading the real query code, not assumed.
Canonical test: `backend/supabase/migration_187_dm_and_directory_workspace_scoping_tests.sql`. —
*Migration applied and canonical test PASSED in production (E confirmed, 2026-09-19, "Success. No rows
returned" for both).* **Do not run migration 187 or its canonical test again.** Deliberately NOT part
of this migration: the separate, larger future feature of inviting an external subcontractor into one
project channel only — E confirmed this should build on the proven share-link/token pattern (proposal
Q&A, migrations 025/053/137/149/158) rather than `channel_members`/workspace-membership, since
`channel_members` isn't currently wired into project/section/client channel visibility at all and
there is no "authenticated but not a full member" tier anywhere in this app today. Not designed or
scheduled yet.

**Two broader security audits run tonight (Queue R1-class, no business decision), both came back
essentially clean.** A systemic sweep of every `drop policy if exists` across all 185 migrations for
stale-policy-survives-a-typo'd-drop bugs (the exact concern raised about migration 176's
`product_catalog` policy) found that concern was itself a false alarm — migration 033 had already
correctly renamed the policy before 176 ever touched it — and found zero real instances of this bug
class anywhere in the whole history; confirmed against real production `pg_policies` via a read-only
diagnostic (`backend/supabase/diagnostic_stale_rls_policies_flagged_only.sql`), which returned exactly
one row, the already-known `app_known_users` finding closed by migration 187 above. A parallel sweep of
every `security definer` function for a missing PUBLIC-grant revoke (the migration 171/186 bug class)
found only `is_app_manager()` (closed by 186) and one purely cosmetic, non-exploitable inconsistency
(`create_client_channel()`, a trigger function Postgres cannot invoke directly regardless of its
grants).

**Migration 188** (`backend/supabase/migrations/188_external_channel_guest_access.sql`, commit
`f98f1e0`) — implements `PRODUCT_EXTERNAL_GUEST_CHANNELS_DESIGN.md` end to end, backend only. An
internal PM/admin/channel-creator can invite an outside person (e.g. a subcontractor from a different
company) into ONE `project`/`client`/`group` channel — never a `section`-type channel ("Projects,"
"Sales," "Marketing"), enforced by a `before insert` guard trigger at the data layer, not just the UI.
Two new tables, `channel_guests`/`channel_guest_invites` (channel-scoped only, no `workspace_id`
column, never linked to `workspace_members` — a guest is a real `auth.users` row with a persistent,
revocable, named identity, but never a company member). Additive RLS OR-branches (no existing condition
removed) on `channels`/`channel_messages`/`channel_message_reactions`/the `message-attachments` storage
bucket (read+write for the guest's own channel) and `channel_canvas` (read-only for guests — judgment
call, flagged for E, one-line change if write access is wanted). Four RPCs:
`create_channel_guest_invite`, `get_channel_guest_invite_by_token` (anon-callable), 
`accept_channel_guest_invite`, `revoke_channel_guest`. Verified via the consolidated isolation suite
(54/54 passing, zero regressions) plus its own canonical test
(`backend/supabase/migration_188_external_channel_guest_access_tests.sql`), which directly asserts a
guest accepting their invite produces zero `workspace_members` rows and is fully isolated from every
other channel, the section channel, and unrelated tables. — *Migration applied and canonical test
PASSED in production (E confirmed, 2026-09-20, "Success. No rows returned" for both).* **Do not run
migration 188 or its canonical test again.** File promotion (a room owner moving a guest-uploaded file
into the project's permanent document store) and the read-state/@mention notification system (design
doc's own Phase 2) are deliberately not part of this migration. **The matching frontend — guest invite
UI for internal staff, the guest's own accept-invite landing page, and a minimal guest-only app shell —
is not yet built; this is the next active workstream.**

**Migration 175** (`backend/supabase/migrations/175_team_members_workspace_scoping.sql`, commit
`6db3148`) — adds a real `workspace_id` to `team_members` (root staff-directory table, no FK anywhere —
the table §5a called out by name: "any future second-workspace user could read every other company's
entire staff list"), converts the email-uniqueness index to per-workspace, rewrites RLS to gate
read/write on workspace membership. Canonical test:
`backend/supabase/migration_175_team_members_workspace_scoping_tests.sql`. Independently verified
end-to-end against a real local PostgreSQL 18 engine (PGlite) before being handed to E; migration and
test both passed unmodified. — *Migration applied and canonical test PASSED in production (E confirmed,
2026-09-19, "Success. No rows returned" for both).* **Do not run migration 175 or its canonical test
again.**

**Migration 176** (`.../176_product_catalog_workspace_scoping.sql`, commit `3912b92`) —
workspace-scopes `product_catalog` (`catalog_number` uniqueness becomes per-workspace, same pattern as
migration 164's uniqueness batch) and derives `catalog_price_change_requests.workspace_id` from its
mandatory parent via a new dedicated guard trigger. Canonical test:
`..._176_product_catalog_workspace_scoping_tests.sql`. One test-file bug found and fixed during
verification (the simulated JWT was missing the email claim the table's own RLS policies check) —
migration itself needed no changes. — *Migration applied and canonical test PASSED in production (E
confirmed, 2026-09-19, "Success. No rows returned" for both).* **Do not run migration 176 or its
canonical test again.**

**Migration 177** (`.../177_remaining_global_config_workspace_scoping.sql`, commit `7e99325`) —
extends E's migration-173 ruling ("each company should have its own separate copies, this should not
be a question") to `presales_hardware_rules`, `site_hardware_rules`, `form_schemas` + mandatory child
`form_schema_fields` — the exact reconsideration §5a flagged these three for. Also fixes
`derive_deletion_log_workspace_id()`'s stale "genuinely global" classification of these entity types,
the same class of gap migration 173 fixed for `schedule_template_phase`. Canonical test:
`..._177_remaining_global_config_workspace_scoping_tests.sql`. Two test-file bugs found and fixed
during verification (`site_hardware_rules.metric`'s real CHECK constraint rejected the test's
placeholder value; `form_schemas`/`form_schema_fields` column names in the test didn't match the real
schema — `name` vs `title`, `label`/`sequence_order` vs `field_label`/`display_order`) — migration
itself needed no changes. — *Migration applied and canonical test PASSED in production (E confirmed,
2026-09-19, "Success. No rows returned" for both).* **Do not run migration 177 or its canonical test
again.**

**Migration 178** (`.../178_one_off_reconciliations_workspace_scoping.sql`, commit `bbe014d`) — adds
`workspace_id` to `one_off_reconciliations` (a flat, anchor-less inventory-merge audit log, previously
readable/writable by any authenticated user regardless of company). Canonical test:
`..._178_one_off_reconciliations_workspace_scoping_tests.sql`. Verification exercised the backfill
UPDATE against a real pre-existing null-workspace row; migration and test both passed unmodified. — *Migration
applied and canonical test PASSED in production (E confirmed, 2026-09-19, "Success. No rows returned"
for both).* **Do not run migration 178 or its canonical test again.**

**Migration 179** (`.../179_safe_storage_buckets_workspace_containment.sql`, commit `2be689d`) —
closes 3 of the 6 storage buckets §5a flagged as open: `project-location-images`,
`project-shipment-photos`, `avatars`, chosen because each anchors to a real, non-colliding UUID path
segment with a workspace-resolver pattern already proven safe by migrations 161/162/169. The other 3
open buckets (`project-documents`, `catalog-datasheets`, `company-branding`) are deliberately NOT
included — see §5a for why. **Depended on migration 175 being applied first**
(`team_members.workspace_id`) — E ran 175 before 179 as required. Canonical test:
`..._179_safe_storage_buckets_workspace_containment_tests.sql`. Verified with a mocked
`storage.objects` in PGlite, migration 175 applied first in the reconstructed schema; migration and
test both passed unmodified. — *Migration applied and canonical test PASSED in production (E confirmed,
2026-09-19, "Success. No rows returned" for both).* **Do not run migration 179 or its canonical test
again.**

**Migration 174** (`backend/supabase/migrations/174_fix_ref_counters_rls_gap.sql`, commit `1608ad8`) —
URGENT LIVE GAP, found while inventorying the schema for the item below. Migration 164 (this session)
gave `sales_quote_ref_counters`/`project_ref_counters` a real `workspace_id` and composite
`(workspace_id, year)` primary key, but never touched their RLS policy — still the original fully-open
`using(true)/with check(true) for all` from migrations 066/067. Any authenticated user, any workspace,
could read/insert/update/delete any other workspace's ref-counter row, including forging another
workspace's `next_seq`. Fixed by scoping SELECT to workspace membership and removing the write policy
entirely (the only legitimate writers, `assign_sales_quote_ref()`/`assign_project_ref()`, are `security
definer` and bypass RLS anyway — confirmed via grep that `src/persistence.ts` never writes to either
table directly). Canonical test: `backend/supabase/migration_174_fix_ref_counters_rls_gap_tests.sql`.
Independently verified end-to-end against a real local PostgreSQL 18 engine (PGlite): reproduced all
four exploitable operations pre-fix, confirmed closed post-fix, confirmed the real write path
unaffected. One test-script bug found and fixed during verification: Section 2's UPDATE/DELETE checks
used exception-catching, but RLS's USING clause silently returns zero rows on a blocked UPDATE/DELETE
rather than raising. — *Migration applied and canonical test PASSED in production (E confirmed,
2026-09-19, "Success. No rows returned" for both).* **Do not run migration 174 or its canonical test
again.**

## 5a. Final Phase 3 milestone — full cross-workspace isolation suite: ESSENTIALLY CLOSED as of
migrations 175-185 confirmed applied; only test-rigor items remain (2026-09-19)

A complete schema inventory (triggered by scoping migration 174) found this milestone — "the full
automated cross-workspace isolation suite and final Phase 3 reconciliation," the formal gate before a
second real workspace may ever be created (§6) — considerably larger and more decision-dependent than a
single migration. Migrations 175-185 (§5), all now CONFIRMED APPLIED and canonical-test-passed in
production, close every mechanical AND decision-dependent gap that inventory originally flagged.
**This milestone is now essentially closed** — what remains below is a narrow, genuinely non-urgent
test-rigor item, not a scoping or product decision.

- **Already done, no further work needed**: 25+ tables with a real `workspace_id` all have a dedicated
  cross-workspace test from the migration that scoped them (migrations 115–173); roughly 25 more
  resolver-scoped child tables are also already tested; 12+ `security definer` RPCs already have
  behavioral cross-workspace-rejection tests.
- **Closed by migrations 175-179 (CONFIRMED APPLIED and canonical tests PASSED in production,
  2026-09-19, see §5)**: `team_members`, `product_catalog`/`catalog_price_change_requests`,
  `presales_hardware_rules`/`site_hardware_rules`/`form_schemas`/`form_schema_fields`,
  `one_off_reconciliations`, and 3 of the 6 open storage buckets (`project-location-images`,
  `project-shipment-photos`, `avatars`; the other 3 of the original 9 — `purchase-order-files`,
  `message-attachments`, `sales-quote-images` — were fixed earlier this session).
- **Closed by migrations 180-185 (CONFIRMED APPLIED and canonical tests PASSED in production,
  2026-09-19, see §5)**: `project-documents`/`catalog-datasheets` storage.objects (migration 180 —
  dual-match RLS off the real anchor row id for new uploads, legacy sanitized-name matching preserved
  for existing files, a dormant residual collision risk for pre-fix uploads E explicitly accepted);
  `user_invites`, including a real `accept_invite()` → `workspace_members` insert (migration 181);
  `company_branding`, converted from a global singleton to one row per workspace (migration 182);
  `app_records`/`app_state_snapshots`, the last fully-open tables in the schema (migration 183); a
  separately-discovered missing `catalog-datasheets` bucket that meant datasheet uploads had likely
  never worked at all (migration 184); and per-workspace admin authorization additively OR'd into 9
  admin-gated policies across the tables above plus `product_catalog`/`catalog_price_change_requests`/
  `presales_hardware_rules`/`site_hardware_rules`/`form_schemas`/`form_schema_fields` (migration 185,
  plus its frontend companion).
- **3 RPCs verified only structurally, not behaviorally**: `re_enable_share_link`,
  `permanently_revoke_share_link`, `create_and_send_quote_proposal_version` — a test-rigor opportunity,
  not urgent, the one item left open from this whole inventory.
- **Confirmed correctly OUT of scope, no action needed**: `app_role_modes` (dead/vestigial, zero app
  code references — corrects this section's own earlier listing of it as an open gap) and the
  system-health/backup RPC family (`record_system_health_event`, `acknowledge_system_health_event`,
  `resolve_system_health_event`, and the 3 backup/restore RPCs
  `start_or_resume_restore_run`/`finalize_restore_run`/`cancel_restore_run`) — genuinely
  platform-admin-gated by design, operating on whole-database/platform state rather than per-tenant
  rows, not workspace data.
- **Test-suite infrastructure**: every canonical test file (52 as of migration 185) is scoped to a
  single migration; a consolidated cross-cutting suite replaying all migrations together (§11 stage 6's
  own gate) is in progress as a separate, concurrent piece of work — see recent commits for current
  status, not claimed done here.

**Migration 172** (`backend/supabase/migrations/172_inventory_item_equipment_type_atomic_delete_and_log.sql`,
commit `0abe68b`) — closes migration 166's one residual gap: `inventory_item`/`equipment_type` are the
only two `deletion_log` entity types genuinely hard-deleted, so their log row's `workspace_id` stayed
null forever. Three new atomic RPCs (`delete_inventory_item_and_log`/`force_delete_inventory_item_and_log`/
`delete_equipment_type_and_log`) capture `workspace_id` from the row before deleting it, in the same
transaction, preserving every existing client behavior exactly. Also fixes a load-bearing correctness
gap: since migration 164 made `sku`/`equipment_name` uniqueness workspace-scoped, two workspaces can
now share an identical value, so these RPCs' internal lookups are explicitly scoped to the caller's own
workspace. Canonical test:
`backend/supabase/migration_172_inventory_item_equipment_type_atomic_delete_and_log_tests.sql`.
Independently verified end-to-end against a real local PostgreSQL 18 engine (PGlite). — *Migration
applied and canonical test PASSED in production (E confirmed, 2026-09-18, "Success. No rows returned"
for both).*

**Real process mistake this session, worth recording**: the matching `src/persistence.ts` commit
(`5a5f919`) was committed with the explicit intent to hold it back until this migration was confirmed
applied — but `git push` sends every commit ahead of `origin/main`, not just the one just created, so it
went out anyway with a later, unrelated doc-reconciliation push, deploying it BEFORE E had run migration
172. This meant a real window where every inventory-item/equipment-type delete attempt in the live app
would have failed (the RPC didn't exist yet in the database) — no data was corrupted, but it's a genuine
live-functionality gap, caught only after the fact by checking the deployed bundle hash and grepping it
for the new RPC name. The app is back in a consistent, working state as of 2026-09-18 (migration
confirmed applied, deployed frontend already matches it). **Do not run migration 172 or its canonical
test again.**

**`build_transaction`'s deletion-log bug — FIXED, no migration needed (commit `e56c696`).**
`deleteBuildTransaction()` was sending `build_number` ("BUILD-0001", this table's natural key in the
app layer, never a raw uuid) as `deletion_log.entity_id`, a `uuid not null` column — PostgREST silently
rejected every such insert before it reached Postgres, so every `build_transaction` deletion had been
failing to log at all. Fixed by using the real row `id` already present in the PATCH's own
`return=representation` response — pure frontend fix, no backend schema change. Side effect: migration
166's `derive_deletion_log_workspace_id()` already resolves `'build_transaction'` via the row's real
`id` — that branch was simply unreachable before; with a real id now, this entity type's log rows are
correctly workspace-scoped automatically. Deployed and confirmed live (bundle hash changed, zero
console errors on load).

**Migration 171** (`backend/supabase/migrations/171_revoke_stray_anon_grants_mvp_leftovers.sql`, commit
`96bc949`) — hygiene item, not workspace containment. `app_sync_events`/`app_transaction_locks`
(migration 008) both had a full-access `anon` policy pair each, "during no-login MVP" — any
unauthenticated caller could read/write/delete arbitrary rows in both, with no legitimate caller for as
long as this app has had real authentication. Migration 069 separately granted `anon` EXECUTE on
`acquire_transaction_lock()` — same fix. **Correction to this doc's own earlier "looks dead, confirm
before dropping" note (§11)**: `app_sync_events` is NOT dead — still written on every `roleMode`
change, just carrying a single trivial UI preference now that real business data moved to normalized
tables ("Phase 10f"); not dropped. Canonical test:
`backend/supabase/migration_171_revoke_stray_anon_grants_mvp_leftovers_tests.sql`. Independently
verified against a real local PostgreSQL 18 engine (PGlite), and the verification itself caught two
real bugs: testing read-denial via "did an exception get raised" is wrong for a bare SELECT under RLS
(a blocked SELECT silently returns zero rows, never raises — fixed via a row-count check against a real
fixture row); and Postgres grants EXECUTE to the `PUBLIC` pseudo-role automatically on function
creation, so revoking `anon`'s own grant alone left `acquire_transaction_lock()` still callable via
`PUBLIC` (migration 069 never revoked that default) — fixed by revoking from `PUBLIC` outright. — *Migration
applied and canonical test PASSED in production (E confirmed, 2026-09-18, "Success. No rows returned"
for both).* **Do not run migration 171 or its canonical test again.**

**Migration 170** (`backend/supabase/migrations/170_fix_project_documents_upload_and_workspace_containment.sql`,
commit `9a1ff1e`) — URGENT LIVE INCIDENT, found while continuing the `project_documents.document_number`
task (the one column migration 164 deliberately excluded, no `workspace_id` on this table at all).
`project_documents` has three nullable anchors (`project_id`/`purchase_order_id`/`purchase_request_id`)
scoped only indirectly via a three-way coalesce (migration 161). Confirmed from `src/persistence.ts`:
`project_id` is effectively dead for new rows, and a plain "general project document" (migration 080's
own header: "most documents ... link to neither") sets neither PO nor PR — so the app's own MOST COMMON
document-upload case made the coalesce resolve to null, and migration 161's INSERT policy rejected the
insert outright. **Every general project document upload attempted since migration 161 went live
(2026-09-17) had almost certainly been failing.** Confirmed empirically against a real local PostgreSQL
18 engine (PGlite): reproduced the exact rejection under the pre-170 policy, confirmed resolved
afterward. Fixed by giving `project_documents` a real `workspace_id` column with a derivation trigger
modeled on migration 162's `guard_channel_workspace_id_mutation()` — prefer whichever anchor is set,
fall back to the caller's own resolved workspace when none are set. RLS switched to a plain
`workspace_id` check; a cross-workspace anchor reference is still correctly rejected. Also closes the
original goal: `document_number`'s global unique constraint is now `(workspace_id, document_number)`.
Canonical test: `backend/supabase/migration_170_fix_project_documents_upload_and_workspace_containment_tests.sql`.
— *Migration applied and canonical test PASSED in production (E confirmed, 2026-09-18, "Success. No
rows returned" for both).* **Do not run migration 170 or its canonical test again.**

**Migration 169** (`backend/supabase/migrations/169_sales_quote_images_storage_containment.sql`, commit
`dfbbba1`) — Phase 3 Stage 5, fifth migration. Closed the last genuine storage-bucket gap:
`sales-quote-images`' four `storage.objects` policies (migration 033, never touched since) were bare
`bucket_id = 'sales-quote-images'` with no further predicate — fully open to any authenticated user in
any workspace. Fixed by matching the storage path's leading segment (`quote_location_id`) against
`public.sales_quote_locations` directly (the PARENT entity, existing before any upload) via
`sales_quote_location_owner_workspace_id()`, deliberately NOT through the per-file
`sales_quote_location_images` row — avoiding a repeat of migration 161/168's exact chicken-and-egg bug.
Canonical test: `backend/supabase/migration_169_sales_quote_images_storage_containment_tests.sql`.
Independently verified end-to-end against a real local PostgreSQL 18 engine (PGlite): confirmed the
pre-fix policy is genuinely fully open, confirmed the fix preserves the real upload order while
rejecting cross-workspace/nonexistent-location uploads. — *Migration applied and canonical test PASSED
in production (E confirmed, 2026-09-18, "Success. No rows returned" for both).* **All three storage
buckets originally flagged for Stage 5 are now correctly workspace-scoped. Do not run migration 169 or
its canonical test again.**

**Migration 168** (`backend/supabase/migrations/168_fix_purchase_order_files_storage_upload_bug.sql`,
commit `e4fcbc3`) — URGENT LIVE INCIDENT, found while scoping the storage-bucket item below. Migration
161's `purchase-order-files` storage.objects INSERT/UPDATE policies required a matching
`purchase_order_files` row to already exist (exact match on `storage_path`) before an upload could
succeed, but the real upload flow (`addPurchaseOrderFile()`, `src/persistence.ts:9931-9960`) uploads
the file bytes to Storage FIRST and only inserts the metadata row afterward — every purchase order file
upload attempted since migration 161 went live (2026-09-17) had almost certainly been silently failing.
Confirmed empirically against a real local PostgreSQL 18 engine (PGlite): reproduced the exact
rejection under the pre-168 policy, confirmed resolved after the fix. Fixed by matching the
`purchase_order_id` leading path segment directly against `public.purchase_orders` (same pattern
already correct in migration 162 for channel message-attachments), not through the per-file metadata
row. Migration 161 itself not edited or rerun. Canonical test:
`backend/supabase/migration_168_fix_purchase_order_files_storage_upload_bug_tests.sql`. — *Migration
applied and canonical test PASSED in production (E confirmed, 2026-09-18, "Success. No rows returned"
for both).* **Do not run migration 168 or its canonical test again.**

**Correction to the storage-bucket scoping item below**: of the three buckets flagged as "deferred,
never claimed," only `sales-quote-images` is actually still unaddressed — `purchase-order-files`
(migration 161) and `message-attachments`'s channel-specific policies (migration 162) were already
correctly workspace-scoped on direct re-check.

**Migration 167** (`backend/supabase/migrations/167_report_views_workspace_containment.sql`, commit
`45302d8`) — Phase 3 Stage 5, fourth migration. Closed a CONFIRMED, LIVE, anon-exploitable
cross-workspace data leak in the three report views (`report_inventory_on_hand`/
`report_project_inventory_usage`/`report_purchase_order_status`, migration 001, never touched since):
owned by `postgres` with no `security_invoker`, bypassing RLS entirely, and `anon` (fully
unauthenticated) had SELECT on all three — confirmed directly against production via a live-database
diagnostic query, 2026-09-18. Fixed with `security_invoker = true` on all three plus revoking `anon`
SELECT outright, no view-body rewrite needed (each view INNER JOINs at least one already
workspace-scoped table, which alone forces containment). Canonical test:
`backend/supabase/migration_167_report_views_workspace_containment_tests.sql`. Independently verified
end-to-end against a real local PostgreSQL 18 engine (PGlite), including a negative control and a
deeper read-only probe confirming genuine row-level leakage pre-fix. — *Migration applied and canonical
test PASSED in production (E confirmed, 2026-09-18, "Success. No rows returned" for both).* **Do not
run migration 167 or its canonical test again.**

**Migration 166** (`backend/supabase/migrations/166_deletion_log_workspace_containment.sql`, commit
`df4bed6`) — Phase 3 Stage 5, third migration. Closes `deletion_log`'s confirmed live cross-workspace
leak (no `workspace_id`, fully open `using(true)` SELECT policy). Adds `workspace_id` (nullable by
design, not transitional) plus a BEFORE INSERT trigger dispatching across the 21 real `entity_type`
literals actually written by `src/persistence.ts` (verified by direct grep, not the migration 088
comment's own incomplete summary): 17 resolve via existing resolvers/direct columns; 4 are confirmed
genuinely global (`schedule_template_phase`, `form_schema_field`, `presales_hardware_rule`,
`site_hardware_rule`) and stay visible to everyone by design; an unrecognized entity_type is rejected
outright (fail closed). SELECT policy uses `is_workspace_member()` (migration 115), not
`resolve_caller_workspace_id()` (unsafe in a bare RLS clause — raises on ambiguous/missing membership).
**Deliberately NOT closed at the time**: `inventory_item`/`equipment_type` were hard-deleted before the
log write happened, so a trigger couldn't resolve their workspace after the fact — closed later by
migration 172 (see §3). Also found, unrelated, pre-existing: `build_transaction` deletion-log writes
appear to have been silently failing already (non-uuid `entity_id`) — fixed later the same session, no
migration needed (commit `e56c696`, see §3).
Canonical test: `backend/supabase/migration_166_deletion_log_workspace_containment_tests.sql`.
Independently verified end-to-end against a real local PostgreSQL 18 engine (PGlite) before being sent,
including a deliberate stress-test confirming this migration is NOT exposed to the same
missing-`security definer` bug class that caused the migration 164/165 incident. — *Migration applied
and canonical test PASSED in production (E confirmed, 2026-09-18, "Success. No rows returned" for
both).* **Do not run migration 166 or its canonical test again.**

**Migration 164**
(`backend/supabase/migrations/164_phase3_stage5_workspace_scoped_uniqueness_and_ref_counters.sql`,
commit `7ed52b2`) — Phase 3 Stage 5, second migration. Closes the workspace-scoped-uniqueness gap: nine
columns across seven already-workspace-scoped tables (`clients.name`, `projects.project_name`/
`project_number`, `vendors.name`, `inventory_items.sku`, `purchase_orders.po_number`,
`purchase_requests.request_number`, `sales_quotes.quote_ref`, `equipment_types.equipment_name`) still
carried a GLOBAL unique constraint/index from their origin migration — swapped for a composite
`(workspace_id, <column>)` equivalent, no backfill or trigger work needed (every table's `workspace_id`
is already NOT NULL and trigger-protected). Also re-keys `sales_quote_ref_counters`/
`project_ref_counters` from year-only to `(workspace_id, year)`, rewriting `assign_sales_quote_ref()`/
`assign_project_ref()` to resolve the caller's own workspace directly rather than trust
`new.workspace_id` (BEFORE INSERT triggers on the same table as `guard_workspace_id_mutation()`, which
fires alphabetically AFTER `..._assign_ref`, so `workspace_id` is not yet set when it runs).
`save_equipment_recipe()` carried forward verbatim (migration 159) with its two hardcoded
`unique_violation` constraint-name checks updated to match the renamed `equipment_types` index.
Canonical test: `backend/supabase/migration_164_phase3_stage5_workspace_scoped_uniqueness_and_ref_counters_tests.sql`.
— *Migration applied and canonical test PASSED in production (E confirmed, 2026-09-18, after migration
165's same-day fix below).*

**Migration 165** (`backend/supabase/migrations/165_fix_ref_assign_trigger_grants.sql`, commit
`2f5d4f8`) — same-day fix for a LIVE INCIDENT migration 164's own canonical test surfaced on its first
real run: `ERROR: 42501: permission denied for function resolve_caller_workspace_id`, on the test's
very first ordinary project insert. Since neither `sales_quotes` nor `projects` inserts ever supply an
explicit ref, this meant every real project/sales-quote creation in production broke the moment
migration 164 went live, not just the test. Root cause (confirmed directly from migration 117's own
header comment): `resolve_caller_workspace_id()` deliberately has EXECUTE revoked from everyone and is
only ever meant to be called from inside another `security definer` function — migration 164's
rewritten `assign_sales_quote_ref()`/`assign_project_ref()` were the only consumers of it in the whole
codebase left as plain invoker-rights functions. The PGlite sandbox verification did not catch this
because its own default-privilege replication does not precisely reproduce this specific revoke
boundary — the same class of sandbox-vs-production gap already seen once before this session
(migrations 140/142). Fixed by redefining both functions again with `security definer` added, no other
logic changes, migration 164 itself untouched. — *Migration applied and migration 164's canonical test,
re-run afterward, PASSED cleanly (E confirmed, 2026-09-18).* **Phase 3 Stage 5's workspace-scoped
uniqueness and ref-counter work is now fully shipped end-to-end. Do not run migrations 164/165 or
migration 164's canonical test again.**

**Separately, a new feature request from E, NOT part of Phase 3**: `conversations`/`direct_messages`
should support more than two participants, Slack/Teams-style (currently a fixed
`participant_a_id`/`participant_b_id` pair). This needs its own schema redesign (a real membership
table in place of the fixed pair) plus frontend UI work — tracked here, not scoped or scheduled yet.

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
3. **Purchasing, inventory, vendors, warehouses, and receiving — DONE.** Ownership migration 159
   (`f9a5d33`) adds `workspace_id` to the seven root tables (`vendors`, `locations`, `inventory_items`,
   `purchase_orders`, `purchase_requests`, `equipment_types`, `build_transactions`) and retires
   `save_equipment_recipe()`'s `active_workspace_id()` guard. RLS migration 160 (`df341ab`) adds
   workspace-scoped RLS to all seven root tables plus their ten children
   (`purchase_order_lines`/`_files`/`_receipts`/`_holds`, `inventory_balances`,
   `inventory_movements`, `inventory_transactions`, `project_inventory_allocations`,
   `project_allocation_history`, `equipment_bom_components`, all inheriting ownership through their FK
   via three new resolver functions), preserving every migration-023 role gate alongside the new
   workspace predicate. Both migrations CONFIRMED APPLIED and their canonical tests PASSED in
   production, 2026-09-17. Deliberately excluded on inspection (topical match, not FK-graph
   inclusion): the four `project_shipment*`/`_shipping_addresses` tables, re-scoped from this stage to
   Stage 4 (Documents/Notifications) after direct read showed they carry no purchasing/inventory data
   of their own; `purchase_order_files`' storage.objects bucket policies (Stage 4 territory, storage).
4. **Documents, notifications, channels, jobs, share-link records, and storage — DONE.** Full research
   pass complete (repo-wide read of all 160 migrations);
   confirmed by direct grep that **zero tables in this entire domain have `workspace_id` today** (only
   117/156/159 ever add the column, anywhere in the repo). Findings by sub-area:
   - **Documents** — `project_documents` has THREE nullable FK anchors (`project_id`,
     `purchase_order_id`, `purchase_request_id`, no combination guaranteed non-null), resolved via a
     coalesce resolver, same shape as migration 160's `inventory_transactions`. `sales_quote_extractions`
     anchors two hops out via `project_document_id → project_documents`, resolved via a new
     `project_document_owner_workspace_id()` helper. Both still no role gate (migration 023
     deliberately left `project_documents` un-role-gated), preserved. **Migration 161 (`d42190b`)
     CONFIRMED APPLIED and its canonical test PASSED in production, 2026-09-17.**
   - **Shipping/shipments** — `project_shipping_addresses`, `project_shipments`,
     `project_shipment_lines`, `project_shipment_photos` (all from migration 072) were re-scoped from
     Stage 3 to here by migrations 159/160's own headers; confirmed correct by direct read — all four
     anchor cleanly to `projects` (directly or via `project_shipments`), zero purchasing/inventory FKs
     of their own. **Migration 161, same as above.**
   - **Share-link table containment** — confirmed a real gap while scoping: migration 158 hardened the
     RPC layer, but `public_share_tokens`/`share_link_views`/`share_link_actions` themselves still had
     bare `using(true)` SELECT policies (any authenticated user in any workspace could read every other
     workspace's share-link rows) and `workspace_share_link_settings` had an unscoped read policy plus
     an admin-gated-not-workspace-gated write policy. **Migration 161 closed this**, reusing migration
     158's own `share_link_entity_workspace_id()` helper directly — no new resolver needed.
   - **`purchase_order_files`' storage bucket** — the TABLE got workspace RLS in migration 160, but its
     underlying `purchase-order-files` storage bucket's object policies (`storage.objects`) were
     explicitly deferred to Stage 4 by migration 160's own header. **Migration 161 closed this** too,
     joining `storage.objects.name` against the real `purchase_order_files.storage_path` row (confirmed
     exact-match, not prefix-based, by reading `src/persistence.ts`'s actual upload code before writing
     the policy).
   - **Notifications** — `notification_rules` is very likely **actually Stage 5's job, not Stage 4's**:
     it's a global, admin-configured event-type whitelist with no per-row tenant data at all (same
     shape as `standard_install_times`/`project_schedule_templates`, both already excluded from
     Stage 2 for the identical reason) — migration 156's own header flagged this overlap explicitly.
     `notifications` has NO anchor at all (`recipient_email` is plain text, `related_entity_type`/
     `related_entity_id` is a polymorphic pair with no FK) — direct INSERT is already closed to
     `authenticated` since migration 114 (service-role API route only), so real containment here would
     mean hardening that API route, not an RLS/column migration. `notification_deliveries` inherits the
     same anchor gap and is still fully open (read+insert) RLS. `push_subscriptions` has no workspace
     concept and needs none (a device subscription keyed to `auth.uid()` alone) — correctly self-scoped
     already, not a to-do. **Recommend confirming with E whether `notification_rules` moves to Stage 5
     before scoping the rest of Notifications** — everything else in this bullet is unblocked either
     way.
   - **Messaging channels ("channels," second meaning — a Slack-replacement feature, migrations
     094/100-105/112/113)** — **RESOLVED, 2026-09-17: E decided per-workspace** (each workspace gets
     its own copy of the 4 section channels and its own group channels, not a shared global set).
     `channels.type` is `section | project | client | group`: `project`/`client` types anchor cleanly
     (to `projects`/`clients`, both workspace-scoped already); `section`/`group` types have no anchor
     of any kind, so `channels` gets a genuine `workspace_id` column (unlike every other Stage 4
     table) rather than a resolver. **Migration 162 (`862aa75`) CONFIRMED APPLIED and its canonical
     test PASSED in production, 2026-09-17.** Two pre-existing gaps found in passing, NOT fixed by
     this migration (a different authorization dimension than workspace containment, correctly
     deferred for their own review at the time) -- **both closed 2026-09-22, E approved.**
     `channel_canvas`'s SELECT/INSERT/UPDATE never got the same private-group `channel_members`
     check `channel_messages` already enforces (not literally `using(true)` by this point --
     migration 162 itself had already workspace-scoped it -- the real gap was narrower: any
     workspace member could read/edit a *private group's* canvas without being a member of that
     specific channel). **Migration 193 (`channel_canvas_private_group_scoping`) closes this** by
     mirroring `channel_messages`' own predicate exactly. `channel_members`' INSERT/DELETE had no
     gate beyond workspace membership at all -- any workspace member could add/remove any other
     member from any group channel. **Migration 194 (`channel_members_manage_authorization`)
     closes this**, reusing migration 188's existing `channel_guest_manage_authorized()` helper
     (admin/workspace-admin/PM/channel-creator) rather than inventing a second permission model for
     the same class of decision -- SELECT is untouched (membership lists stay broadly workspace-
     readable, unchanged). Both migrations PGlite-verified against the full 001-194 consolidated
     isolation suite (60/60 canonical tests passing) and their own new canonical test files; **not
     yet applied to production -- kept local for E's review**, same as every other migration in
     this repo before E runs it in Supabase Studio.
   - **`conversations`/`direct_messages` (private 1:1 DMs, migrations 094/100 — distinct from
     `channels`)** — **RESOLVED, 2026-09-17: E decided these stay cross-workspace** (personal
     messaging, not tenant data) — no migration needed, this table is correctly left exactly as-is.
     **Separately, E asked for DMs to support more than two participants, Slack/Teams-style** — a real,
     separate feature (the fixed `participant_a_id`/`participant_b_id` pair on `conversations` would
     need to become a real membership table, plus frontend UI work), not a workspace-scoping question.
     Tracked as its own item, not part of Phase 3 — not scoped or scheduled yet.
   - **Share-link records** (`public_share_tokens`, `share_link_views`, `share_link_actions`,
     migrations 025/053/137, RPC containment already added by migration 158) — confirms the gap
     migration 158 always documented as out of scope: the RPC layer has real per-call workspace
     containment now, but **the underlying tables themselves still have zero `workspace_id` and zero
     workspace-aware RLS.** Concretely: `public_share_tokens`' SELECT policy (the only policy left on
     it since migration 144 closed direct writes) is `using(true)` with no workspace filter — any
     authenticated user, in any workspace, can currently read every OTHER workspace's share-token rows
     via a raw REST select (status, entity_id, disable/revoke reasons, etc.). Same gap on
     `share_link_views`/`share_link_actions`' own `using(true)` read policies.
     `workspace_share_link_settings` already has `workspace_id` as its PK (from migration 137) but its
     own read policy has no workspace filter either, and its write policy is `is_app_admin()`-gated,
     not workspace-gated. **Not blocked on a product decision** — this is a straightforward containment
     fix (add a resolver + tighten these SELECT/write policies), the same class of work as every prior
     stage, just deferred until now because it needed this table-by-table inventory to see clearly.
   - **Storage buckets** — 9 total (`project-documents`, `sales-quote-images`, `catalog-datasheets`,
     `company-branding`, `project-location-images`, `project-shipment-photos`, `purchase-order-files`,
     `message-attachments`, `avatars`); confirmed NONE have any workspace check today (role/auth/entity-
     visibility checks only). `message-attachments`' policies are correctly scoped to
     conversation/channel visibility already (not workspace, by design, matching the DM/channel
     question above); the rest would need workspace-aware object policies once their owning tables are
     scoped. **Not blocked**, but naturally sequenced after each bucket's owning table.
   - **"Jobs"** — confirmed via repo-wide grep: **no job queue, cron table, or webhook log exists
     anywhere in this codebase.** If Stage 4 planning assumed one, that assumption is corrected here —
     there is nothing to migrate under this name.
   - **Cross-cutting note, not owned by this stage**: `deletion_log` (migration 088) is a polymorphic
     audit table (`entity_type text, entity_id uuid`, no FK) logging deletions from several
     Stage-4-adjacent tables among ~10 others — same "no anchor, no workspace check" shape as
     `notifications`. Flag for a decision on whether Stage 4 or a later cross-cutting pass resolves it.
     `app_sync_events`/`app_transaction_locks` (migration 008) are pre-`workspaces`-feature MVP
     leftovers keyed on a plain string, not the real `workspaces.id` — a cleanup item, not part of this
     stage's containment work.
   - `active_workspace_id()` confirmed fully retired from this entire domain — no new call sites
     anywhere in Documents/Notifications/Channels/Jobs/Share-links/Storage.
5. **Workspace-scoped uniqueness, reports, aggregates, functions, triggers, and remaining indirect
   access paths — DONE.** Full scoping pass complete (repo-wide read of all 162 migrations,
   tracing every table/function to its current live definition, not just its origin migration).
   Findings, in priority order:
   - **RPC containment gaps — DONE.** `replace_project_bom_lines()`, `respond_to_proposal_question()`,
     `submit_proposal_question()`, all three real, confirmed cross-workspace access gaps missed by
     earlier hardening passes because they live outside those passes' file clusters. **Migration 163
     (`88fa65b`) closes all three — CONFIRMED APPLIED and its canonical test PASSED in production,
     2026-09-18.**
   - **Workspace-scoped uniqueness — DONE.** Global `unique` constraints on tables that already have
     real `workspace_id`, never previously flagged: `clients.name`, `projects.project_name`/
     `project_number`, `vendors.name`, `inventory_items.sku`, `purchase_orders.po_number`,
     `purchase_requests.request_number`. Plus two already partially flagged: `sales_quotes.quote_ref`
     and `equipment_types.equipment_name` (both named as "Stage 5's job" by migrations 159/160 at the
     time). **Migration 164 (`7ed52b2`) closes all nine columns, landed together with the ref-counter
     fix below** since `quote_ref`/`project_number` are both generated FROM those counters. **CONFIRMED
     APPLIED and its canonical test PASSED in production, 2026-09-18** (after migration 165's same-day
     fix for a live incident the test itself surfaced — see §4). `project_documents.document_number` and
     `equipment_types.equipment_number` are deliberately excluded — see §4 for why.
   - **`sales_quote_ref_counters`/`project_ref_counters` (migrations 066/067) — DONE, same migration as
     above.** Confirmed genuinely global, keyed by calendar year only (`year primary key, next_seq`),
     consumed by `assign_sales_quote_ref()`/`assign_project_ref()` (the latter redefined in 128).
     Already flagged as Stage 5's job by migrations 155/156's own "Deliberately NOT done" sections.
     Migration 164 makes both `(workspace_id, year)` keyed and rewrites both consuming functions to
     resolve the caller's own workspace directly — migration 165 then added `security definer` to both
     (required for them to call `resolve_caller_workspace_id()` at all, per its own access-control
     design; missed in migration 164, found immediately by its own canonical test).
   - **`project_documents.document_number` — DONE, and surfaced a live incident.** This table had NO
     `workspace_id` column at all (three nullable FK anchors — `project_id`/`purchase_order_id`/
     `purchase_request_id` — scoped only indirectly, at query time, via
     `project_document_owner_workspace_id()`, migration 161). Scoping this properly found that
     migration 161's own INSERT policy rejected the app's own most common document-upload case (a
     general project document with no PO/PR link) outright, since all three anchors resolve to null for
     that case — **every such upload attempted since migration 161 went live (2026-09-17) had almost
     certainly been failing.** **Migration 170 (`9a1ff1e`) closes both** — a real `workspace_id` column
     with a derivation trigger (prefer whichever anchor is set, fall back to the caller's own resolved
     workspace when none are set) fixes the incident and makes `document_number`'s uniqueness
     constraint composite `(workspace_id, document_number)`. CONFIRMED APPLIED and its canonical test
     PASSED in production, 2026-09-18.
   - **Report views — DONE.** `report_inventory_on_hand`, `report_project_inventory_usage`,
     `report_purchase_order_status` (all three from migration 001, never touched since). The suspected
     leak was **confirmed live and worse than expected** via a live-database diagnostic E ran directly
     against production, 2026-09-18: all three owned by `postgres` with no `security_invoker`
     (bypassing RLS entirely), and `anon` (fully unauthenticated) had SELECT on all three, not just
     `authenticated` — genuinely exploitable without logging in. **Migration 167 (`45302d8`) closes
     this — CONFIRMED APPLIED and its canonical test PASSED in production, 2026-09-18.** Fixed with
     `security_invoker = true` (no view-body rewrite needed, each view INNER JOINs an already
     workspace-scoped table) plus revoking `anon` SELECT outright.
   - **`deletion_log` — DONE.** Polymorphic audit table (`entity_type text, entity_id uuid`, no FK, no
     anchor), previously fully open RLS (`using(true)`/`with check(true)` for both read and insert),
     confirmed still actively written to (migrations 098/112 both extend the same soft-delete-logging
     pattern) across 21 real entity types (verified by grep of every `logDeletionEvent()` call site).
     **Migration 166 (`df4bed6`) closes this — CONFIRMED APPLIED and its canonical test PASSED in
     production, 2026-09-18.** Adds a `workspace_id` column derived server-side per entity_type (17
     resolvable, 4 genuinely global, unrecognized types rejected outright) and a scoped read policy.
     Two items deliberately NOT closed by this migration: `inventory_item`/`equipment_type` (hard-deleted
     before the log write happens, needs an atomic delete+log RPC) and a separate, pre-existing,
     unrelated bug in `build_transaction` logging (non-uuid `entity_id`) — both tracked, not fixed.
   - **Storage bucket policies — DONE, all three buckets.** Direct re-check (2026-09-18) found
     `purchase_order_files` (migration 160's own deferral) and the `message-attachments` bucket's
     channel-specific policies (not independently re-verified when migration 162 scoped the metadata
     tables) were BOTH already correctly workspace-scoped, by migrations 161 and 162 respectively — the
     earlier "repeatedly deferred, never actually scheduled" framing was stale for those two. Only
     `sales-quote-images` (deferred by migration 155) was genuinely still fully open — bare `bucket_id =
     'sales-quote-images'` with no workspace predicate on any of its four policies (migration 033).
     **Migration 169 (`dfbbba1`) closes this — CONFIRMED APPLIED and its canonical test PASSED in
     production, 2026-09-18** — matching the storage path's leading segment (`quote_location_id`)
     against `sales_quote_locations` directly via `sales_quote_location_owner_workspace_id()` (migration
     155). **Separately, re-checking `purchase_order_files` surfaced a real, unrelated, already-live
     incident**: its INSERT/UPDATE policies required a metadata row to exist before upload, but the real
     upload code writes bytes first — breaking every new purchase order file upload since migration 161
     shipped. **Fixed by migration 168** (`e4fcbc3`, confirmed applied and tested, 2026-09-18) — see §3.
     The metadata ROWS describing an uploaded file are workspace-scoped for all three buckets; the point
     of these fixes is that the actual file BYTES in Supabase Storage are a separate policy surface from
     table RLS and needed their own explicit scoping.
   - **Governance decision — RESOLVED, 2026-09-18.** `notification_rules`, `standard_install_times`,
     `project_schedule_templates`/`project_schedule_template_phases` were confirmed genuinely global
     (admin-configured libraries/config, zero per-row tenant data, no anchor of any kind) but E rejected
     the framing that this was even an open question: "each company should have its own separate
     copies, this should not be a question... Would you tell Google they have to use everything the way
     Apple does it?" **Migration 173 closes this** — see §3/§4.
   - **Minor hygiene — DONE.** `app_sync_events` turned out NOT dead on direct re-check — still written
     on every `roleMode` change (`saveRemoteAppState()`, `src/main.tsx:1577`), just carrying a single
     trivial UI preference now that real business data moved to normalized tables ("Phase 10f"); the
     earlier "appears genuinely dead" note was wrong, corrected here. Both it and
     `app_transaction_locks` had a full-access `anon` policy pair each, "during no-login MVP" — bigger
     than the "stray EXECUTE grant" this doc originally flagged (that grant, on
     `acquire_transaction_lock()`, migration 069, was real too). **Migration 171 (`96bc949`) closes
     both** — CONFIRMED APPLIED and its canonical test PASSED in production, 2026-09-18. Neither table
     was dropped or redesigned (`workspace_key text`, not a real `workspace_id`, stays as-is — tracked
     separately, not urgent).
   - **Confirmed NOT Stage 5 work**: `channels`/DMs (migration 162, already resolved);
     `public_share_tokens`/`workspace_share_link_settings` (already reviewed, workspace-agnostic by
     design or already scoped, migrations 155/161).
   - **Correction to the standing plan**: `save_equipment_recipe()` was already retired from
     `active_workspace_id()` by migration 159 — any older planning text still listing it as a pending
     call site is stale. The confirmed complete remaining call-site list is: the legacy admin-role
     bridge functions (migrations 124/133, permanently out of scope) and `replace_project_bom_lines()`
     (now retired by migration 163).
   - **Remaining indirect access paths — DONE, migrations 180-185.** The decision-dependent items §5a
     had carried forward past migration 179 are now all closed: `project-documents`/`catalog-datasheets`
     storage.objects (migration 180), `user_invites` (migration 181), `company_branding` (migration 182),
     `app_records`/`app_state_snapshots` (migration 183), the separately-discovered missing
     `catalog-datasheets` bucket (migration 184), and per-workspace admin authorization (migration 185).
     All CONFIRMED APPLIED and canonical-tested in production, 2026-09-19 — see §5 for each migration's
     full writeup. **Stage 5 is now fully shipped end-to-end.** Only the 3 structurally-only-tested RPCs
     flagged in §5a remain, a test-rigor item, not a blocker.
6. **Full automated cross-workspace isolation suite and final Phase 3 reconciliation — SUITE LANDED,
   GATE GREEN.** Gate: this must pass before a second real workspace may ever be created (§6).
   `backend/supabase/consolidated_isolation_suite/` (`021d935`) is a permanent, reusable PGlite harness
   that applies all 185 real migrations verbatim to one fresh instance once, then runs all 51 existing
   canonical `migration_N_..._tests.sql` files against that same fully-migrated schema in one pass —
   `node backend/supabase/consolidated_isolation_suite/run_all.mjs` (or `npm run test:isolation`).
   Running the full history for the first time surfaced several test-file-only bugs (fixed freely, per
   this session's own standing discipline — see the commit message for the full list). Its first run
   also produced **one false positive, since traced and fixed, that this section and HANDOFF.md
   originally, incorrectly, wrote up as a genuine PRE-EXISTING production bug**: migration 166's own
   canonical test file (`migration_166_deletion_log_workspace_containment_tests.sql`, Section 4) still
   asserted its ORIGINAL pre-173 expectation — that `schedule_template_phase` derives a NULL,
   globally-visible `workspace_id` — an assertion written before migration 173 (carried forward
   unchanged by migration 177) replaced that exact CASE branch in `derive_deletion_log_workspace_id()`
   with a real one-hop lookup into `project_schedule_template_phases.workspace_id`. That produced a
   `TEST FAILED` that was misread as evidence of a live disclosure bug in production. **Direct
   verification against real production** (`select proname, prosrc from pg_proc where proname =
   'derive_deletion_log_workspace_id'` in the Supabase SQL editor) disproved this: production's live
   function already contains migration 173/177's fix, byte-for-byte, matching
   `173_global_config_workspace_scoping.sql:324-325` and
   `177_remaining_global_config_workspace_scoping.sql:293-294` exactly. The bug was in the test file's
   stale assertion, not in any applied migration — migration 166 itself was never edited or rerun, per
   this session's standing discipline. **Fixed** by updating Section 4 of the test file to assert the
   current, correct, already-live behavior (a real derived `workspace_id`, and no cross-workspace
   visibility — the exact leak migration 173 closed); see that file's own Section 4 header comment for
   the full history. **Suite now passes 51/51 with zero findings — the gate is GREEN**, and a second
   real workspace may now be created per §6, subject to any other still-open items in this section.
7. **Company onboarding and no-code workspace configuration — LIGHTWEIGHT PATH SHIPPED AND HARDENED,
   2026-09-22.** No longer blocked on stage 6 (green as of the entry above). E's own decision:
   model on Teams/QuickBooks, self-serve signup gated by E's own platform-admin approval (no billing
   infra yet), lightweight path first (a guided setup wizard deliberately deferred until this path
   has real usage — "once everything actually works and is tested 100, we build the guide"). Built
   across migrations 195-197 plus a full frontend pass, all confirmed live in production: a public
   `?request-company` signup form (rate-limited via `api/request-company-signup.js`, the only
   genuinely public unauthenticated write path in this schema); a real `is_platform_admin()`-gated
   review queue (`company_signup_requests`, migration 195 — corrected from an initial `is_app_admin()`
   mistake by migration 196 after E's own review, since that flag is grantable to any of Ergon's own
   employees and must never gate approving unrelated companies); full workspace provisioning on
   approval (workspace, branding, 4 section channels — migration 162's own long-standing "belongs to
   Stage 7" flag, now closed); a hardened claim path (migration 196) verifying the accepting caller's
   real, confirmed auth email against the request, rejecting a caller who already belongs to another
   workspace, real 7-day token expiration with explicit revoke/regenerate, and atomic pending->active
   workspace activation only on genuine acceptance; a one-time backfill (migration 197) giving every
   pre-196 approved token a real expiration; and a full frontend lifecycle (distinct messaging per
   token/outcome state, admin revoke/regenerate/expiration/status controls) matching what the backend
   actually enforces, not a generic catch-all. See `HANDOFF.md`'s same-night entries for the full
   defect list and verification detail. **Deliberately still open**: seeding a new company's
   catalog/schedule-templates/notification-rules (E's own "different industries" decision — stays
   genuinely empty, not copied from Ergon Test Workspace); the guided wizard itself; company-level
   branding/subscription/usage-metrics surfaces beyond what's listed here.
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
