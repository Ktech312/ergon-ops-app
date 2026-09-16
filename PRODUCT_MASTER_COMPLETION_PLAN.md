# Ergon Ops — Master Completion Plan

> **Execution handoff:** Use [`CONTINUOUS_CODER_HANDOFF.md`](CONTINUOUS_CODER_HANDOFF.md) for the
> full session-by-session queue history, delivery conventions, and the consolidated decision
> register (§8, D1-D18). Use [`HANDOFF.md`](HANDOFF.md) for the most recent session's own summary
> and exact next task. This document is the authoritative, always-current product roadmap: what's
> live, what's staged, what's left, in what order, and what's explicitly off-limits without E.

Status: **AUTHORITATIVE, RECONCILED 2026-09-15** against `HANDOFF.md`, `CONTINUOUS_CODER_HANDOFF.md`
§8's full D1-D18 decision register, every applied migration (115 through 150), and
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
has a check+plain-error+log. System Health Phase A is real and admin-visible. **Open, non-blocking
follow-on**: backup restore's own checkpoint/resume (§4, Queue R2) and System Health Phase B
(durable event storage beyond `notification_deliveries`, §4 Queue R1) extend this gate further but
are not required to consider it met — the gate itself (no silent data loss, no partial writes) is
satisfied.

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

### Phase 5 — Sales presentation/template experience — **GATE MOSTLY MET, two items deliberately deferred**
A PM/salesperson can today generate a priced, branded, approval-gated, Q&A-capable, share-link-
controlled proposal from Ergon end-to-end (pricing, in-place BOM editing, searchable catalog
picker, branding, mobile labels, `client_id`/`source_quote_ref` carry-through, section reordering,
share-link expiry/revocation, version comparison, client Q&A, optional BOM lines — see §3 for the
full shipped list). What remains, **by deliberate, decision-gated deferral, not oversight**: real
e-signature beyond typed-name+hash, and a server-generated PDF beyond `window.print()` — both fully
traced and designed with recommended defaults in `PROPOSAL_PDF_AND_ESIGNATURE_DECISION.md`, neither
implemented, both awaiting E's confirmation (D12 revised, D18). The phase's actual measurement gate
("stop needing HubSpot/PandaDoc for this step, one real deal closed end-to-end") is a usage
milestone, not a code gate, and remains open pending real use.

### Phase 6 — Mobile and accessibility — **GATE MOSTLY MET**
Every modal has focus trap/return/Escape-close (`useModalA11y`, source-wide, zero remaining
unconverted). Every flagged desktop clickable row is keyboard-operable. Photo uploads are resized
client-side. Two real bugs were found and fixed in this work, not just polish (mobile
`stack-table-mobile` overflow; `saveBuildTransactions` equipment-lookup key mismatch). **Still
open, not yet started**: three items from `PRODUCT_ACCESSIBILITY_MOBILE_PERF_AUDIT.md` — form-
submission errors have no `aria-live` announcement anywhere in the app (A3); filter/search inputs
rely on `placeholder` alone, not a real accessible name (A4); a family of hardcoded "muted" text
colors fails WCAG AA contrast (A5); mobile tap targets on icon buttons/checkboxes fall short of
44px guidance (A7). None of these need a business decision — WCAG AA is the standing bar. See §4
Queue R1.

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

## 3. Completed and live — migration range 115 through 150

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

## 4. Completed locally but not yet migrated/deployed/verified

**Nothing is currently in this state.** The last two batches that passed through this stage (D16,
D17) are both fully closed as of §3. If a coder picks up Queue R1 below and drafts a migration, it
lands here until E applies it (§5) — update this section then, don't leave a drafted-but-unrun
migration undocumented.

## 5. Manual-action queue for E — one action at a time, in order

Nothing is currently queued. **The first item that will land here** is System Health Phase B's
migration (Queue R1 below) once it is drafted and locally verified — a coder resuming this plan
should draft it, run it through the checklist in `CONTINUOUS_CODER_HANDOFF.md` §3 ("For every
database checkpoint, present E exactly one clickable file and one plain instruction"), and add it
here as item 1 before doing anything else that depends on it being live.

## 6. Explicit stop boundaries — do not cross without discussion, regardless of what else this plan authorizes

- **Phase 3 RLS** (tenant isolation) — no code, no migration, until E has the standing "discuss the
  process first" conversation. Untouched this pass and every pass before it.
- **A second real workspace** — do not create one, seed it, or build onboarding flows that assume
  one exists, ahead of Phase 3 RLS actually protecting it.
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

1. **System Health Phase B — steps 1-4** (`PRODUCT_SYSTEM_HEALTH_PLAN.md`, fully implementation-
   ready). `system_health_events` table + dedup upsert RPC + admin acknowledge/resolve RPCs (draft
   as a migration, confirm the next free number, do not apply — that's the manual-action queue's
   first item); `recordSystemHealthEvent` call sites at the already-ranked list (restore per-section
   failures, notification-delivery write failures, cron failures, rate-limit hits); an Admin →
   System Health panel with the existing "last known good on load failure" degradation pattern;
   the 90-day-retention cron. **Step 5 (alert wiring) has a documented fallback** (§9 of the design
   doc: "email to every workspace admin" if D8 isn't otherwise answered) — implement it using that
   default, flagged clearly as a default, not a confirmed decision, easy for E to override later.
2. **Inventory pagination** (`PRODUCT_INVENTORY_PAGINATION_DESIGN.md` — D10's direction is already
   recorded as non-blocking, unlike D9). A new, separate, server-side-searched, cursor-paginated
   `loadInventoryItemsPage` query used *only* by the Inventory page's own table and (optionally) the
   Reports page's filter — does **not** touch `loadInventoryItems`/`inventoryItems`, which stays
   exactly as-is for its other 100+ consumers (lookups, dropdowns, global search, aggregates). Selected-
   item hydration (a row selected outside the current page gets fetched by `ref` and pinned) per the
   design's §3.
3. **Accessibility remediation, mechanical and decision-free** (`PRODUCT_ACCESSIBILITY_MOBILE_PERF_AUDIT.md`
   Part A, items not yet closed):
   - A3: add `role="alert"`/`aria-live="polite"` to every inline form-submission error, starting
     with the two public, unauthenticated pages (Proposal/Submittal response forms) where there's no
     colleague to ask "did that work?", then the rest sitewide.
   - A4: give every filter/search `<input>` a real accessible name (`aria-label`, matching Client
     Ledger's already-correct pattern) instead of relying on `placeholder` alone.
   - A5: recompute and replace the family of hardcoded "muted" text hex colors that fail WCAG AA
     against the actual page background, keeping the same hue family, not a redesign.
   - A6: normalize the handful of icon-only buttons relying on `title` alone to `aria-label`, for
     consistency with the other 24+ correctly-labeled instances.
   - A7: raise `.icon-button`/`.compact-remove`/checkbox tap targets toward the 44px guidance on
     mobile widths via a media query, without changing desktop sizing.
4. **Regression coverage** — as each of the above ships, add its own test coverage in the same pass
   (matching this repo's standing convention — no item above should land without a test), plus a
   quick audit for any of Queue A8's six flows (`PRODUCT_CRITICAL_FLOW_COVERAGE_MATRIX.md`) that
   have drifted since it was last written.

## 8. Queue R2 — designed, decision-gated; implement once E answers, not before

| Decision | What's ready | What's blocked | Where the full design lives |
|---|---|---|---|
| D9 — backup restore unresolved-reference policy | Full `restore_runs`/`restore_run_sections` schema, deterministic retry key, resume/cancel behavior, stale-reference rule, test matrix | The spec's own header says "nothing below should be built until D9 is answered" — the recommended direction (warned skip/retry) is recorded but not confirmed | `PRODUCT_BACKUP_RESTORE_CHECKPOINT_SPEC.md` |
| D6 — `xlsx` → `exceljs` | Exhaustive current-usage trace (2 call sites, both read-only, client-side), library comparison, migration outline, affected-file list | A real dependency swap on both bulk-import paths (BOM, catalog) needs live-file parity testing (blank-cell handling especially differs between libraries) before it's safe to ship, plus the library choice itself is still framed as E's call | `PRODUCT_XLSX_REPLACEMENT_EVALUATION.md` |
| D12 (revised) — e-signature hardening | Keep typed-acceptance; fix the currently-dead `approval_ip` capture; add `approval_email` verified against the proposal's `client_email`; no OTP/drawn signature/third-party integration | Awaiting E's confirmation before any column is added or any capture logic changes | `PROPOSAL_PDF_AND_ESIGNATURE_DECISION.md` §2 |
| D18 — frozen proposal PDF | Keep `window.print()` by default; build a server pipeline (`@react-pdf/renderer` recommended) only if a concrete need is confirmed | Awaiting E's confirmation on whether a stored/emailable file is actually needed | `PROPOSAL_PDF_AND_ESIGNATURE_DECISION.md` §1 |
| D5 (remaining half) — bundle-components full explosion | Interim relabel already shipped (2026-09-15, copy-only) | Whether to build real BOM-line explosion from `bundle_components`, or make the relabel the permanent behavior | §5 row 6 below |
| Sales Batch 15/16 duplicate — superseded by D12/D18 | — | — | Historical §5 rows below now point to the consolidated decision doc instead of standing alone |
| D11 — Phase 3 RLS | 16-threat design complete | Explicit process discussion with E first — this is the one item that cannot be de-risked by more solo drafting | `PRODUCT_PHASE3_PLAN.md`, §6 of this document |
| D13/D14 — Support/Engineering modules | Placeholder scoping only | Full design pass — "what is this" is itself still open | `PRODUCT_SUPPORT_MODULE_DESIGN.md`, `PRODUCT_ENGINEERING_MODULE_DESIGN.md` |
| D15 — Commercial SaaS billing | — | Explicitly deferred, no design work without an explicit go-ahead | §6 stop boundary |

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
| 6. Bundle-components explosion | D5 | **Interim relabel SHIPPED**; full explosion vs. permanent-notes-field still open — §8 |
| 7. Searchable catalog picker | `CatalogItemPicker` | **SHIPPED** |
| 8. Branding wire-up | Frozen company name/logo on snapshot | **SHIPPED** |
| 9. Proposal-page mobile data-labels | `stack-table-mobile` | **SHIPPED** |
| 10. BOM/proposal-section reordering | Move up/down buttons | **SHIPPED** |
| 11. Share-link expiration/revocation | Full lifecycle | **SHIPPED** — §3 (Queue C2) |
| 12. Version-comparison view | `compareProposalSnapshots` | **SHIPPED** |
| 13. Client Q&A on a proposal | D16 | **SHIPPED** — §3 |
| 14. Optional/alternate BOM lines | D17 | **SHIPPED** — §3 |
| 15. Real e-signature | D12 (revised) | **Designed, awaiting approval** — §8 |
| 16. Server-generated PDF | D18 | **Designed, awaiting approval** — §8 |

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
