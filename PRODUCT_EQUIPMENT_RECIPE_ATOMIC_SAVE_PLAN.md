# Equipment Recipe Atomic Save — Design Proposal (migration 130 APPLIED, frontend wired)

Status: **MIGRATION 130 APPLIED AND VERIFIED IN PRODUCTION (E, 2026-09-11)** —
E ran `backend/supabase/migrations/130_atomic_equipment_recipe_save.sql` and
its complete verification script (`backend/supabase/migration_130_recipe_save_tests.sql`)
directly against the production Supabase project; both completed with no
SQL error, meaning every assertion in the test script passed and zero
sections were skipped. **The frontend is now wired to the new RPC**:
`saveDeviceRecipes` (`src/persistence.ts`) calls `rpc/save_equipment_recipe`
once per recipe instead of the old multi-request PATCH/INSERT/upsert/delete
sequence — see the "Frontend wiring" section below for what changed and
what remains. The two-session concurrency check (the test script's Section
16) remains explicitly deferred, not run.

Role access and atomicity were decided by E on 2026-09-11 (below), and the
migration was drafted, corrected across three review rounds, and finally
approved and run by E following those decisions. Written per the overnight
autonomous pass's task 3 (2026-09-11), following the deployed
`saveDeviceRecipes` write-verification fix (commits `de756ea`/`59f8e2b`)
that made failures visible and rejected bad input before writing, but
explicitly left the function non-atomic (see
`PRODUCT_ERROR_VISIBILITY_AUDIT.md`'s corrected finding on this).

**Decisions (2026-09-11, E):**
1. **Role access** (§8): **warehouse and workspace administrators** — E
   confirmed this design's RLS-grounded gate (matching the live
   `equipment_types`/`equipment_bom_components` policy, migration 023),
   not the sibling BOM plan's PM-or-admin gate.
2. **Atomicity** (§3): **Option A, confirmed** — save each recipe atomically
   and independently. One broken recipe must not prevent unrelated recipes
   from saving. The migration implements exactly one recipe per call; the
   frontend still loops once per recipe, matching `saveDeviceRecipes`'
   existing loop shape. The whole multi-recipe batch remains deliberately
   not atomic — that was Option B, not chosen.
3. **Implementation priority (E, 2026-09-11)**: this is the next
   implementation priority overall — it addresses a live partial-save risk
   and is smaller in scope than the Project BOM redesign. Project BOM
   reconciliation (`PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md`) follows
   after this one.

**Still required before this migration is actually run**: E's review and
explicit go-ahead on the drafted SQL itself (`130_atomic_equipment_recipe_save.sql`)
and its accompanying test script — a decided design and a drafted migration
are not that go-ahead. This document follows the same review discipline as
`PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` (its sibling document for the
Project BOM problem, still design-only and second in the implementation
order above) and reuses its precedent — migrations 127/128's
`create_project_from_quote` — rather than inventing a new pattern.

## 1. The risk this is meant to close

`saveDeviceRecipes` (`src/persistence.ts`) saves one or more equipment
recipes as a loop of separate, independently-committing PostgREST requests
per recipe: an `equipment_types` PATCH-or-INSERT, then an
`equipment_bom_components` upsert, a lookup, and a conditional DELETE. The
2026-09-11 deployed fix made every one of these checked and added two
preflight validations (unresolved/ambiguous component names; a duplicate
component within one recipe), but explicitly did not — and could not,
without a real transaction — make any of it atomic:

- **Across recipes**: if recipe 2 of 3 in one save fails, recipe 1's writes
  are already committed. There is no way to undo them from client-side
  code after the fact.
- **Within one recipe**: its `equipment_types` write can succeed and
  commit before a later `equipment_bom_components` write for that same
  recipe fails, leaving a recipe whose name/description saved but whose
  component list didn't — a real, live-since-day-one gap this document
  exists to close, not a new one introduced by the recent fix.

## 2. Precedent this should follow

Same as `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md`: one `security
definer` Postgres function per unit of work (here, **one recipe**, not the
whole batch — see §3's open decision), executed inside the single implicit
transaction PostgREST already wraps every RPC call in. `set search_path =
''`, every table reference schema-qualified, stable `EC0xx` error codes
continuing migration 127's numbering. **`EC008` is the next free code as
of this writing** (re-confirmed 2026-09-11: `EC001`-`EC007` all belong to
migration 127 alone) — but this plan and `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md`
both currently claim `EC008` as "next free," since neither has been
implemented. **Whichever of the two RPCs is actually built first must
re-check the live migration history for the real next-free code before
writing real SQL** — this plan does not assume it wins that race.

## 2a. Schema facts specific to this design (read directly, not assumed)

Checked against `backend/supabase/migrations/003_manufacturing_inventory_controls.sql`
(base tables) and `020_phase10_equipment_recipes_cutover.sql` (the
`equipment_name` unique index and `output_inventory_item_id` column):

- **`equipment_types`**: `id` (uuid pk), `equipment_number` (unique, but
  client-generated today, see §5), `equipment_name` (**unique index**,
  migration 020), `description`, `image_url`, `output_inventory_item_id`
  (nullable FK to `inventory_items`), `is_retired`, `retired_at`,
  `created_at`/`updated_at`.
- **`equipment_bom_components`**: `id` (uuid pk — a **real stable id
  already exists here**, unlike `project_bom_lines`), `equipment_type_id`
  (FK, `on delete cascade`), `inventory_item_id` (FK, **`not null`** —
  stricter than `project_bom_lines.inventory_item_id`, which is nullable),
  `quantity_required` (`check (quantity_required > 0)`), `line_sort`,
  `is_active`, **`unique (equipment_type_id, inventory_item_id)`**.
- **This unique constraint is the component's real natural key.** Unlike
  the Project BOM problem, a component row's identity is already fully
  determined by *which item it links to within a recipe* — there is no
  equivalent of the "BOM lines have no stable id, only a name" problem
  here, and no need to invent one. This materially simplifies component
  reconciliation (§3) compared to `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md`'s
  approach.
- **No foreign key anywhere references `equipment_bom_components.id`**
  (checked via a repo-wide grep for `references equipment_bom_components`
  — zero results). A component row can safely be deleted and a new one
  inserted for the same `(equipment_type_id, inventory_item_id)` pair
  without any FK-orphaning risk analogous to `project_bom_lines`'
  `task_hardware_dependencies` situation. **`equipment_types.id` IS
  referenced** by `inventory_transactions.equipment_type_id`,
  `build_transactions.equipment_type_id` (migration 003), and
  `product_catalog.equipment_type_id` (migration 013) — so the *recipe's
  own* id must be preserved across a save (see §3), even though a
  *component's* id does not need to be.
- **RLS (migration 023, still the live policy)**: `using
  (is_app_admin(auth.uid()) or has_role('warehouse'))` for **both**
  tables — **`warehouse` or admin, not `pm`**. This is a real, different
  detail from the Project BOM RPC's PM-or-admin gate — copying that gate
  verbatim here would be wrong. Confirmed by direct read, not assumed
  from the sibling document.
- **A real, previously-undocumented gap found while researching this
  design**: `saveDeviceRecipes` resolves an existing recipe by
  `equipment_name` (`equipmentIdByName.get(recipe.name)`). If a user
  renames a recipe in local state before saving, the OLD name no longer
  matches, so the save path treats it as brand new — **inserting a
  duplicate recipe under the new name and leaving the original row,
  under its old name, untouched** rather than renaming it. This is a
  real, live bug in the *already-shipped* code (not something this
  design would introduce), confirmed by reading the resolution logic
  directly; it was not caught by the recent write-verification pass
  because it's a data-modeling gap, not an unchecked-response one. No UI
  path was found that lets a user edit `recipe.name` directly on an
  *existing* recipe today (new recipes get an auto-generated "New
  Equipment N" name, `main.tsx:10136`) — so this is currently **latent,
  not actively triggered**, but the RPC design below closes it properly
  by carrying a stable `equipment_type_id` instead of re-resolving by
  name, so it cannot recur once implemented. Flagging here rather than
  filing a separate finding, since fixing it is naturally subsumed by
  this design, not a separate task.

## 3. One recipe, atomically — and a batch, as an explicit decision

**One recipe saved atomically**: the RPC operates on exactly one recipe
per call (`save_equipment_recipe(...)`, not a batch parameter) — matching
the "one project per call" shape `create_project_from_quote` and the
proposed `replace_project_bom_lines` both use. Within that one call, the
`equipment_types` upsert and the full component reconciliation (upsert
retained/new components, delete removed ones) run inside the function's
own single implicit transaction: either the whole recipe (name,
description, output link, and its complete component list) saves
correctly, or none of it does.

**Whether a whole multi-recipe batch should also be atomic — presented as
a decision, not selected silently:**

- **Option A (recommended default, matches the Project BOM plan's own
  precedent)**: the frontend calls this RPC once per recipe, in a loop,
  exactly as `saveDeviceRecipes` already loops today. Each call is fully
  atomic; the *batch* is not — a failure on recipe 2 of 3 leaves recipe
  1's save committed. This is a real limitation, stated plainly, not
  hidden — but recipes are edited far less frequently and in much smaller
  batches than BOM lines (typically one recipe edited at a time, rarely a
  bulk multi-recipe save), so the practical exposure to this specific gap
  is smaller here than for BOM lines.
- **Option B**: a second, batch-level RPC (`save_equipment_recipes(p_recipes
  jsonb)`) that wraps *every* recipe's reconciliation in one transaction,
  so a failure on any recipe rolls back the entire batch. This is
  possible (Postgres transactions aren't limited to one row/entity), but
  is materially more SQL and more error-code surface for a save pattern
  that, per the frequency argument above, may not need it. Also raises a
  question Option A doesn't: should one bad recipe (e.g. an ambiguous
  component name) block saving four other, perfectly fine recipes in the
  same batch? That's a real UX tradeoff, not just a technical one.
- **DECIDED (2026-09-11, E): Option A.** Save each recipe atomically and
  independently — one broken recipe must not prevent unrelated recipes
  from saving. Option B (whole-batch atomicity) is not implemented.

## 4. Existing versus new `equipment_types` rows

Because `equipment_name` already has a real, enforced unique index
(migration 020) — unlike `project_bom_lines`, which has no natural key at
all — an upsert keyed on `equipment_name` is already safe by construction
for the *common* case. The RPC still accepts an optional stable
`p_equipment_type_id`, for two reasons found during this review, not
just for symmetry with the BOM plan:

1. **Renaming a recipe** (§2a's found gap) — if the client sends
   `p_equipment_type_id` for an existing recipe, the RPC updates that row
   by id regardless of whether `p_equipment_name` changed, correctly
   handling a rename instead of creating a duplicate. If `p_equipment_type_id`
   is null/absent, the RPC falls back to resolving by `equipment_name`
   (today's behavior, safe because the name is genuinely unique).
2. **A non-null `p_equipment_type_id` that doesn't exist, or that maps to
   a different `equipment_name` than expected** — treated as a hard
   rejection (new `EC0xx` code), never silently treated as "create new."
   Mirrors the exact correction already made to
   `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` after its own review found
   this same class of bug.

## 5. Component reconciliation

Because `(equipment_type_id, inventory_item_id)` is already a real unique
constraint, reconciliation is a natural-key upsert, not an id-preservation
problem: for the given recipe's resolved component set,

- `insert ... on conflict (equipment_type_id, inventory_item_id) do
  update set quantity_required = excluded.quantity_required, line_sort =
  excluded.line_sort, is_active = true` — one statement covers both
  "retained, quantity changed" and "genuinely new component."
- `delete from equipment_bom_components where equipment_type_id = <id>
  and inventory_item_id <> all(<the resolved id list from this call>)` —
  removes only components no longer in the recipe, never a blanket delete
  first. Safe because nothing references a component row's own `id` (§2a).

**Validation before any write, all four checks ported directly from the
deployed client-side fix, now enforced server-side and atomically:**

1. **Unresolved component**: a component's item identifier (see below)
   doesn't resolve to any real `inventory_items` row → reject the whole
   call, log the offending name/id, existing recipe (if any) unchanged.
2. **Ambiguous component** (name-fallback path only, see §6): a name
   matches more than one `inventory_items` row → reject the whole call.
3. **Duplicate component within the recipe**: two entries in the payload
   resolve to the same `inventory_item_id` → reject the whole call —
   never silently combine quantities (a business-behavior decision, not
   made here, matching the deployed client-side fix's own stance) and
   never silently pick one.
4. **Malformed payload**: a non-uuid `id`, a non-numeric `qty`, a
   `qty <= 0` (the table's own `check (quantity_required > 0)` would
   catch this at the database level regardless, but rejecting it in the
   validation step first gives a clearer error than a raw constraint
   violation) → reject the whole call.

## 6. Output inventory-item behavior

`output_inventory_item_id` keeps its existing, deliberately tolerant
behavior: it may be null (today's code already accepts an unresolved
output name this way, and that behavior is not being changed). Applying
the same untrusted-input principle established in
`PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` §5a: if the client sends a
stable `p_output_inventory_item_id`, the RPC verifies that row actually
exists before accepting it (never trusts it blindly); if the client sends
only `p_output_item_name` (fallback path, no stable id yet since
`BuildRecipe.outputName` is a plain string today, same situation
`BomLine.item` was in), the RPC resolves it the same way `saveDeviceRecipes`
does today — a name matching zero or multiple rows still resolves to
`null`, not an error, since **this specific field's null-tolerant behavior
is pre-existing and explicitly not being changed by this design** (unlike
component resolution, where ambiguity is now a hard rejection). This
asymmetry is deliberate, not an oversight: a recipe's own components
failing to resolve blocks the save because the recipe would be
functionally wrong without them; a recipe's *output link* failing to
resolve does not block the save, matching the tolerance the current,
already-approved product behavior already has.

## 7. Concurrency using a real database lock

Two distinct cases, since (unlike a BOM replace, which always targets an
existing project) a recipe save can be creating a brand-new row:

- **Existing recipe** (`p_equipment_type_id` resolved to a real row):
  `select * from equipment_types where id = <id> for update` — the exact
  same pattern `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` uses for a
  project row. Serializes two concurrent saves of the *same* recipe.
- **New recipe** (no existing row to lock yet): there is nothing to take
  a row lock on before it exists. Use `select pg_advisory_xact_lock(hashtext('equipment_type:' ||
  p_equipment_name))` — a transaction-scoped advisory lock keyed on the
  *name* being created, held only for the duration of this call. This
  serializes two concurrent attempts to create a recipe with the same
  name (which would otherwise race on the unique index and one would
  simply fail with a constraint violation — the advisory lock turns that
  race into a clean serialization instead of a raw constraint error for
  the loser). Released automatically at transaction end, no explicit
  unlock needed.
- Two calls for **different** recipes (different existing ids, or
  different new names) never contend — both locking mechanisms are
  scoped per-recipe, not table-wide.

## 8. Workspace and role authorization

- **Role gate, confirmed from the live RLS policy (§2a), not copied from
  the BOM plan**: `is_app_admin(auth.uid()) or has_role('warehouse')` —
  **warehouse or admin**, matching `equipment_types`/`equipment_bom_components`'
  own migration-023 policy exactly. Using the BOM plan's "PM or admin"
  gate here would have been a real, wrong copy-paste error this review
  specifically checked for and avoided.
- **Workspace guard**: same temporary posture as
  `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` §5 — call
  `active_workspace_id()` first (fails closed unless exactly one active
  workspace exists), then `resolve_caller_workspace_id()` + the role
  check above (catch `P0001` → `EC007`, reusing the established code).
  `equipment_types` has no `workspace_id` column today, same situation as
  `projects` — this is an explicitly temporary substitute, to be replaced
  with real per-recipe workspace ownership before a second workspace is
  ever allowed to exist, not a permanent design choice.

## 9. Safe, stable error codes/messages

Continuing from `EC008` (re-verify at implementation time, §2): a
distinct code per rejection reason established in §§4-5 above (unknown/
cross-recipe id, unresolved component, ambiguous component, duplicate
component, malformed payload, output-item verification failure if a
stable id was supplied and doesn't exist, workspace/role failures reusing
`EC007`/a new admin-role code). Every user-facing message stays plain
("This recipe could not be saved because..." + a specific, safe-to-show
reason), with raw constraint/SQL text logged via `RAISE WARNING`
server-side only, matching the established pattern throughout this
session's other RPC designs.

## 10. Idempotent retries

Calling this RPC twice with the same payload (including the real
`equipment_type_id` and each component's real identity) produces the same
end state both times — the natural-key upserts in §4-5 guarantee this
without any special-casing. Unlike the Project BOM plan, there is no
"new id assigned on every call" risk to design around here, since
`equipment_bom_components`' natural key already prevents it (§2a) and the
recipe's own id is preserved via `p_equipment_type_id` (§4).

## 11. Exact result returned to the frontend

Matching the correction already made to
`PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` (counts alone were found
insufficient there) — **return the full saved recipe, not just counts**:

```
-- ILLUSTRATIVE OUTLINE ONLY -- not runnable SQL.
return jsonb_build_object(
  'equipment_type_id', v_equipment_type_id,
  'equipment_name', v_equipment_name,
  'output_inventory_item_id', v_output_inventory_item_id,
  'components', (
    select jsonb_agg(jsonb_build_object(
      'id', ebc.id,
      'inventory_item_id', ebc.inventory_item_id,
      'quantity_required', ebc.quantity_required,
      'line_sort', ebc.line_sort
    ) order by ebc.line_sort)
    from public.equipment_bom_components ebc
    where ebc.equipment_type_id = v_equipment_type_id and ebc.is_active
  )
);
```

The frontend updates its local `deviceRecipes` state directly from this
response (the real `equipment_type_id`, now carried forward on every
subsequent save per §4) rather than requiring a separate reload.

## 12. Grants and `search_path` hardening

Identical posture to every RPC this session has designed: `security
definer`, `set search_path = ''`, every table reference schema-qualified
(`public.equipment_types`, not bare `equipment_types`), `revoke all ...
from public`, `revoke execute ... from anon`, `grant execute ... to
authenticated` only. `information_schema.role_routine_grants` verified in
the test suite (§14) to confirm `anon` has no path in, matching migration
127/128's own verification pattern.

## 13. Rollback behavior

Automatic and complete, by construction: the `equipment_types` upsert,
the advisory or row lock, the component reconciliation, and the
validation checks all run inside this one function's single implicit
transaction. Any exception at any point (a failed validation check, a
constraint violation, an authorization failure) rolls back every
statement in the function, including a component delete that already
ran. There is no partial-recipe state reachable from a single call, by
construction — this is the actual fix the deployed client-side pass
could not provide without a real transaction.

## 14. Test cases, including a real two-session concurrency test

To be written and reviewed before any migration is drafted:

1. An existing recipe, resolved by `equipment_type_id`, with a changed
   description and one changed component quantity → both persist, same
   `equipment_type_id` afterward.
2. **Rename case**: an existing recipe saved with its real
   `equipment_type_id` but a *different* `equipment_name` → the same row
   is renamed, not duplicated — the direct proof §2a's found gap is
   closed by this design.
3. A brand-new recipe (no `equipment_type_id`) → inserted, real generated
   id returned in the response (§11).
4. A duplicate component within one recipe's payload → whole call
   rejected, no write of any kind, existing recipe (if any) unchanged.
5. An unresolved component name/id → same rejection shape.
6. Two different component names resolving to the same `inventory_items`
   row (name-fallback ambiguity) → same rejection shape.
7. A malformed line object (bad uuid, non-numeric qty, `qty <= 0`) →
   rejected before any write, not a raw constraint error.
8. A forced failure partway through (a temporary constraint violation
   injected only for the test, after the `equipment_types` write has
   already run in-transaction) → confirm the recipe's **original**
   `equipment_types` row and component set are unchanged afterward — the
   actual proof of atomicity within one recipe, which nothing in today's
   client-side code can prove.
9. **Real two-session concurrency test — same methodology as
   `PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md` §6 item 5, not a plain
   `.sql` script**: an external harness with two real database
   connections. For the **existing-recipe** case: session A holds `SELECT
   ... FOR UPDATE` on the real `equipment_types` row; session B calls the
   RPC for the same recipe; confirm session B blocks (proven via a third,
   monitoring connection reading `pg_locks`/`pg_blocking_pids`, not a
   timing guess) until session A releases; confirm the final state
   reflects exactly one call's data. For the **new-recipe** case: session
   A holds `SELECT pg_advisory_xact_lock(hashtext('equipment_type:Test
   Recipe'))` directly; session B calls the RPC to create a recipe with
   that same name; confirm session B blocks the same way, and confirm
   only one `equipment_types` row exists afterward, not a unique-
   constraint error surfaced to the loser.
10. Non-warehouse/non-admin caller → rejected, `EC0xx`, existing data
    unchanged. (Confirms the role gate is genuinely `warehouse`-or-admin,
    not accidentally `pm`-or-admin copied from the sibling plan.)
11. A second workspace row exists (even suspended) → fails closed via
    `active_workspace_id()`, before any recipe logic runs.
12. Calling twice in a row with the same payload → identical end state,
    including identical component row ids where they were already
    retained (not just identical content).
13. `information_schema.role_routine_grants` check confirming `anon` has
    no execute grant.

## 15. What this document is not

**Superseded by §16 below.** Migration 130 is applied and verified in
production, and the frontend is wired to it — this section's original
"not a frontend change, not deployed, not yet run" framing no longer
describes the current state and is kept only for the historical record of
how this design proposal evolved.

**Updated 2026-09-11**: role access (§8) and atomicity (§3) are both now
DECIDED by E (see the status block at the top of this document) — those
two items are no longer open. The real next-free `EC0xx` code was
re-confirmed immediately before drafting `130_atomic_equipment_recipe_save.sql`
(still `EC008` at that time).

## 16. Migration applied, frontend wiring (2026-09-11)

**Migration 130 and its complete verification script both ran successfully
in E's production Supabase project** — E confirmed no SQL error occurred,
meaning every assertion in `backend/supabase/migration_130_recipe_save_tests.sql`
passed and zero sections were skipped.

**Frontend wiring completed this pass** (`src/persistence.ts`):
`saveDeviceRecipes` no longer performs the old per-recipe sequence of
separate PATCH/INSERT/upsert/delete PostgREST requests plus two upfront
preflight lookups. It now calls `rpc/save_equipment_recipe` exactly once
per recipe, in the same sequential, stop-at-the-first-failure loop as
before (per-recipe atomicity, §3 Option A, unchanged):
- An existing recipe sends its real `equipmentTypeId` as
  `p_equipment_type_id`, so the RPC updates that exact row rather than
  re-resolving by name — this is what closes the rename-creates-a-
  duplicate risk §4 flagged. A new recipe sends `null`.
- Every RPC response is converted via `mapSaveEquipmentRecipeResult` (the
  imageUrl null/undefined mapper from the second correction round) into a
  real `BuildRecipe`, and `saveDeviceRecipes` now returns the array of
  saved recipes (previously `Promise<void>`) instead of discarding them.
- The caller (`src/main.tsx`'s debounce-save effect) uses that return
  value to backfill a newly created recipe's real `equipmentTypeId` into
  local React state — the one field that changes, applied only when it
  actually changed, so this can't loop the debounce-save effect forever.
- A non-2xx RPC response is logged in full (status + body: `message`/
  `code`/`details`/`hint`) via `console.error`, then only the existing
  plain message (`"Some equipment recipes could not be saved."`) is
  thrown to the caller — same convention as every other checked write in
  this file.
- Regression tests rewritten (`src/device-recipes-write-verification.test.ts`):
  the old suite tested the now-deleted multi-request sequence's own
  request ordering and no longer applied. The new suite covers a new
  recipe save, an existing recipe save, a renamed recipe save (name sent
  alongside the existing id), an RPC failure (plain error + logged
  detail), and a multiple-recipe save (one RPC call per recipe, in order,
  stopping at the first failure).

**Explicitly deferred, not attempted this pass**: the two-session
concurrency verification (the test script's Section 16; the proposed
Node.js `pg`-based harness). Still a documented decision point, not a
step that was skipped by mistake.

What remained before this pass and is now done: E's review and go-ahead,
running the migration and its test script, and the frontend change
described above. What remains open: the two-session concurrency check
(deferred by explicit instruction), and the Project BOM RPC
(`PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md`, still design-only, starts
at `EC017`).
