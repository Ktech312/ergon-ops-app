# Project BOM Atomic Replace — Design Proposal (not implemented)

Status: **Design only. No migration file exists. No SQL has been run against
any database.** This document is the reviewable plan requested alongside the
2026-09-10 write-verification fix for `saveInventoryItems`/`saveProjectSites`
(see `PRODUCT_ERROR_VISIBILITY_AUDIT.md` Addendum 2, A2.1). Do not implement
any part of this without a separate, explicit go-ahead.

**Revision note (2026-09-10, same day)**: this revises the first draft after
E's review found a real correctness gap in the concurrency claim (§4), asked
for a concrete temporary workspace-safety guard instead of an open question
(§5), asked for an explicit statement of what "atomic" does and does not
cover across a multi-project save (§4a, new), and flagged that BOM lines are
identified by item **name**, which is not database-unique — SKU is — so the
item-name-to-`inventory_item_id` resolution step could silently pick the
wrong catalog item (§3 step 3, §5a, new). All four are addressed below.

**Second revision note (2026-09-10, same day)**: E decided §5a's open
question — **option (b)**: an ambiguous item name rejects the entire BOM
replacement call rather than degrading one line to a null catalog link.
§3, §5a, and §6 are updated below to reflect that as the decided design,
not an open option. Nothing in this document has been implemented; it is
still a design-only document.

## 1. The risk this is meant to close

`saveProjectSites` (`src/persistence.ts`, "BOM lines have no natural per-line
key to reconcile against..." comment) replaces a project's entire BOM line
set on every save by:

1. Resolving item names to `inventory_item_id` (a read-only lookup).
2. `DELETE FROM project_bom_lines WHERE project_id IN (...)` for every
   project being saved.
3. `INSERT INTO project_bom_lines (...)` with the current line set.

Steps 2 and 3 are two separate, unchecked PostgREST requests with **no
transaction between them**. The 2026-09-10 fix added row-count verification
everywhere else in these two functions, but deliberately did **not** touch
this sequence — a row-count check on step 3 alone can prove the INSERT
failed, but it cannot undo the DELETE that already ran in step 2. Adding a
check without fixing the underlying sequence would let this pass be
described as "fixed" when the actual failure mode (a project's BOM ends up
empty) is unchanged. That's the gap this document proposes to close.

**Failure scenario this enables today**: any transient failure (network
blip, RLS misconfiguration, a bad `inventory_item_id` lookup, exceeding a
request size limit) between step 2 and step 3 leaves every project in that
save batch with **zero BOM lines** — not "unsaved changes," but the
project's real, previously-saved BOM lines actually deleted with nothing to
replace them. This is a data-loss bug, not just a visibility gap, which is
why it needs a structural fix (atomicity) rather than a verification
patch.

## 2. Precedent this should follow

Migrations 127/128 (`create_project_from_quote`, `backend/supabase/migrations/127_atomic_project_conversion.sql`)
already solved the same class of problem — a multi-step write across
several tables that used to be a sequence of unchecked client-side
PostgREST calls — by moving it into one `security definer` Postgres
function, executed inside the single implicit transaction every RPC call
already runs in. This proposal reuses that exact pattern rather than
inventing a new one:

- One `security definer` function, `set search_path = ''`, every table
  reference schema-qualified.
- Caller's workspace resolved via the existing, already-hardened
  `resolve_caller_workspace_id()` (migration 117) — not a new resolution
  mechanism.
- Role/authorization check mirroring `create_project_from_quote`'s own
  PM-or-admin gate (same roles that can write `project_bom_lines` today
  per migration 023's RLS policy — this proposal does not widen or narrow
  who may edit a BOM, only how the edit is applied).
- Stable `EC0xx`-style error codes for anything the frontend needs to
  distinguish from a generic network failure, continuing the numbering
  migration 127 established (next available: confirm the current highest
  `EC0xx` code in use before implementation — do not assume any specific
  number is free without checking).
- A test script named and shaped like `migration_127_conversion_tests.sql`
  (see §6), reviewed by E before anything is run, exactly like 127/128's
  process.

## 3. Proposed function shape

```
-- ILLUSTRATIVE OUTLINE ONLY -- not runnable SQL, not a migration file.
-- Exact column list, constraint names, and error codes must be verified
-- against the live schema before this becomes a real migration.

create or replace function public.replace_project_bom_lines(
  p_project_id uuid,
  p_lines jsonb  -- array of { item_sku or item_name (see §5a), qty,
                 --             status, request_speed, po, notes,
                 --             procurement_track, ship_to,
                 --             purchasing_sent_at }, in display order
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_workspace_id uuid;
  v_project record;
  v_inserted_count int := 0;
  v_ambiguous_names text[];
begin
  -- 1. Fail closed on the temporary single-workspace assumption (see §5):
  --    perform public.active_workspace_id(); -- raises if there is not
  --    exactly one active workspace row in the whole database. This is a
  --    deliberate, separate guard from the caller-authorization step
  --    below -- it protects against this function ever silently running
  --    against ambiguous multi-workspace state before Phase 3 exists,
  --    even if every other check would otherwise pass.

  -- 2. Resolve + authorize (mirrors create_project_from_quote):
  --    - resolve_caller_workspace_id(), catch P0001 -> EC007 (reuse the
  --      existing code migration 127 already established for this exact
  --      failure shape, not a new one).
  --    - PM-or-admin check, same shape as migration 127's gate.

  -- 3. Load + lock the project row (see §4 -- this lock is what actually
  --    makes the delete+insert below safe under concurrent calls, not
  --    just the transaction boundary by itself):
  --    - select * into v_project from public.projects
  --      where id = p_project_id and deleted_at is null
  --      for update;
  --    - not found -> a clear "project not found or deleted" error
  --      (new EC code).
  --    - Every current project is treated as belonging to the sole
  --      active workspace confirmed by step 1 -- see §5, this is a
  --      temporary substitute for a real per-project workspace check,
  --      not a permanent design choice.

  -- 4. Resolve item identifiers to inventory_item_id in bulk -- see §5a.
  --    DECIDED (option b): if any item name in p_lines matches more than
  --    one inventory_items row, this step must NOT proceed to the
  --    delete/insert in step 5 at all. Collect every ambiguous name into
  --    v_ambiguous_names, raise a controlled exception listing them (new
  --    EC code, e.g. "This BOM could not be saved because N item name(s)
  --    match more than one catalog item: ..."), and stop -- the existing
  --    BOM lines (step 5 never runs) are left completely unchanged. Log
  --    the ambiguous names and their matching inventory_items ids via
  --    RAISE WARNING or an equivalent server-side log before raising, so
  --    the ambiguity is diagnosable without exposing catalog internals to
  --    the end user. Never null out inventory_item_id for an ambiguous
  --    line and continue -- that was option (a), not chosen.

  -- 5. delete from public.project_bom_lines where project_id = p_project_id;
  --    insert into public.project_bom_lines (...) select ... from
  --    jsonb_to_recordset(p_lines) as t(...);
  --    get diagnostics v_inserted_count = row_count;
  --    Only reached if step 4 found zero ambiguous names. Both statements
  --    run in this function's implicit transaction, AND the project row
  --    is already locked (step 3) for the duration of this transaction --
  --    see §4 for why the lock, not just the transaction boundary, is
  --    what prevents a concurrent call's DELETE from missing this call's
  --    INSERT.

  -- 6. return jsonb_build_object(
  --      'project_id', p_project_id,
  --      'line_count', v_inserted_count
  --    );
end;
$$;

revoke all on function public.replace_project_bom_lines(uuid, jsonb) from public;
revoke execute on function public.replace_project_bom_lines(uuid, jsonb) from anon;
grant execute on function public.replace_project_bom_lines(uuid, jsonb) to authenticated;
```

## 4. Rollback, retry, and concurrency behavior

- **Rollback**: automatic and complete. Because delete + insert run inside
  one `plpgsql` function body with no explicit sub-transaction handling,
  Postgres treats the whole function body as part of the single implicit
  transaction PostgREST already wraps every RPC call in — any exception
  (a bad item lookup, a constraint violation on insert, an authorization
  failure) rolls back every statement in the function, including the
  delete. There is no partial-BOM state reachable from a **single** call,
  by construction.
- **Retry**: safe and idempotent in the sense that matters here — calling
  this function twice with the same `p_lines` payload produces the same
  end state (the project's BOM exactly matches the payload) both times.
  Unlike migration 127's conversion RPC, this is not a "create once, then
  return the same result forever" idempotency — it's a "this call fully
  defines the set" replace, so calling it again with a *different*
  payload is expected to produce a *different* result. That's the correct
  behavior for a BOM edit (the client always sends the full current line
  set, not a diff) and should not be treated as a bug during
  implementation.
- **Concurrent calls for the same project — corrected, this was wrong in
  the first draft.** The first draft of this document claimed two
  overlapping transactions "serialize... the loser applies second and its
  payload wins." **That is not guaranteed by a transaction boundary
  alone.** Under Postgres's default `read committed` isolation, two
  concurrent transactions can each take an MVCC snapshot before the other
  commits: transaction A's `DELETE` can run and commit, then transaction
  B's own `DELETE` (already planned against a snapshot that didn't include
  rows A already removed, or vice versa) and `INSERT` can proceed against
  rows that no longer reflect what actually happened -- the specific bad
  outcome is that B's `DELETE` does not see rows A's `INSERT` already
  added (if A's insert lands between B's delete and B's insert), leaving
  **both** replacement sets present instead of only the later one — i.e.
  duplicate/leftover BOM lines, not a clean "last write wins." Relying on
  the transaction boundary by itself, with no explicit lock, does not
  prevent this.
  - **Required fix**: the function must take `select ... for update` on
    the parent `projects` row (step 3 in §3) before deleting or inserting
    any BOM lines. `for update` forces a second concurrent call for the
    same `project_id` to block until the first call's transaction
    commits or rolls back, so the two delete+insert sequences genuinely
    serialize instead of merely overlapping in time. This is the same
    category of fix as the existing "key-reuse table pattern" already
    documented in `HANDOFF.md` (an atomic reclaim function, not a bare
    client-side insert) — locking the parent row is this feature's
    equivalent of that pattern.
  - Two calls for **different** `project_id`s never contend — the lock is
    per-project-row, not a table-wide lock.

## 4a. What "atomic" covers — per project, not per save batch

This function makes **one project's** BOM replacement atomic: for that one
`project_id`, either its full new line set is written or none of it is,
even under a concurrent call for the same project (§4). It does **not**
make an entire `saveProjectSites` call atomic when that call saves
multiple projects at once. If the frontend calls this RPC once per project
in a loop (matching how `saveProjectSites` iterates `sites` today), a
failure on the third of five projects still leaves the first two projects'
BOM replacements committed — each individual call is all-or-nothing, but
the batch as a whole is not. **This document does not propose or claim
whole-batch atomicity.** If E wants the entire multi-project save to be
all-or-nothing, that is a materially different, larger design (one
transaction spanning every project in the batch, or a saga/compensation
pattern) and would need its own separate proposal — not something to
assume is included here just because the per-project piece is atomic.

## 5. Workspace safety — temporary guard, not deferred

The first draft of this document left workspace enforcement as an open
question with no concrete interim behavior. That was insufficient — this
function must have a real guard from the moment it exists, not a gap left
until Phase 3. Revised recommendation, in place of the three open options
previously listed:

- **Call `public.active_workspace_id()` (migration 124) as the function's
  first action.** This existing helper already raises an exception unless
  there is exactly one workspace row in the entire database and that
  workspace is `active` — the same fail-closed bridge pattern already
  used elsewhere for exactly this "we have not built real per-entity
  workspace scoping yet" situation (see migration 124's own section 2
  comment). If a second workspace is ever created — even merely
  suspended, not yet active — this function stops working immediately and
  loudly, rather than silently operating against ambiguous data.
- **Still perform the same caller-authorization check as migration 127**:
  `resolve_caller_workspace_id()` (catch `P0001` → `EC007`, reusing the
  established code) plus the PM-or-admin role check. `active_workspace_id()`
  is an additional, independent guard on the *data's* state — it does not
  replace verifying who the caller is and what role they hold.
- **While that guard holds, every existing project is treated as
  belonging to the sole active workspace** — there is no per-project
  workspace check to perform yet (`projects.workspace_id` does not exist,
  see below), and none is needed while `active_workspace_id()` guarantees
  there is only one workspace for any project to belong to.
- **This is explicitly temporary.** Before a second workspace is ever
  allowed to exist (i.e. before Phase 3 or any workspace onboarding work
  begins), `replace_project_bom_lines` must be revised to check a real
  `projects.workspace_id` column against the caller's resolved workspace,
  the same way `create_project_from_quote` checks `sales_quotes.workspace_id`
  today. Shipping this function now, gated by `active_workspace_id()`,
  does not remove that future requirement — it defers it safely rather
  than leaving no guard at all in the meantime.

## 5a. Item-name ambiguity — SKU is the real unique key, name is not

Flagged during review: `BomLine` (the client-side type) identifies a line
by `item` (a product **name** string) with no stable `inventory_item_id`
or SKU carried on the line at all — `HANDOFF.md`'s own data-model notes
already document this ("BOM lines have no stable id in the app layer --
they're identified by item (product name) everywhere"). `inventory_items`
has no uniqueness constraint on `item_name` — only `sku` is guaranteed
unique. Today's client-side code (`saveProjectSites`, unchanged by this
proposal or the 2026-09-10 fix) already has this exact risk: its bulk
`item_name=in.(...)` lookup builds an `id` map keyed by name, so if two
catalog items happen to share a name, whichever row PostgREST returns last
for that name silently wins the map entry — an arbitrary, unannounced
choice, not a deliberate one.

This proposal **must not carry that same silent-arbitrary-pick behavior
into the new RPC** just because it matches today's behavior — the
whole point of doing this work as a reviewed migration is to not
reproduce a known-bad pattern by default.

**DECIDED (2026-09-10, E's call): option (b).** If any item name in
`p_lines` matches more than one `inventory_items` row, the RPC rejects
the **entire** BOM replacement call with a controlled, user-safe error
naming the ambiguous item(s) at a level of detail safe to show a human
who can fix the catalog (not raw constraint/SQL text) — and the
project's existing BOM lines are left completely unchanged (the
delete/insert in §3 step 5 never runs; the ambiguity check in step 4
happens first). The ambiguous names and their matching
`inventory_items` ids are logged server-side (`RAISE WARNING` or
equivalent) for diagnosis. **Option (a) — nulling the catalog link for
just the affected line and continuing — is explicitly not chosen.**
Rationale: a BOM line silently missing its catalog link is a quieter,
easier-to-miss failure than a whole save being rejected; rejecting the
whole call forces the ambiguity to be resolved in the catalog before
any BOM state changes, matching this feature's overall bias toward
"stop and surface it" over "degrade and continue" established
throughout this fix and the migration 127 precedent it follows
(`EC005`/`EC006` reject outright rather than guessing at intent).

A bare `SELECT ... LIMIT 1` or an unguarded join that can silently
return more than one match for a name remains **not** an acceptable
implementation of the resolution step, regardless of which option was
chosen.

**Longer-term, preferred product solution — not implemented by this
document, and not a substitute for the (b) guard above**: give
`BomLine` a real stable identifier (`itemSku` or `inventoryItemId`)
that the client already has (from the loaded `Part`/`inventory_items`
it built the line from) and carry it through `p_lines` instead of
re-resolving from a name string at all. This removes the ambiguity at
its root — a save could never be ambiguous if it never needed to guess
an id from a name in the first place — but it is frontend/type scope
beyond "make the BOM replace atomic," and does not remove the need for
the RPC's own defensive check (a stable id could still theoretically be
stale or wrong; the (b) rejection behavior should stay in place
regardless of whether this longer-term change ever happens).

## 6. Verification cases (for a future test script, same shape as `migration_127_conversion_tests.sql`)

To be written and reviewed before any migration is drafted, not sketched
further here beyond the list of what it must cover:

1. A PM/admin calling with a project they have access to, a normal line
   list -> old lines gone, new lines present, correct `line_count`
   returned.
2. Calling twice in a row with the same payload -> same end state both
   times, no duplicate rows.
3. Calling with an empty `p_lines` array -> project ends up with zero BOM
   lines (a deliberate "clear the BOM" case, not an error).
4. A forced failure partway through (e.g. a temporary constraint
   violation injected only for the test) -> confirm the project's
   **original** BOM lines are still present afterward (the actual proof
   of atomicity — this is the test that could not be written against
   today's client-side sequence, since there is no way to force a
   mid-sequence failure and prove rollback without a transaction to roll
   back).
5. **Concurrency test, using two real concurrent sessions/connections
   (not two sequential calls in one test)** — one session begins a call
   for a project and is paused mid-transaction (e.g. via a deliberate
   delay or an advisory breakpoint the test controls), a second session
   calls the same `project_id` concurrently; confirm the second call
   blocks until the first commits (proving the `for update` lock is
   actually taken, not just present in the source), and confirm the
   final BOM reflects exactly one call's line set with no duplicate or
   leftover rows from the other. A test that only calls the function
   twice in sequence does **not** prove this — it must exercise genuine
   overlap.
6. A non-PM/non-admin caller -> rejected, existing BOM lines unchanged.
7. A caller with no resolvable workspace/session -> rejected with the
   EC007 pattern, not a generic error.
8. **A second workspace row exists (even suspended)** -> the function
   fails closed via `active_workspace_id()`'s own exception, before any
   authorization or BOM logic runs; existing BOM lines unchanged.
9. An item name in `p_lines` matching exactly one `inventory_items` row
   -> resolves normally, matching today's behavior for the unambiguous
   case.
10. An item name in `p_lines` matching **two or more** `inventory_items`
    rows -> the entire call is rejected with a controlled error listing
    the ambiguous name(s) (§5a, decided option (b)); confirm the
    project's BOM lines are completely unchanged afterward (not
    partially replaced, not one line silently nulled) — this is the
    real proof that rejection happens before the delete/insert, not
    after a partial write.
10a. A batch with one ambiguous name and several unambiguous ones in the
    same call -> the whole call still rejects (no partial success), not
    just the ambiguous line.
11. `information_schema.role_routine_grants` check confirming `anon` has
    no execute grant on this function, matching migration 127/128's own
    verification pattern.

## 7. What this document is not

This is not a migration, not a frontend change, and not an implementation
plan with a start date. It exists so the atomicity fix has a reviewed shape
before any SQL is written, per the instruction that created it. The
immediate 2026-09-10 fix (row-count verification on the item/balance and
project/scope-of-work writes) already shipped without touching this BOM
sequence at all — **BOM atomicity remains entirely open/unimplemented as
of that fix.** §5a's ambiguous-name behavior is now decided (option (b)),
but implementation should still not begin until the exact `EC0xx` codes
are confirmed against the live schema and E has given a separate,
explicit go-ahead to implement — a design being fully specified is not
itself that go-ahead.
