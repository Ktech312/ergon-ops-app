# Ergon Ops — Full Overnight Coder Execution Plan

Status: **ACTIVE HANDOFF FOR THE NEXT LONG AUTONOMOUS RUN.** This is an execution queue, not a
one-task request and not a request for another broad audit. The coder should keep moving through
independent work for the whole available session. A database checkpoint, an unanswered design
detail, or one blocked lane is a reason to park that lane in a reviewable state and start the next
lane — not a reason to stop.

Prepared: 2026-09-13. Canonical companion files: `CONTINUOUS_CODER_HANDOFF.md`, the newest entries
at the top of `HANDOFF.md`, and `PRODUCT_MASTER_COMPLETION_PLAN.md`.

## 1. Mission and confirmed starting point

Continue closing real reliability, security, share-link, recovery, accessibility, and product-
readiness gaps without inventing business processes or requiring E to supervise the session.

At preparation time:

- `main` and `origin/main` are both at `814af14`; verify this rather than assuming it is still true.
- The working tree is clean.
- Migrations 134, 135, and 136 and their canonical tests have run successfully. Do not run them
  again.
- Frozen Sales pricing is deployed at `https://ergon-ops-app.vercel.app/`; one real priced proposal
  remains a natural-use acceptance check, not a reason to create production data.
- Share-link migrations 137–140 and their rollback-only canonical tests are already drafted,
  committed, and pushed on `main`. They are **not applied**. Do not redraft, renumber, or run them.
- Queue C2.1–C2.5 are completed preparation records. Begin with C2.6 preparation, then continue
  through the independent lanes below.

If the baseline differs, reconcile the difference in the morning report. Do not discard or rewrite
someone else's uncommitted work.

## 2. Rules that prevent another early stop

1. Do not end after one task, one migration draft, one test run, or one audit finding.
2. If a task reaches a manual Supabase gate, record the exact gate, leave the package reviewable,
   and immediately move to the next independent task in this page.
3. If a business detail is genuinely missing, add one concise entry to the decision register and
   continue elsewhere. Do not ask E questions during the overnight run.
4. Source research alone is not a completed implementation task when a safe code/test change is
   already authorized below. Use research to verify the change, then implement it.
5. Keep changes in small coherent commits. A failure in one batch must not strand unrelated
   finished work.
6. Re-run only the checks justified by the files changed. Before pushing any production code,
   require TypeScript, relevant tests, full Vitest, ESLint, build, and smoke to pass.
7. Continue until every lane below is implemented, reduced to a concrete review package, or
   blocked by a named constraint. Stop early only if the same technical failure prevents meaningful
   work in every remaining lane.

## 3. Hard boundaries

The overnight coder must not:

- run any Supabase migration, canonical SQL test, ad hoc SQL, repair query, or production-data
  mutation;
- create a second workspace or demo data in the real Ergon Test Workspace;
- begin Phase 3 RLS containment or change who can read cross-workspace records;
- change Sales, PM, Manager, Admin, Billing, Engineering, Support, or Marketing authority;
- create the Billing role, down-payment gate, assigned-PM workflow, commercial SaaS billing, or a
  new approval workflow;
- alter real users, roles, admins, quotes, projects, links, or customer records;
- enter credentials, connect a paid service, send email/Slack/push messages, or contact anyone;
- install, remove, or upgrade a dependency, including `xlsx`/`exceljs`;
- push frontend code that requires an unapplied database migration;
- claim authenticated acceptance, mobile acceptance, real email delivery, or natural-use business
  acceptance from bundle inspection or a signed-out browser check.

The coder may perform read-only source inspection, local builds/tests, synthetic rollback-only test
design, small reversible code fixes within the lanes below, documentation reconciliation, commits,
and pushes/deployments of code that is fully independent of unapplied schema.

## 4. Database checkpoint protocol

Migrations 137–140 form one ordered chain. They are not tonight's stopping point.

1. Do not hand E several SQL files. The next morning action is exactly migration 137.
2. After E reports 137 succeeded, the next action is exactly its canonical test file. A clean
   `Success. No rows returned` is a pass because the script hard-fails assertions and genuine skips;
   never ask E to find NOTICE output.
3. Only after that pair passes does migration 138 become the next single action, followed by its
   test; then 139 and its test; then 140 and its test.
4. The frontend must not switch to the new RPC/output contracts until the required migration has
   passed. Prepare mappers, pure state transitions, component contracts, and tests locally without
   wiring them into the live calls.
5. Never create another numbered migration merely to stay busy while 137 is pending. Put later SQL
   into a reviewed design block or unnumbered draft notes until the active chain advances.

## 5. Pass 0 — establish evidence and protect the workspace

Complete these before editing:

- Verify `git status --short`, `git rev-parse HEAD`, and `git rev-parse origin/main`.
- Read this page, the current top of `HANDOFF.md`, Queue C2 in `CONTINUOUS_CODER_HANDOFF.md`, and the
  current master-plan status table.
- Confirm migrations 137–140 and all four canonical tests exist and match the committed records.
- Search for `AGENTS.md`; follow it if present.
- Create a simple overnight work log in `HANDOFF.md` only when the first real batch is complete;
  avoid speculative progress entries.

Deliverable: a short baseline record in the final report, with no code change required.

## 6. Lane A — Share-link lifecycle client preparation

This is the primary lane. Business rules are already decided in
`PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md`; do not reopen them.

### A1. Re-review the prepared SQL chain

Read migrations 137–140 and their tests as one dependency graph. Check signatures, grants,
`search_path`, table qualification, output-column ambiguity, transition predicates, audit writes,
quote soft-delete behavior, and empty-table fixtures. Do not edit merely for style. If a concrete
defect exists, fix only the affected migration/test and document why; otherwise record a clean
review and continue.

### A2. Build pure lifecycle outcome parsing

Add or refine TypeScript types and pure mappers for `found`, `invalid_token`, `expired`,
`superseded`, and neutral `unavailable` outcomes for proposals and submittals. Cover null/malformed
RPC rows and preserve the existing successful payload shape. These helpers must not be wired to the
live RPC until migration 139 passes.

Deliverables: one small module or clearly isolated functions, focused tests, no runtime call-site
change.

### A3. Build customer message resolution

Implement a pure message resolver matching the decided copy policy:

- superseded: tell the customer a newer version was sent and to check email;
- expired: neutral unavailable wording;
- temporarily disabled and permanently revoked: the same neutral unavailable wording;
- invalid token: no customer data and no reason disclosure.

Test proposal and submittal wording and accessible status semantics. Keep this unwired if the live
RPC cannot yet produce the outcomes.

### A4. Prepare internal control state and audit-history mapping

Create pure UI models/helpers for allowed actions by token status: Disable/Re-enable as a pair;
Permanent Revoke separate; Generate New Link separate; terminal revoked/superseded restrictions;
and chronological action/view history. Proposal action authority remains Sales/Manager/Admin. PM
gets no proposal authority. For submittals, do not approximate the future assigned-PM rule as “any
PM”; keep the currently provable PM/Admin boundary and identify the later Stage 2 cutover.

Deliverables: pure functions/types/tests. Do not display controls against production until their
RPCs exist.

### A5. Prepare component integration behind one explicit activation seam

Trace the exact proposal and submittal internal views and public pages. Refactor only as needed so
the prepared mappers/message helpers can be activated in one small later patch. Preserve current
behavior now. Add accessible confirmation-dialog copy and focus-return tests where existing test
infrastructure supports them. Do not add disabled “coming soon” controls.

### A6. Write the post-139 wiring checklist

Specify the exact files, functions, old response types, new response types, and verification flow
for the later activation commit. Include rollback behavior if the new RPC returns an unexpected
shape. This is a concise implementation checklist, not another architecture document.

Fallback: when any A task depends on live 137–140 schema, leave it as a tested pure seam and move to
Lane B.

## 7. Lane B — Reliability closure in current production code

This lane is independent of migrations 137–140 and should produce deployable batches when real gaps
are found.

### B1. Reconcile the error-visibility audit against current code

Search the current `src/persistence.ts` writers and their `main.tsx` callers. Mark already-fixed
findings as resolved and identify only remaining cases where:

- a mutating response is never checked;
- a required lookup silently becomes an empty array/null;
- the UI reports success before the write is confirmed;
- a caught error is discarded despite an existing visible status channel;
- a multi-step save claims atomicity it does not provide.

Do not produce a broad duplicate audit. Produce a ranked, source-cited delta against the existing
audit.

### B2. Fix bounded unchecked writes

For each confirmed case whose caller already has an error channel and whose behavior is
unambiguous, add `.ok`/response-cardinality checking, log status/body to `console.error`, throw or
return the existing plain failure result, and prevent false local success. Add failure-path tests.
Keep business logic, role gates, retry policy, and database shape unchanged.

Work in batches of at most three related functions. Run relevant tests after each batch. Commit and
continue rather than accumulating one enormous diff.

### B3. Check optimistic state updates

Find handlers that update local state before awaiting persistence and never revert on failure. For
simple value edits with an established pessimistic precedent, await the write first and update state
only after success. Do not redesign Client Ledger's already-shipped serialized queue or introduce a
new global save system.

### B4. Verify search/read failures

Review functions that convert failed prerequisite or list requests into an empty success result.
Fix only cases where empty data is observably indistinguishable from failure and callers already
support an error state. Preserve deliberately best-effort telemetry and optional enrichment.

### B5. Documentation truth pass

Update `PRODUCT_ERROR_VISIBILITY_AUDIT.md` and the master plan only for source-confirmed changes.
Separate durable admin visibility from one-tab console diagnostics. Do not label either as an alert.

Fallback: if no valid code defect remains, record the clean scope and move to Lane C immediately.

## 8. Lane C — Backup/restore checkpoint preparation

Decision D9 is already recorded: unresolved references may be skipped by section with a clear
warning and retry; live entry stays strict. Do not ask again.

### C1. Verify the current restore outcome contract

Trace `restoreFullBackupSnapshot`, `RestoreOutcome`, `RestoreSectionResult`, the import UI, and
existing tests. Confirm which sections can continue independently and which have prerequisites.
Correct stale documentation before adding new behavior.

### C2. Build pure checkpoint/reconciliation types

Create backward-compatible types and pure helpers for a future restore run:

- stable snapshot id/fingerprint input;
- per-section `pending/running/succeeded/failed/skipped` state;
- attempted/succeeded/count/error fields;
- retry eligibility and dependency blocking;
- final reconciliation summary with warnings.

No database table, network write, or resume RPC is added. Test malformed input, partial success,
skipped unresolved references, retry selection, and deterministic summaries.

### C3. Add synthetic fixture builders

Consolidate repeated restore-test fixtures into deterministic builders using fictional identifiers.
No real production restore is ever run. Ensure the fixtures cover legacy documents lacking stable
document numbers and the current idempotent path.

### C4. Draft the implementation-ready checkpoint contract

Reconcile `PRODUCT_BACKUP_RESTORE_CHECKPOINT_SPEC.md` with the current code and D9. Specify the
future `restore_runs`/section-state boundary, safe redacted errors, retry rules, and System Health
integration. Keep illustrative SQL inside the document; do not create a numbered migration.

Fallback: if a helper would force a UI/workflow choice not already decided, document the exact seam
and move to Lane D.

## 9. Lane D — System Health Phase B preparation

Phase A is live. D8 is recorded as email every workspace admin by default, with a configurable
on-call list later. Do not send any alert overnight.

### D1. Revalidate the event taxonomy

Map current cron, Redis fallback, notification delivery, RPC, save, and restore failure sources to
the existing `PRODUCT_SYSTEM_HEALTH_PLAN.md` event fields. Remove stale references and identify
which sources can safely emit redacted structured data.

### D2. Build pure classification and redaction helpers

Implement pure helpers for severity, dedup keys, safe-detail allowlisting/redaction, lifecycle
labels, and 90-day detailed-retention summaries. Never pass tokens, request bodies, customer
content, email contents, stack traces, or raw database responses into safe detail. Add exhaustive
unit tests.

### D3. Prepare Admin UI mapping independent of the future table

Build pure view-model/filter helpers for active/acknowledged/resolved events and occurrence counts.
If a component can be tested without a live endpoint, create it behind a non-rendered seam; do not
show a nonfunctional panel in production.

### D4. Reconcile the Phase B build sequence

Update the System Health plan with exact API/function/file contracts and failure-in-the-monitor
handling. Keep future SQL illustrative and unnumbered while migrations 137–140 are pending.

Fallback: if all pure work already exists and tests are adequate, record proof and move to Lane E.

## 10. Lane E — Spreadsheet dependency proof without changing packages

The `xlsx` package remains the one unresolved audit vulnerability. The recorded direction is to
replace it only after a real-file proof. Do not install `exceljs` or remove `xlsx` overnight.

### E1. Extract the current behavior into an adapter contract

Without changing runtime behavior, isolate the two current first-sheet-to-row import paths behind a
shared interface if that can be done safely. Preserve blank cells, numeric-looking text, header
matching, first-sheet-only behavior, and current error copy. Add tests around the adapter boundary.

### E2. Create committed fictional workbook fixtures

Use the currently installed library only to create or store tiny fictional `.xlsx` fixtures for:
blank cells, numeric-looking text, header-only sheet, multiple sheets, duplicate headers, BOM
headers, and catalog headers. Keep them small and free of real customer/vendor data.

### E3. Write a replacement compatibility harness

Create tests that define the exact normalized row output any future replacement must match. The
tests should be reusable after `exceljs` is installed later, without depending on it now.

### E4. Refresh the read-only audit

Run `npm audit` read-only and record the exact current findings. Do not run `npm audit fix`. Update
the evaluation only if the dependency tree or call sites actually changed.

Fallback: if fixture generation would modify dependencies, use static checked-in fixtures or pure
row-normalization tests and continue to Lane F.

## 11. Lane F — Accessibility, mobile, and performance cleanup

Make only targeted, evidence-based fixes. Do not redesign the app or change business flow.

### F1. Public document pages

Inspect proposal and submittal public views at narrow widths and keyboard-only operation using local
fixtures or routes. Fix confirmed overflow, inaccessible status text, missing labels, focus loss,
or unusable controls. Preserve presentation content and frozen snapshots.

### F2. Internal proposal/submittal history

Review current list/table semantics, focus order, button names, confirmation copy, and small-screen
overflow so C2.6 can integrate without regressing accessibility. Changes that do not depend on
137–140 may ship; lifecycle controls themselves remain unwired.

### F3. Performance verification

Use source evidence and browser/network measurements to check whether the public pages or current
Sales detail render repeatedly compute or fetch the same data. Apply only small memoization or
bounded-load fixes with measurable evidence. Do not introduce a new state library or pagination UX.

### F4. Update coverage honestly

Update the critical-flow coverage matrix with exact local/browser coverage. Signed-out load is not
authenticated acceptance; desktop width is not mobile acceptance.

Fallback: if no concrete defect is reproduced, record what was checked and move to Lane G.

## 12. Lane G — Security and authorization review around new work

This lane is review and preparation only while the share-link migration chain is unapplied.

### G1. Audit migrations 137–140 as an attacker

Check anonymous enumeration, token status leakage, caller-supplied actor/workspace fields, response
replay, cross-entity role mistakes, direct table writes, action-history forgery, soft-delete/restore,
and concurrent version creation. Strengthen existing SQL tests when a missing assertion is found.

### G2. Verify security-definer hygiene since migration 136

List every new/redefined function and check `search_path=''`, fully qualified references, grants,
safe error messages, and trigger-only EXECUTE revocation. Fix only the unapplied 137–140 files when
needed. Any unrelated live-function correction becomes a documented future migration, not a second
numbered package tonight.

### G3. Review client-side secret exposure

Confirm no share token, service-role key, Redis token, cron secret, raw email body, or customer
snapshot is logged to browser/server diagnostics. Small log-redaction fixes with no behavior change
may ship with tests.

### G4. Reconcile policy-closure prerequisites

Document the exact C2.7 order for replacing direct writers before revoking their policies, including
`accept_invite()`'s special invited-user path. Do not implement or activate policy closure tonight.

## 13. Lane H — Documentation and handoff integrity

This lane runs last and also between code batches when useful.

- Reconcile `HANDOFF.md`, `CONTINUOUS_CODER_HANDOFF.md`, the master plan, relevant feature plan,
  error audit, System Health plan, backup plan, and critical-flow matrix.
- Correct stale statements such as “committed locally/not pushed” when Git proves the commit is on
  `origin/main`.
- Keep historical migration records accurate; add a later status note rather than rewriting what
  was true at the time.
- Consolidate manual database actions into one ordered list. The first and only immediate user
  action must be migration 137.
- Delete no design document merely because another supersedes it; mark it superseded and point to
  the canonical current page.
- End with a clean or fully explained working tree. Do not hide unfinished work in an unnamed stash.

## 14. Commit, push, and deployment rules

### Safe independent production-code batches

For Lane B, E, or F changes that do not depend on migrations 137–140:

1. Run targeted tests.
2. Run `npx tsc -b`.
3. Run full `npx vitest run`.
4. Run `npx eslint .`; existing warnings may remain only if the count does not increase.
5. Run `npm run build` and `npm run test:smoke`.
6. Commit by coherent topic, push to `main`, wait for Vercel, verify the production URL, served
   bundle, fresh load, network failures, and console errors.
7. State exactly whether the check was signed out or authenticated. Never use credentials merely to
   improve the report.

### Prepared future-schema work

- Pure mappers, message resolvers, fixtures, and tests may be committed/pushed only when they do not
  change live behavior or imports in a way that assumes new schema.
- Runtime wiring that calls migrations 137–140 stays uncommitted or in a clearly separated commit
  that is not pushed until the corresponding migration and test pass.
- Do not combine a safe deployable reliability fix with blocked share-link runtime wiring.

## 15. Required morning report

Use these exact sections:

1. **Shipped and live** — commits, production URL, and direct verification evidence.
2. **Completed locally / prepared for review** — files and behavior, clearly marked not run/deployed.
3. **Database queue** — state of 137–140; one next manual action only.
4. **Verification** — targeted/full test totals, TypeScript, ESLint, build, smoke, browser coverage.
5. **Confirmed defects fixed** — before/after behavior with file/function names.
6. **New findings** — source-confirmed facts separate from recommendations.
7. **Decisions recorded** — only genuinely new decisions; do not relist resolved D1–D15 items.
8. **Blocked** — exact blocker and what reviewable artifact was left behind.
9. **Next automatic task** — the next unblocked lane the coder would continue without E.
10. **Git state** — HEAD, `origin/main`, clean/dirty files, and any intentionally unpushed commit.
11. **Boundary confirmation** — confirm no SQL run, no production data changed, no second workspace,
    no Phase 3 RLS, no role/authority change, no dependency install, and no external message sent.

Do not end the report by asking what E wants to do next. State the single manual action separately:

> **Your one next action:** Review and run
> `backend/supabase/migrations/137_share_link_lifecycle_schema.sql` in Supabase SQL Editor, then send
> the result. Do not run its test yet.

## 16. Definition of a full overnight pass

The pass is not complete merely because Lane A reached migration 137's gate. It is complete only
when the coder has:

- reviewed the prepared share-link chain and completed every safe pre-wiring artifact available;
- exhausted the bounded reliability delta or shipped the valid fixes found;
- produced checkpoint/reconciliation helpers and an updated restore contract, or proved they
  already exist;
- completed the safe System Health pure logic/preparation available without schema;
- produced the spreadsheet replacement compatibility fixtures/harness without changing packages;
- performed targeted accessibility/mobile/security checks and fixed reproducible, bounded issues;
- reconciled the documentation and supplied the required report.

If time ends before that list is exhausted, the report must identify the exact next automatic task
and leave the repo in a state where another coder can continue immediately without rediscovery.
