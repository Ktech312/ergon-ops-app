# Critical-Flow Coverage Matrix

Status: **Queue A8** (`CONTINUOUS_CODER_HANDOFF.md`). Reviews existing coverage across the six named
completed critical flows rather than padding test counts — a fresh read of every named test file's
actual assertions confirmed the material gap categories the task calls out (stale response mapping,
failure preserving local state, idempotent retry, old snapshot compatibility) are already covered in
depth for five of the six flows. No new tests were added for this pass; where a real, material gap
existed, it's named explicitly below rather than silently left out.

**How to read this table**: "TS tests" = `src/*.test.ts` (Vitest, runs against mocked `fetch`, proves
frontend logic). "SQL tests" = `backend/supabase/migration_*_tests.sql` (transaction-safe, proves the
database function itself, run manually by E in Supabase's SQL editor). "Prod verify" = confirmed via
the Vercel-CLI/curl/browser pattern this session established. "Real-world use" = requires E (or a
real user) actually using the feature under real conditions this session's tooling cannot reach
(concurrent edits from two real people, a real sent proposal, a real receiving discrepancy, etc.).

| Flow | TS tests | SQL tests | Prod verify | Real-world use still needed |
|---|---|---|---|---|
| Quote-to-project conversion (`create_project_from_quote`, migrations 127/128) | `project-conversion.test.ts` (15), `quote-conversion-flow.test.ts` (14) — result mapping, photo copy/retry/cleanup, 409-conflict idempotency, transfer-count wording, unverified-project safety | `migration_127_conversion_tests.sql` — role/workspace/status authorization, atomic insert, idempotent retry returns the same project, unique-violation race handling. **Run and passed in production** (see `HANDOFF.md`) | Bundle-content and clean-boot verified after deploy | A real PM converting a real Closed-Won quote with real locations/photos — not yet exercised (no real quote has reached Closed-Won with photos in this account) |
| Project BOM replacement (`replace_project_bom_lines`, migrations 131/132) | `project-bom-save-queue.test.ts` (4) — save-queue coalescing/reconciliation, plus the reorder tests added this session | `migration_131_bom_replace_tests.sql` — reconcile-by-id, zero-quantity Draft placeholders, atomic update/delete/insert ordering. **Run and passed in production**, including the migration-132 correction found live | Bundle-content and clean-boot verified after deploy | A real PM editing a real project's BOM concurrently across two tabs/sessions — not yet exercised |
| Equipment Recipe save queue (`save_equipment_recipe`, migration 130) | `device-recipe-save-queue.test.ts` (10), `device-recipes-write-verification.test.ts` (8), `equipment-recipe-rpc-mapper.test.ts` — rename-while-saving race, coalesced overlapping saves, id backfill without clobbering newer local edits | `migration_130_recipe_save_tests.sql` — authorization, component resolution, duplicate/ambiguous-name rejection, BOM reconciliation, rollback. **Run and passed in production** | Bundle-content and clean-boot verified after deploy | The two-session concurrency scenario (test script Section 16) remains explicitly deferred, never built or run — a standing, named decision point, not an oversight |
| Purchase-order receiving failure state | `task2-unchecked-write-fixes.test.ts` and the dedicated receiving fix from this session's earlier pass — line/receive-all accessible status, receive-all stops on first failure, no false-complete on untouched lines | N/A — this flow has no dedicated RPC, it's a checked REST write | Bundle-content and clean-boot verified after deploy | A real receiving discrepancy (partial shipment, damaged goods) on a real purchase order — not yet exercised |
| Proposal/submittal response outcome mapping | `proposal-response.test.ts` (11), `submittal-response.test.ts` (11) — **both** already cover: first-winner success, replay/concurrency-loser mapped to the ORIGINAL winner's state (not the replay's own input), invalid-token, HTTP failure vs. invalid-token distinction, network-throw-without-rejecting, and an unrecognized future outcome string treated as `error` instead of crashing | Covered by migrations 119/121/122/123's own SQL suites (proposal/submittal replay-safety, applied and verified in earlier sessions per `HANDOFF.md`) | Bundle-content verified; the public page itself was spot-checked at load time | A real client actually responding to a real sent proposal/submittal — not yet exercised (no real proposal exists to respond to) |
| Backup restore structured outcome (`restoreFullBackupSnapshot`) | `restore-backup-snapshot.test.ts` (7) — complete success, first-section failure not blocking later sections, middle-section failure preserving an earlier success, malformed-snapshot rejection, deterministic document-number retry. **D9 (2026-09-16) added `restore-checkpointing.test.ts` (10)** — required-vs-optional reference distinction (unresolved optional references warn-and-continue, required-data failures still stop the section), resumable per-section checkpointing (an already-succeeded section is skipped entirely on resume, never re-run) | `migration_154_backup_restore_checkpointing_tests.sql` (9 sections) — fresh run seeds pending sections, section updates persist including warnings, resume reuses the same run without duplicating it, finalize correctly distinguishes `completed`/`completed_with_failures`, force-new starts an independent run, non-admin rejected, grant checks. **Drafted, not yet run in production — migration 154 is queued, §5 item 2 of `PRODUCT_MASTER_COMPLETION_PLAN.md`** | Not yet exercised against a real backup file in production. Frontend code is deployed and degrades safely (runs as a normal non-checkpointed restore) until migration 154 is live | A real restore of a real exported backup snapshot — never run against production per the standing rule against destructive backup/restore testing outside a sandbox |

## The one material gap actually found this pass — CLOSED by Queue A11

**Old-snapshot compatibility for `ProposalSnapshot.companyName`/`companyLogoUrl`** (added this
session's earlier branding work) was covered on the frontend (`proposal-version-comparison.test.ts`'s
"missing optional fields from older proposals" case, and `send-proposal-email.js`'s new fallback
test from Queue A7) but had no equivalent for `SubmittalSnapshot`, because that type never gained
company-branding fields at all — see Queue A7's own recorded finding in `HANDOFF.md`. **Queue A11
(2026-09-12) closed this**: `SubmittalSnapshot` now carries the same optional `companyName`/
`companyLogoUrl` fields, `SubmittalPublicPage` renders them via the shared `.proposal-public-brand`
block, and `send-submittal-email.js`'s sign-off uses the frozen name with an "Ergon" fallback — 2 new
tests in `tests/api/send-submittal-email.test.js` mirror `send-proposal-email.test.js`'s own coverage
exactly. Kept here for history; the gap this section originally named is no longer open.

## Addendum (2026-09-13, Queue C1) — frozen Sales pricing shipped

Not added as a seventh row above because the original matrix was scoped to six reliability flows.
Sales pricing is now deployed: migration 136 and its corrected canonical test passed, and the new
Vercel bundle was verified. `sales-pricing.test.ts` and the extended
`proposal-version-comparison.test.ts` cover the same gap categories this matrix already checks for —
frozen-value correctness, old-snapshot compatibility (a pre-pricing proposal compares/renders
cleanly), and no cost/margin leakage into any customer-reachable payload (asserted directly, not just
by convention). `migration_136_sales_pricing_foundations_tests.sql` passed in production, including
the accepted-proposal-total conversion carry-through. Real-world use (a rep actually
pricing a live quote, a real client seeing a priced proposal) remains unexercised, same standing
limitation every other flow in this matrix already lists.

## What this matrix deliberately does not do

It does not re-derive pass/fail counts already stated in `HANDOFF.md`'s per-commit entries, and it
does not add tests that would just re-assert what the SQL test scripts already prove at the database
layer (per the task's own instruction not to duplicate SQL coverage or implementation line-for-line).
