# Ergon Ops — Continuous Coder Handoff

Status: **QUEUE C2 IS FULLY CLOSED.** A1–A15, B1–B10, QUEUE C1 (SALES PRICING), QUEUE C2.2–C2.6
(SHARE-LINK LIFECYCLE FOUNDATION + INTERNAL CONTROLS, MIGRATIONS 137–144), QUEUE C2.7 (SERVER-OWNED
CREATE & SEND + DIRECT-WRITE CLOSURE), MIGRATION 145 (re-applying migration 143's view-logging
function bodies, which had been recorded as applied but were never actually live — root-caused via a
six-round diagnostic investigation), and the version-comparison status-badge fix are ALL
applied/shipped in production, every migration with a passing canonical test. **No open items remain
anywhere in Queue C2.**
Prepared: 2026-09-12, updated 2026-09-15. E approved the recommended
pricing statement below and C1.1–C1.9 executed continuously against it (frozen Sales pricing:
`unit_price`/`price_source` on `sales_quote_bom_lines`, `discount_percent`/`tax_rate` on
`sales_quotes`, `accepted_proposal_total` on `projects`, frozen totals in every new
`ProposalSnapshot`, Sales Quote Builder UI, customer proposal display, KPI fixes, 22 new tests, full
doc reconciliation). Migration 136 and its canonical test passed; the prepared commits were pushed
to `main` and Vercel deployed them.
Production: `https://ergon-ops-app.vercel.app/` (Queue C1 bundle verified live 2026-09-13).

**✅ Completed and verified:**
- Queue C2.2–C2.5 (share-link lifecycle foundation): migrations 137 (+141), 138, 139, 140 (+142) —
  all applied, every canonical test returned `Success. No rows returned` with zero sections skipped.
  Migration 139's paired frontend fix (parsing the new `outcome` column on the two public share-link
  pages) is live, shipped same-day ahead of its own test after checking 139's live effect surfaced
  an active production defect.
- Queue C2.6 (internal lifecycle controls): Disable/Re-enable, Permanently Revoke & Generate New
  Link, Activity history — shipped and deployed (`35bc262`).
- Migration 143 (view-logging follow-up, found while reconciling docs against C2.6): applied in
  production (`Success. No rows returned`).
- **Migration 143's canonical test found a real bug on its own live run (2026-09-14) — FIXED, TEST
  SCRIPT ONLY, migration 143 itself untouched.** E's run failed with `ERROR: 42501: new row violates
  row-level security policy for table "project_submittals"`. Root cause: the test's fixture setup
  switched `role` to `'authenticated'` to insert its fixtures — worked when first drafted (migration
  025's/053's write policies on `project_submittals`/`sales_quote_proposals` still existed then), but
  migration 144 (applied later the same day) deliberately dropped both policies, so the same
  direct-write rejection 144's own test proves is exactly what 143's fixture setup was still relying
  on. This is genuinely why E "swore it ran fine before" — it did, before 144 shipped. **Fixed**:
  fixture creation no longer switches `role` at all — only the jwt-claim GUCs are set, so fixtures run
  as the script's own original (superuser) role and bypass RLS regardless of policy state, matching
  144's own test's already-proven pattern. Verified at the trigger level, not by analogy:
  `guard_workspace_id_mutation()` (migration 117) stamps `sales_quotes.workspace_id` via
  `resolve_caller_workspace_id()`, which reads only `auth.uid()` — itself reading only the jwt-claim
  GUCs, never `role` — so the admin's real workspace membership still resolves correctly. Corrected
  test resent to E.
- **Corrected migration 143 test's re-run surfaced a SECOND, more serious real bug (2026-09-14) —
  POTENTIAL PRODUCTION DEFECT, under active investigation, NOT yet fixed.** E's re-run got past
  fixture creation and failed at Section 1: `TEST FAILED: expected exactly one 'success' share_link_
  views row for the active proposal token after one lookup, found 0.` The RPC's own `outcome=found`
  check passed — the problem is specifically that `get_quote_proposal_by_token()`'s internal `insert
  into public.share_link_views (...)` produced no row. **This matters beyond the test**: that insert
  is wrapped in `exception when others then null;` inside the actual, applied, production function
  (deliberate — a logging failure must never block a real customer) — so if this insert is genuinely
  failing, it has been failing silently for every real page view since migration 143 was applied, and
  Queue C2.6's Activity panel (reads this exact table) has been showing 0 views the whole time with no
  error anywhere. Leading theory: migration 141 (already applied) revoked all direct table privilege
  on `share_link_views` from `anon`/`authenticated`/`public` — whether that blocks a `SECURITY
  DEFINER` function's own internal insert depends on live facts (table/function ownership, actual
  execution-role privileges) not determinable from source alone. A small diagnostic script
  (`backend/supabase/diagnostic_143_share_link_views_insert_failure.sql`, `begin;`/`rollback;`,
  nothing commits) was sent to E to surface the real (currently swallowed) Postgres error and report
  ownership/grant facts directly, before proposing any fix. **Do not treat Queue C2 as closed or
  migration 143's test as merely "pending a rerun" until this is root-caused.**
  **Update (v5/v6): ownership/grant theory RULED OUT** — `share_link_views` and
  `get_quote_proposal_by_token()` share the same owner (`postgres`), and a throwaway probe function
  with the identical insert (security definer, empty search_path, no exception swallowing) succeeded
  cleanly under this role. The real finding: **the LIVE deployed `get_submittal_by_token()`'s own
  source does not contain the insert statement migration 143 was supposed to add at all** — it appears
  to still be running an earlier version of the logic (or something reverted it). v6 dumps the live
  source of both functions verbatim via `pg_get_functiondef()` for direct comparison against
  `migrations/143_share_link_view_logging.sql` — sent to E, should be the final piece needed before
  drafting a real fix (likely a new migration re-applying these two function definitions).
  **v6 CONFIRMED it: both live functions are exactly migration 139's original logic** — no
  `v_view_result` variable, no `insert into public.share_link_views` anywhere. Migration 143's
  function-body changes were never actually live, despite being recorded as applied. Historical cause
  undetermined from the live database alone (recorded as an open question, not assumed). **Per this
  repo's standing rule, migration 143 itself is NOT edited or rerun.**
  `backend/supabase/migrations/145_reapply_share_link_view_logging.sql` re-applies the exact same
  intended function bodies via `create or replace function` — idempotent, safe regardless of current
  state, no design change (same signatures/outcomes/grants/exception-swallowing posture).
  `migration_143_share_link_view_logging_tests.sql` extended with a new **Section 0**: reads each
  function's live source via `pg_get_functiondef()` and asserts the logging insert is actually
  present, checked unconditionally before anything else — the exact check that would have made this
  instant instead of a six-round investigation. **Migration 145 APPLIED (2026-09-15) — `Success. No
  rows returned`.** The view-logging insert is genuinely live now. Do not run 145 again. **Its
  extended canonical test PASSED (2026-09-15) — `Success. No rows returned`, zero sections skipped,
  including the new Section 0 structural check. QUEUE C2 IS NOW FULLY CLOSED.**
- Queue C2.7 part 1 (frontend switch to the server-owned atomic RPCs,
  `create_and_send_submittal_version`/`create_and_send_quote_proposal_version`, replacing the old
  direct-INSERT flow): shipped and deployed (`05fa486`).
- Queue C2.7 part 2 (migration 144, closing the now-unused direct-write policies on
  `public_share_tokens`/`project_submittals`/`sales_quote_proposals`): **applied in production
  (2026-09-14) — `Success. No rows returned`.**
- **Migration 144's canonical test — PASSED in production (2026-09-14) — `Success. No rows
  returned`.** Zero sections skipped. **Queue C2.7 is now fully closed: all four of its original
  requirements (RPC switch, all four obsolete direct-write paths removed, frozen snapshots/version
  numbers/email delivery/visible errors/role boundaries preserved, narrowly-scoped direct-write-
  closing migration) are applied AND proven correct by their own canonical test.** One benign mix-up
  along the way, recorded for completeness: E first ran the migration file itself a second time by
  mistake (similar name to its test file, different directory) — failed harmlessly on a duplicate
  `CREATE POLICY` inside a single transaction, so nothing committed or changed; the correct test file
  was resent and passed cleanly on the real attempt.
- **Version-comparison/history UI — DONE, shipped and deployed (`32065e9`, 2026-09-14).** A
  superseded/disabled/revoked prior version now shows the same status pill in the version-comparison
  dropdown options and panel that `ShareLinkLifecycleControls` already shows in the version list
  above it (`shareLinkTokenStatusBadge`, shared between both). `tsc -b` clean, 431/431 Vitest (no
  regressions -- pure display logic, no new test file per this repo's own main.tsx-local-helper
  convention), `eslint` 0 errors, build clean. Deployed and confirmed live: the deployed bundle
  contains the new label strings, and the production page loads with zero console errors. **Real
  limitation, stated plainly rather than glossed over**: none of the 4 real quotes currently in
  production have 2+ sent proposal versions (checked all four directly), so the comparison panel
  itself -- and therefore this badge -- has no live data to render against yet. Not fixable without
  creating a real proposal version against real quote data purely for visual testing, which the
  standing boundaries forbid. The same limitation this repo already documented for the outcome-aware
  public pages (no real expired/disabled token available either) applies here for the same reason.

**✅ Still required: NONE. Queue C2 is fully closed** — every migration (137–145) applied and
canonically tested, every frontend piece shipped and deployed, zero open items.

**Explicitly out of scope for Queue C2 (a separate, pre-existing body of work, not tracked as part of
this queue's closure)**: the authorization-table policy closure (`app_user_roles`/`app_admins`' own
wide-open admin write policies) and the bridge-aware `accept_invite()` replacement — grouped under the
same "C2.7" label in an earlier planning pass but not share-link-specific. Tracked here so it isn't
mistaken for done, not silently dropped, but it is a new/separate body of work, not a Queue C2
follow-up.

Three corrective migrations were needed across this whole queue beyond the originally planned ones
(141/142 for real default-grant gaps, neither requiring editing an already-applied migration file,
matching this repo's own established rule) plus 143 for a real missing view-logging write path found
while reconciling docs.

**Queue C2.7 re-verification (2026-09-14, no code changes):** a fresh session was asked to "finish
Queue C2.7 completely" against a four-point requirements list (RPC switch, all four obsolete
direct-write paths removed, frozen snapshots/version numbers/email delivery/visible errors/role
boundaries preserved, and a narrowly-scoped migration closing direct writes). Every point was
independently re-verified against current source rather than assumed from this document's own prior
claims: `main.tsx:5183`/`5311` confirmed calling the RPCs; grep confirmed zero remaining
`createSubmittal`/`createSubmittalShareToken`/`createQuoteProposal`/`createQuoteProposalShareToken`/
`generateShareToken` definitions anywhere and zero remaining mutating `fetch()` calls against the
three tables (reads only); the submittal call site confirmed the frozen snapshot is still built
client-side, email still sends via `/api/send-submittal-email` with a real result surfaced through
`setSubmittalStatus`, and failures render real text, not a generic message; migration 144 confirmed
already applied and matching the narrow scope requested (no Phase 3, authorization-table work
explicitly excluded). All four requirements were already fully met — nothing needed to change. The
one genuinely outstanding action was sending E migration 144's canonical test, done in this pass.

## Next-session launchpad

**Repository checkpoint: QUEUE C2 IS FULLY CLOSED.** Migrations 134, 135, 136, 137 (+141), 138, 139,
140 (+142), 143, 144, and 145 are all applied in production, **every one canonically tested and
passing.** Queue C2.6 (internal share-link lifecycle controls), Queue C2.7 (both parts, including its
canonical test), migration 145 (re-applying migration 143's view-logging function bodies, which had
been recorded as applied but were never actually live — root-caused via a six-round diagnostic
investigation, full trail in "Completed and verified" above), and the version-comparison status-badge
fix are all shipped, deployed, and canonically tested where applicable (`35bc262`, `05fa486`,
`450606b`, `32065e9`; production bundles verified, zero console errors; migration 144's test and
migration 143's extended test — with its new Section 0 structural check — both passed `Success. No
rows returned`, zero sections skipped). The version-comparison badge fix has one stated limitation: no
real quote currently has 2+ proposal versions, so the badge has no live data to visually confirm
against yet (not fixable without mutating real data for testing) — this does not block Queue C2's
closure. **No open items remain anywhere in Queue C2. There is no next concrete Queue C2 action.**
Do not rerun 134/135/136/137/141/138/139/140/142/143/144/145 and do not re-ask D7's settled link rules.

**D3/D4 approved 2026-09-15 — see HANDOFF.md for full detail, this is the short pointer. Batch 4b (D3)
and Batch 5 (D4) are BOTH FULLY SHIPPED. No open items remain in either.** D3: `projects.source_quote_ref`
— migration 146 applied and its canonical test passed; frontend shipped in `3d8452d`. D4: a configurable
per-workspace discount-approval gate (disabled by default, 10% default threshold, Sales Manager/admin
only, never PM) — migration 147 applied; its own canonical test caught two real test-fixture bugs on
live data (this workspace's real "pm" and "sales" role holders turned out to be the same person on the
first run, and the real "sales" holder already had a pre-existing "manager" role on the second) — both
fixed TEST SCRIPT ONLY, migration 147 itself never touched, test passed clean on the third run. Batch
5's frontend (`requestOrSendQuoteProposalVersion` replacing `createAndSendQuoteProposalVersion`, the
Admin settings panel, the Approval Requests review queue, and a pending-approval indicator in the Quote
Proposal panel) shipped in `f0bc686`. Do not re-litigate D3/D4 (table at "D3"/"D4" further below), do
not re-derive this design from scratch, and do not rerun migrations 146/147 or their tests.

**D16/D17 approved 2026-09-15 — see HANDOFF.md for full detail and
`PRODUCT_PROPOSAL_QA_AND_OPTIONAL_BOM_DECISION.md` for the design rationale, this is the short pointer.
Both are FULLY SHIPPED. No open items remain in either.** D16 (Client Proposal Q&A): scoped to
one proposal VERSION, not the quote; Sales/manager/admin may answer, never PM; read-only after
approval/rejection/supersession/expiration/disablement/revocation, explicitly still open through
revision_requested — migration 149 applied; its own canonical test found a real bug in 149 itself (a
`RETURNS TABLE` column name colliding with a real table column, same class migration 121 already fixed
once), corrected by migration 150 (149 itself never touched), test passed clean after. Frontend
(`submitProposalQuestion`/`respondToProposalQuestion`, a Quote Proposal panel question-thread card, a
non-status-changing "Ask a Question" section on the public page) shipped in `997ec7b`. D17 (optional
BOM lines): optional lines begin UNSELECTED (not included-by-default); required lines always included;
live client-side recompute from the frozen snapshot; selection + server-computed final totals stored
atomically with the response, immutable after — migration 148 applied; its own canonical test needed
two test-script-only fixes (a stale direct-write fixture pattern predating migrations 144/147's
write-path closure; a missing `created_by_email` on fixture quotes masking the owner-notification
check), migration 148 itself never touched. Frontend (BOM line editor checkbox,
`ProposalBomLineSnapshot.id`/`isOptional`, the public page's live-recompute toggle UI) shipped in
`2fc3a6e`. Do not re-litigate D16/D17 (table at "D16"/"D17" further below), do not re-derive this
design from scratch, and do not rerun migrations 148/149/150 or their tests.

**2026-09-15, later same day: master-plan reconciliation + PDF/e-signature decision doc + System
Health Phase B + accessibility (Queue R1 items 1 and 3). See HANDOFF.md for the full session summary
— this is the short pointer, and `PRODUCT_MASTER_COMPLETION_PLAN.md` is now the authoritative,
current roadmap (read it first, not this file's own historical batch list below, for current
status).** Delivered, in order: (1) `PROPOSAL_PDF_AND_ESIGNATURE_DECISION.md` — traced and designed
both frozen-PDF (D18, new) and e-signature hardening (D12, revised); **neither implemented**, both
awaiting E's approval. (2) A full rewrite of `PRODUCT_MASTER_COMPLETION_PLAN.md` reconciled against
confirmed production state (also fixed D3/D4's own stale register rows here in this file — they'd
never been updated past their original open-question framing despite shipping the same day). (3)
**System Health Phase B, steps 1-4 — migration CONFIRMED LIVE 2026-09-16** (`9a90903`) — migration
151 (`system_health_events` + monthly summary + dedup RPC + admin lifecycle RPCs + retention rollup)
applied by E and its canonical test run clean ("Success. No rows returned" — the correct result for
its `do $$ ... $$; rollback;` shape completing with no exception). Frontend (Admin panel, one
`recordSystemHealthEvent` call site wired to `restoreFullBackupSnapshot`'s per-section failures,
weekly retention cron) was already deployed and now has a live table. **Manual-action queue is empty
again** — see `PRODUCT_MASTER_COMPLETION_PLAN.md` §5. (4) **Accessibility — ALL FIVE ITEMS DONE
(`f930f39`, `6b42ca1`, `9af073c`).** A4 (filter/search input labels), A5 (WCAG AA contrast fix,
computed against both page backgrounds), A6 (icon-button `aria-label` normalization), A7 (mobile
tap-target sizing), A3 (`role="alert"` on all 9 `.error-text`/`.modal-error-text` sites, including
both public pages — deliberately does not cover generic dual-purpose status strings, flagged as a
separate later follow-up, not silently skipped). **Queue R1 item 3 is fully closed.** (5) **Inventory
pagination — Queue R1 item 2, DONE (`1e6eb7a`).** `loadInventoryItemsPage` (persistence.ts) is a
second, independent, server-side-searched, cursor-paginated query wired ONLY into the Inventory
page's own desktop table + mobile card list (50-item pages, "Load more," 300ms debounce);
`loadInventoryItems`/`inventoryItems`/`filteredInventoryItems` (CSV export, counts, the 100+ other
consumers) are completely untouched. The derived "status" filter is applied client-side per fetched
page (documented scope cut, not server-filterable without a joined-aggregate computed view). (6)
**System Health's remaining three call sites — Queue R1 item 1 steps 1-4 now FULLY DONE (`d1e8d24`).**
Notification-delivery write failures, cron job failures, and rate-limit hits all now record durable
System Health events, via a new shared `api/_lib/systemHealth.js` helper. **Step 5 (alert wiring) was
deliberately NOT built** — the design doc's own threshold rule needs occurrence-timing logic this
schema doesn't track and has a genuinely ambiguous "spanning ≥5 minutes" clause; flagged as needing a
spec-precision pass from E, not a mechanical follow-up.

**Queue R1 is now fully exhausted as of 2026-09-16 — every safe-autonomous item is done.** Do not
invent new Queue R1-style scope without a real cited design doc/audit finding backing it. Historical
note only — the paragraph above described D12/D18 as still awaiting E; they were approved and shipped
later the same day, see the next entry.

**2026-09-16, later same day: standing authorization given, Queue R2/R3 (D5/D6/D8/D9/D12/D18) all
implemented, tested, committed, and deployed. See `PRODUCT_MASTER_COMPLETION_PLAN.md` §3, §4, §5,
§8, and §8b for the authoritative current state — this is the short pointer.** E gave a standing
authorization to build through the full completion roadmap without stopping to ask after each item.
Under that authorization: **D8 (System Health alert wiring)** — migration 152 (`c6de0fa` + follow-ups):
`alerted_at` column, `record_system_health_event` return type changed to jsonb, new
`record_system_health_recovery`/`list_admin_emails` RPCs, `api/send-system-health-alert.js`,
`api/_lib/systemHealth.js` extended for server-side call sites, all 4 original failure call sites also
call recovery on success. **Migration 152 is CONFIRMED APPLIED in production** — E ran it and its
canonical test in Supabase Studio and both returned "Success. No rows returned" (2026-09-16). D8 is
fully shipped end-to-end, no longer in the manual-action queue. **D9 (backup restore resumable
checkpointing)** — migration 154 (`a889b60`, `67b6cb6`): Part 1 (required-vs-optional distinction) is
pure application logic, already fully live, no migration needed. Part 2 (durable per-section
checkpointing via `restore_runs`/`restore_run_sections` + 4 RPCs) is implemented, 23 new tests passing,
deployed. **Migration 154 is CONFIRMED APPLIED in production** — E ran it and its canonical test and
both returned "Success. No rows returned" (2026-09-16). D9 is fully shipped end-to-end, no longer in
the manual-action queue.
**D6 (`xlsx` → `exceljs`)** — no migration, pure npm/frontend change: parity-tested via a real
side-by-side comparison, locked into a permanent regression test (`src/xlsx-import.test.ts`); `xlsx`
fully removed from `package.json`, `exceljs` added with a `package.json` "overrides" pin on its
transitive `uuid` dependency, `npm audit` now 0 vulnerabilities. Fully shipped, deployed. **D12
(proposal acceptance hardening)** — migration 153 (`eecb8b1`): fixed the dead `approval_ip` behavior
using the server-observed request IP (`x-forwarded-for` via new `api/respond-to-proposal.js`, never
trusting client-supplied IP), added verified `approval_email` (server-derived from the proposal's own
`client_email`, not a client parameter). Typed-name acceptance remains the v1 signature model —
explicitly not a regulated e-signature product. Frontend already deployed and switched to the new API
route. **Migration 153 is CONFIRMED APPLIED in production** — E ran it and its canonical test and both
returned "Success. No rows returned" (2026-09-16). D12 is fully shipped end-to-end, no longer in the
manual-action queue. **The manual-action queue is now empty — migrations 152, 153, and 154 are all
confirmed applied and tested in production.** **D18 (proposal PDF)** — no migration, pure frontend (`d92a114`):
kept `window.print()` from the frozen proposal snapshot as the v1 approach (explicitly decided NOT to
build a server-generated/stored PDF pipeline — no attachment/storage/integration requirement exists to
justify it); fixed three real print-CSS gaps (colors not printing via `print-color-adjust: exact`; the
`.stack-table-mobile` stacked-layout bug shared between the proposal BOM table and the unrelated
Submittal page; interactive checkboxes replaced with a plain-text "Included"/"Not included" fallback
under print). Fully shipped, deployed. **D5 (bundle components) remains reference-only per standing
decision** — no change needed, confirmed still correctly marked that way (§9 of the master plan, D5's
own row in this file's D-register above, unchanged).
**Manual-action queue, current exact state**: migration 152 DONE, no longer queued. **Item 1
(current)**: apply migration 153
(`backend/supabase/migrations/153_proposal_acceptance_ip_and_email.sql`), then its test
(`backend/supabase/migration_153_proposal_acceptance_ip_and_email_tests.sql`). **Item 2 (do not run
until item 1 confirmed)**: apply migration 154
(`backend/supabase/migrations/154_backup_restore_checkpointing.sql`), then its test
(`backend/supabase/migration_154_backup_restore_checkpointing_tests.sql`). Do not re-litigate
D5/D6/D8/D9/D12/D18 (table further above) or rerun migration 152.

The pricing statement E approved 2026-09-13:

> Approve recommended pricing: catalog price starts each line; Sales may override with an audit
> record; each sent proposal version freezes its own prices; customers see unit price, line total,
> subtotal, percentage discount, tax, and final total; costs/margin stay internal; the accepted final
> total carries to the Project as a read-only reference; approval thresholds remain a separate later
> decision.

C1.1–C1.9 below are kept as the executed record, each now marked DONE with what actually shipped.

### C1.1 — Refresh and preflight

**Status: DONE.** Re-read every named definition fresh from current source (not stale memory);
confirmed 136 as the next free migration number; packaged
`backend/supabase/preflight_136_sales_pricing.sql` (read-only, not run — no authorized Supabase path
this session, per the task's own instruction).

- Confirm HEAD/origin and a clean tree.
- Re-read the latest live definitions of `sales_quotes`, `sales_quote_bom_lines`,
  `sales_quote_proposals`, `ProposalSnapshot`, `compareProposalSnapshots`, quote creation/editing,
  proposal creation, dashboard Sales KPIs, and `create_project_from_quote()` including migration 134.
- Confirm the next free migration number; do not assume `136` if another migration landed.
- Produce a read-only preflight query that reports: existing BOM line count, catalog-linked vs.
  free-text line count, null/missing catalog defaults, and quotes/proposals affected by backfill.
- Never run that query or inspect real pricing data without an available authorized Supabase path;
  package it for E if manual execution is required.

### C1.2 — Finalize the migration contract

**Status: DONE.** Backfill explicitly labels every pre-existing row `'legacy_unverified'`, never
`'catalog_default'` (an inferred historical price is never claimed as verified); constraints for
finite/nonnegative/precision-bounded money and rates; no internal cost/markup column added anywhere.

The migration design must explicitly cover existing rows, not merely add defaults:

- quote BOM line unit price;
- price source/audit metadata;
- quote-level percentage discount and tax rate;
- Project-side accepted proposal total, if the approved statement includes it;
- constraints for finite, nonnegative, precision-bounded money/rates;
- deterministic treatment of pre-feature catalog-linked and free-text rows;
- backward compatibility for existing proposals whose snapshots have no pricing fields;
- no internal cost/markup in any customer-reachable snapshot or public RPC.

Do not label an inferred historical value as though it were the price actually quoted at the time.
Use an explicit legacy/unverified state or require review where history cannot be reconstructed.

### C1.3 — Draft one migration and one canonical SQL test

**Status: DONE — NOT RUN.** `backend/supabase/migrations/136_sales_pricing_foundations.sql` +
`backend/supabase/migration_136_sales_pricing_foundations_tests.sql`, mirroring the established
transaction-safe/real-fixture/hard-fail-on-skip convention. Covers catalog default, manual override
audit, constraint rejection, backfill labeling, accepted-total carry-through (including an
old-snapshot-with-no-grandTotal case), and a grant-state regression guard. Give E only the migration
file first; its test script only after E reports success — per this section's own instruction.

- One numbered migration, one transaction, idempotent where practical.
- One separate transaction-safe verification script with synthetic fixtures and a trailing rollback.
- The test must hard-fail on every failed assertion and every skipped section.
- Cover catalog default, manual override audit, free-text line, invalid money/rates, old snapshot
  compatibility, version freezing, no cost leakage, and accepted-total carry-through if approved.
- Review variable/column-name collisions, search paths, grants, RLS effects, constraints, and every
  downstream trigger/function before giving E the file.

Give E only the migration file first. After E reports success, give only its test script. Record the
real results before any dependent frontend deploy.

### C1.4 — Frontend types and persistence

**Status: DONE.** `SalesQuoteBomLine`/`SalesQuote` types, mappers, and `SALES_QUOTE_SELECT` extended;
`addSalesQuoteBomLines`/`updateSalesQuoteBomLine` accept and validate price; catalog-linked bulk
generators (Pull Location Hardware) default from `computeCatalogSellPrice`; `price_source` decided
by comparing the saved value against today's catalog default at save time, never typed directly.

- Extend quote/BOM row types and selectors for price fields.
- Keep money values precise at storage boundaries; centralize display formatting.
- Default a newly catalog-linked line from the catalog's current sell price exactly once.
- Preserve a deliberate manual override when item details or catalog prices later change.
- Checked pessimistic writes: failed saves leave the editor open and the visible confirmed value
  unchanged; technical detail logs, plain user message displays.
- Update proposal snapshot mapping without ever adding `unitCost`, markup, or margin.

### C1.5 — Internal Sales Quote Builder

**Status: DONE.** Unit Price + Line Total in the BOM editor and add-line row; an "(overridden)"/
"(unverified -- review price)" indicator; Discount %/Tax % + a live subtotal/discount/tax/total
preview in the Edit Site modal (alongside the existing Sale Amount/SaaS Contract sections). No new
role/permission invented -- margin visibility unchanged from its existing gate.

- Add Unit Price and Line Total to the BOM editor.
- Add quote subtotal, discount percentage, tax rate/amount, and final total.
- Show catalog-default vs. manual-override state and who/when changed it.
- Show cost/margin only to the already-authorized internal audience; do not invent new roles here.
- Maintain keyboard/mobile behavior and the existing Move/Edit/Save/Cancel controls.

### C1.6 — Customer proposal

**Status: DONE.** `ProposalPublicPage` renders price/total columns and a totals block only when
`snapshot.grandTotal !== undefined` (an older price-free version renders exactly as before, never an
invented total); always reads the frozen snapshot, never the live quote/catalog.

- Render unit price, line total, subtotal, discount, tax, and final total from the frozen proposal
  snapshot only.
- Never calculate from the live catalog or live quote on the public page.
- Preserve older price-free proposal versions without crashes or invented totals.
- Verify mobile widths and print/PDF output; keep company branding and response controls intact.

### C1.7 — Proposal versions, reporting, and conversion

**Status: DONE.** `compareProposalSnapshots` extended (zero new UI needed -- already field-driven);
`avgDealSize` now reads each quote's own frozen price/discount/tax instead of live catalog joins
(`estimatedProfitYtd`/margin deliberately left on live catalog cost -- out of scope for the approved
statement, documented inline); `create_project_from_quote` carries the accepted proposal's frozen
`grandTotal` onto the new Project as `accepted_proposal_total`, surfaced read-only in the Financial
Summary panel.

- Extend the existing proposal comparison to show price/total changes.
- Replace Sales KPI calculations that currently infer value from live catalog prices with the
  appropriate frozen quote/proposal values; document exactly which version/status each KPI uses.
- When an accepted proposal exists and carry-through was approved, store its final total on the
  converted Project as a read-only historical reference. Preserve migration 127/128/134's atomic,
  idempotent conversion guarantees.

### C1.8 — Verification and deployment

**Status: SHIPPED.** 22 new tests (`sales-pricing.test.ts`,
extended `proposal-version-comparison.test.ts`, extended `task2-unchecked-write-fixes.test.ts`) --
398/398 full suite passing, `tsc -b` clean, `eslint` 0 errors, `npm run build` clean. Migration 136
and its corrected SQL test passed; pushed through `473c0f4`. Vercel served bundle
`index-zEv2L1p6.js`, containing the new pricing/accepted-total UI; fresh browser boot had zero console
warnings or errors. Authenticated Sales use and one real priced proposal remain acceptance evidence,
not prerequisites for continuing engineering work.

- Focused tests for mapping, editing, totals/rounding, overrides, old snapshots, comparison, no cost
  leakage, failures, mobile labels, and conversion outcome.
- Full TypeScript, Vitest, ESLint, build, and smoke suite under §3.
- Push coherent commits only after the database migration and SQL test have passed.
- Verify Vercel production bundle plus a fresh browser load. Use an authenticated read-only
  walkthrough if available; distinguish it from real Sales acceptance.

### C1.9 — Closeout and automatic continuation

**Status: DONE AND DEPLOYED.** `HANDOFF.md`, this file, the master plan,
`PRODUCT_SALES_DISCOVERY.md`, `PRODUCT_SALES_PRICING_IMPLEMENTATION_PLAN.md`, and the critical-flow
coverage matrix all updated. `PRODUCT_MARKETING_CLAIMS.md` checked -- no pricing-related claim exists
there to correct. Reported shipped/prepared/verified/acceptance-pending separately, per this
section's own instruction. Queue C2 below is now the automatic continuation.

- Update `HANDOFF.md`, the master plan, Sales discovery/experience, pricing plan, marketing claims,
  and the critical-flow coverage matrix.
- Report shipped, locally prepared, production-verified, and acceptance-pending separately.
- Then continue to the next approved Queue C workstream. Do not end by asking what to do next while
  a previously decided share-link or reliability preparation task remains available.

## Queue C2 — Share-link lifecycle foundation (active next coder queue)

The business rules are already decided in
`PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md`; the dependency order is reconciled in
`PRODUCT_SHARE_LINK_IMPLEMENTATION_PLAN.md`. Do not send those questions back to E. This queue covers
the independent lifecycle work in Stages A–D and the direct-write closure needed to trust it. It does
not implement the Sales-to-assigned-PM handoff, Billing clearance, conversion approval, or Phase 3
tenant isolation.

### C2.1 — Refresh the real baseline

Read the latest definitions of `public_share_tokens`, `sales_quote_proposals`,
`project_submittals`, all four public lookup/response RPCs, both token-creation writers, quote soft
delete/restore, and the current RLS policies. Confirm the next free migration number; `137` is only a
working expectation. Reconcile stale claims in the two source documents before writing SQL.

### C2.2 — Inert lifecycle schema package

**Status: DONE — drafted, NOT run.** `backend/supabase/migrations/137_share_link_lifecycle_schema.sql`
+ `backend/supabase/migration_137_share_link_lifecycle_schema_tests.sql`. Adds `status`/`disabled_*`/
`revoked_*`/`superseded_by_token` to `public_share_tokens` (backfilled to `active` via the column
default, no separate UPDATE); new `workspace_share_link_settings` (admin-write/authenticated-read,
mirroring `company_branding`'s migration-039 pattern, seeded for today's one active workspace);
new `share_link_views`/`share_link_actions` audit tables (authenticated-read only — no write policy;
only future security-definer RPCs can write). Touches no existing RPC body and adds no anon grant.
Test proves the full existing-row backfill, one settings row per active workspace, a real proposal
token still resolving identically twice, every check-constraint rejection, the `superseded_by_token`
self-referencing FK, minimum-grants, and non-admin-cannot-write-settings. Committed and pushed
(`362e702`), not applied. This is the next single file to hand E.

Draft one migration and one separate canonical rollback-only SQL test. The migration adds the
decided token states and metadata, workspace expiration defaults, view/action audit tables,
constraints, indexes, minimum grants, and safe RLS. Existing tokens backfill to `active`; existing
`expires_at` values remain unchanged. This package must not change token resolution or client-visible
behavior. Review search paths, grants, output-column ambiguity, trigger ordering, FK delete behavior,
and empty-production-table fixtures. It is committed and pushed but remains unapplied; E runs the
single migration and then its single test.

### C2.3 — Server-owned token creation and expiration

**Status: DONE — drafted, NOT run. Requires 137 live first.**
`backend/supabase/migrations/138_share_link_server_owned_creation.sql` +
`backend/supabase/migration_138_share_link_server_owned_creation_tests.sql`. `generate_share_token()`
(two native `gen_random_uuid()` calls concatenated, no pgcrypto dependency);
`create_submittal_share_token(uuid)` (PM/admin, mirroring the submittal write gate);
`create_quote_proposal_share_token(uuid)` (Sales/manager/admin — the DECIDED narrower ownership model,
ahead of the old wide-open proposal write policy being closed later in C2.7). Both derive workspace
via `active_workspace_id()`, set `expires_at` from `workspace_share_link_settings.
default_expiration_open_documents`, and log a `created` row to `share_link_actions`. The OLD direct-
INSERT client writers (`createSubmittalShareToken`/`createQuoteProposalShareToken` in
`src/persistence.ts`) are untouched and still the live path — switching the frontend to call these
RPCs instead happens only alongside C2.7's direct-write closure, not before. Test proves creation
success/entity-correctness/expiration-matching/action-logging for both RPCs, nonexistent-id
rejection, authorization denial (non-privileged user, and PM-denied-for-proposal), and anon-grant
denial. Committed and pushed (`362e702`), not applied.

After C2.2 is live, replace direct token INSERTs with hardened RPCs that derive entity/workspace,
generate the token server-side, apply the open-document default expiration, and return the token.
Never trust caller-supplied workspace, status, actor, or expiration. Preserve old completed-document
links; completed-link retention is a separate scheduled transition, not a destructive rewrite.

### C2.4 — Atomic lifecycle actions and read outcomes

**Status: DONE — drafted, NOT run. Requires 137 and 138 live first.**
`backend/supabase/migrations/139_share_link_lifecycle_actions.sql` +
`backend/supabase/migration_139_share_link_lifecycle_actions_tests.sql`. Shared
`assert_can_manage_share_link(p_entity_type)` helper (centralizes the same Sales/manager/admin vs.
PM/admin check C2.3 already enforces at creation); `disable_share_link`/`re_enable_share_link`
(fully reversible pair, first-writer-safe WHERE guards); `permanently_revoke_share_link` (terminal —
structurally, not just by convention, blocks any later re-enable); `regenerate_share_link` (creates a
new token, marks the old one `superseded` — for C2.5's version-supersession flow specifically, NOT
the manual revoke-and-regenerate UI button, which stays two separate calls in C2.6). `get_quote_
proposal_by_token`/`get_submittal_by_token` gain a new leading `outcome` column (`found`/
`invalid_token`/`expired`/`superseded`/`unavailable` — the last one deliberately covers both
`temporarily_disabled` and `permanently_revoked`, per the decided "client never told which" rule).
`respond_to_quote_proposal`/`respond_to_submittal` gain the same `outcome` extension, reject a
response on any non-active link, and extend `expires_at` to the workspace's longer completed-document
default on a real successful response (best-effort — a settings-lookup failure never blocks the
response itself). Both GET RPCs and both respond RPCs are a **breaking signature change** (new
leading column) — the frontend's `PublicQuoteProposalResult`/`PublicSubmittalResult`/
`ProposalResponseOutcome` parsing and the two public-page components must be updated in the same
reviewed batch as this migration, but as a separate commit, shipped only after E confirms 139 and its
test both succeeded. Test proves every disable/re-enable/revoke/regenerate transition and its
already-X no-op outcome, outcome discrimination on both GET RPCs, response-rejection on a disabled
link (with proof the entity's own status didn't change), the completed-document expiration extension,
cross-entity authorization denial (PM cannot manage a proposal link, Sales cannot manage a submittal
link), and grant boundaries. Committed and pushed (`362e702`), not applied.

Implement disable, re-enable, permanent revoke, and regenerate/supersede as hardened RPCs with
server-derived authorization, required reasons where decided, append-only audit events, and
first-writer-safe predicates. Extend both public lookup and response paths consistently: superseded,
expired, and neutral unavailable states must be distinguishable enough for the decided customer copy
without exposing internal reasons or customer data. A disabled/revoked/expired/superseded link may
never submit a response. Ship enforcement, action RPCs, and customer wording together so no control
can appear to work while public access remains unchanged.

### C2.5 — Version supersession and quote deletion

**Status: DONE — drafted, NOT run. Requires 137, 138, and 139 live first.**
`backend/supabase/migrations/140_share_link_version_supersession_and_quote_cascade.sql` +
`backend/supabase/migration_140_share_link_version_supersession_and_quote_cascade_tests.sql`. Two
independent pieces: (1) a `sales_quotes` trigger (`cascade_quote_soft_delete`) that auto-disables
every still-active proposal-link token for a quote the moment it's soft-deleted (`deleted_at` goes
null → non-null), logging a `temporarily_disabled` action with reason `'Quote deleted'`; restoring the
quote (`deleted_at` back to null) intentionally fires no trigger action at all, matching the decided
"restore never auto-reactivates" rule; an already permanently_revoked/superseded token is untouched.
(2) `create_and_send_submittal_version(project_id, content_snapshot, client_name, client_email)` /
`create_and_send_quote_proposal_version(quote_id, ...)` -- one atomic RPC each that creates the new
version row (server-computed `version = max+1`, closing a real client-computed-version race the old
two-step flow left open), creates its token, and marks every OTHER version's still-live
(`active`/`temporarily_disabled`) token `superseded` pointing at the new one, all in one transaction --
deliberately NOT three separate client round-trips, which would reopen a window where both an old and
new version's links are simultaneously respondable. These two RPCs are the actual replacement for
today's `createSubmittal`+`createSubmittalShareToken` / `createQuoteProposal`+
`createQuoteProposalShareToken` two-step frontend flow; migration 138's narrower, single-purpose
`create_submittal_share_token`/`create_quote_proposal_share_token` remain valid, unmodified primitives,
just not what the frontend will call for the version-creation flow once switched over. Test proves
first-version creation, second-version supersession (with `get_submittal_by_token` confirming
`outcome=superseded` on the old token), a third version leaving an already-revoked second version's
token untouched (no loophole), nonexistent-project/quote rejection, cross-entity authorization denial,
the mirrored proposal-side flow, the quote-cascade disable-then-restore-stays-disabled sequence, and
grant boundaries. Committed and pushed (`d564b8b`), not applied.

Make a newer proposal/submittal version supersede the prior version's response ability while keeping
the old content viewable under the decided wording. Soft-deleting a quote disables its proposal links
and records joinable quote/link audit events. Restoring the quote never silently re-enables them; a
Sales user must deliberately re-enable and create the matching audit event.

### C2.6 — Internal controls and history

**Status: DONE AND DEPLOYED (2026-09-13) — `35bc262`.** Add the decided per-version controls:
Disable/Re-enable together; Permanently Revoke and Generate New Link separated and
confirmation-gated; activity summary plus history. Proposal controls are Sales; do not grant PM
proposal authority. For submittals, implement only the authority that can be proven from current
schema; defer the assigned-PM cutover portion to Stage 2 rather than approximating it as
“any PM.” Preserve keyboard, mobile, screen-reader, email, and frozen-snapshot behavior.

Built entirely on the already-live RPCs from migrations 138/139 — no new migration needed. New
shared `ShareLinkLifecycleControls` component (`src/main.tsx`) is used by both the submittal
(`Projects`) and proposal (`SalesQuoteBuilder`) version-row lists, since their row shapes are
identical: Disable/Re-enable render as one toggle pair; Permanently Revoke & Generate New Link is a
visually separate, `window.confirm`-gated action (matching the decided "must read as unmistakably
different actions" requirement — this repo's only confirmation convention, no custom modal exists);
an expandable Activity panel shows view count + first/last viewed + a compact action log, summarized
not raw, per the decided design. `canManageSubmittalLinks`/`canManageProposalLinks` (new derived
booleans in `App`) mirror `assert_can_manage_share_link()`'s own two authorization branches exactly
(PM/admin for submittals, Sales/manager/admin for proposals) — deliberately "any PM"/"any
Sales-or-manager" because that IS the real, already-decided schema authority (migration 139's own
RPC), not an invented approximation of the not-yet-built assigned-PM concept; the RPCs remain the
authoritative check regardless of what the UI shows. `ProjectSubmittal`/`SalesQuoteProposal` gained
`shareTokenStatus`; `loadSubmittalsForProject`/`loadProposalsForQuote` now select the token's status
and order tokens newest-first so a regenerated link's row picks the current token, not an arbitrary
historical one, once an entity has more than one token row (only possible after a manual
regenerate). New persistence functions: `disableShareLink`/`reEnableShareLink`/
`permanentlyRevokeShareLink` (wrap migration 139's RPCs), `createNewSubmittalShareToken`/
`createNewQuoteProposalShareToken` (migration 138's server-owned creation RPCs, used here only for
the "Generate New Link" step — NOT yet the main Create & Send flow, which is C2.7's job),
`loadShareLinkActivity` (reads `share_link_actions`/`share_link_views`). 15 new tests; 427/427
passing, tsc clean, eslint 0 errors (72 pre-existing warnings, unchanged), build clean. Pushed and
deployed; Vercel served `index-Bir39DZP.js` and a fresh browser load had zero console errors. Not
verified against a real submittal/proposal in the browser — no authenticated session with real
share-link data is available this session, matching this repo's established practice when that's the
case.

### C2.7 — Close direct-write bypasses

**Status: FULLY CLOSED (2026-09-14).** Part 1 (frontend switch) DONE AND DEPLOYED; part 2
(migration 144) APPLIED IN PRODUCTION (`Success. No rows returned`) AND its canonical test PASSED
(`Success. No rows returned`, zero sections skipped). The share-link-specific portion of this task
(narrowing `public_share_tokens`/`project_submittals`/`sales_quote_proposals`) is fully done and
proven; the authorization-table/`accept_invite()` portion below remains a separate, deliberately
out-of-scope item — see "Still required" above. After the sanctioned RPCs are live, narrow direct writes to `public_share_tokens`,
`sales_quote_proposals`, and `project_submittals`. In the same reviewed sequence, finish the already-
designed authorization-table policy closure and bridge-aware `accept_invite()` replacement so neither
legacy nor workspace roles can drift through a raw client write. Keep SELECT changes and Phase 3 data
containment out of this migration. Require SQL tests plus a real authenticated REST rejection check
and an actual invite-acceptance check before calling it closed.

**Part 1 (`05fa486`):** `handleCreateSubmittal`/`handleCreateQuoteProposal` (`src/main.tsx`) now call
new persistence wrappers `createAndSendSubmittalVersion`/`createAndSendQuoteProposalVersion`, which
go through migration 140's `create_and_send_submittal_version`/`create_and_send_quote_proposal_version`
RPCs instead of the old two-step direct-INSERT flow. The four now-dead old functions
(`createSubmittal`/`createSubmittalShareToken`/`createQuoteProposal`/`createQuoteProposalShareToken`)
and the client-side `generateShareToken()` helper they were the only callers of were removed entirely
— closing, for good, the weak `Math.random()` fallback path C2.1's own baseline refresh flagged as a
real (if narrow) weakness. 4 new tests; 431/431 passing, tsc/eslint/build clean. Deployed and verified
live (bundle `index-C_sfjz0J.js`, zero console errors). Safe to ship on its own since the RPCs it
calls were already live — did not wait for part 2's migration.

**Part 2 (`backend/supabase/migrations/144_close_share_link_direct_write_bypasses.sql`, `450606b`) —
APPLIED (2026-09-14):** drops `public_share_tokens`' "authenticated manage" policy (replaced with
SELECT-only), `project_submittals`' "pm and admin write" policy, and `sales_quote_proposals`'
"authenticated write" policy — all three entirely, since every legitimate write now goes through a
security-definer RPC. Confirmed via a full trace of every direct `fetch()` call against these three
tables in `src/persistence.ts` that nothing else depended on them. Independently verified end-to-end
against a real local PostgreSQL 18 engine (PGlite), including a negative control (the same test
genuinely fails without this migration applied) and the real admin-also-PM condition. E ran it in
production and it returned `Success. No rows returned`. **Its canonical test
(`backend/supabase/migration_144_close_share_link_direct_write_bypasses_tests.sql`) was then run by E
and also returned `Success. No rows returned`, zero sections skipped (2026-09-14) — Queue C2.7 is
fully closed. Do not run migration 144 or its test again.** One benign mix-up along the way: E first
re-ran the migration file itself by mistake (name/location easily confused with its test file) and
hit a harmless duplicate-`CREATE POLICY` error inside a single transaction — nothing committed or
changed; the real test file was resent and passed on the next attempt.
The authorization-table policy closure and bridge-aware `accept_invite()` replacement this task
description also names are **not**
part of migration 144 — they are a separate, pre-existing body of work grouped under the same
"C2.7" label in an earlier planning pass but not share-link-specific; tracked separately, not
silently dropped. The version-comparison/history UI item (consuming migration 139's lifecycle state
for a superseded prior version) is also now done — see the entry above in "Completed and verified."

### C2.8 — Delivery and continuation

For every database checkpoint, present E exactly one clickable file and one plain instruction. Never
open several files or paste alternate SQL into chat. After E reports the migration succeeded, present
exactly its one test file. A clean `Success. No rows returned` counts when the script hard-fails every
assertion and genuine skip; do not ask E to hunt for NOTICE output. Push dependent frontend only
after its database gate passes, verify the production bundle and fresh browser console, update all
handoff/status docs, then continue to the next independent C2 item. If waiting on a manual migration,
continue preparing later C2 tests/docs or another independent Queue C wave instead of stopping.

### Historical pre-approval boundary (closed)

If the next coder starts before E answers, they may complete C1.1's source trace and draft the
read-only preflight/test matrix, reconcile stale documentation, and verify that migrations 134/135
remain recorded correctly. They must not create the pricing migration, alter production types/UI,
or choose discount/tax/customer-display rules. Once that preparation is complete, use §8 to present
only the genuinely open decisions; never relist D7, D11, or D15 as unanswered.

For a long unattended run, open **`OVERNIGHT_CODER_PLAN_2026-09-13.md` first**. It is the full
multi-lane execution queue with fallback work and stop conditions; this file remains the detailed
historical queue and decision register. `PRODUCT_MASTER_COMPLETION_PLAN.md` remains the full product
roadmap and evidence inventory. This page turns that roadmap into a continuous work
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

**As of 2026-09-16 (later same day): `PRODUCT_MASTER_COMPLETION_PLAN.md` §3 is now the authoritative,
current "completed and live" list (migration range 115-151, plus 152; D3/D4/D5/D6/D8/D9(part 1)/D12/
D16/D17/D18, Queue C2, Sales pricing, accessibility batch) — prefer it over re-deriving status from the
bullets below, which stop at migration 145/the 2026-09-12/13 session and were not individually
rewritten in this pass. Migration 151 (System Health Phase B) and migration 152 (System Health alert
wiring, D8) are both applied and their canonical tests confirmed passing. **The manual-action queue
(§5) now has two items**: migration 153 (D12, proposal acceptance hardening) is current; migration 154
(D9 part 2, backup restore checkpointing) is queued next, not to be run until 153 is confirmed.**

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
- Migration 134 (`client_id` carry-through onto Projects) is **applied and verified in production**.
  E ran the migration and its canonical transaction-safe test script successfully; the script's
  hard-fail-on-error/skip design confirms every section ran with zero skips.
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
- `has_role()` hardening (Queue A14, migration 135) is **applied and verified in production**. Its
  canonical test completed with every section executed and zero skips; role results and a
  representative RLS-policy call remained correct while anonymous direct execution was closed.
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

**Status: DONE — `11a940c`.** Updated this file's header/§4 baseline/§8 (new "manual database
actions" subsection) and each of A10–A14's own `Status:` lines; `PRODUCT_MASTER_COMPLETION_PLAN.md`
(Client Ledger reliability row and Batch 2 marked DONE, xlsx/inventory-performance rows corrected to
reflect A12/A13); `PRODUCT_CRITICAL_FLOW_COVERAGE_MATRIX.md` (the one material gap it named —
`SubmittalSnapshot` branding — marked closed by A11); `PRODUCT_CLIENT_LEDGER_SAVE_RECOVERY_PLAN.md`,
`PRODUCT_INVENTORY_PAGINATION_DESIGN.md`, and `PRODUCT_SECURITY_DEPENDENCY_FOLLOWUP.md` were already
updated inline within their own A10/A12/A13/A14 commits, not deferred to this pass. All of A10–A14
finished with no unresolved code-only blocker — nothing to report as incomplete.

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
| D3 | **APPROVED 2026-09-15.** Add a human-readable quote reference to Projects, and what column name? | Added nullable `source_quote_ref`; kept `source_sales_quote_id` as the durable link | **FULLY CLOSED (2026-09-15)** -- migration 146 applied and its canonical test passed, frontend shipped (`3d8452d`). No open items. |
| D4 | **APPROVED 2026-09-15.** Customer pricing detail and approval threshold | A configurable per-workspace discount-approval gate (disabled by default, 10% default threshold, Sales Manager/admin only, never PM), reusing the existing Catalog Price Change Requests propose/review/approve pattern | **FULLY CLOSED (2026-09-15)** -- migration 147 applied (canonical test caught two real live-data test-fixture bugs, both fixed test-script-only, migration 147 itself never touched); frontend (`requestOrSendQuoteProposalVersion`, Admin settings panel, Approval Requests review queue, pending-approval indicator) shipped (`f0bc686`). No open items. |
| D5 | **APPROVED 2026-09-16 — PERMANENT, no further work planned.** `bundle_components`: expand into real lines or relabel as notes? | **Remains reference-only, permanently** — the interim relabel shipped 2026-09-15 (`8b4a6b6`, "Reference only -- listing components here doesn't add them to a quote's BOM automatically") is now the final, confirmed behavior, not a stopgap. Full BOM-line explosion will not be built. | **FULLY CLOSED (2026-09-16).** No open items. |
| D6 | **APPROVED 2026-09-16 (Queue R2/R3), FULLY SHIPPED.** `xlsx` dependency | Replaced with `exceljs` after a real side-by-side parity proof against synthetic workbooks (blank cells, numeric-looking text, header-only files) — now a committed regression suite (`src/xlsx-import.test.ts`, 7 tests); `xlsx` fully removed from `package.json`; a real transitive `uuid` vulnerability pulled in by `exceljs` fixed via a `package.json` "overrides" pin, `npm audit` now reports 0 vulnerabilities | **FULLY CLOSED (2026-09-16)** -- `13d9979`. No migration involved, pure npm/frontend change. No open items. |
| D7 | **Already decided:** Share-link policies | Use the eight recorded decisions and seven follow-up decisions in the canonical share-link document; do not ask E to decide them again | Stage 2 schema/review, not a missing policy answer |
| D8 | **APPROVED 2026-09-16 (System Health alert wiring, including the threshold-timing spec-precision pass Queue R1 item 1 flagged).** Down-alert recipients/channel, and the exact "3 consecutive failures spanning ≥5 minutes" occurrence-timing rule | Email every workspace admin by default (on-call list/channels remain a later config option, not built); alert all workspace admins after 3 consecutive failures for the same workspace/component (first-to-latest span ≥5 minutes), one alert per incident, suppressed until recovery, durable record, recovery notice on success | **FULLY CLOSED (2026-09-16)** -- migration 152 (`c6de0fa` + follow-ups): new `record_system_health_recovery`/`list_admin_emails` RPCs, `record_system_health_event` return type changed to jsonb, `api/send-system-health-alert.js`, `api/_lib/systemHealth.js` extended for server-side call sites, all 4 original failure call sites now also call recovery on success. Migration applied and its canonical test PASSED in production 2026-09-16 ("Success. No rows returned" for both, E confirmed). No open items. |
| D9 | **APPROVED 2026-09-16 (Queue R2/R3), FULLY SHIPPED IN TWO PARTS.** Backup restore unresolved references + resumable checkpointing | Part 1: unresolved optional references warn and continue during restore (per-reference, not whole-section); required-data failures still stop that section; live manual entry remains strict. Part 2: durable per-section checkpointing (`restore_runs`/`restore_run_sections` + 4 RPCs — start-or-resume, update-section, finalize, cancel), a Resume-vs-Start-Over prompt in `importBackup`; mid-restore Cancel button deliberately deferred (backend-ready, no UI trigger yet) | **FULLY CLOSED (2026-09-16)** -- Part 1: `a889b60`, pure application logic, no migration needed, already live. Part 2: `67b6cb6`, migration 154 CONFIRMED APPLIED and its canonical test PASSED in production 2026-09-16 ("Success. No rows returned", E confirmed). 23 new tests passing. No longer in the manual-action queue. No open items. |
| D10 | Inventory pagination UX | A12 first removes silent truncation transparently; later use server-side search + cursor pagination while preserving selected rows | **FULLY CLOSED (2026-09-16)** -- `1e6eb7a`: `loadInventoryItemsPage` (server-side search + cursor pagination) wired into the Inventory page's own desktop table and mobile card list; exports and complete-data calculations untouched (`loadInventoryItems`/full-array load path preserved for those). Standing-authorization instruction to "continue... through the remaining intended Inventory UI" investigated 2026-09-16: the only other inventory-browsing surface, the Reports page, was found NOT a pagination candidate -- its `filteredInventoryItems` feeds aggregate calculations (reorder-point rows, price-trend rows, category/vendor spend) that need the complete dataset, not one cursor page; converting it would break "complete-data calculations," a named protected boundary. No further Inventory UI remains. No open items. |
| D11 | **Already established process:** Phase 3 RLS rollout | Discuss first, then review and approve one complete table group at a time; Clients/Sales Quote graph first | Tenant isolation/onboarding implementation discussion |
| D12 | **APPROVED 2026-09-16 (revised scope), FULLY SHIPPED.** E-signature scope, legal record, signer identity, completion behavior | Kept typed-name acceptance (no drawn signature, no third-party e-signature integration — explicitly not a regulated e-signature product); fixed the previously-dead `approval_ip` capture using the server-observed request IP (Vercel's `x-forwarded-for`, via new `api/respond-to-proposal.js`, never trusting a client-supplied value); added verified `approval_email`, server-derived from the proposal's own `client_email`, not a client parameter; no OTP/click-through step. See `PROPOSAL_PDF_AND_ESIGNATURE_DECISION.md` §2 for the full trace and reasoning | **FULLY CLOSED (2026-09-16)** -- migration 153 (`eecb8b1`): new `approval_email` column, `respond_to_quote_proposal`'s `anon` direct-call grant revoked; `api/respond-to-proposal.js` deployed and is the frontend's only path now (11 new/updated TS-side tests passing). Migration 153 CONFIRMED APPLIED and its canonical test PASSED in production 2026-09-16 ("Success. No rows returned", E confirmed). No longer in the manual-action queue. No open items. |
| D13 | Support first release | Ticket/request lifecycle linked to Client Ledger, Project, site, and installed asset | Support module |
| D14 | Engineering first release | Product/solution request + technical review + Catalog release link | Engineering module |
| D15 | **Already decided for now:** Commercial SaaS billing | Remains deferred until explicit authorization; do not ask again during current operational-product work | SaaS commercialization only |
| D16 | **APPROVED 2026-09-15, with corrections to the recommended default.** Client Proposal Q&A: mechanism, scope, who may answer | Dedicated `sales_quote_proposal_questions` table + two token/role-gated RPCs (not `channels`); **scoped to one proposal VERSION, not the quote** (E overrode the recommended default here); Sales/manager/admin may answer, PM has no proposal authority; notify the quote's owner (was deferred in the original recommendation, E requires it); history becomes read-only after approval/rejection/supersession/expiration/disablement/revocation (NOT after revision_requested, which stays open) | **FULLY CLOSED (2026-09-15)** -- migration 149 + corrective migration 150 (real ambiguous-column bug, test-caught) + canonical test all confirmed, frontend shipped (`997ec7b`). No open items. |
| D17 | **APPROVED 2026-09-15, with corrections to the recommended default.** Optional BOM lines: default inclusion state, response semantics | `is_optional` boolean; required lines always included; **optional lines begin UNSELECTED** (E overrode the recommended included-by-default); client selects while reviewing; live recompute from the frozen snapshot; selected line IDs + final totals stored atomically with the response, server-computed, never trusted from the client; immutable after response, a new version is required to change it. **Do not call these "alternates"** -- mutually-exclusive alternate groups are an explicitly separate, later, still-undecided product decision | **FULLY CLOSED (2026-09-15)** -- migration 148 + canonical test confirmed applied, frontend shipped (`2fc3a6e`). No open items. |
| D18 | **APPROVED 2026-09-16, FULLY SHIPPED.** Frozen proposal PDF: build a server-generated pipeline, or keep `window.print()` | Kept `window.print()` as v1 (already read the correct frozen `content_snapshot`, already had a dedicated print stylesheet; no server pipeline built -- no concrete need a browser "Save as PDF" can't meet has emerged: no stored-canonical-file, email-attachment, or external-system requirement exists). Fixed three real print-CSS gaps instead: colors not printing (`print-color-adjust: exact`), a `.stack-table-mobile` stacked-layout bug shared between the proposal BOM table and the unrelated Submittal page, and the optional-BOM-line "Include" checkbox (meaningless on paper) replaced with print-only "Included"/"Not included" text. See `PROPOSAL_PDF_AND_ESIGNATURE_DECISION.md` §1 for the full trace and reasoning | **FULLY CLOSED (2026-09-16)** -- `d92a114`. No migration involved. No open items. |

### Manual database actions

Migrations 134, 135, 136, 137 (+ corrective 141), 138, 139, 140 (+ corrective 142), 143, and 144 are
**all applied in production.** Two canonical tests are outstanding (143's and 144's — see items 10/11
below); neither blocks anything else. Queue C2.2–C2.6 (share-link lifecycle foundation + internal
controls) and Queue C2.7's frontend/migration work are otherwise fully closed.

1. **Migration 134 — DONE.** The migration and canonical verification script both ran successfully
   in production. No further action remains.
2. **Migration 135 — DONE.** The migration and canonical verification script both ran successfully
   in production. No further action remains.
3. **Migration 136 — DONE AND VERIFIED.** `backend/supabase/migrations/136_sales_pricing_
   foundations.sql` implements the
   frozen Sales pricing statement E approved 2026-09-13: `unit_price`/`price_source` (+ override
   audit) on `sales_quote_bom_lines`, `discount_percent`/`tax_rate` on `sales_quotes`,
   `accepted_proposal_total` on `projects`, a backfill labeling every pre-existing BOM line
   `'legacy_unverified'` (never `'catalog_default'` — an inferred historical price is never claimed
   as verified), and a redefinition of `create_project_from_quote` carrying the accepted proposal's
   frozen total onto the Project. Verification script:
   `backend/supabase/migration_136_sales_pricing_foundations_tests.sql`.
   The migration and corrected canonical test both returned `Success. No rows returned`; the test
   hard-fails every assertion and genuine skip. The Queue C1 frontend was then pushed and verified
   in Vercel production. Do not run either SQL file again.
4. **Migration 137 — DONE AND VERIFIED.** `backend/supabase/migrations/
   137_share_link_lifecycle_schema.sql` — inert share-link lifecycle schema (see C2.2 above for full
   contents). Changes no existing RPC and no client-visible behavior. E ran it successfully. Its
   first test exposed the default-grant gap described under migration 141 below. The corrected final
   test passed from the exact repository file; do not run it again.
5. **Migration 141 — DONE AND VERIFIED.** `backend/supabase/migrations/
   141_fix_share_link_table_grants.sql` closed the real table-ACL gap found by migration 137's first
   canonical-test run. Migration 137's corrected test verifies the closed grants and passed. Do not
   run migration 141 or the migration-137 test again.
6. **Migration 138 — DONE AND VERIFIED.** E ran the corrected canonical test in production and it
   returned `Success. No rows returned` (2026-09-13) — the script's hard-fail-on-skip design confirms
   every section ran with zero skips. Do not run migration 138 or its test again.
   `backend/supabase/migrations/138_share_link_server_owned_creation.sql` — server-owned
   token-creation RPCs (see C2.3 above). Requires 137 live first. Its test script,
   `backend/supabase/migration_138_share_link_server_owned_creation_tests.sql`, now creates its
   workspace-owned quote under a real authenticated admin and deterministically tests PM-only and
   non-privileged callers. Every caller switch sets both `request.jwt.claims` and
   `request.jwt.claim.sub`; an earlier run set only the former, so `auth.uid()` was null and the
   existing workspace-ownership trigger correctly rejected the synthetic quote. A later parser error
   at the block terminator was corrected by using explicit `end;` / `$$;` and normalizing the file to
   UTF-8/LF.
   **Independent verification performed this pass:** since no live Supabase credentials or CLI/Docker
   connection are available in this environment, the exact, unmodified file on disk was run against a
   real local PostgreSQL 18 engine ([PGlite](https://pglite.dev/), no Docker required) inside a
   from-scratch schema reconstructed by tracing the actual applied migrations that define every
   table/function/policy this test touches (`app_admins`/`app_user_roles` from 010/040,
   `is_app_admin`/`has_role` from 124/135, `active_workspace_id`/the workspace-ownership guard trigger
   from 124/117, `project_submittals`/`sales_quote_proposals`/`public_share_tokens` from 025/053, plus
   the real project-level default table grants to `anon`/`authenticated` that migration 141's own
   header confirms exist outside any migration file) — then applying migrations 137 and 138 verbatim
   and running this exact test file verbatim against it. Result: the script completed with **zero
   errors** and the real `NOTICE: ALL MIGRATION 138 SHARE-LINK CREATION TESTS PASSED -- ZERO SECTIONS
   SKIPPED` fired, across every section (PM submittal-token creation, Sales proposal-token creation,
   nonexistent-id/EC003, non-privileged/EC001 denial with role stripping+restore, PM-only/EC001
   proposal denial with role stripping+restore, anon-grant denial). No further change was made to the
   file — none was needed. This is a faithful reconstruction of the specific schema this test
   depends on, not a literal run against the real production database (no credentials to it exist in
   this session), so running it for real in the Supabase SQL editor remains the final authoritative
   confirmation; this verification is offered as the strongest evidence obtainable without that
   access, run to remove doubt before handing the file back rather than risking a fifth failed
   round-trip. One real risk this exercise surfaced and is worth ruling out first: if the live
   workspace currently has fewer than two non-admin real workspace members, this script will
   correctly (by its own hard-fail-on-skip design) report `SECTIONS SKIPPED` rather than a clean
   pass — that would be a real data-availability condition, not a construction bug, and the fix would
   be adding a second/third real workspace member (or accepting the honest skip), not editing the SQL.
   A clean `Success. No rows returned` (with the PASSED notice, zero skips) closes migration 138.
7. **Migration 139 — DONE AND VERIFIED (2026-09-13).** `backend/supabase/migrations/
   139_share_link_lifecycle_actions.sql` — atomic lifecycle actions plus the `outcome`-bearing
   extension of all four public share-link RPCs (see C2.4 above). E ran it in production and it
   returned `Success. No rows returned`. Its canonical test,
   `backend/supabase/migration_139_share_link_lifecycle_actions_tests.sql`, failed once in
   production on a real condition its reconstructed-schema verification hadn't reproduced (`TEST
   FAILED: a PM-only caller was able to manage a proposal share link` -- root cause: this
   workspace's admin also holds the `pm` role, so the discovery query needed to exclude admins, not
   just this migration's own logic). Fixed and re-verified against that exact scenario plus a second
   one (a non-admin PM also holding `sales` as a secondary role); E reran the corrected file and it
   returned `Success. No rows returned` -- zero sections skipped. **This was also a breaking RPC
   signature change**, and its paired frontend TypeScript update (parsing the new `outcome` column
   on `fetchPublicQuoteProposal`/`fetchPublicSubmittal`, plus the three decided customer-facing
   messages on both public pages) was already shipped and deployed same-day, ahead of this test
   confirming -- see HANDOFF.md's "urgent finding" entry for why it couldn't wait: checking
   migration 139's live effect surfaced an active production defect (every non-`found` outcome was
   being rendered as a real, found document with null content), not a scheduled follow-up. Do not
   run migration 139 or its test again.
8. **Migration 140 — DONE AND VERIFIED (2026-09-13).**
   `backend/supabase/migrations/140_share_link_version_supersession_and_quote_cascade.sql` —
   auto-supersede-on-new-version RPCs plus the quote soft-delete cascade trigger (see C2.5 above). E
   ran it in production and it returned `Success. No rows returned`. This migration was checked
   proactively before being sent at all (given migrations 137/138/139 each surfaced a real production
   issue only their own live run caught) and a real bug was found in the migration itself:
   `create_and_send_submittal_version`/`create_and_send_quote_proposal_version` both declare `returns
   table (..., token text)`, and a RETURNS TABLE column becomes an implicit plpgsql variable in scope
   for the whole function body — the supersession UPDATE's unqualified `where token = r.old_token`
   was genuinely ambiguous between that variable and `public_share_tokens.token` (Postgres 42702), the
   exact bug class migration 121 already hit and documented. Fixed by aliasing the target table (`as
   pst`) and qualifying the WHERE clause before ever sending it. Its canonical test,
   `backend/supabase/migration_140_share_link_version_supersession_and_quote_cascade_tests.sql`, also
   had the same three issues 139's test needed fixing in production (missing fixture-creation
   identity simulation; PM/Sales discovery not excluding admins — this workspace's admin also holds
   `pm`; the two cross-authorization checks needing secondary-role isolation) — all fixed and
   independently verified against three scenarios (clean fixtures, the admin also holding `pm`, a
   non-admin PM also holding `sales`) before ever being sent. E ran it in production and it returned
   `Success. No rows returned`. Its canonical test found one more real gap on the first run (see
   migration 142 below); the corrected rerun of the SAME test file also returned `Success. No rows
   returned`, zero sections skipped. Do not run migration 140 or its test again.
9. **Migration 142 — DONE AND VERIFIED (2026-09-13).** `backend/supabase/migrations/
   142_fix_quote_cascade_trigger_grants.sql` — migration 140's canonical test's first run found:
   `TEST FAILED: anon has execute privilege on the cascade_quote_soft_delete trigger function --
   expected none (trigger-only).` Migration 140 only revoked from `public`, reasoning (matching
   migration 117's own precedent) that a trigger function needs no grant since Postgres refuses to
   invoke a `returns trigger` function directly regardless of privilege — true, but this Supabase
   project's project-level default privileges apply to newly created FUNCTIONS too, not just tables
   (the same class of gap migration 141 already closed for `share_link_views`/`share_link_actions`/
   `workspace_share_link_settings`), so `anon`/`authenticated` were automatically granted EXECUTE
   anyway. Functionally inert (the grant can never actually be exercised) but closed for the same
   explicit minimum-ACL discipline every function here follows. Migration 140 itself was not edited
   — it is already applied; this was a separate follow-up, exactly mirroring 137→141. E ran it and it
   returned `Success. No rows returned`, then reran migration 140's canonical test, which also passed
   cleanly. **Queue C2.2–C2.5 is now fully closed — no pending manual database action.**
10. **Migration 143 — APPLIED (2026-09-14), but its OWN effect was never actually live. Canonical
    test found TWO real bugs across two live runs -- first fixed (test script only); second is a
    real production defect, root-caused, fixed via migration 145 (drafted, next single file for E).**
    `backend/supabase/migrations/143_share_link_view_logging.sql` — closes a real gap found while
    reconciling `PRODUCT_SHARE_LINK_IMPLEMENTATION_PLAN.md` against the shipped Queue C2.6 work:
    `share_link_views` (migration 137) never had a write path — Stage B always specified one,
    migration 139 didn't implement it, and Queue C2.6's Activity panel reads this exact table, so its
    view count would silently show 0 forever without this. Redefines
    `get_quote_proposal_by_token`/`get_submittal_by_token` (already applied) to log one view row per
    call — same external outcome shape and grants, additive only. A genuinely unknown token is
    deliberately never logged (no entity to attach it to under the current NOT NULL schema). E ran it
    in production and it returned `Success. No rows returned`. Independently verified end-to-end
    against a real local PostgreSQL 18 engine (PGlite), including under the real admin-also-PM
    condition, before ever being sent. Do not run migration 143 again. **Its canonical test's first
    real run failed** (`ERROR: 42501` on `project_submittals` — see "Completed and verified" above for
    the full root cause: the test's own fixture setup relied on a direct-write RLS policy migration
    144, applied later the same day, deliberately removed). Fixed in the test script only, resent to
    E, resent, and E's re-run hit a SECOND real bug — `TEST FAILED: expected exactly one 'success'
    share_link_views row ... found 0`, i.e. `get_quote_proposal_by_token()`'s own internal insert into
    `share_link_views` produced no row. Since that insert is wrapped in the function's own `exception
    when others then null;` (deliberate, so logging never blocks a real customer), **this may mean
    view logging has been silently failing in production for every real page view since migration 143
    was applied** — not just a test-script defect this time. Leading theory: migration 141's `revoke
    all on table share_link_views ... from public, anon, authenticated` may be reaching the function's
    own execution-role privilege in a way source review alone can't confirm. A diagnostic script
    (`backend/supabase/diagnostic_143_share_link_views_insert_failure.sql`, `begin;`/`rollback;`,
    nothing commits) was sent to E to surface the real (currently swallowed) error and report
    ownership/grant facts before any fix is proposed. **Six rounds later (v1-v6, each iterating on the
    previous result), root cause CONFIRMED**: both live functions are exactly migration 139's original
    logic, verbatim — no `v_view_result` variable, no `insert into public.share_link_views` anywhere.
    Migration 143's function-body changes were simply never live, for a historical reason this
    investigation could not determine from the database alone (recorded as an open question, not
    assumed). Ownership, RLS, grants, and search_path were all definitively ruled out along the way — a
    throwaway probe function with the identical insert succeeded cleanly under the same role. **Per this
    repo's standing rule, migration 143 itself is NOT edited or rerun.**
    `backend/supabase/migrations/145_reapply_share_link_view_logging.sql` re-applies the exact same
    intended function bodies via idempotent `create or replace function` statements — no design
    change. `migration_143_share_link_view_logging_tests.sql` extended with a new **Section 0** that
    reads each function's live source via `pg_get_functiondef()` and asserts the logging insert is
    actually present, checked unconditionally before anything else — closing the exact detection gap
    this whole investigation exposed. **Migration 145 APPLIED (2026-09-15) — `Success. No rows
    returned`. Its extended canonical test PASSED (2026-09-15) — `Success. No rows returned`, zero
    sections skipped, including the new Section 0 check. QUEUE C2 IS NOW FULLY CLOSED. Do not run
    migration 143, 145, or either of their tests again.**
11. **Migration 144 — APPLIED (2026-09-14). Canonical test PASSED — `Success. No rows returned`, zero
    sections skipped. Queue C2.7 is fully closed.**
    `backend/supabase/migrations/144_close_share_link_direct_write_bypasses.sql` — Queue C2.7 part 2
    (see C2.7 above for full detail): drops `public_share_tokens`'/`project_submittals`'/
    `sales_quote_proposals`' old direct-write policies entirely, now that Queue C2.7 part 1 (the
    frontend switch to the server-owned RPCs) is deployed and confirmed live. E ran it in production
    and it returned `Success. No rows returned`. Independently verified end-to-end against a real
    local PostgreSQL 18 engine (PGlite), including a negative control proving the test genuinely
    fails without this migration and the real admin-also-PM condition, before ever being sent. Do
    not run migration 144 or its canonical test again — both are done.

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
`PRODUCT_MASTER_COMPLETION_PLAN.md`. **Queue C2 is fully closed** — migrations 137–145 are all applied
in production and every one has a passing canonical test (including migration 145, which re-applied
migration 143's view-logging function bodies after a six-round diagnostic investigation confirmed they
had been recorded as applied but were never actually live — full trail in "Completed and verified").
Migration 143 itself was NOT edited or rerun. The internal lifecycle controls UI, the Create & Send RPC
switch, and the version-comparison status badge are all shipped and deployed. **Do not redo, rerun, or
resend any of this.** Treat A1–A15, B1–B10, C1, and C2.1–C2.7 as completed records, not a queue with
open items. Move to Queue B/C's other prepared-but-not-implemented items, or a new task from E, for
the next unit of work.

**Update, 2026-09-16 (later same day):** the above remains true and is now further superseded by the
Queue R2/R3 batch described in the launchpad above (D5/D6/D8/D9/D12/D18) and by
`PRODUCT_MASTER_COMPLETION_PLAN.md`, which is the authoritative current roadmap. The next concrete
action for the next coder is the manual-action queue in that document's §5: apply migration 153
(D12), then its canonical test; only after that is confirmed, apply migration 154 (D9 part 2), then
its canonical test. Both are one-at-a-time Supabase SQL actions for E, not something the coder runs.
