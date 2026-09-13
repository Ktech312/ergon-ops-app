# Client Ledger Save Recovery — Design Specification (Queue B1, NOT IMPLEMENTED)

Status: **DESIGN COMPLETE; CLEARED FOR TECHNICAL IMPLEMENTATION IN QUEUE A10. No production code in
this document.** Written for `CONTINUOUS_CODER_HANDOFF.md` Queue B item B1. The earlier framing called
the choice a business decision, but the completed comparison shows it is a reliability mechanism:
the serialized latest-snapshot queue preserves the existing Client Ledger workflow while preventing
an older failed request from overwriting a newer edit. Implement Option B under Queue A10.

## 1. The current caller, traced

`handleUpdateProjectLedgerInfo` (`src/main.tsx:1555`) is called directly from three onChange
handlers in the Client Ledger detail panel (`src/main.tsx:14329`, `:14345`, `:14355` — ledger
bucket select, kickoff date, warranty expiration date) plus one button handler (`:14074`, moving a
project into the Primary List). Each call:

1. Optimistically updates local state via `setProjectLedgerInfo`, using the functional-updater form
   (`(current) => ...`), so React resolves it against the latest state, not a stale closure — this
   part is already safe against rapid successive edits.
2. `await`s `updateProjectLedgerInfo(projectId, updates, accessToken)` (`src/persistence.ts:7746`),
   which sends one PATCH to `projects?id=eq.<projectId>` containing only the changed field(s).

There is no debounce and no save queue here at all — unlike the whole-array patterns for Project
Sites (`createProjectSiteSaveQueue`, `src/persistence.ts:7650`) and Equipment Recipes
(`createDeviceRecipeSaveQueue`, `src/persistence.ts:5960`), each Client Ledger field edit fires its
own independent PATCH the moment the input commits (a `<select>` change or a `type="date"` commit,
not a keystroke). Two edits to the *same* project fired close together (e.g. kickoff date, then
warranty date, before the first PATCH resolves) become two independent, unserialized in-flight
requests against the same row. Since each carries only its own field, they cannot directly clobber
each other's column — but a failure of the first has no defined recovery today: `updateProjectLedgerInfo`
only `console.error`s on a non-`ok` response (see the 2026-09-12 review comment at
`src/persistence.ts:7762`); the optimistic local value is left standing, un-reverted, un-retried, and
un-flagged to the user beyond the console.

## 2. The 2026-09-11 reverted attempt, and exactly why it was unsafe

The attempt that was tried and reverted added a caller-side "revert the optimistic update back to its
pre-edit value" step when the PATCH failed. Concretely, for a single field (e.g. `ledgerBucket`):

1. User sets bucket `null → "active"` (edit A). Local state shows `"active"` immediately.
2. The PATCH for A is slow or fails transiently.
3. Before A resolves, the user changes their mind and sets bucket `"active" → "archived"` (edit B).
   Local state shows `"archived"` immediately. B's own PATCH is sent and **succeeds**.
4. A's PATCH now resolves as a failure. The revert-on-failure logic reverts local state to A's
   *pre-edit* value (`null`) — stomping B's already-confirmed, already-persisted `"archived"` value.
   The UI now shows `null` even though the database and the user's actual last intent both say
   `"archived"`.

The bug is that "revert to the value before my own edit" is only safe if no other edit has landed in
between — and a caller with no serialization has no way to know that. This is the same class of bug
already solved elsewhere in this codebase by never doing a blind revert at all: `reconcileSavedDeviceRecipes`
and `reconcileSavedProjectSites` instead merge the *server's actual returned state* back into
whatever local state exists at reconciliation time, and `createDeviceRecipeSaveQueue`/
`createProjectSiteSaveQueue` prevent two saves for the same array from ever being in flight
simultaneously in the first place. Client Ledger has neither protection today.

## 3. State machine

Scoped **per `projectId`** (each project's ledger row is independent; concurrent edits to two
different projects should never block each other). Per project:

- **Idle** — no save in flight, no pending edit queued.
- **Saving(snapshot S)** — a PATCH for merged-field snapshot `S` is in flight.
- **Newer edit arrives while Saving** — the new field value(s) are merged into a `pending` snapshot
  (replacing any previously-pending snapshot, not appended to a list — only the latest value per
  field ever matters). State remains `Saving(S)`; nothing new is sent yet.
- **Saving(S) → Success** — server confirms. Local state is reconciled against the *actual returned
  row* (not blindly kept as-is), matching the existing reconcile pattern. If a `pending` snapshot
  exists, transition immediately to `Saving(pending)` using a payload merged on top of the just-
  confirmed server state (never the original pre-A snapshot).
- **Saving(S) → Failure** — server rejects or the request throws. **No revert.** Local optimistic
  state is left exactly as the user last set it; the failure is surfaced once (banner + logged
  detail), matching the existing `setSyncStatus("error")` / `setAuthStatus(...)` convention used for
  Inventory Movements and Equipment Recipe saves. If a `pending` snapshot exists, transition to
  `Saving(pending)` regardless of A's outcome — a later edit always gets its own attempt; it is never
  blocked by an earlier failure.
- **Retry** — not automatic. The next user-initiated edit to the same project (of any ledger field)
  naturally becomes the next `Saving` attempt and carries the failed field's last value forward,
  since `pending` is always the full latest per-field snapshot, not a diff against what last
  succeeded. A user who wants to explicitly retry an unchanged value can re-select the same option;
  no dedicated "Retry" button is required for correctness, only recommended for UX polish (out of
  scope for D1 itself).

## 4. Two designs compared

**Option A — per-field revert-on-failure (the 2026-09-11 attempt).** Rejected already; kept here
only for the comparison D1 asks for. Requires tracking a "pre-edit value" per field per in-flight
request and only reverting if no newer edit has since landed — which in turn requires exactly the
kind of in-flight bookkeeping Option B needs anyway, but adds a second failure mode on top of it (the
revert itself must be version-guarded, or the original bug reappears). Strictly more complex than
Option B for no additional safety.

**Option B — serialized, latest-snapshot save queue** (recommended; matches D1's recorded direction).
One `saving` flag and one `pending` snapshot per `projectId`, following exactly the shape of
`createDeviceRecipeSaveQueue`/`createProjectSiteSaveQueue` already in `src/persistence.ts`, adapted
from "one save per whole array" to "one save per project row, coalescing partial field updates into
a merged payload." A new `createClientLedgerSaveQueue` would:

- Accept `(applyReconciled, onError)` the same way the two existing queues do.
- `enqueue(projectId, updates, accessToken)`: if that `projectId` is not currently saving, PATCH
  immediately; if it is, merge `updates` into that project's `pending` object (last-value-wins per
  field) and return.
- On settle (success or failure), check for a `pending` entry for that `projectId`; if present, clear
  it and immediately start the next save with the merged snapshot.
- Never revert local state on failure. Only reconcile against the server's real response on success.

This is a small, additive change scoped entirely to `src/persistence.ts` (new function) and
`src/main.tsx` (swap the direct `await updateProjectLedgerInfo(...)` call in
`handleUpdateProjectLedgerInfo` for `clientLedgerSaveQueueRef.current?.enqueue(...)`, dropping the
function back to synchronous/fire-and-forget the same way the site/recipe callers already are) — no
schema change, no new table, no migration.

## 5. Tests that would prove no older failed request can overwrite a newer edit

To be added alongside the Queue A10 implementation (none existed when this design was written):

1. Two sequential edits to the *same* field on the *same* project, first PATCH fails, second
   succeeds → final state reflects the second edit's value, not a revert to the pre-first-edit value.
2. Two sequential edits to *different* fields on the *same* project, first PATCH fails, second
   succeeds → both the first edit's (now-failed, unretried) local value and the second edit's
   confirmed value survive; neither is silently dropped.
3. A failed save followed by no further edits → local optimistic value is preserved as-is (not reset
   to blank/null), and the failure is surfaced exactly once (banner + `console.error`), matching the
   existing pattern's assertions for Inventory Movements/Equipment Recipe failures.
4. Rapid edits to *two different projects* → each project's queue runs independently; a slow save for
   project A never delays or blocks project B's save.
5. A third edit arriving while a second edit is already `pending` (not yet in flight) → the second
   and third merge into one `pending` snapshot; only one follow-up PATCH is sent, carrying the
   latest value of every touched field (mirrors the existing recipe-queue coalescing test shape in
   `device-recipe-save-queue.test.ts`).
6. Reconciliation after success applies the server's actual returned row, not merely "leave local
   state alone" — so a value normalized or defaulted server-side (e.g. a null-coalesced date) is
   reflected locally, the same guarantee `reconcileSavedProjectSites`/`reconcileSavedDeviceRecipes`
   already provide for their own arrays.

## 6. What this document deliberately does not do

It does not itself implement `createClientLedgerSaveQueue`, change
`handleUpdateProjectLedgerInfo`/`updateProjectLedgerInfo`, or add a test file. That work now belongs to
Queue A10. The rejected revert model remains here as historical reasoning so it is not accidentally
reintroduced.
