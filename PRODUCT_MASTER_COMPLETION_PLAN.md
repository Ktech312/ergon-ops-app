# Ergon Ops — Master Completion Plan

> **Execution handoff:** Use [`CONTINUOUS_CODER_HANDOFF.md`](CONTINUOUS_CODER_HANDOFF.md) for the
> current continuous work queue, stop/skip rules, delivery gates, full completion waves, and the
> consolidated decision register. This document remains the authoritative product roadmap and
> evidence inventory; the handoff document tells the coder exactly what to do next without stopping
> at the first blocked item.

Status: **AUTHORITATIVE CONSOLIDATION, DESIGN-LEVEL.** Written 2026-09-12 (overnight reliability
closeout, part 1). **Updated 2026-09-12 (same overnight run, part 2)** to reflect the second work
queue: a critical-write follow-up sweep, backup-restore structural rework, optional-association
rejection for three specified functions, System Health Phase A (real, admin-visible, no
migration), a bounded accessibility batch, three measured performance fixes, and — in this
revision — a full reconciliation of every item below against current source, plus an ordered
"Next 20 implementation batches" section (§4) and a batch-level breakdown of the Sales workstream
(§5). This document does not reproduce every existing audit — it consolidates `HANDOFF.md`,
`PRODUCT_ERROR_VISIBILITY_AUDIT.md`, `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md`,
`PRODUCT_EQUIPMENT_RECIPE_ATOMIC_SAVE_PLAN.md`, `PRODUCT_SYSTEM_HEALTH_PLAN.md`,
`PRODUCT_XLSX_REPLACEMENT_EVALUATION.md`, `PRODUCT_ACCESSIBILITY_MOBILE_PERF_AUDIT.md`,
`PRODUCT_ONBOARDING_CONFIG.md`, `PRODUCT_TENANCY_AUDIT.md`, `PRODUCT_PHASE3_PLAN.md`,
`PRODUCT_SALES_DISCOVERY.md`/`PRODUCT_SALES_EXPERIENCE_PLAN.md` into one ordered roadmap for
finishing Ergon as a sellable, multi-tenant product. Read this first; go to the named source
document for full detail on any one workstream.

**No completion dates are stated or implied anywhere in this document.** Every date mentioned is
either today's authoring date or a decision-arrival date (when E made or reviewed a call) — never
a projected finish date. Priority and ordering below reflect risk and dependency, not calendar
time.

**The app is not "finished" merely because the current reliability work is complete.** Reliability
closeout (this pass and its immediate predecessors) removes the risk of silent data loss and
partial writes in the core operational app. It does not address tenancy isolation, commercial
onboarding, no-code configurability, the sales-to-close experience, mobile readiness as a product
requirement (not just an accessibility fix list), or billing. Each of those is its own phase below
with its own completion gate.

## Product lifecycle this plan covers

Marketing → Sales → Proposal/quote acceptance → Billing review & down-payment clearance → Project
creation & execution → Project closeout → Service & Support → future Engineering/Product
Development. Ergon today has strong coverage of Project creation/execution (the bulk of this
session's reliability work) and partial coverage of Sales (quote/proposal, no pricing shown to the
customer yet) and Project closeout (Client Ledger). Everything else in this lifecycle —
Marketing, Billing review/down-payment clearance as a real gate, Service/Support as its own
module, Engineering/Product Development — is either a thin placeholder or entirely undesigned.
See the workstream table (§2) for current state per stage.

## How to read the classification columns (§2)

- **Priority** — `Critical` (blocks a phase gate or risks data loss/security), `High` (real
  product/reliability value, no hard blocker), `Medium` (real value, smaller blast radius or
  clearly sequenced behind something else), `Later` (explicitly deferred by standing instruction
  or genuinely undesigned). This is a risk/dependency ranking, not a schedule.
- **Verification needed** — every item is tagged with which of these apply before it can be
  called done: `Code` (implementation), `Migration` (a `.sql` file must be written/reviewed/run),
  `Prod verify` (must be checked against the live deployment, e.g. via the Vercel-CLI/curl/browser
  pattern established this session), `User acceptance` (E needs to actually use the feature and
  confirm it behaves as expected in real operational use, not just pass tests), `Business
  decision` (a product/process call only E can make). Most items need more than one.
- **Dependency** — the other workstream, migration, or decision that must land first, or `—` if
  none.

## 1. Phases and completion gates

Each phase has a **measurable** gate — not "looks done," a specific, checkable condition.

### Phase 1 — Reliability closeout
**Gate**: Equipment Recipe save is atomic and race-safe (**DONE**, migration 130 +
clientId/queue fix, deployed). Project BOM replace is atomic and concurrency-safe (**DONE**,
migrations 131/132 + canonical zero-skip database verification + clientId/save queue, deployed).
Backup restore reports
accurate per-section success/failure instead of an all-or-nothing throw (**DONE this pass** —
`restoreFullBackupSnapshot` now returns a structured `RestoreOutcome`; whole-snapshot atomicity
itself remains explicitly out of scope, see §2 row). Every confirmed-critical write in
`PRODUCT_ERROR_VISIBILITY_AUDIT.md`'s ranked list either has a check+plain-error+log, or is
explicitly documented as a reviewed, deferred decision (**met** — the two-part sweep covered every
named persistence function, and the final purchase-order receiving caller now shows a visible
failure and no longer marks failed/remaining lines received). Optional-association warnings are enforced for the
three specified persistence functions (**DONE this pass** for `saveBuildTransactions`,
`saveInventoryMovements`, `saveProjectAllocations` — batch-scoped rejection naming the unresolved
record, restore-leniency question intentionally left open, see §2). System Health is real and
admin-visible, not console-only (**Phase A DONE this pass** — `notification_deliveries`-derived
failure list, admin-gated UI section; durable event storage beyond what the existing schema
supports remains design-only).

### Phase 2 — Tenant containment and Phase 3 RLS
**Gate**: A second real workspace can be created and its data is provably invisible to the first
workspace's users — verified by an automated test that logs in as a Workspace-B user and asserts
zero Workspace-A rows are readable across every table, not just spot-checked. Today: zero of 86
tables have a tenant column outside the Phase 1/2 workspace tables; most RLS is `using(true)`; 8 of
9 Storage buckets are fully open; several global-uniqueness constraints (team member email,
vendor/location/client name, sku, po_number, catalog_number, quote_ref) would block onboarding a
second company outright. `PRODUCT_PHASE3_PLAN.md` is a full 16-threat design; **no RLS has been
written**. This phase is explicitly blocked from starting without discussing the process with E
first (standing rule, unchanged by this pass).

### Phase 3 — Sales → Billing → Project handoff
**Gate**: A Closed-Won quote converts to a Project with a real, customer-visible price and an
enforced down-payment/billing-review gate before Project execution can begin — conversion itself is
atomic and idempotent (migrations 127/128, independently re-verified this session as a genuine
strength, not just a claim). **Customer-visible pricing is shipped (Queue C1)** — migration 136 and
its canonical test passed; a proposal now shows unit
price/line total/subtotal/discount/tax/final total, frozen per version, and a converted Project
carries a read-only reference to the accepted total. There is still no billing-review or down-payment
gate of any kind between quote acceptance and project creation — that part of this phase's gate
remains open. Billing itself (the commercial subscription/invoicing system) is explicitly deferred —
this phase is about the handoff and gate, not building Billing. See §5 for the full Sales batch
breakdown.

### Phase 4 — Product onboarding and no-code configuration
**Gate**: A new customer can configure business identity (name, logo, terminology),
roles/permissions, and at least one workflow template through the UI, with zero code changes or
manual database rows, and complete first login to a working (if empty) workspace in under the
10-step flow `PRODUCT_ONBOARDING_CONFIG.md` already designs. Today: that document is a full
10-step flow + responsibility matrix + starter configurations, **entirely undesigned in code** —
its own finding is that "Phase 1/2's workspace/platform-admin infrastructure is not yet reachable
from any frontend or API code."

### Phase 5 — Sales presentation/template experience
**Gate**: A PM/salesperson can generate a client-facing proposal from Ergon with pricing,
branding, and a signature/acceptance flow good enough that the team stops needing
HubSpot/PandaDoc for this step — measured by at least one real deal closed end-to-end through
Ergon alone. Today: proposal-response and submittal-response replay bugs are fixed and live
(migrations 119/121/122/123), but share tokens never expire or get revoked (a column exists,
nothing ever sets it), and no price is shown anywhere in the flow. The misleading proposal-page
heading that previously promised pricing was corrected to "Bill of Material" on 2026-09-12;
actual customer-facing pricing remains open and depends on frozen per-line pricing.

### Phase 6 — Mobile and accessibility
**Gate**: Every Critical-tier screen is keyboard-operable and screen-reader-passable (**every modal
in the app now has focus trap/return/Escape-close** via a shared `useModalA11y` hook — mechanism
live-verified in a running instance, full coverage confirmed by a source-wide grep and a clean
build/test pass; real authenticated user acceptance across the full set is still outstanding; **12
of 12 flagged desktop clickable-rows are now keyboard-operable, DONE this pass** via a shared
`clickableRowProps` helper), and mobile
performance is measured, not assumed (Dashboard's activity feed is now memoized and `loadTasks` is
now bounded, **both DONE this pass**; two other unbounded-growth table loads and unresized photo
uploads remain open). `PRODUCT_ACCESSIBILITY_MOBILE_PERF_AUDIT.md` has the full list; this plan's
§2 row tracks exactly what remains. **A real, silent mobile overflow bug was found and fixed this
pass** (Queue A6 in `CONTINUOUS_CODER_HANDOFF.md`) — the shared `stack-table-mobile` `data-label`
cell layout let a long value (proposal BOM table Description/Item columns especially) overflow its
container at mobile widths, invisibly clipped by the sitewide `overflow-x: hidden`. Confirmed with
an isolated before/after browser reproduction (not screenshotted against production, since no real
proposal exists to click through) and fixed by stacking label above value instead of beside it —
applies sitewide to every table using this shared class.

### Phase 7 — Service/Support and client ledger expansion
**Gate**: A closed-out project can be handed to a Support/Service workflow with its own status
lifecycle and the Client Ledger tracking real post-close financial/warranty state — Client Ledger
exists today (migration 089/090) and its write path now logs failures
(`updateProjectLedgerInfo`, done this pass, non-throwing since its caller-side revert logic was
already tried once and reverted), but the caller-side safe-revert redesign itself remains an open
decision (see §2), and there is no dedicated Support/Service module or ticket-like workflow
anywhere in the app today.

### Phase 8 — Engineering/Product Development
**Gate**: A named placeholder becomes a real module with at least one working feature. Today:
**not mentioned anywhere in this codebase or its documentation** — this is the least-defined
phase in this plan and needs its own scoping pass before a gate can even be written precisely.
Placeholder gate: a design document exists and is reviewed by E.

### Phase 9 — Commercial SaaS readiness
**Gate**: Ergon can bill and meter a real paying customer for the SaaS product itself (distinct
from a customer's own operational Billing/Client Ledger, which Ergon already tracks *for* the
customer) — subscription tiers, usage limits, payment processing. **Explicitly deferred, not
designed, not started, by standing instruction.** This phase's gate cannot be met without an
explicit go-ahead to begin design work on it at all.

## 2. Workstream table

| Workstream | Current State | Remaining Work | Priority | Verification Needed | Dependency | Definition of Done |
|---|---|---|---|---|---|---|
| Equipment Recipe atomic save | **Done, deployed** (migration 130 + clientId/save-queue race fix) | Two-session concurrency verification | Medium | User acceptance | — | Migration + test script run in production; frontend wired; race-condition tests passing (all true except live two-session check) |
| Project BOM atomic replace | **Done, deployed** (migrations 131/132; canonical database suite passed with zero failures/skips; frontend/clientId/save queue live) | Authenticated user acceptance during the next natural Project BOM edit | N/A — done | User acceptance | — | Migration applied; test script passed; frontend calls the RPC; regression tests pass; deployed — met |
| Backup restore structured outcome | **Done this pass** — `restoreFullBackupSnapshot` returns a `RestoreOutcome` (per-section attempted/succeeded/count/error), snapshot shape validated before any write, `document_number` now deterministic from snapshot data instead of `Date.now()` | Nothing outstanding for this specific sub-item | N/A — done | Code (done), Prod verify (not yet exercised against a real restore in production) | — | 7 tests covering success/first-failure/middle-failure/malformed/deterministic-retry — all passing |
| Backup restore checkpoint/resume design | Whole-restore atomicity confirmed impractical without a large RPC rewrite (documented, not attempted); no `restore_runs`-style tracking exists | Implement a `restore_runs` table + run id + resumable per-section retry, per `PRODUCT_ERROR_VISIBILITY_AUDIT.md` A2.2c/A2.5 | Medium | Migration, Code, Business decision (how lenient should a resumed/retried restore be) | Benefits from System Health's durable-event pattern but doesn't require it | Checkpointed restore with resumable per-section retry; tested only against synthetic/staging data, never production |
| Remaining critical-write audit | **Done** — every named persistence function has response checks/diagnostics; purchase-order line and receive-all callers now branch on failure, show a plain accessible message, preserve failed/remaining line state, and only complete the order after every line saves | Authenticated user acceptance during the next natural receiving action | N/A — done | User acceptance | — | A failed receiving write is visible and cannot produce a false all-received screen — met |
| Optional-association warning (persistence layer, 3 specified functions) | **Done this pass** — `saveBuildTransactions`, `saveInventoryMovements`, `saveProjectAllocations` now reject a batch containing an unresolved equipment/project/build/movement reference, naming the offending record; also fixed a real, independently-confirmed key-mismatch defect in `saveBuildTransactions` (equipment lookup now matches on `output_item.item_name` as well as `equipment_name`) | Whether restore should be allowed to stay more lenient than live save (these three functions are shared between both paths) remains an open, not-yet-decided question | High | Business decision (restore leniency), User acceptance | — | User is warned and must correct an unresolved reference, never silently saved as null — met for live saves; restore-path leniency still an open call |
| Optional-association warning (form-level UI guard) | **Done** — Inventory's "Transfer To Project" now rejects a stale/renamed project selection with an inline error before creating the movement; every other candidate call site was traced and confirmed safe by construction (live `.find()` by stable ref/id, not a form draft) | Nothing outstanding for the one real risk site found | N/A — done | Code (done), User acceptance | None — restore-independent, confirmed | A user picking a stale dropdown value is warned before the record is even created — met |
| xlsx vulnerability | **Evaluated, recommendation given** (`PRODUCT_XLSX_REPLACEMENT_EVALUATION.md`). Every OTHER `npm audit` finding is now cleared (Queue A13: `nodemailer`/`pdfjs-dist` bumped, `npm audit fix` for the rest) — `xlsx` is the one remaining vulnerability, with no fix available regardless of a library-choice decision | Migrate to `exceljs` (or confirm staying), per the small POC plan already written | High | Business decision (which library / accept risk), Code, Prod verify | None | `npm audit`-class finding cleared (5 of 6 done, `xlsx` remains); both import flows verified against real files |
| System Health — Phase A (existing-data only) | **Done this pass** — `loadNotificationDeliveryFailures` aggregates `notification_deliveries`/`notifications` into channel/event/reason rows with counts and first/last-seen; admin-only UI section (gated by existing `isAdmin`, no RLS/role change) with channel filter and empty state | Nothing outstanding for Phase A itself | N/A — done | Code (done), Prod verify (deployed and bundle-content-checked; not yet exercised against a real failure in production since none has occurred) | — | Admin can see failed notification deliveries without reading Vercel logs — met |
| System Health — Phase B (durable event storage) | **Design only** (`PRODUCT_SYSTEM_HEALTH_PLAN.md`) | `system_health_events` table + write helper for cron/RPC/API failures beyond what `notification_deliveries` already captures; retention cron; alert wiring | Medium | Migration, Code, Business decision (which alert channel/recipient fires a `down` transition) | Independent of Phase 3 RLS | Admin can see failed cron/Redis/API/backup-restore jobs, not just notification deliveries; 90-day retention live |
| Mobile/accessibility — clickable rows | **Done this pass** — reusable `clickableRowProps(onActivate)` helper applied to all 11 flagged desktop `<tr>` instances (Purchasing, Inventory, Projects, Client Ledger, Team Roster, Locations, Sales Catalog, Tasks) | Nothing outstanding for this specific sub-item | N/A — done | Code (done), Prod verify (done) | — | Every flagged clickable row is keyboard-operable — met |
| Mobile/accessibility — modal focus management | **Done** — `useModalA11y` reusable hook applied to every `role="dialog"` modal in `main.tsx` (confirmed by source-wide grep, zero remaining); mechanism live-verified in a running instance (Escape closes + returns focus, Tab/Shift+Tab trap holds); full coverage confirmed structurally via `tsc -b` and the 350-test suite, not by clicking through all ~38 modals individually (most need Supabase-backed data not available in the unauthenticated local/demo environment) | Real authenticated user acceptance across the full set | High | Code (done), User acceptance | None | Escape closes every Critical-tier modal; focus enters on open and returns to the trigger on close — met, pending real-use confirmation |
| Mobile/accessibility — performance | **Most items done across this session's passes** — xlsx dynamic import (~113kB gzip win, confirmed in production bundle), Dashboard `activityFeed` memoized, `loadTasks` bounded to 2000, photo resize-before-upload now live on all three real photo-upload paths, and (Queue A12) `loadInventoryItems` no longer relies on one unbounded request — it fetches deterministic paginated pages internally, closing the real silent-truncation risk Queue B6 found | A real paginated/searched **UI** for the Inventory table itself (`PRODUCT_INVENTORY_PAGINATION_DESIGN.md`) remains a separate, later UX decision — A12 only fixed the correctness risk, not the browse experience at scale | Medium | Code (row-cap fix done), Business decision (pagination UX, still pending) | None blocking | Every unbounded list load is either justified or paginated (row-cap correctness met; UI-level pagination still pending); uploaded photos are resized client-side before upload — met |
| Phase 3 RLS / tenant containment | **Design only** (`PRODUCT_PHASE3_PLAN.md`, 16-threat model) | Everything — tenant columns, real RLS, Storage bucket scoping, uniqueness-constraint scoping | Critical (for Phase 2's own gate) but explicitly blocked | Business decision (explicit process discussion required before starting — standing rule), Migration (extensive), Code, Prod verify | Blocks onboarding a second workspace | Automated cross-tenant-isolation test passes for a real second workspace |
| Onboarding / no-code configuration | **Design only** (`PRODUCT_ONBOARDING_CONFIG.md`) | Build the 10-step flow, responsibility matrix, starter configs; wire Phase 1/2's workspace infra into actual UI/API | High, blocked on Phase 3 | Business decision (how much is truly no-code vs. a human setup step), Migration (likely), Code | Phase 3 RLS should land first or in parallel | A new customer completes setup and first login with zero code/manual DB changes |
| Sales pricing (frozen per-line price) | **Shipped — Queue C1.** `unit_price`/`price_source` on `sales_quote_bom_lines`, `discount_percent`/`tax_rate` on `sales_quotes`, `accepted_proposal_total` on `projects`, frozen subtotal/discount/tax/grand total in every new `ProposalSnapshot`; migration 136 and its canonical test passed | One real Sales-authored priced proposal remains user acceptance | **Critical gap closed in code/production** | Migration (passed), Code (done), Prod verify (done), User acceptance | None | A quote's price is frozen at creation time and never silently drifts from a later catalog price change — met and live |
| Sales presentation/templates (remaining items) | **Mostly implemented** — pricing (display + frozen), in-place BOM-line editing, searchable catalog picker, branding wire-up, mobile data-labels, `client_id` carry-through, BOM/proposal-section ordering, share-link expiry/revocation, and version comparison (§5 rows 1/2/3/4/7/8/9/10/11/12) are all done; see §5 for the rest | `quote_ref` carry-through, internal approval-before-send gate, bundle-components behavior, client Q&A, optional/alternate BOM lines, real e-signature, and server-generated PDF (§5 rows 4b/5/6/13/14/15/16) | Mixed — see §5 for per-batch priority | See §5 | Batch 5 (approval gate) is the next batch with no open decision blocking it once E answers who approves and at what threshold | One real deal closed through Ergon's own proposal flow, no PandaDoc/HubSpot step needed |
| Service/Support module | **Not designed** | Full design pass needed | Later | Business decision (entirely undecided scope), Migration, Code | Client Ledger reliability fix should land first | A closed project can enter a Support lifecycle with its own status/ticket model |
| Client Ledger reliability | **Done — Queue A10.** `createClientLedgerSaveQueue` serializes saves per project, coalesces overlapping edits, never blindly reverts on failure, and reconciles against the server's confirmed row; the previously log-only failure now surfaces a plain banner via `setAuthStatus`/`setSyncStatus`. 7 new tests cover all six proof cases the design named | Nothing outstanding for this item | N/A — done | Code (done), User acceptance | None | `updateProjectLedgerInfo` checked, throws, AND its caller safely surfaces/recovers from failure — met |
| Engineering / Product Development | **Does not exist** | Full scoping pass | Later | Business decision (everything, starting with "what is this") | None known | A reviewed design document exists |
| Commercial SaaS billing | **Explicitly deferred** | Not started by design | Later | Business decision (explicit go-ahead to even begin design) | Everything else, functionally | Ergon can bill a real paying customer for the product itself |

## 3. Cross-cutting notes

- **Data backup and recovery** is covered by the two Backup restore rows above — there is no
  separate "backup creation" gap; `loadFullBackupSnapshot`/`restoreFullBackupSnapshot` already
  exist and work for the happy path. The gap is restore's whole-snapshot atomicity/resumability
  under failure, not backup's existence, and per-section outcome reporting (the first of those two
  gaps) is now closed.
- **Multi-company/workspace isolation** and **onboarding** are listed as separate workstreams
  above because they have separate gates (isolation is a security property; onboarding is a UX
  flow), but they are sequenced together in practice — onboarding a real second company requires
  Phase 3 RLS to actually protect it, not just a nice setup wizard atop still-open data.
- **No-code configuration** (business identity, templates, terminology, roles, permissions,
  workflows) is currently split across many ad hoc settings screens with no single "configuration"
  mental model — Phase 4's gate implies consolidating these, not just adding more isolated
  settings.
- Every workstream above tagged `Business decision` under **Verification Needed** is blocked by an
  explicit, named decision only E can make — none of them are blocked by unresolved technical
  uncertainty this plan couldn't already answer.
- This pass (part 2) closed 6 of the workstream rows entirely (marked "Done this pass" above) and
  meaningfully narrowed 3 more (critical-write audit, mobile/accessibility performance, optional
  association). Nothing in this reconciliation found a row that was previously reported done but
  is actually not — the only correction versus the part-1 version of this table is sequencing and
  status refinement, not a reversal.

## 4. Next 20 implementation batches (ordered)

This ordering reflects risk, dependency, and "smallest safe next step" — not a calendar. A batch
blocked on a business decision is still listed in sequence, with the decision named explicitly, so
picking it up later doesn't require re-deriving why it's blocked. Batches already completed in
this session's two overnight passes are not relisted here — only what remains.

1. **Project BOM atomic replacement — DONE.** Migrations 131/132 are applied, the canonical zero-skip database suite passed, frontend wiring is deployed, and the production bundle is verified.
2. **Client Ledger save recovery — DONE, Queue A10.** The per-project serialized latest-snapshot queue is shipped (`createClientLedgerSaveQueue`); an older failed edit can no longer overwrite a newer value. *Verification: Code (done), User acceptance (pending real use).*
3. **Sales Batch 1 — frozen per-line pricing — SHIPPED (Queue C1).** Migration 136 and its canonical test passed; code deployed through `473c0f4`, production bundle verified. *Verification: Migration (passed), Code (done), Prod verify (done), User acceptance (one real priced proposal pending).*
4. **Purchase-order receiving caller UX fix — DONE.** The line and receive-all actions show accessible success/failure status; receive-all stops on the first failed write and cannot falsely complete untouched lines.
5. **Sales Batch 2 — heading and customer-facing pricing display SHIPPED.** The misleading "Pricing & Bill of Material" heading reads "Bill of Material"; the proposal now shows frozen price columns and totals for new priced versions. *Verification remaining: one real Sales-user acceptance flow.*
6. **Sales Batch 3 — in-place BOM-line editing — DONE.** Existing quote BOM lines now edit item, quantity, notes, and catalog link through one checked write; local state updates only from the returned database row, and a failed save leaves the editor open.
7. **Sales Batch 4 — `client_id` carry-through — DONE, APPLIED AND VERIFIED.** Migration 134 preserves `create_project_from_quote()`'s hardened behavior while carrying the quote's existing nullable `client_id` onto the converted Project. E ran the migration and its canonical transaction-safe test script successfully in production; all assertions ran with zero skipped sections. **`quote_ref` remains separate:** `projects` has no human-readable destination column, so carrying it needs a new column and naming decision (Batch 4b), not a change to this completed item.
7b. **Sales Batch 4b — `quote_ref` carry-through onto Projects** (Medium, newly split out — corrected this pass). Add a new column to `projects` (name to be decided) and populate it from the source quote's `quote_ref` at conversion time. *Verification: Business decision (column name/whether to add it at all), Migration, Code, Prod verify.*
8. **Modal focus-trap/Escape-close reusable hook — DONE, all modals converted.** `useModalA11y(isOpen, onClose)` (Escape-close, Tab/Shift+Tab focus trap cycling within the modal, focus-return to the trigger element on close) is now applied to every `role="dialog"` modal in `main.tsx` — confirmed by a source-wide grep finding zero remaining unconverted instances. Verified live in a running dev instance (unauthenticated/local-demo mode, no signed-in session available): opening the Inventory Add Item modal moves focus to its first focusable element; Escape closes it and returns focus to the triggering button; Shift+Tab from the first focusable element wraps to the last, confirming the trap holds. The remaining ~30 modals converted this pass use the identical hook and pattern but were verified structurally (`tsc -b` clean — a mismatched ref type or wrong state/close-handler pairing would fail the build — plus the full 350-test suite passing with no regression) rather than each being individually clicked through live, since most require Supabase-backed data (quotes, catalog items, projects) not present in the unauthenticated local/demo environment available this session. *Verification: Code (done), User acceptance (real authenticated use of the full set, not yet possible this session).*
9. **Form-level optional-association UI guard — DONE.** Traced every `projectName`/`equipmentName`-taking call site to find which are genuinely form-driven (a raw string from user selection that can go stale) versus internal (a live `.find()` lookup by stable id, safe by construction). Only one call site matched A2.6's actual risk: Inventory's "Transfer To Project" (`saveTransfer()`, `Inventory` component) takes its project name from a `<select>`-bound draft that could go stale between selection and Save (a mid-session rename/delete in another tab, or the modal's initial default value never touched by the user). `saveTransfer()` now checks the selected project name still matches a current `projectSites` entry before calling `onTransferToProject`; if not, shows a plain inline error (reusing the existing `.modal-error-text` style) and does not create the movement. The other candidate sites (`allocateFromInventory`/`shipFromInventory` call sites, build creation) all resolve their project/equipment via a live `.find()` on a stable ref/id at call time, not a stale form draft — confirmed safe by construction, no guard needed there. *Verification: Code (done), User acceptance (the race itself is narrow and hard to reproduce outside real concurrent use).*
10. **xlsx replacement decision + migration to `exceljs`** (High, decision-gated). Every other dependency advisory `npm audit` found is now cleared (Queue A13), and `has_role()` hardening is applied and production-verified through migration 135. `xlsx` is the one dependency finding that genuinely needs the replacement decision, not just a version bump. *Verification: Business decision, then Code, Prod verify.*
11. **Sales Batch 5 — approval-before-send gate** (Medium, sequenced after #3/#5). Reuse the existing Catalog Price Change Requests propose/review/approve pattern. *Verification: Business decision (who approves, at what threshold), Code.*
12. **Sales Batch 6 — bundle-components explosion or UI relabel** (Medium, decision-gated). Either wire `bundle_components` into a real BOM-line-insert action, or stop presenting the field as functional until it is. *Verification: Business decision, Code.*
13. **§5 row 8 — proposal-page branding wire-up — DONE.** `ProposalSnapshot` carries `companyName`/`companyLogoUrl`, frozen from `company_branding` at send time; `ProposalPublicPage` renders them. Deployed, bundle-verified.
14. **§5 row 9 — proposal-page mobile data-labels — DONE.** The proposal BOM table's `<td>`s now carry `data-label` attributes, activating the existing `.stack-table-mobile` CSS mechanism at phone widths. Deployed, bundle-verified.
15. **§5 row 11 — share-link expiration/revocation — FULLY CLOSED AND VERIFIED (2026-09-15).** Decided in full via `PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md`; implemented and deployed as migrations 137 (+ corrective 141), 138, 139, 140 (+ corrective 142), 143, 144, and 145 — every one applied in production with a passing canonical test, zero sections skipped. Migration 143's own function-body changes (the view-logging insert) were recorded as applied but never actually went live; root-caused via a six-round diagnostic investigation and fixed forward by migration 145 (143 itself was never edited or rerun). The Queue C2.6 internal lifecycle-controls UI, Queue C2.7's frontend switch to the server-owned Create & Send RPCs plus direct-write-bypass closure, and the version-comparison picker's share-link status badge (consuming `shareTokenStatus` so a superseded/disabled/revoked prior version shows its own distinct state) are all shipped and deployed. **No open items remain for this workstream.** Explicitly out of scope, tracked separately (not share-link-specific): the authorization-table policy closure and bridge-aware `accept_invite()` replacement. *Verification: Migration (done, prod-verified), Code (done, prod-verified), User acceptance pending real use.*
16. **System Health Phase B — durable event storage** (Medium). `system_health_events` table for cron/RPC/API/backup-restore failures beyond `notification_deliveries`' coverage, plus retention cron. *Verification: Migration, Code, Business decision (alert channel/recipient).*
17. **Backup restore checkpoint/resume design implementation** (Medium). `restore_runs` table + resumable per-section retry, building on this pass's already-shipped `RestoreOutcome` shape. *Verification: Migration, Code, Business decision (retry leniency).*
18. **`loadInventoryItems` pagination** (Medium). Deliberately not mechanically capped this pass (alphabetical ordering would silently hide items) — needs an actual paginated-UI decision, not a `limit=`. *Verification: Business decision, Code.*
19. **Photo resize-before-upload — DONE.** New `resizeImageFile(file, maxDimension=1920, quality=0.85)` utility (never throws — returns the original file unchanged, same reference, if it's already small enough or can't be decoded, e.g. some HEIC files). Applied to the three real photo-upload paths found: CameraCaptureModal's live capture (`capturePhoto()` now encodes the canvas at a capped resolution directly, instead of the camera's native frame size) and its gallery/file picker (`addPickedFiles`, now async); and `ProjectShippingSection`'s shipment packing-photo upload (`handlePhotoSelect`). Two non-photo upload paths (`LocationFilesModal`'s document upload, various catalog/equipment/logo reference-image uploads) were confirmed out of scope — the first accepts PDFs/CAD files, not photos; the second are typically small, deliberately-chosen reference images, not multi-MB phone-camera captures. *Verification: Code (done — `tsc -b` clean, 350/350 tests unchanged, no dedicated unit test since jsdom has no real canvas/Image decode support, same constraint as every other DOM-behavior helper in `main.tsx`), User acceptance (not yet exercised with a real photo on a real device).*
20. **Phase 3 RLS kickoff discussion** (Critical, but explicitly blocked). No code should be written here until E has the standing "discuss the process first" conversation — listed last not because it matters least, but because it is the one item on this whole list that cannot be de-risked by more solo drafting; the next step is a conversation, not a document.

## 5. Sales workstream — implementation batches (Task 9 detail)

This section expands the Sales portion of §2 using the dedicated, already-completed research in
`PRODUCT_SALES_EXPERIENCE_PLAN.md`'s "Task 9 Product Review" (2026-09-11) — a line-by-line
re-verification of every screen-level concept against current `main.tsx`/`persistence.ts`/
migration source, not a re-derivation from scratch. Full citations and current-state detail live
in that document; this section turns its findings into ordered, gated batches. **Already-decided
behavior** (what to build, once a decision is made) is separated from **open questions** (what
only E can decide) per batch.

| Batch | What it is | Already decided | Open question | Priority | Verification |
|---|---|---|---|---|---|
| 1. Frozen per-line pricing | **SHIPPED (Queue C1).** `unit_price`/`price_source` (+ database-stamped override audit) on `sales_quote_bom_lines`, populated from the catalog item's current sell price at add time, editable with an audit trail; `avgDealSize` KPI now reads frozen quote prices instead of live catalog joins (`estimatedProfitYtd`/margin intentionally left on live catalog cost — cost-locking was out of scope for the approved statement, see `PRODUCT_SALES_PRICING_IMPLEMENTATION_PLAN.md`) | E approved the recommended pricing statement 2026-09-13; snapshot-at-edit-time mechanism, matching this codebase's established frozen-state pattern | None remaining for this batch — mid-lifecycle price-change handling is simply "the rep edits the line, price_source flips to manual_override" | **Critical** | Migration 136 (passed), Code (done), Prod verify (done), User acceptance (one real priced proposal pending) |
| 2. Customer-facing pricing display + heading fix | **SHIPPED (Queue C1).** `ProposalPublicPage` renders unit price/line total/subtotal/discount/tax/final total from the frozen snapshot only, once a version has them (older price-free versions render exactly as before, never an invented total) | Line-item + subtotal/discount/tax/total, per the approved statement | None | Critical for pricing | Code (done), Prod verify (done), User acceptance pending real use |
| 3. In-place BOM-line editing | **Done:** Edit/Save/Cancel controls update item, quantity, notes, and catalog link in one checked request | Yes — implemented without a workflow or schema change | None | N/A — done | Code and regression tests complete; user acceptance remains |
| 4. `client_id` carry-through | **DONE AND VERIFIED.** `create_project_from_quote()` now carries `client_id` onto the created Project — shipped as migration 134, applied and canonically verified in production (hard-fail-on-error/skip test confirmed every section ran with zero skips) | Yes — small, scoped data-completeness fix to an already-hardened, already-shipped atomic function | None | N/A — done | Migration (done, prod-verified), Prod verify (done) |
| 4b. `quote_ref` carry-through | **Corrected this pass — not a one-line change.** `projects` has no column to hold a human-readable quote reference (only `source_sales_quote_id`, an id used for idempotency); `quote_ref` itself lives only on `sales_quotes` (`066_sales_quote_ref_and_closed_at.sql`, trigger-assigned, unique). Needs a genuinely new column | The value to carry (the source quote's `quote_ref`) already exists and is unambiguous | Whether to add the column at all, and what to name it (`source_quote_ref` vs. reusing `quote_ref`) | Medium | Business decision, Migration, Code, Prod verify |
| 5. Internal approval-before-send gate | Reuse the existing Catalog Price Change Requests propose/review/approve pattern as the template for a proposal-send approval gate | The mechanism to reuse | Who approves, at what deal-size threshold, or whether at all — explicitly sequenced behind Batch 1 (nothing price-related to approve until pricing exists) | Medium | Business decision, Code |
| 6. Bundle-components explosion | **Interim relabel DONE (2026-09-15)** — the catalog editor's Bundle components field now carries a "Reference only -- listing components here doesn't add them to a quote's BOM automatically" disclaimer, per D5's own recommended interim direction, closing the immediate UX-trap risk. **Still open**: either parse the existing free-text `bundle_components` (`SKU:qty, SKU:qty`) into real BOM lines on insert, or formalize the relabel as the permanent behavior | D5's interim direction (relabel, don't imply automation) — done. Full explosion vs. permanent-notes-field is still undecided | Which of the two directions (build real explosion vs. keep it a documented notes-only field) | Medium | Code (interim relabel done, prod-verified); Business decision, Migration, Code (for full explosion, if chosen) |
| 7. Searchable catalog picker | **Done.** New `CatalogItemPicker` combobox (reuses the existing, already-styled `PeoplePicker` visual pattern/CSS classes rather than new markup or a dependency) replaces the flat `<select>` in both places a BOM line links to a catalog item: the "add BOM line" row and the inline catalog-link changer on an already-saved line. Filters by product name, manufacturer, and catalog number as the rep types; shows the current selection as a clearable chip once one is picked | Yes — contained, non-schema-changing UI change, implemented as scoped | None | N/A — done | Code (done — `tsc -b` clean, 350/350 tests unchanged; not live-clicked through since it needs real catalog/quote data not present in the unauthenticated local/demo environment available this session), User acceptance |
| 8. Branding wire-up | **Done, deployed:** `ProposalSnapshot` carries `companyName`/`companyLogoUrl` frozen at send time from `company_branding`; `ProposalPublicPage` renders them above its own heading | Yes, for the existing single workspace-wide name/logo — implemented as decided | Only if E wants per-deal/per-template color themes beyond what exists today (not attempted, not needed for this batch) | N/A — done | Code and prod verify complete; user acceptance remains |
| 9. Proposal-page mobile data-labels | **Done, deployed:** the proposal BOM table's `<td>`s carry `data-label` attributes, activating the existing `.stack-table-mobile` CSS rule at phone widths | Yes — small, contained fix, existing mechanism | None | N/A — done | Code and prod verify complete; user acceptance remains |
| 10. Reorder for BOM lines and proposal sections — DONE (both) | Built as accessible Move up/Move down buttons (not a drag-and-drop library), writing back to `sales_quote_bom_lines.line_sort` (Queue A3) and Proposal Template sections' `sequence_order` (Queue A4) — both existed unused until now. Existing sent proposal snapshots confirmed unchanged by the section-ordering addition | Yes — pure UI/UX, no schema change needed | None | N/A — done | Code (done for both), verified live and deployed |
| 11. Share-link expiration/revocation | **FULLY CLOSED AND VERIFIED (2026-09-15).** Full lifecycle (status/expiration/disable/re-enable/permanently-revoke/regenerate/version-supersession/quote-delete-cascade/view-logging) shipped as migrations 137 (+141), 138, 139, 140 (+142), 143, 144, and 145 — every one applied and canonically tested, zero sections skipped — plus the Queue C2.6 internal controls UI and Queue C2.7's Create & Send RPC switch + direct-write closure. Migration 143's view-logging insert was recorded applied but never actually live; root-caused (six-round diagnostic) and fixed forward by migration 145 without touching 143 | Expiry policy, revocation UX, and audit design all decided via `PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md` | None remaining for this batch — the authorization-table policy closure/`accept_invite()` bridge (not share-link-specific) is tracked separately, not a business decision | N/A — done | Migration (done, prod-verified), Code (done, prod-verified), User acceptance pending real use |
| 12. Version-comparison view — DONE | Read-only `compareProposalSnapshots()` + a "Compare versions" UI in the Quote Proposal section, defaulting to the newest two versions with explicit selectors for any pair. Extended (2026-09-14) so a superseded/disabled/revoked prior version shows the same status pill in the picker/panel that the version list already shows (`shareLinkTokenStatusBadge`, shared with `ShareLinkLifecycleControls`) | Yes — self-contained, no approval/process implications | None | N/A — done | Code (done); User acceptance pending real multi-version proposal data (no real quote currently has 2+ sent proposal versions, so the status badge has no live data to visually confirm against yet) |
| 13. Client Q&A on a proposal | **Re-traced and designed in full (2026-09-15) — see `PRODUCT_PROPOSAL_QA_AND_OPTIONAL_BOM_DECISION.md`.** A dedicated `sales_quote_proposal_questions` table + two token/role-gated RPCs, NOT the `channels` system — closer inspection found `channels` has no anonymous-write path, no actual client-channel implementation despite the schema placeholder, and no per-quote scoping, so reusing it would need building an undocumented prerequisite feature first | Full design ready, see linked doc | D16 in the decision register: mechanism (now recommended), scope (quote vs. version), who may answer | Later | Business decision (D16), Migration, Code |
| 14. Optional/alternate BOM line items | **Re-traced and designed in full (2026-09-15) — see `PRODUCT_PROPOSAL_QA_AND_OPTIONAL_BOM_DECISION.md`.** An `is_optional` boolean on `sales_quote_bom_lines`; live subtotal recomputation is pure client-side math against the already-frozen snapshot (no new persisted toggle state); final selection captured by extending the existing response RPC's payload | The shape, and the sequencing blocker is now CLEARED — Batch 1 (pricing) shipped | D17 in the decision register: default inclusion state (recommended: included by default) | Later | Business decision (D17), Migration, Code |
| 15. Real e-signature | Drawn/certificate-based signature or a third-party integration (e.g. DocuSign-equivalent legal weight), replacing today's typed-name+IP+content-hash | Nothing — this is a materially different trust/liability surface, not a small extension | Whether the business actually needs DocuSign-equivalent legal weight, or the current pattern is sufficient | Later | Business decision (explicit yes/no required before any design work) |
| 16. Server-generated PDF | A real PDF export independent of the browser's print dialog | Not evaluated for a specific library this pass | Whether this is worth a new dependency vs. keeping `window.print()` | Later | Business decision, Code |

**Recommended sequencing** (restated from `PRODUCT_SALES_EXPERIENCE_PLAN.md`'s own conclusion,
unchanged by this reconciliation): Batch 1 (pricing) first — it is the one gap that determines
whether Ergon can functionally replace PandaDoc/HubSpot at all, and several later batches (2's
price column, 5, 14) are meaningless or lower-value without it. Batches 3 and 4 are small,
already-scoped, low-risk wins that don't compete for the same design attention and can proceed in
parallel with the Batch 1 decision. Batch 5 (approval gate) becomes materially more important
right after Batch 1 lands, not before — sequencing it there (not first) avoids building an
approval workflow for a document that currently has nothing price-related to approve. Batches 15
(e-signature) and 16 (PDF) are real, but neither gates whether Ergon can stand in for
PandaDoc/HubSpot the way pricing does, and 15 in particular should not be started without an
explicit decision on the legal-weight question.

## 6. What this reconciliation changed versus the part-1 version of this document

- Added explicit **Priority** and **Verification Needed** columns to every workstream row (this
  document previously had "Business Decision Needed"/"DB Migration Needed"/"Safe to Build Now" as
  separate binary-ish columns; those are now unified into one classification per the standing
  instruction to tag code/migration/production-verification/user-acceptance/business-decision
  needs explicitly per item).
- Updated every row's **Current State** to reflect what Part 2 of this overnight run actually
  shipped (backup restore structure, optional-association rejection for the three named
  functions, System Health Phase A, the clickable-row accessibility batch, the three performance
  fixes) — six rows moved from "design only"/"traced" to "done."
- Split "Backup restore reliability" and "Optional-association warning" each into two rows (done
  vs. still-open sub-parts) since Part 2 completed one half of each while deliberately leaving the
  other half as a reviewed, open decision — collapsing them back into one row would have hidden
  that partial-completion nuance.
- Added §4 ("Next 20 implementation batches") and §5 (Sales batch breakdown), neither of which
  existed in the part-1 version.
- No item previously marked "done" was found to be incorrect on reconciliation — this pass is
  additive/refining, not corrective, versus part 1's own claims.

**Reconciliation pass, 2026-09-15** (corrective this time, not just additive): found and fixed three
stale rows that had drifted out of sync with `CONTINUOUS_CODER_HANDOFF.md`'s own confirmed production
state:
- §5 row 11 / item 15 (share-link expiration/revocation): was stuck at "143/144's tests independently
  verified and sent/pending E's run result" and made no mention of migration 145 at all — updated to
  reflect Queue C2's full closure (migrations 137-145 all applied and canonically tested, zero open
  items) and the version-comparison status-badge addition.
- §5 row 4 (`client_id` carry-through): still described as not-yet-built ("Add `client_id`... to
  `create_project_from_quote()`'s insert list") despite migration 134 having shipped, applied, and
  passed its canonical test earlier this same overnight run — corrected to DONE.
- §5 row 10 (BOM/proposal-section reordering): still said "proposal sections remain... see Queue A4"
  despite Queue A4 having shipped and deployed that exact work — corrected to DONE for both.

Row 189 (workstream table) and this section's own "remaining items" summary were updated to match. The
lesson worth naming: a document is only as trustworthy as its last reconciliation pass — three real
items drifted stale here even though each was correctly recorded as done in the operational handoff
docs the whole time. Prefer checking `CONTINUOUS_CODER_HANDOFF.md`'s "Current production baseline"
directly over trusting this document's own prior "done" claims when the two could plausibly have
diverged.
