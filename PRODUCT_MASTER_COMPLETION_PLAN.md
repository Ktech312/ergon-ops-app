# Ergon Ops — Master Completion Plan

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
enforced down-payment/billing-review gate before Project execution can begin — today, conversion
is atomic and idempotent (migrations 127/128, independently re-verified this session as a genuine
strength, not just a claim) but **no pricing ever reaches the customer anywhere in the Sales
module** (the single largest gap versus HubSpot/PandaDoc), and there is no billing-review or
down-payment gate of any kind between quote acceptance and project creation. Billing itself (the
commercial subscription/invoicing system) is explicitly deferred — this phase is about the handoff
and gate, not building Billing. See §5 for the full Sales batch breakdown.

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
**Gate**: Every Critical-tier screen is keyboard-operable and screen-reader-passable (46 modals
still have no focus trap/return/Escape-close; **12 of 12 flagged desktop clickable-rows are now
keyboard-operable, DONE this pass** via a shared `clickableRowProps` helper), and mobile
performance is measured, not assumed (Dashboard's activity feed is now memoized and `loadTasks` is
now bounded, **both DONE this pass**; two other unbounded-growth table loads and unresized photo
uploads remain open). `PRODUCT_ACCESSIBILITY_MOBILE_PERF_AUDIT.md` has the full list; this plan's
§2 row tracks exactly what remains.

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
| Optional-association warning (form-level UI guard) | **Traced, scoped, not implemented** (`PRODUCT_ERROR_VISIBILITY_AUDIT.md` A2.6) — the safe first step (catch a stale/renamed selection before object creation) never touches restore | Build the form-level check using the existing `setActionStatus` "N skipped" banner pattern | Medium | Code | None — deliberately restore-independent | A user picking a stale dropdown value is warned before the record is even created |
| xlsx vulnerability | **Evaluated, recommendation given** (`PRODUCT_XLSX_REPLACEMENT_EVALUATION.md`) | Migrate to `exceljs` (or confirm staying), per the small POC plan already written | High | Business decision (which library / accept risk), Code, Prod verify | None | `npm audit`-class finding cleared; both import flows verified against real files |
| System Health — Phase A (existing-data only) | **Done this pass** — `loadNotificationDeliveryFailures` aggregates `notification_deliveries`/`notifications` into channel/event/reason rows with counts and first/last-seen; admin-only UI section (gated by existing `isAdmin`, no RLS/role change) with channel filter and empty state | Nothing outstanding for Phase A itself | N/A — done | Code (done), Prod verify (deployed and bundle-content-checked; not yet exercised against a real failure in production since none has occurred) | — | Admin can see failed notification deliveries without reading Vercel logs — met |
| System Health — Phase B (durable event storage) | **Design only** (`PRODUCT_SYSTEM_HEALTH_PLAN.md`) | `system_health_events` table + write helper for cron/RPC/API failures beyond what `notification_deliveries` already captures; retention cron; alert wiring | Medium | Migration, Code, Business decision (which alert channel/recipient fires a `down` transition) | Independent of Phase 3 RLS | Admin can see failed cron/Redis/API/backup-restore jobs, not just notification deliveries; 90-day retention live |
| Mobile/accessibility — clickable rows | **Done this pass** — reusable `clickableRowProps(onActivate)` helper applied to all 11 flagged desktop `<tr>` instances (Purchasing, Inventory, Projects, Client Ledger, Team Roster, Locations, Sales Catalog, Tasks) | Nothing outstanding for this specific sub-item | N/A — done | Code (done), Prod verify (done) | — | Every flagged clickable row is keyboard-operable — met |
| Mobile/accessibility — modal focus management | **Not attempted this pass** — still 46 modals with no focus trap/return/Escape-close | Build one reusable modal-focus hook (trap, Escape-close, return-focus-to-trigger) and apply it across modals, prioritizing the most-used Inventory/Projects/Sales screens first | High | Code, User acceptance | None | Escape closes every Critical-tier modal; focus enters on open and returns to the trigger on close |
| Mobile/accessibility — performance | **Two of several items done this pass** — xlsx dynamic import (~113kB gzip win, confirmed in production bundle), Dashboard `activityFeed` memoized, `loadTasks` bounded to 2000 | `loadInventoryItems` deliberately left unbounded (alphabetical ordering means any cap would silently hide catalog items — a real pagination design is needed, not a mechanical limit); photo resize-before-upload not started | Medium | Code, Business decision (pagination UX for `loadInventoryItems`) | None blocking | Every unbounded list load is either justified or paginated; uploaded photos are resized client-side before upload |
| Phase 3 RLS / tenant containment | **Design only** (`PRODUCT_PHASE3_PLAN.md`, 16-threat model) | Everything — tenant columns, real RLS, Storage bucket scoping, uniqueness-constraint scoping | Critical (for Phase 2's own gate) but explicitly blocked | Business decision (explicit process discussion required before starting — standing rule), Migration (extensive), Code, Prod verify | Blocks onboarding a second workspace | Automated cross-tenant-isolation test passes for a real second workspace |
| Onboarding / no-code configuration | **Design only** (`PRODUCT_ONBOARDING_CONFIG.md`) | Build the 10-step flow, responsibility matrix, starter configs; wire Phase 1/2's workspace infra into actual UI/API | High, blocked on Phase 3 | Business decision (how much is truly no-code vs. a human setup step), Migration (likely), Code | Phase 3 RLS should land first or in parallel | A new customer completes setup and first login with zero code/manual DB changes |
| Sales pricing (frozen per-line price) | **Design-complete, not implemented** — see §5 Batch 1 | `unit_price`/`unit_cost` snapshot columns on `sales_quote_bom_lines`, populated at insert time, dashboard KPIs recomputed from frozen values | **Critical** — single highest-leverage Sales gap | Business decision, Migration, Code, User acceptance | Blocks customer-visible pricing and the approval-before-send gate | A quote's price is frozen at creation time and never silently drifts from a later catalog price change |
| Sales presentation/templates (remaining items) | **Partially implemented** — misleading pricing wording and in-place BOM-line editing are done; see §5 Batches 2-9 | Pricing display, `client_id`/`quote_ref` carry-through, approval gate, bundle explosion, branding wire-up, mobile data-labels, share-link expiry | Mixed — see §5 for per-batch priority | See §5 | Batch 1 (pricing) gates several later batches | One real deal closed through Ergon's own proposal flow, no PandaDoc/HubSpot step needed |
| Service/Support module | **Not designed** | Full design pass needed | Later | Business decision (entirely undecided scope), Migration, Code | Client Ledger reliability fix should land first | A closed project can enter a Support lifecycle with its own status/ticket model |
| Client Ledger reliability | Logging added this pass (non-throwing); caller-side safe-revert redesign was attempted once (2026-09-11), reverted after a concurrency flaw was found, not reattempted | Redesign the caller-side revert-on-failure logic without repeating the earlier concurrency flaw | **Critical** for Phase 7's own gate | Business decision (what "safe revert" means here — per-field revert vs. in-flight guard), Code, User acceptance | None | `updateProjectLedgerInfo` checked, logged, AND its caller safely surfaces/recovers from failure |
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
2. **Client Ledger safe-revert redesign** (Critical). Design and implement caller-side recovery for `updateProjectLedgerInfo` failures without repeating the concurrency flaw found and reverted 2026-09-11. *Verification: Business decision first, then Code, User acceptance.*
3. **Sales Batch 1 — frozen per-line pricing** (Critical). See §5 Batch 1. This is the single highest-leverage remaining gap in the whole plan short of migration 131 and Phase 3. *Verification: Business decision, Migration, Code.*
4. **Purchase-order receiving caller UX fix — DONE.** The line and receive-all actions show accessible success/failure status; receive-all stops on the first failed write and cannot falsely complete untouched lines.
5. **Sales Batch 2 — heading fix DONE; customer-facing pricing display remains.** The misleading "Pricing & Bill of Material" heading now reads "Bill of Material". The actual price column depends on #3 landing first. *Verification remaining: pricing design, Code, User acceptance.*
6. **Sales Batch 3 — in-place BOM-line editing — DONE.** Existing quote BOM lines now edit item, quantity, notes, and catalog link through one checked write; local state updates only from the returned database row, and a failed save leaves the editor open.
7. **Sales Batch 4 — `client_id`/`quote_ref` carry-through** (High, small, safe). One-line addition to `create_project_from_quote()`'s already-hardened insert list. *Verification: Code, Migration (small, additive), Prod verify.*
8. **Modal focus-trap/Escape-close reusable hook** (High). One shared hook, applied first to the most-used Inventory/Projects/Sales modals, matching this pass's `clickableRowProps` pattern for reuse over per-instance patching. *Verification: Code, User acceptance.*
9. **Form-level optional-association UI guard** (Medium). The safe, restore-independent first step from A2.6 — warn before a stale/renamed selection is even turned into a record. *Verification: Code.*
10. **xlsx replacement decision + migration to `exceljs`** (High, decision-gated). *Verification: Business decision, then Code, Prod verify.*
11. **Sales Batch 5 — approval-before-send gate** (Medium, sequenced after #3/#5). Reuse the existing Catalog Price Change Requests propose/review/approve pattern. *Verification: Business decision (who approves, at what threshold), Code.*
12. **Sales Batch 6 — bundle-components explosion or UI relabel** (Medium, decision-gated). Either wire `bundle_components` into a real BOM-line-insert action, or stop presenting the field as functional until it is. *Verification: Business decision, Code.*
13. **Sales Batch 7 — proposal-page branding wire-up** (Medium, safe/additive). Render the existing `company_branding` name/logo on `ProposalPublicPage` — data and upload UI already exist. *Verification: Code, Prod verify.*
14. **Sales Batch 8 — proposal-page mobile data-labels** (Low, quick-win). Add `data-label` attributes to the proposal BOM table's `<td>`s so the existing `.stack-table-mobile` CSS mechanism (already built for this exact case) actually activates. *Verification: Code, Prod verify.*
15. **Sales Batch 9 — share-link expiration/revocation** (High, security-adjacent). A column already exists and nothing ever sets it. *Verification: Business decision (expiry policy), Code.*
16. **System Health Phase B — durable event storage** (Medium). `system_health_events` table for cron/RPC/API/backup-restore failures beyond `notification_deliveries`' coverage, plus retention cron. *Verification: Migration, Code, Business decision (alert channel/recipient).*
17. **Backup restore checkpoint/resume design implementation** (Medium). `restore_runs` table + resumable per-section retry, building on this pass's already-shipped `RestoreOutcome` shape. *Verification: Migration, Code, Business decision (retry leniency).*
18. **`loadInventoryItems` pagination** (Medium). Deliberately not mechanically capped this pass (alphabetical ordering would silently hide items) — needs an actual paginated-UI decision, not a `limit=`. *Verification: Business decision, Code.*
19. **Photo resize-before-upload** (Medium). Client-side resize before the existing upload path, for mobile performance. *Verification: Code, User acceptance.*
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
| 1. Frozen per-line pricing | Add `unit_price`/`unit_cost` snapshot columns to `sales_quote_bom_lines`, populated from the catalog item's current values at insert time, never recomputed afterward; recompute dashboard KPIs from frozen values instead of live catalog joins | The mechanism (snapshot-at-insert, not live-join) — matches the pattern already used elsewhere in this codebase for frozen state | Whether/when to build this at all, and how a price change mid-quote-lifecycle (before acceptance) should be handled | **Critical** | Business decision, Migration, Code, User acceptance |
| 2. Customer-facing pricing display + heading fix | **Heading fix done:** the proposal now says "Bill of Material." Remaining: show frozen prices after Batch 1 establishes them | The heading fix is complete | How much pricing detail the customer sees (line-item vs. total-only) — depends on Batch 1's decision | Critical for pricing | Business decision, Code, User acceptance |
| 3. In-place BOM-line editing | **Done:** Edit/Save/Cancel controls update item, quantity, notes, and catalog link in one checked request | Yes — implemented without a workflow or schema change | None | N/A — done | Code and regression tests complete; user acceptance remains |
| 4. `client_id`/`quote_ref` carry-through | Add `client_id` (already a nullable column on both `sales_quotes` and `projects`) and `quote_ref` to `create_project_from_quote()`'s insert list | Yes — small, scoped data-completeness fix to an already-hardened, already-shipped atomic function | None | High | Code, Migration (small), Prod verify |
| 5. Internal approval-before-send gate | Reuse the existing Catalog Price Change Requests propose/review/approve pattern as the template for a proposal-send approval gate | The mechanism to reuse | Who approves, at what deal-size threshold, or whether at all — explicitly sequenced behind Batch 1 (nothing price-related to approve until pricing exists) | Medium | Business decision, Code |
| 6. Bundle-components explosion | Either parse a catalog item's existing free-text `bundle_components` (`SKU:qty, SKU:qty`) into real BOM lines on insert, or stop presenting the field as if it does something until that's built | Something must change — the field currently implies behavior it doesn't have, which is a real UX trap either way | Which of the two directions (build it vs. relabel it) | Medium | Business decision, Code |
| 7. Searchable catalog picker | Replace the flat `<select>` BOM-line-add control with a type-ahead/autocomplete combobox filtering by name/manufacturer/SKU | Yes — contained, non-schema-changing UI change | None | Medium | Code |
| 8. Branding wire-up | Render the existing `company_branding` (name, logo) on `ProposalPublicPage` — the data and upload UI already exist, only the public page's render path is unwired | Yes, for the existing single workspace-wide name/logo | Only if E wants per-deal/per-template color themes beyond what exists today | Medium | Code, Prod verify |
| 9. Proposal-page mobile data-labels | Add `data-label` attributes to the proposal BOM table's `<td>`s so the existing `.stack-table-mobile` CSS (already built for exactly this) activates | Yes — small, contained fix, existing mechanism | None | Low (quick win) | Code, Prod verify |
| 10. Drag/reorder for BOM lines and proposal sections | A lightweight drag handle (e.g. `@dnd-kit/sortable`) writing back to the already-existing-but-unused `line_sort`/`sequenceOrder` columns | Yes — pure UI/UX, no schema change needed | None | Medium/Later | Code |
| 11. Share-link expiration/revocation | Set and enforce the already-existing (but never-populated) share-link expiry column | The column already exists | Expiry policy (fixed duration vs. per-quote, revocation UX) | High (security-adjacent) | Business decision, Code |
| 12. Version-comparison view | A side-by-side diff between two proposal versions | This document's own long-standing recommendation for "narrowest high-value next Sales feature" once the above settle | None — self-contained, no approval/process implications | Later | Code |
| 13. Client Q&A on a proposal | A non-status-changing "Ask a question" action wired into the existing internal messaging (`channels`/`conversations`) system rather than a new comment system | The mechanism to reuse | Access/notification implications of connecting an unauthenticated public page to an internal channel | Later | Business decision, Code |
| 14. Optional/alternate BOM line items | An `is_optional` boolean on `sales_quote_bom_lines`, customer-toggleable with live subtotal recomputation | The shape, once pricing exists | Explicitly sequenced behind Batch 1 — meaningless without a visible price to accept/decline | Later | Business decision (sequencing confirmed), Migration, Code |
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
