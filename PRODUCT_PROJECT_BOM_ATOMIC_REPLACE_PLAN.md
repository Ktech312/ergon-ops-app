# Project BOM Atomic Replace — Design Proposal (migration drafted, NOT applied)

Status: **UPDATED 2026-09-12 (overnight reliability closeout): migration
131 (`replace_project_bom_lines`), its verification test script
(`backend/supabase/migration_131_bom_replace_tests.sql`), and the frontend
wiring (`BomLine.id`/`sku`, `saveProjectSites` calling the RPC) are all
DRAFTED and kept LOCAL — none of it is committed, none of it is applied to
any database, and the frontend wiring is not deployed (it depends on the
unapplied RPC). See `HANDOFF.md`'s 2026-09-12 entry for the exact file
list and local-check results, and this document's own end for the
deviations found and corrected against the live schema while drafting.
This design itself (reconcile-by-id, one project per call, ambiguous-name
rejection, `FOR UPDATE` locking, PM/workspace-admin authorization) is
otherwise unchanged from the fully-reviewed plan below — nothing in the
decided design was revised, only implemented.**

Prior status (accurate through 2026-09-11, superseded by the above):
**Design only. No migration file exists. No SQL has been run against
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

**Third revision note (2026-09-11, overnight local-only pass)**: schema
validated against every migration that touches `project_bom_lines` (new
§2a) — one real, currently-dormant risk found (an FK from
`task_hardware_dependencies` that a delete+insert-with-new-ids design
would silently orphan, confirmed to affect zero live data today) and
`EC008` confirmed as the next free error code. The concurrency test in §6
item 5 now has a concrete two-connection methodology, not just a
requirement statement. The following are treated as settled and were not
reopened or re-litigated this pass: `active_workspace_id()` as the
temporary single-workspace fail-closed guard (§5); the existing BOM
remaining unchanged after a rejection (§3, §5a); each project's
replacement being atomic on its own while a multi-project batch may still
partially complete across projects (§4a).

**Fourth revision note (2026-09-11, same day, review): the delete-then-
reinsert design itself is superseded, not just flagged as risky.** §2a's
FK finding was correctly identified but under-weighted — treating it as
merely "a future dormant concern" understated what's actually required.
Review determined the RPC design must decide how to preserve existing BOM
line identity **before** implementation, not defer that decision. §3 and
§5a are substantially rewritten below to a **reconcile-by-id** design:
retained lines are updated in place (same `id`, so any FK pointing at one
survives), genuinely new lines are inserted, and only the specific ids the
user actually removed are deleted — replacing the old "delete every line
for this project, reinsert the current set" shape entirely. This also
promotes the stable `inventoryItemId`/SKU requirement from "preferred
later solution" to a precondition of this design: `p_lines` now carries a
stable item identifier per line as the primary mechanism, with the
name-based ambiguity check (§5a, option (b) rejection behavior) kept only
as a fallback for a line that arrives without one. Still design only — no
migration created, no RPC implemented.

**Fifth revision note (2026-09-11, same day, second review): the
reconcile-by-id direction was confirmed correct, but the first version of
it had real contradictions and missing safeguards.** Fixed below: (1) a
non-null line `id` that doesn't belong to the target project is now
always a rejection, never silently treated as "insert a new line" — the
prior wording actually said the opposite in one place (§3); (2) duplicate
non-null line ids within one payload are now an explicit rejection case
(§3 step 4b, §6 item 12); (3) malformed ids and malformed line objects
are now validated *before* any resolution or reconciliation logic runs
(§3 step 4a, §6 item 13); (4) the return value now includes the full
saved line collection (real ids included), not just counts — the
retry/idempotency discussion (§4) already assumed the caller receives
generated ids, but nothing in the original return shape actually provided
them; (5) §2a's phrasing that could be read as "nothing references BOM
line ids today" is corrected — the `task_hardware_dependencies
.project_bom_line_id` foreign key is a real, present-tense schema
reference regardless of whether any row currently populates it; (6)
client-supplied `inventory_item_id`/`sku` is now explicitly treated as
untrusted input requiring verification (existence, exactly-one-match for
`sku`, and mutual consistency when both are supplied), not assumed
correct because it has the right shape (§3 step 5, §5a). New verification
cases added for all of the above (§6 items 12-15). Still design only — no
migration created, no RPC implemented.

**Sixth revision note (2026-09-11, overnight autonomous pass, task 4 —
fresh adversarial review against the implementation-readiness checklist,
correcting two real gaps this pass found; no migration/frontend change
made).** Every item on the checklist this pass was asked to verify
(retained-lines-by-id, null/absent-id-only-inserts,
nonexistent/cross-project-id-rejection, duplicate-id-rejection,
malformed-payload-rejection, inventory-id/SKU existence+consistency,
name-fallback ambiguity, `task_hardware_dependencies` FK survival,
deletion-of-only-removed-lines, authoritative-returned-rows, per-project
locking, same-payload-retry, empty-BOM behavior, single-workspace guard,
future `projects.workspace_id` requirement, per-project-vs-multi-project
atomicity, direct EXECUTE grants, and transaction-safe real-concurrent
verification) was re-checked against current source, not assumed correct
from the prior five rounds. Sixteen of those were already correctly
covered and needed no change. Two real gaps were found by cross-checking
§3's proposed `p_lines` field list and validation steps against the
**actual current client code** (`saveProjectSites`, `src/persistence.ts`),
not just against the schema:

1. **`line_sort` was missing from `p_lines` entirely.** Today's live code
   (`persistence.ts`, `site.bom.map((line, index) => ({ ...,  line_sort:
   index, ... }))`) writes every line's array position as `line_sort` on
   every save. §3's proposed field list (the `p_lines` comment) named
   every other real column from §2a's own schema trace **except this
   one** — an oversight, not a deliberate exclusion (nothing in this
   document ever argued `line_sort` should stop being tracked, and the
   return value in step 8 already reads `pbl.line_sort` back and orders
   by it, which only makes sense if something is expected to write it).
   Without this fix, the reconcile-by-id design could preserve every
   line's real `id` (§3's whole point) while silently losing the user's
   chosen display order on every save — a real, user-visible regression
   this document would otherwise have shipped by omission. Fixed in §3
   below: `line_sort` is now an explicit field on every `p_lines` element,
   assigned by the client from array position exactly as today's code
   already does, and both the update and insert branches in step 7 now
   name it explicitly instead of leaving it inside an elided "...".
2. **Enum-valued fields were validated for type, not for value, in step
   4a.** `status`, `request_speed`, and `procurement_track` are all
   `check (... in (...))`-constrained columns at the database level
   (§2a). Step 4a's "malformed line objects" check, as originally
   written, only caught a field of the *wrong type* (e.g. a number where
   text was expected) via `jsonb_to_recordset`'s own cast failure — a
   syntactically-valid-but-not-in-the-allowed-set string (e.g.
   `status: "bogus"`) would pass step 4a untouched and only be caught
   later, by the table's own `CHECK` constraint, **during the actual
   write in step 7** — after the update/insert/delete reconciliation has
   already begun executing (the whole call still rolls back per §4's
   transaction guarantee, so this is not a data-integrity bug, but it
   directly contradicts this document's own stated goal for step 4a:
   catching every structural problem *before* any write is attempted,
   and translating every rejection into a controlled `EC0xx` code rather
   than letting a raw Postgres constraint-violation message reach the
   client). Fixed in §3 step 4a below: the three enum-valued fields are
   now explicitly checked against their known allowed-value sets as part
   of structural validation, before step 5 or step 7 ever runs.

New verification cases added for both (§6 items 16-17). Neither fix
changes this document's overall design, scope, or any prior decision —
both are corrections to an oversight in the existing reconcile-by-id
outline, not new functionality. Still design only — no migration created,
no RPC implemented, no frontend change made.

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
  migration 127 established. **Superseded 2026-09-11 (later same day):**
  `EC008` is **no longer** the next free code — migration 130
  (`save_equipment_recipe`, the equipment-recipe atomic-save RPC) was
  drafted and claims `EC008`-`EC016`. **`EC017` is the next free code for
  this plan's RPC, once it is actually drafted** — re-verify this again at
  that time (`grep -rhoE "errcode = '[A-Z0-9]+'" backend/supabase/migrations/*.sql`)
  in case anything else has shipped by then; this is a re-confirmation
  requirement, not a settled fact to copy forward blindly. (Historical
  note, kept for the record: as of the original 2026-09-11 validation pass,
  before migration 130 existed, `EC001`-`EC007` were the only codes in use,
  all in `127_atomic_project_conversion.sql`, and `EC008` was genuinely the
  next free code at that time — the claim was correct when written, and is
  superseded by migration 130 now existing, not by having been wrong.)
- A test script named and shaped like `migration_127_conversion_tests.sql`
  (see §6), reviewed by E before anything is run, exactly like 127/128's
  process.

## 2a. Schema validation against the live migrations (2026-09-11, read-only trace — no code changed, no migration created)

Every `project_bom_lines`-touching migration was read directly (`022`,
`023`, `026`, `028`, `029`, `032`, `047`, `072`, `079`, `127`, `128` — a
full repo-wide grep for the table name, not a partial check) to confirm
the proposed design in §3 is compatible with the table's real current
shape, not an assumed one.

**Full current column set** (`022` base + later additions): `id uuid
primary key default gen_random_uuid()`, `project_id uuid not null
references projects(id) on delete cascade`, `item_name text not null`,
`inventory_item_id uuid references inventory_items(id)`, `qty numeric(12,2)
not null default 0`, `status text ... check (status in (...))`,
`request_speed text ... check (request_speed in (...))`, `po text`, `notes
text`, `line_sort integer not null default 0`, `created_at`/`updated_at
timestamptz`, plus `procurement_track text ... check (...)` and
`purchasing_sent_at timestamptz` (migration `047`), and `ship_to text`
(migration `079`). **§3's proposed `p_lines` field list already matches
every one of these** — no column was missed, and no column exists that the
proposal doesn't account for.

**Trigger**: `project_bom_lines_set_updated_at` (`before update`, migration
`022`) only fires on `UPDATE`, not `INSERT` — irrelevant to a delete+insert
design, since a fresh `INSERT` gets `updated_at`'s own column default
(`now()`) regardless. No conflict.

**RLS** (migration `023`, still the live policy — no later migration
narrows or widens it): `using (is_app_admin(auth.uid()) or has_role('pm'))`
for `all` (select/insert/update/delete) to `authenticated`. This is
**bypassed entirely** once the RPC exists, since a `security definer`
function runs as its owner regardless of the calling user's own RLS
standing — the RPC's own internal role check (§3, mirroring migration
127's pattern) is what actually gates this action once implemented, not
this table policy. Worth noting precisely: migration 127 checks the
*newer* workspace-scoped `workspace_member_roles` join, not this table's
own (older) direct `has_role('pm')` call — both should agree for any real
user today (the migration-124 bridge keeps them in sync), but the RPC
should follow the **127 precedent** (workspace-scoped check), not
re-implement a call to the older `has_role()` directly, for the same
reason migration 124/125's own review avoided calling unhardened legacy
helpers from a new security-definer function.

**Grants**: no migration issues an explicit `grant`/`revoke` on
`project_bom_lines` at all — it relies on Supabase's default table grants
plus RLS (enabled since migration `022`) as the actual gate. Since the
`023` policy only names `authenticated` (not `anon`), and RLS is
default-deny for any role with no matching policy, `anon` already has zero
access regardless of default grants. No gap found here.

**⚠️ Real finding: a genuine foreign key from a different table already
points at `project_bom_lines.id`. ADDRESSED BY DESIGN as of the
2026-09-11 §3/§5a revision, not merely noted as dormant.** Migration `029`
(`task_hardware_dependencies`) declares `project_bom_line_id uuid
references project_bom_lines(id) on delete set null`. Today's client-side
delete+insert (unchanged, still live) assigns every re-inserted line a
brand-new `gen_random_uuid()`, which would silently orphan any real
`task_hardware_dependencies` row pointing at an old line (`ON DELETE SET
NULL`) every time that project's BOM is replaced. **Confirmed zero
current real-world impact**: `addTaskHardwareDependency`
(`persistence.ts:4416` on, called from exactly one place, `main.tsx:5250`)
always passes `projectBomLineId: null` — nothing in the live app actually
populates this column with a real value today, so today's client-side
code has nothing to orphan in practice.

An earlier version of this section treated this as "a real, documented,
deferred risk... not a blocker" — under-weighted, since it left the RPC's
own design free to inherit the same orphaning behavior deliberately. That
is no longer the plan: §3 now reconciles by id instead of deleting and
reinserting, specifically so a retained line keeps its real id across a
save — the FK is never touched for a line that isn't actually removed by
the user. This closes the risk for the RPC going forward, once
implemented; it does **not** retroactively fix today's still-live
client-side delete+insert, which remains exactly as described in §1 until
the RPC replaces it.

## 3. Proposed function shape — reconcile-by-id, not delete-then-reinsert

**Superseded 2026-09-11 (same day, review)**: the version of this section
below is no longer "delete every line for this project, reinsert the
current set." That shape was found (§2a) to silently orphan any FK
pointing at a BOM line (`task_hardware_dependencies.project_bom_line_id`)
on every single replace, since a fresh `INSERT` always assigns a new
`gen_random_uuid()`. §2a's original framing — "confirmed zero current
impact, a future concern" — under-weighted this: the design must decide
how to preserve line identity **now**, before implementation, not defer
it. The RPC instead **reconciles** the incoming line set against what
already exists, by id:

- A line in `p_lines` that carries an existing `project_bom_lines.id`
  belonging to **this** project is **updated in place** — same row, same
  id, so any real foreign key referencing that id survives untouched. The
  schema reference this protects, `task_hardware_dependencies
  .project_bom_line_id` (migration 029), is real right now — see §2a; no
  currently-populated row happens to use it, but the constraint exists in
  the schema today, independent of whether any row currently has a
  non-null value in it, and that is the correct way to describe it
  throughout this document.
- **Corrected 2026-09-11 (same day, second review): only a null or
  absent `id` means "insert a new line."** A non-null `id` that does
  **not** belong to the target project (wrong project, or doesn't exist
  at all) must **never** be silently treated as "new" — the first version
  of this section conflated those two cases, which would let a caller
  claim someone else's real row (or a stale/mistyped id) as if it were a
  fresh insert. See §3's validation step (below) for the required
  rejection behavior — the whole call fails before any write, the same
  as every other input-validation failure in this design.
- An existing row under this project whose id does **not** appear
  anywhere in `p_lines` is a **deliberately removed line** — deleted, and
  only that specific id, never a blanket "delete everything first."

This requires `BomLine` (the client-side type, `persistence.ts`) to gain
a stable identifier it does not carry today — `HANDOFF.md`'s own
data-model notes are explicit that BOM lines currently have no stable id
in the app layer at all. Closing that gap is **frontend/type scope this
document does not implement**, but the RPC design assumes it as a
precondition: `loadProjectSites` must start returning each line's real
`project_bom_lines.id` (trivial — the column already exists, it's simply
not currently selected/mapped into `BomLine`), and the client must round-
trip that id back unchanged for a line it isn't deleting.

**Item identity is carried the same way, promoted from "preferred later
solution" (§5a's original framing) to a precondition of this design**:
`p_lines` carries a stable `inventory_item_id` or `sku` per line, resolved
client-side from the same catalog data the UI already has loaded, instead
of the RPC re-resolving an arbitrary name server-side. The name-based
ambiguity check from §5a (option (b): reject the whole call rather than
guess) is kept only as a **fallback** for a line that arrives without a
stable identifier — expected to become rare/nonexistent once the frontend
change above ships, not the primary path.

**Corrected 2026-09-11 (same day, second review): the outline below adds
the validation steps a prior version of this document omitted or got
backwards.** Specifically: a non-null `id` not belonging to the target
project is now a rejection, never a silent "treat as new"; duplicate
non-null ids within one payload are rejected; malformed ids/line objects
are rejected before any resolution or reconciliation logic runs; and
every client-supplied `inventory_item_id`/`sku` is treated as untrusted
input and verified against the real catalog, not assumed correct because
it looks like a real id.

```
-- ILLUSTRATIVE OUTLINE ONLY -- not runnable SQL, not a migration file.
-- Exact column list, constraint names, and error codes must be verified
-- against the live schema before this becomes a real migration.

create or replace function public.replace_project_bom_lines(
  p_project_id uuid,
  p_lines jsonb  -- array of { id (nullable -- null/absent means "new
                 --             line"; non-null MUST already belong to
                 --             this project, see step 4), inventory_item_id
                 --             or sku (preferred) / item_name (fallback
                 --             only, display content otherwise -- see
                 --             §5a), qty, status, request_speed, po,
                 --             notes, procurement_track, ship_to,
                 --             purchasing_sent_at, line_sort }, in
                 --             display order -- line_sort is assigned
                 --             client-side from array position, exactly
                 --             as today's saveProjectSites already does
                 --             (persistence.ts: `line_sort: index`); it
                 --             is a real column (§2a) this design
                 --             omitted until the 2026-09-11 review (see
                 --             the sixth revision note above)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_workspace_id uuid;
  v_project record;
  v_updated_count int := 0;
  v_inserted_count int := 0;
  v_deleted_count int := 0;
  v_ambiguous_names text[];
  v_unknown_line_ids uuid[];
  v_duplicate_line_ids uuid[];
  v_malformed_lines text[];
  v_unresolvable_items text[];
  v_mismatched_items text[];
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
  --    makes the reconciliation below safe under concurrent calls, not
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

  -- 4. STRUCTURAL VALIDATION -- new step, runs before any resolution or
  --    reconciliation logic, rejects the whole call on any failure here:
  --    a. Malformed line objects: each element of p_lines must parse into
  --       the expected shape (a real uuid or null for id, a real numeric
  --       qty, a real integer line_sort, etc.) -- jsonb_to_recordset's
  --       own cast failures naturally raise here if a field is the wrong
  --       type; catch and translate into a controlled error (new EC
  --       code) rather than letting a raw cast-error message reach the
  --       client. Collect offending line indices/reasons into
  --       v_malformed_lines.
  --       CORRECTED 2026-09-11 (task 4 adversarial review): a right-typed
  --       but out-of-range value for an enum-constrained column is a
  --       DIFFERENT failure from a wrong-typed one, and was missing here
  --       entirely in the prior draft -- status/request_speed/
  --       procurement_track are each `check (... in (...))`-constrained
  --       at the table level (§2a), and a value of the correct type
  --       (text) that isn't one of the allowed values would otherwise
  --       sail through this step untouched and only be caught by that
  --       table constraint during the actual write in step 7 -- i.e.
  --       AFTER reconciliation has already begun, and surfaced to the
  --       client as a raw Postgres constraint-violation message instead
  --       of a controlled EC0xx code. Explicitly check each line's
  --       status/request_speed/procurement_track against its known
  --       allowed-value set HERE, before step 5 or step 7 ever runs, and
  --       collect any violation into v_malformed_lines exactly like a
  --       type mismatch -- same rejection path, same "nothing written
  --       yet" guarantee.
  --    b. Duplicate non-null ids: select id, count(*) from
  --       jsonb_to_recordset(p_lines) as t(id uuid, ...) where t.id is
  --       not null group by id having count(*) > 1 -- any result means
  --       the payload references the same existing line twice (e.g. a
  --       client-side bug duplicating a row), collected into
  --       v_duplicate_line_ids.
  --    c. Every non-null id must belong to THIS project: select t.id
  --       from jsonb_to_recordset(p_lines) as t(id uuid, ...)
  --       left join public.project_bom_lines pbl
  --         on pbl.id = t.id and pbl.project_id = p_project_id
  --       where t.id is not null and pbl.id is null
  --       -- catches both a genuinely nonexistent id and an id that
  --       -- exists but belongs to a DIFFERENT project. Either case is a
  --       -- hard rejection of the whole call, never treated as "insert
  --       -- a new line with this id" and never silently reassigned --
  --       -- collected into v_unknown_line_ids.
  --    If v_malformed_lines, v_duplicate_line_ids, or v_unknown_line_ids
  --    is non-empty: log every offending entry via RAISE WARNING, then
  --    raise a controlled exception (new EC code per case, or one
  --    shared "invalid BOM line data" code covering all three -- decide
  --    at implementation time) and stop. No write of any kind has
  --    happened yet at this point; existing BOM lines are untouched.

  -- 5. ITEM IDENTITY VALIDATION -- new step, treats every client-supplied
  --    inventory_item_id/sku as untrusted input, not as already-correct:
  --    a. A line carrying inventory_item_id: verify it exists in
  --       public.inventory_items. Not found -> reject the whole call
  --       (new EC code), collected into v_unresolvable_items.
  --    b. A line carrying sku (no inventory_item_id, or in addition to
  --       one): resolve select id from inventory_items where sku = t.sku
  --       -- must return EXACTLY one row. Zero rows -> unresolvable,
  --       same handling as (a). More than one row would mean sku itself
  --       isn't unique, which contradicts the live schema (§2a confirms
  --       sku is the real unique key) -- if this is ever observed, treat
  --       it as an integrity anomaly worth its own investigation, not a
  --       silently-picked match.
  --    c. A line carrying BOTH inventory_item_id and sku: verify they
  --       identify the SAME inventory_items row. Mismatch -> reject the
  --       whole call (new EC code), collected into v_mismatched_items --
  --       this is exactly the shape of bug (or tampering) a stale UI
  --       state or a hand-crafted request could produce, and it must not
  --       be silently resolved by preferring one field over the other.
  --    d. item_name is NEVER used to resolve or override the stable
  --       identifier when either inventory_item_id or sku is present --
  --       it is display content only at that point. It remains the
  --       resolution mechanism ONLY for a line with neither (step 6,
  --       fallback path, §5a).
  --    Any failure in this step rejects the whole call the same way step
  --    4 does -- log via RAISE WARNING, raise a controlled exception,
  --    stop before any write.

  -- 6. Resolve any line's item_name to inventory_item_id ONLY when the
  --    line has neither inventory_item_id nor sku (see §5a -- this is
  --    the fallback path, not the primary one, and only reached once
  --    steps 4-5 found nothing to reject). DECIDED (option b): if any
  --    such name matches more than one inventory_items row, this step
  --    must NOT proceed to step 7 at all -- collect every ambiguous name
  --    into v_ambiguous_names, raise a controlled exception listing them
  --    (new EC code), and stop, leaving every existing BOM line for this
  --    project completely untouched. Log the ambiguous names via RAISE
  --    WARNING before raising. Never null out inventory_item_id for an
  --    ambiguous line and continue (option (a), not chosen), and never
  --    silently fall back to picking one match.

  -- 7. Reconcile, all three statements against the same locked project,
  --    inside this function's one implicit transaction -- only reached
  --    once steps 4-6 found nothing to reject:
  --    - update public.project_bom_lines set qty = ..., status = ...,
  --      line_sort = t.line_sort, ...
  --      where id = (t.id) and project_id = p_project_id
  --      from jsonb_to_recordset(p_lines) as t(id uuid, line_sort int, ...)
  --      where t.id is not null;
  --      get diagnostics v_updated_count = row_count;
  --      -- CORRECTED 2026-09-11 (task 4): line_sort is now named
  --      -- explicitly, not left inside an elided "..." -- a retained
  --      -- line's display position can change on a save (the user
  --      -- reordered it) even when its id, and thus its identity, did
  --      -- not, and the prior draft's elision made it easy to miss that
  --      -- this column needs writing on the update branch too, not only
  --      -- the insert branch.
  --    - insert into public.project_bom_lines (project_id, item_name,
  --      inventory_item_id, qty, line_sort, ...)
  --      select p_project_id, ..., t.line_sort, ... from jsonb_to_recordset(p_lines)
  --      as t(id uuid, line_sort int, ...) where t.id is null
  --      returning id, inventory_item_id, item_name, qty, status, line_sort, ...
  --      into ...; -- capture the newly-generated ids/rows for the
  --      -- return value in step 8, not just a count.
  --      get diagnostics v_inserted_count = row_count;
  --    - delete from public.project_bom_lines
  --      where project_id = p_project_id
  --        and id <> all(coalesce(array(select (t->>'id')::uuid
  --            from jsonb_array_elements(p_lines) t
  --            where t->>'id' is not null), array[]::uuid[]));
  --      get diagnostics v_deleted_count = row_count;
  --    The delete is scoped to ids NOT present in the incoming payload --
  --    never a blanket delete of everything first. Any real FK pointing
  --    at a retained line's id (the update branch) is never touched.

  -- 8. CORRECTED return shape -- counts alone are not enough (see the
  --    "authoritative saved rows" note below the code block): return the
  --    full saved line collection for this project after reconciliation,
  --    not just counts:
  --    return jsonb_build_object(
  --      'project_id', p_project_id,
  --      'updated_count', v_updated_count,
  --      'inserted_count', v_inserted_count,
  --      'deleted_count', v_deleted_count,
  --      'lines', (
  --        select jsonb_agg(jsonb_build_object(
  --          'id', pbl.id,
  --          'inventory_item_id', pbl.inventory_item_id,
  --          'item_name', pbl.item_name,
  --          'qty', pbl.qty,
  --          'status', pbl.status,
  --          'request_speed', pbl.request_speed,
  --          'po', pbl.po,
  --          'notes', pbl.notes,
  --          'line_sort', pbl.line_sort,
  --          'procurement_track', pbl.procurement_track,
  --          'ship_to', pbl.ship_to
  --        ) order by pbl.line_sort)
  --        from public.project_bom_lines pbl
  --        where pbl.project_id = p_project_id
  --      )
  --    );
end;
$$;

revoke all on function public.replace_project_bom_lines(uuid, jsonb) from public;
revoke execute on function public.replace_project_bom_lines(uuid, jsonb) from anon;
grant execute on function public.replace_project_bom_lines(uuid, jsonb) to authenticated;
```

**Return value, corrected 2026-09-11 (same day, second review): counts
alone are not sufficient, and the earlier version of this document was
internally inconsistent about this.** §4 (Retry) already assumed the
caller receives real generated ids for new lines back from the call ("a
retry produces... the same row identities") — but the return shape only
carried counts, with no way for the caller to actually learn what those
ids are. Two ways to close this gap; **this document recommends the
first**:

1. **Return the full saved line collection** (step 8 above) — every
   `project_bom_lines` row for this project after reconciliation,
   including each line's real `id` and `inventory_item_id`. The frontend
   updates its local `BomLine[]` state directly from this response
   (matching by position or by echoing back which input line produced
   which output row), with no separate round trip. This is the
   recommended design — it makes the client's next save automatically
   correct (every retained line already carries its real id) without a
   second network call.
2. **Alternative, not recommended**: return counts only, and require the
   frontend to immediately re-run `loadProjectSites` (or an equivalent
   single-project reload) right after a successful call, before allowing
   another edit. This works but adds a mandatory round trip to every save
   and is easy to accidentally skip at a future call site — only worth
   choosing over (1) if returning full rows turns out to be impractical
   for some reason not yet identified.

## 4. Rollback, retry, and concurrency behavior

- **Rollback**: automatic and complete. Because the update/insert/delete
  reconciliation (§3) runs inside one `plpgsql` function body with no
  explicit sub-transaction handling, Postgres treats the whole function
  body as part of the single implicit transaction PostgREST already wraps
  every RPC call in — any exception (a bad item lookup, a constraint
  violation, an authorization failure) rolls back every statement in the
  function, including any deletes already issued. There is no partial-BOM
  state reachable from a **single** call, by construction.
- **Retry**: safe and idempotent in the stronger sense the reconcile-by-id
  design (§3) now gives it — calling this function twice with the same
  `p_lines` payload produces not just the same *content* but the same
  *row identities* both times, since retained lines are matched and
  updated by their real id rather than deleted and recreated. This is a
  genuine improvement over the superseded delete-then-reinsert shape,
  where even a same-payload retry would have assigned new ids on every
  call. Like migration 127's conversion RPC, and unlike the retry claim
  corrected elsewhere in `PRODUCT_ERROR_VISIBILITY_AUDIT.md`'s restore
  section, this specific function's idempotency follows directly from its
  own transaction and id-matching logic, not from an unverified assumption
  about the wider system. Calling it again with a *different* payload is
  still expected to produce a *different* result — that's the correct
  behavior for a BOM edit, not a bug.
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
    the parent `projects` row (step 3 in §3) before touching any BOM
    lines. `for update` forces a second concurrent call for the same
    `project_id` to block until the first call's transaction commits or
    rolls back, so two calls' reconciliation logic genuinely serializes
    instead of merely overlapping in time. This is the same category of
    fix as the existing "key-reuse table pattern" already documented in
    `HANDOFF.md` (an atomic reclaim function, not a bare client-side
    insert) — locking the parent row is this feature's equivalent of that
    pattern. **Unchanged by the §3 reconcile-by-id revision** — the race
    (two concurrent transactions each planning their update/insert/delete
    against a snapshot that doesn't reflect the other's not-yet-committed
    changes) is the same shape whether the operations are "delete
    everything, reinsert everything" or "update retained rows, insert new
    ones, delete only removed ones" — the lock is still required either
    way, for the same reason.
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

**Superseded 2026-09-11 (same day, review): a stable item identifier is
now a precondition of this design, not a "later, preferred" idea kept
separate from it.** The original framing below treated carrying a real
`inventoryItemId`/SKU as a nice-to-have improvement layered on top of a
name-resolution RPC. Review determined that's backwards for the same
reason §3's id-preservation redesign is: resolving an arbitrary name
server-side is the thing causing the risk, not a detail to optimize
later. The corrected design:

- **Primary path**: `p_lines` carries `inventory_item_id` (preferred) or
  `sku` directly, resolved client-side from catalog data the UI already
  has loaded (the same `Part`/`inventory_items` records the line was
  built from). No server-side name resolution happens for a line that
  already carries one of these — there is nothing to be ambiguous about.
  **A client-supplied `inventory_item_id`/`sku` is untrusted input, not
  an already-correct fact (§3 step 5)**: the RPC verifies the id actually
  exists, resolves `sku` to exactly one row (never zero, never more than
  one — §2a already confirms `sku` is the live schema's real unique key,
  so "more than one" would itself be a live integrity anomaly, not a
  normal outcome), and — if a line carries both — verifies they name the
  *same* row rather than trusting either one blindly. `item_name` is
  never used to resolve or override a line that already carries one of
  these identifiers; it is display content only at that point, and stays
  the resolution mechanism solely for the fallback path below.
- **Fallback path, for a line that arrives without a stable identifier**
  (e.g. data saved before the frontend change ships, or an
  as-yet-unmigrated caller): the RPC falls back to resolving `item_name`,
  and **DECIDED (2026-09-10, E's call): option (b)** still applies here —
  if the name matches more than one `inventory_items` row, the RPC
  rejects the **entire** BOM replacement call with a controlled,
  user-safe error naming the ambiguous item(s) (not raw constraint/SQL
  text), and every existing BOM line for this project is left completely
  unchanged (the reconciliation in §3 step 7 never runs; this check, and
  the structural/item-identity validation in §3 steps 4-5, happen first).
  The ambiguous names and their matching `inventory_items` ids are logged
  server-side (`RAISE WARNING` or equivalent) for diagnosis. **Option
  (a) — nulling the catalog link for just the affected line and
  continuing — remains explicitly not chosen**, for the same reason as
  before: a silently-missing catalog link is a quieter, easier-to-miss
  failure than a whole save being rejected.

A bare `SELECT ... LIMIT 1` or an unguarded join that can silently
return more than one match for a name remains **not** an acceptable
implementation of the fallback path.

**What closing this at the root actually requires (frontend/type scope,
still not implemented by this document, but now load-bearing rather than
optional)**: `BomLine` gains a real stable identifier field (`itemSku` or
`inventoryItemId`), `loadProjectSites` maps it in from
`project_bom_lines.inventory_item_id`/a joined `sku`, and every UI path
that builds or edits a `BomLine` carries it through unchanged. This is the
same change §3 already requires for id preservation (`BomLine.id`) — both
are one frontend change, not two separate ones, since a save can't
reconcile-by-id (§3) or resolve-by-stable-identity (this section) without
the client sending real identifiers for both the line and its catalog
link.

## 6. Verification cases (for a future test script, same shape as `migration_127_conversion_tests.sql`)

To be written and reviewed before any migration is drafted, not sketched
further here beyond the list of what it must cover:

1. **Updated 2026-09-11 for the reconcile-by-id design (§3)**: a PM/admin
   calling with a project they have access to, a payload containing (a)
   an existing line's real `id` with a changed `qty`/`status` -> that
   exact row is updated in place, **same id** afterward; (b) a line with
   no `id` -> a new row is inserted; (c) an existing line's `id` simply
   absent from the payload -> that specific row is deleted. Confirm
   `updated_count`/`inserted_count`/`deleted_count` in the return value
   match reality, and confirm every row's `id` that was *not* meant to
   change genuinely didn't (compare ids before/after, not just content).
2. Calling twice in a row with the same payload (including real ids from
   the first call's result) -> same end state both times, no duplicate
   rows, **and the same row ids both times** — this is the proof the
   reconcile-by-id redesign was for for; the old delete-then-reinsert
   design could satisfy "same content" on a retry but never "same ids."
3. Calling with an empty `p_lines` array -> every existing line for that
   project is deleted (all ids absent from the payload -> all removed),
   ending with zero BOM lines (a deliberate "clear the BOM" case, not an
   error).
3a. **A line's `id` is provided but is unknown to the system** — both
    sub-cases required, not just one: (i) the id **belongs to a
    different project** (a stable id must not let a caller reassign
    another project's line by supplying its id under a different
    `p_project_id` — existing BOM lines for *both* projects unchanged
    afterward), and (ii) the id **does not exist at all** (a stale or
    mistyped id from client state). Both reject the whole call the same
    way — neither is ever silently treated as "insert a new line."
3b. **A retained line (real `id` in the payload) that has a real
    `task_hardware_dependencies` row pointing at it** -> after the call,
    that dependency's `project_bom_line_id` still points at the same,
    unchanged id — the actual proof the §2a FK-orphaning risk is closed
    for this path, not just asserted to be. (Requires seeding a real
    dependency row for the test, since nothing in the live app does this
    today — see §2a.)
4. A forced failure partway through (e.g. a temporary constraint
   violation injected only for the test) -> confirm the project's
   **original** BOM lines are still present afterward (the actual proof
   of atomicity — this is the test that could not be written against
   today's client-side sequence, since there is no way to force a
   mid-sequence failure and prove rollback without a transaction to roll
   back).
5. **Concurrency test, using two real concurrent sessions/connections
   (not two sequential calls in one test).** Designed 2026-09-11 with a
   concrete methodology, not just a requirement statement:

   - **Why this cannot be a plain `.sql` script** (unlike every other test
     here, and unlike `migration_127_conversion_tests.sql`): a single SQL
     file run through one connection is inherently sequential — it cannot
     itself hold one transaction open while a second, genuinely
     concurrent call executes in real wall-clock time. This test needs an
     **external harness with two separate database connections** (e.g. a
     small Node script using the `pg` client library, or two parallel
     `psql` invocations from a shell script) — not a code change to
     `replace_project_bom_lines` itself, and not any debug hook, sleep,
     or breakpoint added to the production function. All orchestration
     lives in the test harness, entirely outside the function under test.
   - **Session A** (connection 1): `BEGIN;` then manually run
     `SELECT id FROM projects WHERE id = '<test-project-id>' FOR UPDATE;`
     against the *same row* the RPC's own first lock statement targets —
     this recreates "the row is currently locked" without touching the
     RPC's source at all, since it's a real lock on the real row, taken
     the same way the function itself would take it. Hold this
     transaction open (the harness pauses here) rather than committing
     immediately.
   - **Session B** (connection 2, started while A's transaction is still
     open): call the real `rpc/replace_project_bom_lines` for the *same*
     `project_id`. Confirm this call does not return immediately — proven
     rigorously (not just by a timing guess) via a **third, monitoring
     connection** querying `pg_locks`/`pg_stat_activity`
     (`pg_blocking_pids()` naming session A's backend as the blocker of
     session B's backend) — this is timing-independent and doesn't depend
     on guessing how long is "long enough" to prove a block occurred.
   - **Session A then commits (or rolls back)**; confirm session B's call
     proceeds and completes immediately after, and that the **final BOM
     state reflects exactly one call's line set** — the real data-
     integrity assertion, not just the timing observation. Repeat with
     which session's payload should "win" made explicit and asserted
     against, not left as "whichever."
   - A test that only calls the function twice in sequence, with no
     genuine overlap, does **not** prove any of this and must not be
     accepted as satisfying this case.
6. A non-PM/non-admin caller -> rejected, existing BOM lines unchanged.
7. A caller with no resolvable workspace/session -> rejected with the
   EC007 pattern, not a generic error.
8. **A second workspace row exists (even suspended)** -> the function
   fails closed via `active_workspace_id()`'s own exception, before any
   authorization or BOM logic runs; existing BOM lines unchanged.
9. **Updated 2026-09-11**: a line carrying a real `inventory_item_id`/
   `sku` (the primary path, §5a) -> used directly, no name resolution
   attempted at all for that line, regardless of what its `item_name`
   string happens to be.
9a. A line with no stable identifier, whose `item_name` matches exactly
   one `inventory_items` row (the fallback path) -> resolves normally.
10. A line with no stable identifier, whose `item_name` matches **two or
    more** `inventory_items` rows (fallback path, ambiguous) -> the
    entire call is rejected with a controlled error listing the
    ambiguous name(s) (§5a, decided option (b)); confirm the project's
    BOM lines are completely unchanged afterward (not partially
    replaced, not one line silently nulled) — this is the real proof
    that rejection happens before the reconciliation in §3 step 7, not
    after a partial write.
10a. A batch with one ambiguous fallback-path name and several
    stable-identifier lines in the same call -> the whole call still
    rejects (no partial success), not just the ambiguous line.
11. `information_schema.role_routine_grants` check confirming `anon` has
    no execute grant on this function, matching migration 127/128's own
    verification pattern.
12. **New, 2026-09-11 (second review) — duplicate non-null line ids in
    one payload**: two entries in `p_lines` carrying the *same* real,
    valid `id` (e.g. a client-side bug that duplicated a row) -> the
    whole call is rejected before any write, distinct from case 3a (an
    id that's unknown/wrong-project) — this is a *known-valid* id used
    twice, a different failure shape that needs its own test.
13. **New, 2026-09-11 — malformed payloads**: a line whose `id` is a
    non-uuid string, or whose `qty`/`status`/other field is the wrong
    type or an out-of-range value -> rejected with a controlled error
    (§3 step 4a), not a raw Postgres cast-error message reaching the
    client, and not a partial write of the other, well-formed lines in
    the same call.
14. **New, 2026-09-11 — the return value actually contains generated ids
    for new lines**: call with one or more `id`-less (new) lines ->
    the response's `lines` array contains a real row for each, with a
    real, non-null `id` and the correct `inventory_item_id` — this is
    the direct proof the return-shape correction (below the code block
    in §3) actually closes the gap it was written to close, not just a
    claim that it does.
15. **New, 2026-09-11 — mismatched inventory_item_id/sku on one line**:
    a line supplying both fields, where they identify two *different*
    real catalog rows -> the whole call is rejected (§3 step 5c),
    existing BOM lines unchanged; a companion case where `sku` doesn't
    resolve to any row at all (typo, deleted catalog item) -> same
    rejection, distinct error detail so the two are diagnosable
    separately if implemented with distinct codes.
16. **New, 2026-09-11 (task 4 adversarial review) — line_sort survives
    reconciliation on both branches**: a payload that reorders an
    existing line (same real `id`, a different `line_sort` than it
    currently has) together with one brand-new line inserted at a
    specific position -> after the call, the retained line's `line_sort`
    reflects its NEW position (not its old one, and not left unchanged
    by the update branch), the new line's `line_sort` reflects its
    inserted position, and the returned `lines` array (step 8, ordered by
    `pbl.line_sort`) reflects the caller's intended display order exactly
    -- this is the direct proof the gap found in this review (line_sort
    silently dropped from the design) is actually closed, not merely
    reworded.
17. **New, 2026-09-11 (task 4 adversarial review) — invalid enum value is
    rejected before any write, not surfaced as a raw constraint error**:
    a line whose `status` (or `request_speed`, or `procurement_track`) is
    a syntactically valid string but not one of the column's allowed
    values -> the whole call is rejected with a controlled `EC0xx` error
    naming the offending field, existing BOM lines for the project
    completely unchanged, and -- the specific proof this test exists
    for -- no raw Postgres `CHECK` constraint-violation text reaches the
    client. A companion run with the same invalid value alongside several
    otherwise-valid lines confirms the rejection is whole-call, not a
    partial write of the valid lines with the bad one dropped.

## 7. What this document is not

This is not a migration, not a frontend change, and not an implementation
plan with a start date. It exists so the atomicity fix has a reviewed shape
before any SQL is written, per the instruction that created it. The
immediate 2026-09-10 fix (row-count verification on the item/balance and
project/scope-of-work writes) already shipped without touching this BOM
sequence at all — **BOM atomicity remains entirely open/unimplemented,
still true as of this 2026-09-11 revision.** §5a's ambiguous-name fallback
behavior is decided (option (b)); §2a's schema validation confirmed
`EC008` as the next free error code **at that time — since superseded by
migration 130 (`save_equipment_recipe`), which now claims `EC008`-`EC016`;
this plan's RPC would start at `EC017`, re-verified at actual
implementation time (see §2's updated note above).** The design was
substantially revised the same day (§3, §5a) from delete-then-reinsert to **reconcile-by-id**,
specifically to close the `task_hardware_dependencies.project_bom_line_id`
FK risk (§2a) by design rather than carrying it forward as a documented-
but-accepted gap. **This revision has one real prerequisite that did not
exist before**: `BomLine` must gain a stable line id and a stable catalog
item identifier (SKU or `inventory_item_id`) before the RPC in this
document can be implemented as designed — a frontend/type change, not
part of this document, and not yet done. None of this is itself a
go-ahead to implement — that must still be a separate, explicit decision
from E, and should include explicit sign-off on the `BomLine` type change
this design now depends on, not just the SQL shape.

**2026-09-11 addendum (overnight autonomous pass, task 4): a fresh
adversarial review against a checklist of implementation-readiness
concerns found this document's TECHNICAL DETAIL sound** — sixteen of
eighteen checked items required no change — but this is a statement
about internal consistency and schema-groundedness, not a claim of
approval or readiness to draft a migration. Two real gaps were also
found (line_sort silently missing from `p_lines` despite being a real,
currently-written column; enum-valued fields checked for type but not
for allowed value in the structural-validation step), by comparing this
design against today's actual `saveProjectSites` code, not just against
the schema. Both are now fixed in §3 and covered by new test cases
§6.16-17 (sixth revision note, above). This is the value of re-reading
the live client code on every review pass, not just the schema and the
document's own prior claims — neither gap would have been caught by
re-reading the migrations alone.

**Correction (2026-09-11, later same day, review): this document remains
design-ready-for-decision, not approved and not implementation-ready.**
"Substantively ready" above described the document's internal
consistency, not a green light. It is still unapproved and design-only:
the batch-vs-per-call atomicity question (§4a), the `active_workspace_id()`
temporary-guard posture (§5), and the `BomLine` type-change prerequisite
(§3, this section) all still require E's explicit decision. **No
migration has been drafted for this design, and none should be, until
E gives that separate, explicit go-ahead** — a thorough design review is
not that go-ahead.

## §7 — Implementation (2026-09-12): go-ahead given, migration drafted

The 2026-09-12 overnight reliability closeout work order gave the
explicit go-ahead this section's own prior correction required, and
resolved the three still-open items above as follows: one project per
RPC call (§4a resolved — no whole-batch atomicity attempted); the
`BomLine` type change is implemented (`id`/`sku` added, this pass);
`active_workspace_id()` is used as the temporary guard, exactly as §5
recommended. Deviations found and corrected against the live schema while
drafting `backend/supabase/migrations/131_atomic_project_bom_replace.sql`
(this file's own illustrative SQL was explicitly marked "not runnable,
re-verify against live schema" — these are that re-verification's
findings, not new design decisions):

1. **`projects` has no `deleted_at` column** — confirmed no migration ever
   adds one. This document's illustrative `where id = p_project_id and
   deleted_at is null for update` would fail outright against the real
   schema; the real migration locks and looks up the project by id alone.
2. **Authorization uses `is_workspace_admin(workspace_id)`, not
   `is_app_admin(auth.uid())`** — a deliberate consistency choice with
   migration 130's own later, reviewed correction (which replaced exactly
   this same legacy-global-admin check for the identical reason: it is
   the wrong gate for a workspace-scoped decision), not a re-litigation of
   migration 127 itself. "PM" is still checked via the same
   `workspace_member_roles` join both migrations already use.
3. **EC0xx codes re-verified immediately before drafting**: `grep -rhoE
   "errcode = '[A-Z0-9]+'" backend/supabase/migrations/*.sql` confirmed
   EC001-EC016 in use (EC001-EC007 migration 127, EC008-EC016 migration
   130) — EC017 was genuinely free, confirming this document's own
   §2/§6 note. The migration claims EC017-EC024 (EC007 itself reused, not
   reclaimed, for the same workspace-resolution-ambiguous case 127/130
   already use it for). **EC025 is the next free code** for any future RPC.
4. **Structural validation uses one shared error code (EC020)** covering
   every malformed-line/invalid-enum sub-case, matching migration 130's
   own established precedent (its EC011 similarly covers several distinct
   structural failures) — resolving this document's own "one code per
   case, or one shared code" open question by following that precedent.
5. An item name matching **zero** catalog rows is tolerated (null link,
   not a rejection) — only an **ambiguous** (multiple-match) name rejects
   the whole call. This matches `saveProjectSites`' own current, unchanged
   behavior and the still-undecided optional-association warning policy
   (`PRODUCT_ERROR_VISIBILITY_AUDIT.md` A2.6) — this migration does not
   preempt that decision, it only handles the different case (an invalid
   or ambiguous stable identifier), which was always meant to be a hard
   rejection regardless of how the zero-match question is eventually
   decided.

**Not yet applied.** The migration, test script, and frontend wiring are
drafted and kept local for E's review — see `HANDOFF.md`'s 2026-09-12
entry for the full file list, local check results, and the exact single
next action for E.
