# Ergon Ops — Continuous Coder Handoff

Status: **ACTIVE — QUEUE A REOPENED WITH A10–A15.** Prepared: 2026-09-12. A1–A9 and B1–B10 are
complete in the forms recorded below. The first pass then incorrectly concluded that every remaining
item required E's decision. A review of its own findings identified more safe work: Client Ledger's
recommended queue is a technical reliability choice, submittal branding can mirror the approved
proposal pattern, Inventory can fetch all pages without choosing a new UI, compatible security
updates can exclude the decision-gated `xlsx` replacement, and `has_role()` hardening can be prepared
without being run. Continue at **A10**, not the decision register.
Current verified repository baseline before this correction: `main` / `origin/main` at `83b8ada`
with a clean working tree.
Production: `https://ergon-ops-app.vercel.app/`

This is the page the next coder should open first. `PRODUCT_MASTER_COMPLETION_PLAN.md` remains the
full product roadmap and evidence inventory. This page turns that roadmap into a continuous work
queue so work does not stop merely because one item needs E's decision, a manual Supabase step, an
authenticated session, or a new dependency.

## 1. The operating rule

Continue through **Queue A** in order. Do not stop after finishing one task and ask what to do next.

If a task is blocked:

1. Record the exact blocker and the smallest decision or manual action that clears it.
2. Leave the blocked work in a reviewable state. Never leave frontend code depending on a database
   migration that has not been applied.
3. Move immediately to the next independent task in Queue A.
4. After Queue A, complete the preparation work in Queue B.
5. Stop only when every unblocked item in A and B is done, or a real technical failure prevents all
   remaining work.

Do not ask E to approve ordinary implementation choices already settled in the source documents.
Do not present a list of options and wait when another independent task is available.

## 2. Boundaries that remain in force

- Do not begin Phase 3 RLS, create a second workspace, or change who can see/edit/delete business
  records until E has the required process discussion.
- Do not build commercial SaaS billing. Product billing remains explicitly deferred.
- Do not invent or alter Sales, Billing, PM, Support, approval, or handoff authority rules. Record
  the decision needed and continue elsewhere.
- Do not mutate real production quotes, projects, roles, inventory, client records, or workspace
  membership for testing. Use read-only checks, synthetic fixtures inside rolled-back transactions,
  or local mocks.
- Supabase migrations are manual review checkpoints. Draft one numbered migration and one canonical
  transaction-safe verification script. Do not run either. Do not make E hunt through chat for SQL.
- For a manual database action, give E one clickable file link and one action at a time. A successful
  migration is followed by its single verification script only after E reports success.
- No new package, package replacement, or major framework change without the corresponding decision.
- Preserve existing processes unless the plan explicitly says the behavior has already been decided.

## 3. Delivery rule for every code-only batch

For each independently shippable code-only batch:

1. Re-read the specific function/component and the relevant product document before editing.
2. Add focused regression tests where they can prove behavior. Avoid tests that merely repeat the
   implementation.
3. Run:
   - `npx tsc -b`
   - `NODE_OPTIONS="--max-old-space-size=6144" npx vitest run --no-file-parallelism`
   - `npx eslint .`
   - `npm run build`
   - `npm run test:smoke` for user-facing UI changes
4. Commit the coherent batch, push `main`, wait for Vercel, and verify the production URL serves the
   new bundle. Use an authenticated read-only walkthrough when a connected authenticated browser is
   available. State plainly when it is not.
5. Update `HANDOFF.md` with what changed, why, tests, commit, deployment evidence, and any remaining
   limitation. Update `PRODUCT_MASTER_COMPLETION_PLAN.md` when a roadmap item changes state.
6. Confirm a clean working tree, then continue to the next queue item.

Local checks, Vercel deployment, authenticated verification, and E's real-world acceptance are
separate evidence. Do not call one a substitute for another.

## 4. Current production baseline

The next coder should verify this baseline before editing rather than redoing completed work:

- Migrations 115–133 that are recorded as applied in `HANDOFF.md` are historical/live work. Never
  edit their files as though they were unapplied.
- Migration 133 is applied. It lets a Manager assign a primary role during sign-in approval and
  bootstrapped `ehren@ensight-technologies.com` as workspace/global admin. Its positive manager-path
  production test passed; the negative test was honestly skipped because no real non-manager,
  non-admin account exists.
- Atomic quote-to-project conversion, equipment-recipe saves, and Project BOM replacement are live.
- Proposal replay and submittal replay protections are live.
- Sales quote BOM lines support checked in-place editing and a searchable catalog picker.
- Proposal snapshots freeze the company name/logo and the public proposal table has mobile labels.
- Purchase-order receiving no longer reports failed lines as received.
- System Health Phase A shows existing notification-delivery failures to admins.
- Modal focus management, clickable-row keyboard behavior, photo resizing, and the core reliability
  write checks are deployed.
- Migration 134 (`client_id` carry-through onto Projects) is drafted with its verification script
  but **NOT applied** -- kept local for E's review, exactly like every unapplied migration before it.
- Sales quote BOM lines and Proposal Template sections both support accessible Move up/down
  reordering (`line_sort`/`sequence_order`, both existed unused before Queue A3/A4).
  `stack-table-mobile`'s `data-label` cells no longer silently overflow at mobile widths (Queue A6 --
  a real bug, found and fixed, not just a polish pass).
- A read-only proposal-version comparison (`compareProposalSnapshots`) is live in the Quote Proposal
  section once a quote has 2+ versions (Queue A5).
- The customer-facing proposal AND submittal email sign-offs both use the real frozen `companyName`
  instead of a hardcoded product name (Queue A7, then Queue A11 for submittals). `SubmittalSnapshot`
  now carries the same optional `companyName`/`companyLogoUrl` fields `ProposalSnapshot` does, and
  `SubmittalPublicPage` renders them via the same shared `.proposal-public-brand` block.
- Client Ledger field edits are serialized per-project through `createClientLedgerSaveQueue` (Queue
  A10) -- an older failed save can no longer overwrite a newer edit, and the previously log-only
  failure now surfaces a plain banner.
- `loadInventoryItems` (Queue A12) fetches deterministic paginated pages instead of one unbounded
  request -- the real silent-truncation risk Queue B6 found is closed; a load failure now surfaces
  via the "Sync issue (N)" pill (`criticalLoadErrors.inventoryItems`) instead of rendering an
  indistinguishable empty catalog.
- `nodemailer`/`pdfjs-dist` bumped to fixed versions and remaining transitive build-tool advisories
  resolved via `npm audit fix` (Queue A13) -- `npm audit` now reports only `xlsx` (no fix available,
  gated on D6).
- `has_role()`'s hardening migration is drafted and parked for E (Queue A14, migration 135) --
  **NOT applied.**
- `PRODUCT_CRITICAL_FLOW_COVERAGE_MATRIX.md` documents what's proven by TS tests, SQL tests, prod
  verification, and what still needs real-world use, for all six Queue A8 flows.
- **Queue B (B1-B10) produced ten design/spec/audit documents, none implemented**:
  `PRODUCT_CLIENT_LEDGER_SAVE_RECOVERY_PLAN.md` (D1), `PRODUCT_SALES_PRICING_IMPLEMENTATION_PLAN.md`
  (D2), `PRODUCT_SHARE_LINK_IMPLEMENTATION_PLAN.md` (reconciled, D7/Stage 2), an expanded
  `PRODUCT_SYSTEM_HEALTH_PLAN.md` (D8), `PRODUCT_BACKUP_RESTORE_CHECKPOINT_SPEC.md` (D9),
  `PRODUCT_INVENTORY_PAGINATION_DESIGN.md` (D10), `PRODUCT_SUPPORT_MODULE_DESIGN.md` (D13),
  `PRODUCT_ENGINEERING_MODULE_DESIGN.md` (D14), `PRODUCT_MARKETING_SALES_DESIGN.md`, and
  `PRODUCT_SECURITY_DEPENDENCY_FOLLOWUP.md` (D6, plus 6 newly-found `npm audit` advisories not
  previously tracked, and a clean review of every security-definer function added since the last
  audit). Read the relevant one before touching its area, rather than re-deriving the same ground.

Do not reimplement these. Verify only where the current task depends on them.

## 5. Queue A — implement and ship without waiting for a business decision

### A1. Close migration 133's browser-verification gap

**Status: DONE — `8bc6154`.** Read-only evidence recorded in `HANDOFF.md`: admin recognized, prior
Sync issue gone, Pending Approvals renders, no new console errors.

**Type:** read-only production verification.  
**Start here:** `HANDOFF.md` top entry; Pending Approvals and Team Roster in `src/main.tsx`.

When an authenticated session is available, reload after a fresh sign-in and confirm:

- the account is recognized as admin;
- the prior role-caused Sync issue is gone;
- Pending Approvals still renders for Manager/Admin;
- there are no new console errors or failed authorization requests on a normal read-only page load.

Do not create an approval, change a role, or cause a write just to test this. If no authenticated
session is available, record that and proceed to A2.

**Done:** direct read-only evidence recorded in `HANDOFF.md`, or an honest “session unavailable” note
with no further delay.

### A2. Prepare `client_id` carry-through for quote-to-project conversion

**Status: DONE (prepared, not run) — `bf9fe43`.** Migration 134 and its verification script are
drafted and parked for E; see §4 baseline note. Not applied.

**Type:** migration package preparation; do not run; do not block later tasks.  
**Source:** `PRODUCT_MASTER_COMPLETION_PLAN.md` §4 item 7 / §5 Batch 4.  
**Primary files:** latest live definition of `public.create_project_from_quote(uuid)`,
`backend/supabase/migrations/127_atomic_project_conversion.sql`, later corrections that redefine its
dependencies, and the existing conversion test script.

Required package:

- Confirm the next free migration number at execution time. Never assume `134` without checking.
- Create one additive migration that preserves the entire latest live function and adds the quote's
  nullable `client_id` to the inserted Project row.
- Preserve every authorization, active-workspace, idempotency, receipt, error-code, trigger-chain,
  and result-shape guarantee already live.
- Create one canonical transaction-safe test script proving:
  - a quote with `client_id` produces a Project with the same `client_id`;
  - a quote without it still converts successfully with null;
  - retry returns the same Project and does not change ownership;
  - wrong-workspace/role/status denials remain intact;
  - fixtures roll back and zero sections are silently skipped.

Do not add a human-readable quote reference in this batch. `projects` has no destination column for
it; that is decision D3.

**Done for overnight work:** migration and test files are fully reviewed, docs updated, no dependent
frontend is shipped, and the package is parked for E. Continue to A3 without asking E to run it.

### A3. Add accessible ordering controls to Sales quote BOM lines

**Status: DONE — `a9a3f67` / `6a92247`.** Move up/down shipped, deployed, and verified live.

**Type:** code-only, ship when verified.  
**Source:** `PRODUCT_MASTER_COMPLETION_PLAN.md` §5 Batch 10.  
**Primary files:** Sales Quote Builder in `src/main.tsx`; Sales quote BOM persistence in
`src/persistence.ts`; `sales_quote_bom_lines.line_sort`.

Build explicit **Move up** and **Move down** controls using the existing `line_sort` field. Do not add
a drag-and-drop package. Buttons must be keyboard accessible, disabled at the first/last boundary,
and use checked pessimistic writes. A failed reorder must leave the visible order unchanged and show
a plain error while logging technical detail.

Keep reordering scoped to one quote. Normalize the affected rows to deterministic integer order and
test first/middle/last moves, failure behavior, and rapid consecutive actions. Do not alter price,
quantity, catalog link, or proposal history.

**Done:** persisted order survives reload; failure cannot create a false saved order; deployed and
recorded.

### A4. Add ordering controls to Proposal Template sections

**Status: DONE — `a36cd3a` / `7beb909`.** Move up/down shipped, deployed, and verified live;
existing sent proposal snapshots confirmed unchanged.

**Type:** code-only, ship when verified.  
**Primary files:** Proposal Template Admin panel in `src/main.tsx`;
`updateProposalTemplateSection()` in `src/persistence.ts`; existing `sequence_order` field.

Use the same accessible Move up/Move down interaction as A3. Existing sent proposals must remain
unchanged because they use `content_snapshot`; verify this by source and regression test. Do not add
template approvals, workspace-scoping, or new permissions.

**Done:** current template order persists; sent proposal snapshots remain historical; deployed.

### A5. Build proposal-version comparison from existing snapshots

**Status: DONE — `a0baa92` / `8a7a42c`.** Read-only comparison view shipped and deployed;
`compareProposalSnapshots` covered by 7 dedicated tests.

**Type:** code-only/read-only feature, ship when verified.  
**Source:** `PRODUCT_MASTER_COMPLETION_PLAN.md` §5 Batch 12.  
**Primary files:** `loadProposalsForQuote()` and `SalesQuoteProposal` in `src/persistence.ts`; proposal
history UI in `src/main.tsx`.

Add a read-only comparison view for two existing proposal versions. It must compare frozen snapshot
content only and must not create, update, approve, reject, disable, or regenerate a link. Default to
the newest two versions when available; provide explicit version selectors; show clear added,
removed, and changed sections/BOM rows using stable keys where present and careful fallback matching
where they are absent. Do not claim a legal document diff; label it as an operational comparison.

Tests should cover identical versions, added/removed sections, changed values, missing optional
snapshot fields from older proposals, and one-version/zero-version empty states.

**Done:** a salesperson can understand what changed between two stored versions without modifying
either; deployed.

### A6. Proposal mobile and print verification/polish

**Status: DONE — `7e350e9` / `a5be390`.** Verified at 360/390/768/desktop plus print; found and
fixed a real silent overflow bug in `stack-table-mobile`'s `data-label` cells (masked in production
by `overflow-x: hidden`). Real Chrome window minimization blocked one direct-device re-check;
isolated-harness evidence used instead and documented as such, not claimed as device verification.

**Type:** code-only fixes arising from verification; no new feature decision.  
**Primary files:** `ProposalPublicPage` in `src/main.tsx`; proposal CSS in `src/styles.css`.

Verify at 360, 390, 768, and desktop widths plus print preview. Check branding, long client/site
names, long item descriptions, quantity, datasheet links, response controls, and status/error states.
Fix only demonstrated overflow, clipping, unreadable stacking, touch-target, contrast, or print
problems. Preserve the existing frozen snapshot and response workflow.

**Done:** screenshots or browser evidence for the tested sizes, zero console errors, and any fixes
deployed. Do not describe desktop verification as mobile-device acceptance.

### A7. Productization identity and configuration sweep

**Status: DONE — `48cece8` / `6b56b2b`.** Proposal email sign-off now uses the frozen
`content_snapshot.companyName` with an "Ergon" fallback. `send-submittal-email.js`'s equivalent gap
(no company-branding fields on `SubmittalSnapshot` at all) is a named, deliberately-unfixed
category-3 item, not silently rewritten — tracked for Queue B/decision register.

**Type:** source audit plus safe code-only corrections.  
**Source:** `PRODUCT_ONBOARDING_CONFIG.md` §1.  
**Primary files:** `src/main.tsx`, `src/persistence.ts`, email/API templates, seeded defaults.

Separate three categories:

1. **Ergon product identity** — may remain Ergon on pre-login/product chrome.
2. **Customer company identity** — must come from `company_branding` or a frozen document snapshot
   where that data is already available.
3. **Historical or legal customer-specific content** — document and decision-gate; never silently
   rewrite.

Fix only category-2 cases with an existing data source and no workflow ambiguity. Add regressions
for customer-facing documents/emails that currently have the data available. Produce a short table
of remaining category-3 items for Queue B. Do not create a second workspace or onboarding flow.

**Done:** no confirmed customer-facing surface with available branding data still displays another
company's identity; unresolved legal/default content is explicitly listed.

### A8. Strengthen read-only acceptance coverage for completed critical flows

**Status: DONE — `3e3d940`.** `PRODUCT_CRITICAL_FLOW_COVERAGE_MATRIX.md` documents coverage for all
six flows; one material gap found (`SubmittalSnapshot` branding fields, same gap as A7) and named
rather than papered over with duplicate tests.

**Type:** tests and verification only.  
**Targets:** quote-to-project conversion result mapping; Project BOM replacement; Equipment Recipe
save queue; purchase receiving failure state; proposal response/submittal response outcome mapping;
backup restore structured outcome.

Review existing tests for behavior gaps rather than increasing a number. Add tests only for material
cases not already covered: stale response mapping, failure preserving local state, idempotent retry,
or old snapshot compatibility. Do not add tests that duplicate SQL test coverage or implementation
line-for-line.

**Done:** a documented coverage matrix says what is proven by TypeScript tests, SQL tests, production
read-only checks, and what still requires natural real-world use.

### A9. Reconcile roadmap and handoff truth

**Status: DONE — this pass.** Header and §4 baseline updated; each of A1-A8 above now carries its own
`Status: DONE` line with the closing commit hash(es); `HANDOFF.md` and
`PRODUCT_MASTER_COMPLETION_PLAN.md` were already kept current incrementally after every batch (see
each dated entry), so this pass is the cross-check confirming that, not a backlog of unresolved
staleness. No false "not implemented" or stale "next action" statements found still standing for
A1-A8 as of this reconciliation.

**Type:** documentation.  
**Files:** `HANDOFF.md`, `PRODUCT_MASTER_COMPLETION_PLAN.md`, relevant product documents.

Remove stale “not implemented,” “next action,” and “draft” statements only when later evidence proves
them false. Keep historical entries accurate rather than rewriting history; add a current-status
banner or superseded marker where needed. Verify commit hashes and migration filenames from Git.

**Done:** a new coder reading only this page, the top of `HANDOFF.md`, and the master plan gets the
same current state.

### A10. Implement the Client Ledger serialized save queue

**Status: DONE — `43df8ea`.**
`createClientLedgerSaveQueue` (`src/persistence.ts`) implemented per Option B, wired into
`handleUpdateProjectLedgerInfo` (`src/main.tsx`) via a new `clientLedgerSaveQueueRef`.
`updateProjectLedgerInfo` now throws and returns the confirmed row instead of logging-and-swallowing.
7 new tests in `src/client-ledger-save-queue.test.ts` cover all six proof cases the design doc named;
`purchasing-write-verification.test.ts`'s existing describe block updated to match. 376/376 passing,
tsc/eslint/build/smoke all clean.

**Status: READY — start automatically.** Queue B1 removed the earlier uncertainty: the serialized,
latest-snapshot queue is the only design that prevents an older failed request from overwriting a
newer edit, and it changes no business workflow. This is now a technical reliability implementation,
not a business decision.

Implement `PRODUCT_CLIENT_LEDGER_SAVE_RECOVERY_PLAN.md` Option B. Scope the queue per `projectId`,
coalesce pending field changes, reconcile only confirmed server rows, never blindly revert, surface
one visible plain-language failure, and keep different projects independent. Add the six specified
tests, then ship under §3's delivery rule. If source inspection reveals a real business-behavior
choice not covered by that plan, document it and continue to A11; do not stop the entire queue.

### A11. Freeze company identity into submittals

**Status: DONE — `2ad1d5e`.** Mirrored the
Queue A7 proposal pattern exactly: `SubmittalSnapshot` gains optional `companyName`/`companyLogoUrl`,
`handleCreateSubmittal` freezes current branding at creation, `SubmittalPublicPage` renders the same
shared `.proposal-public-brand` block, `send-submittal-email.js`'s sign-off uses the frozen name with
an Ergon fallback. 2 new email tests; 378/378 passing, tsc/eslint/build/smoke all clean. Not verified
against a real submittal in the browser (no share token available without fabricating one against
production data) -- stated plainly in `HANDOFF.md`, not overclaimed.

**Status: READY — start automatically after A10.** Queue A7 closed proposal branding but found the
parallel submittal gap: `SubmittalSnapshot` has no company name/logo, and the submittal email still
uses a fixed sign-off.

Mirror the already-deployed proposal pattern:

- add backward-compatible optional company name/logo fields to newly created submittal snapshots;
- render frozen identity on the public submittal page where the proposal page already does;
- use the frozen company name in the submittal email sign-off;
- retain a safe legacy fallback for old snapshots;
- never alter an already-sent snapshot when Admin branding later changes.

Do not change submittal ownership, approval, response, link, or PM handoff behavior. Add snapshot/
email mapping tests and ship under §3.

### A12. Remove the silent inventory row-cap without changing the UI

**Status: DONE — `b7449f1`.**
`loadInventoryItems` now fetches deterministic 500-row pages (ordered `item_name.asc,id.asc`) until a
short final page, dedupes by real row id, throws instead of returning a partial list on any page
failure, and has a 200-page safety guard. Both callers updated; the session-load one now surfaces a
failure via `setCriticalLoadError("inventoryItems", ...)` instead of swallowing it. 6 new tests cover
all five named cases. 384/384 passing, tsc/eslint/build/smoke all clean. No picker changed, no
infinite scroll added.

**Status: READY — start automatically after A11.** Queue B6 confirmed `loadInventoryItems` can be
silently truncated by PostgREST's configured maximum. A paginated UI is a later UX decision, but
returning the complete dataset to today's existing consumers is a correctness fix.

Change `loadInventoryItems` to fetch deterministic, non-overlapping pages until the final short page
instead of relying on one unbounded request. Preserve its public return type and alphabetical order,
deduplicate defensively by stable row id, fail visibly on any page error, and add a finite safety
guard that throws rather than silently returning a partial catalog. Tests must cover one page,
multiple full pages plus a short final page, an exact-full-page boundary, duplicate defense, and a
later-page failure. Do not redesign any picker or add infinite scrolling in this batch.

### A13. Apply compatible security dependency updates, excluding `xlsx`

**Status: DONE — `28232b5`/`f3457e7`/`e6bda50`.** Three separately revertable commits: `nodemailer`
9.0.5→9.1.1, `pdfjs-dist` 6.1.200→6.3.289, then `npm audit fix` (no `--force`) for the remaining
transitive build-tool deps (postcss/browserslist/nanoid/baseline-browser-mapping). `xlsx` untouched.
`npm audit` now reports 1 remaining vulnerability (`xlsx`, down from 7). Full §3 suite (384/384,
tsc/eslint/build/smoke) passed independently after each commit.

**Status: READY WITH STRICT SCOPE.** Queue B10 found new advisories with non-breaking fixes available.
Update only packages that can be remediated within their current compatible major versions. Keep
`xlsx` unchanged pending D6. Do not use a force/major audit fix. Review the resulting lockfile and
run the full §3 suite, plus the PDF/email paths affected by `pdfjs-dist` or `nodemailer` where a
focused test exists. Commit each logically independent dependency group so it can be reverted
cleanly. Record advisories that remain.

### A14. Prepare `has_role()` hardening as a manual migration package

**Status: DONE (prepared, NOT run) — `4b96fbe`.**
`backend/supabase/migrations/135_harden_has_role_search_path.sql` (confirm 135 is still free at
execution time) preserves exact logic/signature, adds `search_path=''` + full qualification +
minimum grants. Its test script proves representative true/false checks, the actual grant-state
change (`has_function_privilege`), and that a real RLS policy calling `has_role()` still produces the
identical outcome. Every real call site traced via full grep -- all are RLS policies scoped
`to authenticated`, none nested inside another `security definer` function. Parked for E; not run.

**Status: PREPARE ONLY — do not run.** Queue B10 reconfirmed the old helper lacks the hardened
`search_path=''`/fully-qualified pattern now required of newer authorization functions and is used by
many policies.

Trace the latest live signature and every overload/caller. Draft one migration that preserves exact
logic/signature while setting an empty search path, fully qualifying every object, and reproducing
the minimum grants. Draft one canonical transaction-safe test proving representative true/false
role checks through real authenticated execution plus routine-grant state. Do not alter policies,
role vocabulary, or authorization results. Park the reviewed package for E and continue to A15.

### A15. Final post-continuation reconciliation

Update this file, `HANDOFF.md`, the master plan, Queue B source documents, and the critical-flow
coverage matrix with A10–A14's actual outcomes. Consolidate manual database actions into one ordered
list, but still present only one migration action at a time when E is ready. If any code-only item is
unfinished, name the concrete technical blocker and resume another independent item before ending.

## 6. Queue B — prepare while implementation items are blocked

**Status: B1-B10 all complete as of this pass — see each item's own `Status: DONE` line below for its
commit hash.** Every Queue B deliverable is a design/spec/audit document; none required or performed
production code, a migration run, or a package change, per this section's own scope rule. The next
coder should resume at A10–A15 above. Queue B remains useful as the implementation specification
behind those tasks and for later decision-gated waves; it does not need to be rewritten.

These tasks keep useful work moving. They may produce designs, test matrices, prototypes isolated
from production code, or migration drafts explicitly marked **NOT RUN**. They may not silently choose
the business rule.

### B1. Client Ledger safe-revert implementation specification

**Status: DONE — `9232988`.** `PRODUCT_CLIENT_LEDGER_SAVE_RECOVERY_PLAN.md` traces the caller,
explains the 2026-09-11 revert-on-failure attempt's unsafety, and specifies the state machine and a
serialized latest-snapshot save queue, matching D1's recorded direction. No production code.

Trace the current caller, overlapping debounced saves, and the earlier reverted attempt. Produce an
exact state machine for: idle, saving revision N, newer local edit exists, success, failure, retry.
Compare per-field rollback with an in-flight queue and recommend one using concrete examples. Include
tests that would prove no older failed request can overwrite a newer edit. This design task is done;
the resulting technical direction is cleared for implementation in A10.

### B2. Frozen Sales pricing implementation package

**Status: DONE — `30caf4b`.** `PRODUCT_SALES_PRICING_IMPLEMENTATION_PLAN.md` defines the full model
per D2, migration pseudocode, and a 6-case test matrix. No production code, no migration run.

Turn the existing discovery into a reviewable schema/API/UI specification. Define catalog-default
price, editable quote price, frozen proposal price, internal cost/margin visibility, tax/discount
scope, version behavior, and conversion carry-through. Provide migration pseudocode and a test
matrix, not a runnable migration, until D2 is answered.

### B3. Share-link implementation readiness

**Status: DONE — `8879b25`.** `PRODUCT_SHARE_LINK_IMPLEMENTATION_PLAN.md` reconciled against the live
schema and Part 12/13: bridge (124-126) confirmed live, three tables' real RLS state checked (none
match the decided model), Stage 2 fields confirmed absent, and an explicit 11-step dependency order
added naming exactly which step first changes real client behavior. No production code.

Reconcile the eight decided policies in
`PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md` with the missing Stage 2 fields and current
proposal/submittal RPCs. Produce the exact schema/function/frontend dependency order and identify
which step first changes real client behavior. Do not implement authority/handoff schema or link
behavior until its required review gate is met.

### B4. System Health Phase B package

**Status: DONE — `5a292de`.** Added the missing failure-in-the-monitor-path section and expanded
build sequencing into concrete function names, file locations, and a per-step test matrix. D8/alert
channel left explicitly open, unchanged. No production code, no migration.

Refine `PRODUCT_SYSTEM_HEALTH_PLAN.md` into a migration/API/UI/test sequence. Fully specify the
90-day detailed retention plus long-term aggregate counts already decided, safe-detail redaction,
deduplication, acknowledgment, retry eligibility, and failure-in-the-monitor path. Keep alert
recipient/channel as one explicit unresolved field (D8). No runnable migration until that decision
or an instruction to proceed without alert delivery.

### B5. Backup restore resume/checkpoint specification

**Status: DONE — `c361164`.** `PRODUCT_BACKUP_RESTORE_CHECKPOINT_SPEC.md` builds on the already-
shipped structured `RestoreOutcome`, defines `restore_runs`/`restore_run_sections`, the
`(restore_run_id, section)` retry key, resume, cancellation, and the stale-reference rule, per D9's
recorded direction. No production code, no migration.

Define `restore_runs`, per-section status, deterministic retry keys, resume behavior, cancellation,
and the rule for references that no longer resolve. Use synthetic snapshots only. Do not implement
until restore leniency D9 is answered.

### B6. Inventory pagination design

**Status: DONE — `f11a1c2`.** `PRODUCT_INVENTORY_PAGINATION_DESIGN.md` traces all 114 consumers,
recommends a second, independent cursor-paginated query for only the two table views (leaving the
other ~110 lookup/dropdown/aggregate consumers untouched), and flags a real, un-fixed PostgREST
row-cap risk found while tracing. Existing alphabetical query left uncapped, per instruction.

Trace every `loadInventoryItems` consumer. Specify server-side search, stable cursor/order, selected
item hydration, empty/loading/error states, and how existing dropdowns avoid losing a selected item
outside the current page. Recommend a default UX with a small interaction sketch. Do not cap the
existing alphabetical query.

### B7. Support/Service module product design

**Status: DONE — `aa3748f`.** `PRODUCT_SUPPORT_MODULE_DESIGN.md`: entry from Client Ledger, reuses
`installed_assets`/warranty data and the `project_submittals` status shape, one append-only activity
table for the full lifecycle. Permissions/workflow explicitly not decided, per instruction.

Build the first real design document for post-close service: entry from a closed Project/Client
Ledger record, installed asset/warranty context, ticket/request statuses, ownership, priority/SLA,
client communication, scheduled maintenance, parts/labor, resolution, and reopen. Distinguish what
already exists from proposed schema. Do not implement permissions or workflow before review.

### B8. Engineering/Product Development module product design

**Status: DONE — `aa3748f`.** `PRODUCT_ENGINEERING_MODULE_DESIGN.md`: two roles kept separate on
purpose (matching their already-different Inventory permissions), request-through-review-to-Catalog-
release schema, kept arm's-length from Project implementation, forward link to Support (B7).

Define who uses it and the first useful feature set: product/solution requests, requirements,
technical review, prototype/test results, version/release readiness, links to Catalog and Projects,
and handoff to Support. Keep Engineering delivery work distinct from Project implementation. Produce
screens, data objects, permissions questions, and a smallest useful first release.

### B9. Marketing-to-Sales design

**Status: DONE — `aa3748f`.** `PRODUCT_MARKETING_SALES_DESIGN.md`: maps leads into the existing
`clients`/`sales_quotes` tables (no parallel company concept), no HubSpot integration built or
promised, dedup against `clients`' existing unique-name constraint plus a human-confirmed path for
cross-lead duplicates.

Map lead source, campaign, company/contact, qualification, opportunity, activities, ownership, and
conversion into today's Sales Quote without re-entry. Include HubSpot coexistence/import boundaries
and deduplication. Do not promise or build a HubSpot integration without a separate decision.

### B10. Security/dependency follow-up

**Status: DONE — `aa3748f`.** `PRODUCT_SECURITY_DEPENDENCY_FOLLOWUP.md`: `xlsx` finding revalidated
unchanged; 6 new `npm audit` advisories found and reported (none fixed); all 7 security-definer
functions added since the last audit reviewed clean against all four criteria; `has_role()`'s known-
unhardened status confirmed still open but correctly avoided by every one of them.

Refresh the read-only dependency audit. Revalidate the `xlsx` finding and the existing `exceljs`
evaluation against current source; do not install or replace a package. Review public RPC execute
grants and newly added security-definer functions since the last audit for `search_path=''`, fully
qualified references, minimum grants, and safe errors. Findings only unless a fix is purely
grant-hardening with zero behavior change; any database fix remains a manual migration package.

## 7. Queue C — full product completion sequence

This is the larger plan. A coder should resume at the first wave whose prerequisites are satisfied,
and use Queue B whenever a decision blocks implementation.

### Wave 0 — current production reliability

Finish A1–A9. Close natural-use acceptance gaps as real activity occurs. Maintain System Health and
write verification. Gate: no known silent partial-write path remains in a Critical workflow.

### Wave 1 — Sales authoring foundation

Complete accessible ordering, proposal version comparison, client carry-through, brand/mobile/print
polish, and bundle-components behavior after D5. Gate: a salesperson can create, edit, order, version,
and present a quote without leaving Ergon for document assembly.

### Wave 2 — Sales pricing and customer proposal

After D2/D4: add frozen per-line unit price and cost, controlled overrides, totals, discounts/tax as
decided, customer-visible detail, internal margin, proposal version snapshots, dashboard/reporting
based on frozen values, and approval-before-send where required. Gate: one real quote is priced and
sent without PandaDoc/HubSpot presentation work.

### Wave 3 — Proposal/submittal link lifecycle

After the share-link readiness review: implement expiry, disable/re-enable, permanent revoke,
regeneration/supersession, client-facing reason text, audit events, quote-delete behavior, and the
Sales-vs-assigned-PM authority cutover already decided. Gate: every link has a visible lifecycle,
first-response-wins remains atomic, and unauthorized/replayed/expired actions are denied and tested.

### Wave 4 — Billing review and Project handoff

Implement the capability system, assigned PM, PM reassignment record, conversion request/approval,
quote-level down-payment clearance carried into Project, Manager/Admin override with reason and
notification, and auditable handoff snapshot. Gate: an accepted quote cannot enter active Project
execution until the decided Billing/down-payment and approval conditions are satisfied.

This is operational Billing workflow only. It is not the later commercial SaaS subscription system.

### Wave 5 — Tenant isolation

After the required discussion: implement Phase 3 as staged table groups, beginning with the complete
Clients/Sales Quote ownership graph in `PRODUCT_PHASE3_PLAN.md`. Include child-table denial,
security-definer/public-token behavior, notification ownership, global-uniqueness changes, Storage
path/policy isolation, platform-admin escape-hatch tests, and multi-membership behavior. Gate: an
automated two-workspace suite proves Workspace B cannot read/write/delete Workspace A data.

No real second customer workspace may be onboarded before this gate passes.

### Wave 6 — Product onboarding and no-code setup

Build platform-admin workspace creation; company identity; timezone/contact; user invites; roles and
capabilities; terminology; starter templates; notification settings; integrations; preview/version/
rollback; setup checklist; and first-login guidance. Gate: a new customer reaches a working empty
workspace without code edits or manual database inserts.

### Wave 7 — Marketing and CRM

Build the reviewed B9 design: campaigns/sources, leads, contacts/companies, qualification,
opportunities, activity history, ownership, quote conversion, dedupe/import, and Sales dashboard.
Gate: a lead can move from Marketing to a quote with history and ownership intact.

### Wave 8 — Project execution and closeout

Finish Client Ledger safe-revert, backup resume/checkpointing, drawing/document categories,
stakeholders, shipment/receiving integration, installed-asset completeness, closeout requirements,
and handoff to Service. Gate: a Project closes with a complete, trustworthy customer record and a
repeatable support handoff.

### Wave 9 — Service/Support

Implement the reviewed B7 scope: request intake, triage, assignment, SLA/priority, installed assets,
warranty, site history, parts/labor, client updates, resolution/reopen, and reporting. Gate: a real
post-close issue is handled end to end inside Ergon.

### Wave 10 — Engineering/Product Development

Implement the reviewed B8 smallest release and its Catalog/Project/Support links. Gate: one real
product or solution request moves from intake through technical review to a released outcome.

### Wave 11 — Commercial SaaS readiness

Only after explicit authorization: product subscriptions, plans, trials, entitlements, metering,
invoicing/payment provider, customer billing portal, suspension/reactivation, and platform support.
Gate: a separate test customer can be onboarded, isolated, billed, and supported without code or
manual database work.

## 8. Decision register — ask once, in a consolidated review

These decisions should be presented together at a natural checkpoint. They are not reasons to stop
Queue A/B work.

| ID | Decision | Recommended working direction | Blocks |
|---|---|---|---|
| D1 | **Resolved as a technical reliability choice:** Client Ledger failure recovery | Implement the serialized, latest-snapshot save queue in A10; never let an older failure overwrite a newer local edit | Nothing after A10 ships |
| D2 | Frozen quote pricing: when may price change before send, and what is frozen? | Catalog price is the starting default; Sales may deliberately override with audit; each sent proposal version freezes its own prices/costs | Pricing migration/UI |
| D3 | Add a human-readable quote reference to Projects, and what column name? | Add nullable `source_quote_ref`; keep `source_sales_quote_id` as the durable link | Quote-ref carry-through |
| D4 | Customer pricing detail and approval threshold | Show line price + subtotal + total; Manager approval only above a configured discount/margin threshold | Proposal price display/approval |
| D5 | `bundle_components`: expand into real lines or relabel as notes? | Expand only after structured component data replaces the current free-text format; meanwhile relabel so it does not imply automation | Bundle behavior |
| D6 | `xlsx` dependency | Replace with `exceljs` after a real-file proof of both import paths | Dependency remediation |
| D7 | **Already decided:** Share-link policies | Use the eight recorded decisions and seven follow-up decisions in the canonical share-link document; do not ask E to decide them again | Stage 2 schema/review, not a missing policy answer |
| D8 | System Health down alert recipients/channel | Email every workspace admin by default; later allow a configurable on-call list/channels | System Health alerting |
| D9 | Backup restore unresolved references | Allow a clearly warned per-section skip/retry during restore; live entry remains strict | Restore checkpointing |
| D10 | Inventory pagination UX | A12 first removes silent truncation transparently; later use server-side search + cursor pagination while preserving selected rows | Later UI/performance work, not A12 correctness |
| D11 | **Already established process:** Phase 3 RLS rollout | Discuss first, then review and approve one complete table group at a time; Clients/Sales Quote graph first | Tenant isolation/onboarding implementation discussion |
| D12 | E-signature legal weight and server PDF | Keep typed acceptance until the business confirms stronger legal requirements; evaluate PDF separately | Advanced proposal features |
| D13 | Support first release | Ticket/request lifecycle linked to Client Ledger, Project, site, and installed asset | Support module |
| D14 | Engineering first release | Product/solution request + technical review + Catalog release link | Engineering module |
| D15 | **Already decided for now:** Commercial SaaS billing | Remains deferred until explicit authorization; do not ask again during current operational-product work | SaaS commercialization only |

## 9. Consolidated reporting format

The coder's report should contain:

1. **Shipped and live** — commits, production URL, direct evidence.
2. **Completed locally / prepared for review** — especially migration packages, clearly marked not
   run.
3. **Verification** — test counts and what they actually prove.
4. **Blocked** — one-line blocker and decision ID; no long conversational history.
5. **New findings** — confirmed source/runtime findings separated from recommendations.
6. **Next automatic task** — the next Queue A/B item the coder will start without waiting.
7. **User actions** — one consolidated list, and only actions that truly require E.
8. **Git state** — HEAD, `origin/main`, and working tree.

The report must never end with “what would you like me to do next?” while an unblocked Queue A or B
item remains.

## 10. Start instruction for the next coder

Read this file, then the top current-status entries in `HANDOFF.md`, then
`PRODUCT_MASTER_COMPLETION_PLAN.md`. Verify Git and begin at A1. If A1 lacks an authenticated
session, record that fact in one line and begin A2 immediately. Continue until all available A and B
work is complete.
