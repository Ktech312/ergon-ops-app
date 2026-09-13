# Backup Restore Resume/Checkpoint — Specification (Queue B5, NOT IMPLEMENTED)

Status: **DESIGN ONLY. No production code, no migration.** Written for `CONTINUOUS_CODER_HANDOFF.md`
Queue B5, blocked on decision **D9** (§8 of that document) — "Backup restore unresolved references":
recommended direction already recorded as "allow a clearly warned per-section skip/retry during
restore; live entry remains strict." This document assumes that direction throughout and turns it,
plus the 6-item checkpoint/reconciliation design already sketched in
`PRODUCT_ERROR_VISIBILITY_AUDIT.md` §A2.2c, into the concrete `restore_runs` schema, retry-key rule,
resume behavior, cancellation, and stale-reference rule B5 specifically asks for. Nothing below should
be built until D9 is answered. Uses synthetic snapshots only for every test named — never a real
production backup file, per the task's own instruction.

## 1. What already exists (do not re-build)

`restoreFullBackupSnapshot` (`src/persistence.ts:8260`) already returns a structured `RestoreOutcome`
— `{ ok: boolean; sections: RestoreSectionResult[] }`, one `RestoreSectionResult` per of the six named
sections (`section`, `attempted`, `succeeded`, `count`, `error?`) — shipped in the 2026-09-12
reliability closeout, ahead of the checkpoint design that first proposed it in §A2.2c item 1. Each
section already runs independently (one section's failure doesn't block the others) and is honestly
reported, not silently swallowed. **This spec builds on that exact shape** — `restore_runs` (§2 below)
is the durable, admin-visible persistence of a `RestoreOutcome`, not a redesign of it. What genuinely
does not exist yet: any durable record of a restore attempt surviving a page reload, any resume/retry
of only the failed sections, any cancellation, and any rule distinguishing "never resolved" from
"used to resolve, doesn't anymore."

## 2. `restore_runs` — schema (illustrative pseudocode, not a runnable migration)

A real, durable table — a deliberate upgrade from §A2.2c's original "`localStorage` is enough, this
only needs to survive one page reload" sketch. That reasoning no longer holds now that System Health
(Queue B4, `PRODUCT_SYSTEM_HEALTH_PLAN.md`) is designed to record a health event for a restore that
ends with failures — a health event naming "Backup restore stopped after Project Documents" is only
useful to an admin who wasn't watching if there's a real, queryable row behind it, not a fact trapped
in the browser of whoever happened to click Import.

```sql
-- Illustrative only -- confirm the next free migration number at execution time.
create table restore_runs (
  id uuid primary key default gen_random_uuid(),
  -- A hash of the uploaded file's bytes, not a user-supplied label -- two
  -- uploads of the exact same backup file must resolve to the same run
  -- identity for resume to mean anything; a user-typed label could collide
  -- or drift from the actual file contents.
  snapshot_hash text not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'completed_with_failures', 'cancelled')),
  started_by_email text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- One row per RestoreSectionResult, keyed by (run, section) -- see §3
  -- for why this is the retry key, not a new concept.
  created_at timestamptz not null default now()
);

create table restore_run_sections (
  id uuid primary key default gen_random_uuid(),
  restore_run_id uuid not null references restore_runs(id) on delete cascade,
  section text not null,  -- RestoreSectionName's six values
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'skipped_empty')),
  attempted_count int not null default 0,
  succeeded_count int not null default 0,
  error text,
  updated_at timestamptz not null default now(),
  unique (restore_run_id, section)
);
```

RLS: both tables restricted to admin read/write, matching the existing "restore is an admin-only
action" posture already implicit in `handleImportBackup` being reachable only from an admin-gated
screen — needs a policy before this is handed over for review, per the standing migration checklist.

## 3. Deterministic retry keys

The retry key is **`(restore_run_id, section)`** — not a per-record key. This matches the granularity
`RestoreOutcome` already ships at (§1): each of the six sections is one atomic unit of retry, exactly
as `runSection` already treats them today. A resumed run:

- Skips any `restore_run_sections` row already `succeeded` for this `restore_run_id` — re-running a
  fully-clean section is safe per §A2.2c's own idempotency analysis (natural-key upserts), but wasteful
  and slower, so resume avoids it rather than merely tolerating it.
- Fully re-attempts any row `failed` or `pending` — a partially-succeeded section is never "topped
  up" record-by-record; it is re-run in full, matching the existing behavior of every save function in
  that chain (each is itself naturally idempotent on retry, so re-running a partial section's already-
  written records is safe, not a new risk introduced by resuming).

This makes `(restore_run_id, section)` the natural unique key for `restore_run_sections` (already
reflected in the schema above) and means resume logic needs no new idempotency mechanism beyond what
each section's own save function already provides — it only needs to know which sections to skip.

## 4. Resume behavior

1. On `handleImportBackup`, compute `snapshot_hash` from the uploaded file before doing anything else.
2. Look up the most recent `restore_runs` row for that hash. If none exists, or the most recent one is
   `completed`, start a brand-new run (fresh `restore_runs` row, all six `restore_run_sections` rows
   `pending`).
3. If the most recent matching run is `running` (a crash/reload interrupted it) or
   `completed_with_failures`, offer **Resume** as the primary action and **Start over** as a secondary,
   explicit, confirmation-gated one (starting over does not delete the old run row — it creates a new
   one, preserving history).
4. Resuming re-attempts only `pending`/`failed` sections per §3, in the same fixed dependency order
   the function already uses today (inventory items and equipment recipes first, since later
   sections resolve names against them).
5. A run transitions to `completed` only when every section reaches `succeeded` or `skipped_empty`;
   otherwise `completed_with_failures` once no more sections are `pending` — matching `RestoreOutcome
   .ok`'s existing "true only when every attempted section succeeded" rule exactly, just persisted.

## 5. Cancellation

Not previously specified anywhere. A running restore can be cancelled between sections (not
mid-section — a section's own save function is already an in-flight sequence of requests with no safe
interruption point, and stopping it mid-write would leave exactly the kind of undefined partial state
the whole design exists to avoid):

- **Cancel** sets `restore_runs.status = 'cancelled'` and stops the loop before starting the next
  `pending` section. Sections already `succeeded` stay recorded as such; the section that was in
  flight when Cancel was pressed either finishes and records its real outcome, or (if cancellation is
  requested before it starts) is left `pending`.
- A `cancelled` run resumes exactly like a `completed_with_failures` one (§4) — Cancel is not a dead
  end, it's a pause. There is no separate "resume a cancelled run" mechanism; the same lookup-by-hash
  logic in §4 step 2/3 already covers it by treating `cancelled` the same as `running`/
  `completed_with_failures` for resume-offer purposes.
- Cancelling does not roll back sections already committed — consistent with §1's existing, accepted
  non-atomicity (a section's writes, once committed, stay committed regardless of what happens to
  later sections or to the run as a whole).

## 6. The rule for references that no longer resolve

Distinct from an always-unresolved reference (already handled — see
`PRODUCT_ERROR_VISIBILITY_AUDIT.md` §A2.2c's existing sku/name-resolution behavior): a **stale**
reference is one that resolved correctly *when the backup was taken* but no longer does at restore
time, because the referenced project/build/equipment/sku was renamed, retired, or deleted in the
interim. Per D9's recommended direction (warned skip/retry, not strict block):

- A stale reference is treated **identically** to a never-resolved one at restore time — same
  `skipped`/`failed` reporting, same dry-run preview visibility (§A2.2c item 3), same "does not block
  unrelated sections" behavior. The restore layer has no reliable way to distinguish "this never
  existed" from "this used to exist" (the snapshot only ever recorded a name/sku, never a stable id
  survives independently of the live row it once matched), and D9's recommended direction doesn't
  require that distinction — both cases get a warning naming the specific unresolved record, never a
  silent null and never a hard abort of the whole run.
- **The one place this does matter**: the dry-run preview (§A2.2c item 3) runs at *restore* time, not
  at *backup* time, so it always reflects current live data — a reference that was fine when the
  backup was created but has since gone stale is correctly caught by the dry-run before any write,
  exactly as if it had never resolved. No separate "as of backup time" comparison is needed or
  proposed.
- **Live entry remains strict** (D9's second clause, unchanged from today): this rule applies only to
  the restore path. A user typing a project/build/equipment reference directly into a live form still
  gets today's existing validation behavior — this document does not loosen anything about normal,
  non-restore data entry.

## 7. Test matrix (synthetic snapshots only — never a real production backup)

To be written once D9 is confirmed and this is actually implemented:

1. A fresh restore of a synthetic snapshot with all six sections populated creates one `restore_runs`
   row (`running` → `completed`) and six `restore_run_sections` rows, all `succeeded`.
2. A synthetic snapshot with one deliberately-failing section (mocked write rejection) leaves that
   section `failed`, all independent later sections still `succeeded`, and the run `completed_with_
   failures` — proving sections remain independent, matching `runSection`'s existing behavior.
3. Resuming a `completed_with_failures` run re-attempts only the `failed` section; already-`succeeded`
   sections are not re-sent (asserted via mock call counts, not just end state).
4. Cancelling between sections stops before the next `pending` section starts; the section in flight
   at cancel time still reports its real outcome, never a fabricated "cancelled" status for a section
   that actually completed.
5. A synthetic snapshot containing a reference that resolves in one lookup fixture and is then removed
   from a second, later fixture representing "current live data at restore time" is reported as
   skipped/failed with a named reason, identically to a reference that never resolved in either
   fixture — proving §6's "treated identically" rule.
6. Two uploads of byte-identical synthetic snapshot content hash to the same `restore_run` lookup key;
   two uploads of near-identical-but-different content (e.g. one extra record) hash differently and
   start independent runs.
7. All of the above use synthetic fixtures inside a rolled-back transaction or a genuinely separate
   test/staging project, per §A2.2c item 6's own testing-infrastructure rule — never production data.

## 8. What this document deliberately does not do

It does not add or alter any migration file, does not touch `src/main.tsx` or `src/persistence.ts`,
and does not add a test file. It does not revisit D9 itself (the skip-vs-strict policy) — it assumes
the already-recorded recommended direction and specifies the mechanics around it. If E prefers strict
(block the whole restore on any unresolved reference, live or stale) instead of warned-skip, §6 and
its test matrix would need to change; nothing here forecloses that answer.
