-- Migration 130: atomic, per-recipe-safe Equipment Recipe save.
--
-- Fixes the reliability gap documented in
-- PRODUCT_EQUIPMENT_RECIPE_ATOMIC_SAVE_PLAN.md: saveDeviceRecipes
-- (src/persistence.ts) saves each recipe as several separate,
-- independently-committing PostgREST requests (an equipment_types
-- PATCH-or-INSERT, then an equipment_bom_components upsert, a lookup, and
-- a conditional DELETE). The 2026-09-11 client-side fix made every one of
-- those checked and added two preflight validations (unresolved/ambiguous
-- component names, a duplicate component within one recipe), but could not
-- make any of it atomic without a real transaction.
--
-- Decisions confirmed by E before this migration was drafted:
--   1. Role access: warehouse and workspace administrators.
--   2. Atomicity: save each recipe atomically and independently -- one
--      broken recipe must not prevent unrelated recipes from saving. This
--      migration implements exactly one recipe per call
--      (save_equipment_recipe(...)); the whole multi-recipe batch is
--      deliberately not atomic.
--
-- REVISION NOTE (this file, second draft -- corrects six issues found in
-- review of the first draft, which was never run against any database):
--   1. min(id)/count(*) on inventory_items.id (a uuid column) is replaced
--      everywhere with array_agg(id) + array_length/first-element reads.
--      Whether a given Postgres build even provides a MIN/MAX aggregate
--      for uuid is version-dependent -- array_agg has no such risk (it
--      works for any type, no ordering operator class required), so the
--      migration cannot install cleanly and then fail on its first real
--      call for a reason unrelated to the data.
--   2. The authorization check called is_app_admin(auth.uid()) -- the
--      LEGACY GLOBAL admin system -- which does not match the decided
--      "warehouse and WORKSPACE administrators" access. Replaced with
--      public.is_workspace_admin(v_caller_workspace_id) (migration 115,
--      already hardened, already granted to authenticated), scoped to the
--      caller's resolved workspace, exactly as decided. See the comment
--      at that check below for why today's real production admin remains
--      authorized under this change, not just in theory.
--   3. Structural validation added before any write: p_components must be
--      a JSON array (an object/scalar/JSON null now raises a controlled
--      EC011, not a raw jsonb_array_elements error); p_retired must not be
--      null; p_equipment_name is trimmed ONCE into v_equipment_name and
--      that trimmed value is used consistently for the advisory lock, the
--      name lookup, and the stored row -- not the raw parameter in some
--      places and a trimmed copy in others; a component quantity that is
--      NaN, Infinity, -Infinity, or too large to fit numeric(12,2) now
--      raises a controlled error instead of either passing a `> 0` check
--      that NaN/Infinity can spuriously satisfy (Postgres numeric NaN
--      sorts as larger than any real number) or reaching the column's own
--      constraint as a raw, uncontrolled error partway through a write.
--   4. The advisory lock now uses hashtextextended(text, seed) -- a real
--      64-bit hash -- instead of hashtext()'s 32-bit one, for a much
--      lower collision probability. Note for the record: this is NOT
--      copied from an existing migration in this repo -- the one other
--      advisory-lock use here (migration 124's admin-revoke lock) still
--      uses plain 32-bit hashtext() on a single fixed literal key (safe
--      there specifically because it is one shared key, not one derived
--      per-recipe-name the way this migration's is). This migration
--      introduces the stronger 64-bit variant for its own per-name lock
--      because a real collision here, however unlikely, would only cause
--      two unrelated recipes to serialize against each other -- harmless
--      temporary blocking, not a correctness bug -- but there is no reason
--      to accept even that when a 64-bit hash is a one-function swap.
--   5. The returned JSON is changed to match BuildRecipe's actual frontend
--      shape directly (equipmentTypeId/name/outputName/description/
--      imageUrl/retired/components: [{itemName, qty}]) instead of
--      database column names and bare ids with no item names -- the
--      original shape could not have been consumed by saveDeviceRecipes/
--      BuildRecipe without a separate, unwritten mapping layer.
--   6. EC008 is no longer "the next free code" for any other future RPC:
--      this migration claims EC008-EC016. PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md
--      and HANDOFF.md are updated in this same pass to say the Project BOM
--      RPC starts at EC017 once it is actually drafted -- re-verify this
--      again at that time in case anything else has shipped by then.
--
-- Precedent: same shape as migration 127's create_project_from_quote --
-- one security-definer function, `set search_path = ''`, every table
-- reference schema-qualified, resolve_caller_workspace_id() for caller
-- workspace resolution (never the unhardened has_role()), stable EC0xx
-- codes, FOR UPDATE / advisory-lock concurrency safety.
--
-- Component validation is done with plain PL/pgSQL arrays and a FOR loop
-- over jsonb_array_elements(), not a temporary table -- this function will
-- be called on every single recipe save, and CREATE TEMPORARY TABLE inside
-- a hot, frequently-invoked plpgsql function is a known rough edge
-- (catalog churn on every call, and plan-cache invalidation risk across
-- invocations within the same session/pooled connection). Recipes have at
-- most a few dozen components, so the O(n^2) duplicate-id check below is
-- negligible in practice and far simpler/safer than the temp-table
-- alternative.
--
-- equipment_types has no workspace_id column (same situation `projects`
-- was in before migration 117) -- active_workspace_id() (migration 124) is
-- used as the explicitly temporary fail-closed single-workspace guard,
-- exactly as PRODUCT_PROJECT_BOM_ATOMIC_REPLACE_PLAN.md's still-undrafted
-- sibling design also calls for. This must be replaced with a real
-- per-recipe workspace check before a second workspace is ever allowed to
-- exist -- shipping this now does not remove that future requirement.
--
-- Schema facts this migration relies on (re-verified directly against
-- backend/supabase/migrations/003_manufacturing_inventory_controls.sql,
-- 020_phase10_equipment_recipes_cutover.sql, and
-- 115_workspaces_foundation.sql, not assumed):
--   - equipment_types.equipment_name has a real unique index (migration
--     020) -- the natural key an id-less save falls back to.
--   - equipment_bom_components.inventory_item_id is NOT NULL and
--     (equipment_type_id, inventory_item_id) is a real unique constraint --
--     component reconciliation is a natural-key upsert, not an
--     id-preservation problem (unlike project_bom_lines).
--   - Nothing references equipment_bom_components.id, so a component row
--     can be safely deleted and reinserted for the same
--     (equipment_type_id, inventory_item_id) pair. equipment_types.id IS
--     referenced (inventory_transactions, build_transactions,
--     product_catalog) -- an existing recipe's id must be preserved across
--     a save, which this migration does via p_equipment_type_id.
--   - equipment_types.equipment_number is a real NOT NULL UNIQUE column
--     with no product-facing meaning anywhere (confirmed: zero references
--     in src/main.tsx) -- generated server-side on insert here instead of
--     trusting the client's Date.now()-based scheme.
--   - public.is_workspace_admin(check_workspace_id uuid) (migration 115)
--     checks workspace_members.is_workspace_admin for auth.uid() against
--     the given workspace id -- already security definer, already
--     `set search_path=''`, already granted to authenticated (migration
--     125 confirmed it is NOT granted to anon). This is the correct,
--     already-hardened helper for a workspace-scoped admin check -- not a
--     new join to invent.
--   - workspace_members.is_workspace_admin was backfilled directly from
--     the then-current app_admins table for every existing admin
--     (migration 115, already applied in production), and every admin
--     grant/revoke through the app today is already routed through
--     bridge_grant_admin()/bridge_revoke_admin() (migration 124), which
--     keep workspace_members.is_workspace_admin in sync going forward --
--     confirmed directly in src/persistence.ts (grantAdmin/revokeAdmin
--     call rpc/bridge_grant_admin and rpc/bridge_revoke_admin, not a raw
--     write to app_admins). A real, current production admin is therefore
--     already a workspace_members row with is_workspace_admin = true, not
--     merely an app_admins row this migration would newly fail to
--     recognize.
--
-- A real, previously-undocumented bug this migration closes going forward
-- (flagged in the design document, not fixed by the 2026-09-11 client-side
-- pass because it's a data-modeling gap, not an unchecked-response one):
-- saveDeviceRecipes resolves an existing recipe by equipment_name, so
-- renaming a recipe in local state before saving created a DUPLICATE row
-- under the new name and left the original untouched. This function
-- accepts an optional stable p_equipment_type_id specifically to close
-- this. BuildRecipe/loadDeviceRecipes are updated in this same pass to
-- carry a stable equipmentTypeId end to end (see src/persistence.ts) --
-- saveDeviceRecipes itself is NOT yet wired to call this RPC; that is a
-- separate, later step.
--
-- Do not run this migration until E has reviewed the accompanying test
-- script (backend/supabase/migration_130_recipe_save_tests.sql) and this
-- file.

begin;

-- ============================================================
-- Section 1 -- the atomic, per-recipe-safe save function.
-- ============================================================

create or replace function public.save_equipment_recipe(
  p_equipment_type_id uuid,          -- nullable: existing recipe's real id, if known
  p_equipment_name text,             -- required
  p_description text,                -- nullable
  p_image_url text,                  -- nullable
  p_retired boolean,                 -- required (matches BuildRecipe.retired ?? false from the caller)
  p_output_inventory_item_id uuid,   -- nullable: preferred, stable output-item id
  p_output_item_name text,           -- nullable: fallback output-item name (tolerant, see below)
  p_components jsonb                 -- array of { item_name text, quantity_required numeric, line_sort int? }, in display order
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_workspace_id uuid;
  v_equipment_name text;
  v_equipment_type_id uuid;
  v_resolved_output_item_id uuid;
  v_output_match_ids uuid[];
  v_recipe_json jsonb;

  -- Component parsing/validation working arrays, index-aligned with each
  -- other and with the incoming p_components array order.
  v_raw_elem record;
  v_item_names text[] := array[]::text[];
  v_quantities numeric[] := array[]::numeric[];
  v_line_sorts int[] := array[]::int[];
  v_parsed_item_name text;
  v_parsed_qty numeric;
  v_parsed_sort int;

  v_resolved_ids uuid[] := array[]::uuid[];
  v_unresolved_names text[] := array[]::text[];
  v_ambiguous_names text[] := array[]::text[];
  v_duplicate_names text[] := array[]::text[];
  v_match_ids uuid[];
  v_match_count int;
  v_component_count int;
  v_i int;
  v_j int;
  v_constraint_name text;
begin
  -- --------------------------------------------------------
  -- Step 1: fail closed on the temporary single-workspace assumption.
  -- Separate from the caller-authorization step below -- this guards
  -- against the function ever running against ambiguous multi-workspace
  -- state before Phase 3 exists, even if every other check would pass.
  -- --------------------------------------------------------
  begin
    perform public.active_workspace_id();
  exception when sqlstate 'P0001' then
    raise exception 'This action is not available right now. Contact an administrator.' using errcode = 'EC008';
  end;

  -- --------------------------------------------------------
  -- Step 2: resolve the caller's workspace, then check role.
  -- resolve_caller_workspace_id() (migration 117) is itself hardened
  -- (set search_path=''), so it's safe to call here -- unlike has_role(),
  -- which is NOT hardened and is deliberately not called from this
  -- function.
  --
  -- CORRECTED (review): the decided access is "warehouse and WORKSPACE
  -- administrators" -- the first draft checked is_app_admin(auth.uid()),
  -- the LEGACY GLOBAL admin system, which is a different, wrong gate (it
  -- would authorize a global admin who has never been added to this
  -- specific workspace's admin flag, and has no connection to "workspace"
  -- authorization at all). public.is_workspace_admin(check_workspace_id)
  -- (migration 115) is the correct, already-hardened, workspace-scoped
  -- helper -- checks workspace_members.is_workspace_admin for auth.uid()
  -- against the given workspace, already granted to authenticated, not
  -- granted to anon (migration 125). Role check for 'warehouse' still
  -- uses the workspace_member_roles join (migration 127's own precedent),
  -- not a direct has_role() call.
  -- --------------------------------------------------------
  begin
    v_caller_workspace_id := public.resolve_caller_workspace_id();
  exception when sqlstate 'P0001' then
    raise exception 'Your workspace access is unavailable or ambiguous. Contact an administrator.' using errcode = 'EC007';
  end;

  if not (
    public.is_workspace_admin(v_caller_workspace_id)
    or exists (
      select 1
      from public.workspace_member_roles wmr
      join public.workspace_members wm on wm.id = wmr.workspace_member_id
      where wm.user_id = auth.uid()
        and wm.workspace_id = v_caller_workspace_id
        and wmr.role_key = 'warehouse'
    )
  ) then
    raise exception 'Only a warehouse team member or workspace administrator may save an equipment recipe.' using errcode = 'EC009';
  end if;

  -- --------------------------------------------------------
  -- Step 3: basic recipe-level validation, before anything else runs.
  -- CORRECTED (review): the name is trimmed ONCE here into v_equipment_name,
  -- which is used for every downstream purpose (the advisory lock, the
  -- name lookup, and the stored row) -- the first draft trimmed only for
  -- this emptiness check and used the raw, untrimmed p_equipment_name
  -- everywhere else, so trailing/leading whitespace could desync the lock
  -- key from the actual stored name.
  -- --------------------------------------------------------
  if p_equipment_name is null or length(trim(p_equipment_name)) = 0 then
    raise exception 'This recipe needs a name before it can be saved.' using errcode = 'EC011';
  end if;
  v_equipment_name := trim(p_equipment_name);

  if p_retired is null then
    raise exception 'This recipe''s retired flag is missing.' using errcode = 'EC011';
  end if;

  -- CORRECTED (review): p_components must be a real, explicit JSON array
  -- -- SQL NULL (the parameter omitted/absent entirely) is now ALSO
  -- rejected, not silently treated as "no components." The first draft
  -- coalesced a SQL-NULL p_components to '[]', on the theory that a
  -- brand-new recipe with nothing added yet is a real case -- but that
  -- reasoning conflated "the caller explicitly sent an empty list" (a
  -- real, deliberate "clear everything" instruction, still accepted
  -- below) with "the caller sent nothing at all," which is exactly the
  -- shape of an accidental omission (a bad frontend build, a dropped
  -- field, a stale call site) that could silently wipe an EXISTING
  -- recipe's real components. Only an explicit JSON array -- including an
  -- explicit '[]' -- is accepted; SQL NULL, JSON null
  -- (jsonb_typeof('null'::jsonb) = 'null', a string, distinct from the
  -- parameter itself being SQL NULL), an object, a string, a number, and
  -- a boolean are all rejected here, before jsonb_array_elements() below
  -- would otherwise raise its own raw, uncontrolled error for the
  -- non-array cases (jsonb_array_elements(NULL) itself just returns zero
  -- rows rather than erroring, which is precisely why SQL NULL needed an
  -- explicit check here rather than relying on that call to catch it).
  if p_components is null or jsonb_typeof(p_components) is distinct from 'array' then
    raise exception 'This recipe''s component list must be an explicit list, not missing, null, or a single value/object.' using errcode = 'EC011';
  end if;

  -- --------------------------------------------------------
  -- Step 4: concurrency. Always take the advisory lock on the name first
  -- -- cheap, and it's the only mechanism available for the "genuinely
  -- new" case (there is no row yet to take a row lock on). If a real row
  -- already exists (by id, or by name for a caller with no stable id
  -- yet), the SELECT ... FOR UPDATE below additionally serializes
  -- concurrent saves of that exact recipe.
  --
  -- CORRECTED (review): uses hashtextextended(text, seed), a real 64-bit
  -- hash, instead of hashtext()'s 32-bit one -- a materially lower
  -- collision probability. Two DIFFERENT recipe names are not guaranteed
  -- to never contend -- a hashed key can theoretically collide for two
  -- different inputs, same as any hash-based lock -- but a collision here
  -- only causes harmless temporary blocking (one save briefly waits on an
  -- unrelated one), never an incorrect result, since the actual identity
  -- check (equipment_name's real unique index, or the row's real id) is
  -- what determines correctness, not the lock key itself.
  -- --------------------------------------------------------
  perform pg_advisory_xact_lock(hashtextextended('equipment_type:' || v_equipment_name, 0));

  if p_equipment_type_id is not null then
    select id into v_equipment_type_id from public.equipment_types where id = p_equipment_type_id for update;
    if not found then
      raise exception 'This recipe could not be found -- it may have been deleted.' using errcode = 'EC010';
    end if;
  else
    -- No stable id supplied: fall back to resolving by equipment_name,
    -- exactly as saveDeviceRecipes does today (safe because the name is
    -- genuinely unique, migration 020). Stays null (genuinely new) if no
    -- row matches either.
    select id into v_equipment_type_id from public.equipment_types where equipment_name = v_equipment_name for update;
  end if;

  -- --------------------------------------------------------
  -- Step 5: parse and structurally validate every component, before any
  -- resolution or write. Each element is parsed in its own nested
  -- exception block so a single malformed entry (wrong JSON type) is
  -- reported as a controlled rejection, not a raw cast error.
  -- --------------------------------------------------------
  -- No coalesce needed here -- Step 3 above already guarantees p_components
  -- is a real, non-null JSON array by this point (SQL NULL was rejected
  -- there, not silently substituted with '[]').
  for v_raw_elem in
    select ord, elem from jsonb_array_elements(p_components) with ordinality as t(elem, ord)
  loop
    begin
      v_parsed_item_name := nullif(trim(v_raw_elem.elem->>'item_name'), '');
      v_parsed_qty := (v_raw_elem.elem->>'quantity_required')::numeric;
      v_parsed_sort := coalesce((v_raw_elem.elem->>'line_sort')::int, (v_raw_elem.ord - 1)::int);
    exception when others then
      raise exception 'This recipe''s component list is malformed and could not be read.' using errcode = 'EC011';
    end;

    if v_parsed_item_name is null then
      raise exception 'This recipe''s component list is malformed and could not be read.' using errcode = 'EC011';
    end if;

    -- CORRECTED (review): a `> 0` comparison alone does not reject NaN or
    -- Infinity -- Postgres numeric NaN sorts as larger than any real
    -- number, so `'NaN'::numeric > 0` is TRUE, and (on a Postgres version
    -- that accepts numeric Infinity at all) `'Infinity'::numeric > 0` is
    -- also TRUE. Both would otherwise reach the equipment_bom_components
    -- INSERT below and fail there with a raw, uncontrolled overflow
    -- error, or worse, silently pass this check entirely. Checked via the
    -- value's own text representation, which is always safe to compute
    -- (the numeric value already exists in memory at this point,
    -- regardless of which Postgres version is running) -- this does not
    -- introduce a new cast that could itself fail on an older version.
    -- Also rejects a magnitude too large for numeric(12,2) (10 digits
    -- before the decimal point, 2 after) with a controlled message
    -- instead of a raw column-overflow error.
    if v_parsed_qty is null or v_parsed_qty <= 0 then
      raise exception 'Every component must have a quantity greater than zero.' using errcode = 'EC011';
    end if;
    if v_parsed_qty::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Every component must have a valid, finite quantity.' using errcode = 'EC011';
    end if;
    if v_parsed_qty >= 10000000000 then
      raise exception 'This component''s quantity is too large to be saved.' using errcode = 'EC011';
    end if;

    v_item_names := array_append(v_item_names, v_parsed_item_name);
    v_quantities := array_append(v_quantities, v_parsed_qty);
    v_line_sorts := array_append(v_line_sorts, v_parsed_sort);
  end loop;

  v_component_count := coalesce(array_length(v_item_names, 1), 0);

  -- --------------------------------------------------------
  -- Step 6: resolve each component's item_name to a real inventory_items
  -- row. Reject the whole call (not just the affected component) on any
  -- unresolved or ambiguous name -- existing recipe, if any, stays
  -- unchanged, matching the deployed client-side fix's own stance.
  --
  -- CORRECTED (review): uses array_agg(id) + array_length/first-element,
  -- not count(*)/min(id) -- whether a given Postgres build even provides
  -- a MIN/MAX aggregate for the uuid type is version-dependent, and this
  -- migration must not install cleanly only to fail on its first real
  -- call for a reason unrelated to the data. array_agg has no such risk.
  -- --------------------------------------------------------
  for v_i in 1 .. v_component_count loop
    select array_agg(id) into v_match_ids
    from public.inventory_items where item_name = v_item_names[v_i];
    v_match_count := coalesce(array_length(v_match_ids, 1), 0);

    if v_match_count = 0 then
      v_unresolved_names := array_append(v_unresolved_names, v_item_names[v_i]);
    elsif v_match_count > 1 then
      v_ambiguous_names := array_append(v_ambiguous_names, v_item_names[v_i]);
    else
      v_resolved_ids := array_append(v_resolved_ids, v_match_ids[1]);
    end if;
  end loop;

  if array_length(v_unresolved_names, 1) > 0 then
    raise exception 'This recipe could not be saved -- these components do not match any catalog item: %.', array_to_string(v_unresolved_names, ', ') using errcode = 'EC012';
  end if;
  if array_length(v_ambiguous_names, 1) > 0 then
    raise exception 'This recipe could not be saved -- these component names match more than one catalog item: %.', array_to_string(v_ambiguous_names, ', ') using errcode = 'EC013';
  end if;

  -- v_resolved_ids is now guaranteed the same length as v_item_names/
  -- v_quantities/v_line_sorts, in the same order (every component either
  -- raised above, or resolved to exactly one real inventory_item_id).

  -- Two entries resolving to the same inventory_item_id -- whether from
  -- identical names or two different names pointing at the same catalog
  -- row -- would violate the (equipment_type_id, inventory_item_id)
  -- unique constraint on the upsert below. Never silently combined or
  -- picked; that's a business-behavior decision, not made here, matching
  -- the deployed client-side fix's own stance. O(n^2), fine for a
  -- recipe's realistic component count.
  for v_i in 1 .. v_component_count loop
    for v_j in (v_i + 1) .. v_component_count loop
      if v_resolved_ids[v_i] = v_resolved_ids[v_j] then
        v_duplicate_names := array_append(
          v_duplicate_names,
          case when v_item_names[v_i] = v_item_names[v_j]
            then v_item_names[v_i]
            else v_item_names[v_i] || ' / ' || v_item_names[v_j]
          end
        );
      end if;
    end loop;
  end loop;

  if array_length(v_duplicate_names, 1) > 0 then
    raise exception 'This recipe could not be saved -- these components are listed more than once, or resolve to the same catalog item: %.', array_to_string(v_duplicate_names, ', ') using errcode = 'EC014';
  end if;

  -- --------------------------------------------------------
  -- Step 7: output-item resolution. Deliberately tolerant, unlike
  -- component resolution above -- a recipe's own components failing to
  -- resolve blocks the save because the recipe would be functionally
  -- wrong without them; a recipe's output link failing to resolve does
  -- not block the save, matching the existing, already-approved product
  -- behavior this design explicitly does not change. A client-supplied
  -- STABLE id is untrusted input and is verified -- unlike the name
  -- fallback, an invalid stable id is a hard rejection, not tolerated.
  -- Also array_agg-based, same reasoning as Step 6.
  -- --------------------------------------------------------
  if p_output_inventory_item_id is not null then
    if not exists (select 1 from public.inventory_items where id = p_output_inventory_item_id) then
      raise exception 'This recipe''s output item could not be found -- it may have been deleted.' using errcode = 'EC015';
    end if;
    v_resolved_output_item_id := p_output_inventory_item_id;
  elsif p_output_item_name is not null and length(trim(p_output_item_name)) > 0 then
    select array_agg(id) into v_output_match_ids
    from public.inventory_items where item_name = trim(p_output_item_name);
    if coalesce(array_length(v_output_match_ids, 1), 0) = 1 then
      v_resolved_output_item_id := v_output_match_ids[1];
    else
      v_resolved_output_item_id := null;
    end if;
  else
    v_resolved_output_item_id := null;
  end if;

  -- --------------------------------------------------------
  -- Step 8: upsert the equipment_types row itself.
  -- --------------------------------------------------------
  if v_equipment_type_id is not null then
    begin
      update public.equipment_types
      set
        equipment_name = v_equipment_name,
        description = nullif(p_description, ''),
        image_url = nullif(p_image_url, ''),
        output_inventory_item_id = v_resolved_output_item_id,
        is_retired = p_retired,
        retired_at = case when p_retired then now() else null end,
        updated_at = now()
      where id = v_equipment_type_id;
    exception when unique_violation then
      -- Distinguish which constraint actually fired (matching migration
      -- 127's own precedent) rather than assuming it's always the name --
      -- equipment_number is server-generated above and its collision is
      -- astronomically unlikely, but the message must stay accurate
      -- either way, not just in the common case.
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'idx_equipment_types_equipment_name' then
        raise exception 'Another recipe already uses the name "%". Choose a different name.', v_equipment_name using errcode = 'EC016';
      end if;
      raise exception 'This recipe could not be saved due to a conflicting record. Try again.' using errcode = 'EC016';
    end;
  else
    begin
      insert into public.equipment_types (
        equipment_number, equipment_name, description, image_url,
        output_inventory_item_id, is_retired, retired_at
      ) values (
        -- No product-facing meaning anywhere in the app (confirmed: zero
        -- references in src/main.tsx) -- generated here instead of
        -- trusting a client-supplied value for a purely internal column.
        'EQ-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
        v_equipment_name, nullif(p_description, ''), nullif(p_image_url, ''),
        v_resolved_output_item_id, p_retired, case when p_retired then now() else null end
      )
      returning id into v_equipment_type_id;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'idx_equipment_types_equipment_name' then
        raise exception 'Another recipe already uses the name "%". Choose a different name.', v_equipment_name using errcode = 'EC016';
      end if;
      raise exception 'This recipe could not be saved due to a conflicting record. Try again.' using errcode = 'EC016';
    end;
  end if;

  -- --------------------------------------------------------
  -- Step 9: reconcile equipment_bom_components -- natural-key upsert
  -- (equipment_type_id, inventory_item_id), then delete only the
  -- components no longer present in this call. Never a blanket delete
  -- first. An empty p_components deliberately clears every existing
  -- component for this recipe (a real "recipe now has zero components"
  -- case, not an error).
  -- --------------------------------------------------------
  for v_i in 1 .. v_component_count loop
    insert into public.equipment_bom_components (equipment_type_id, inventory_item_id, quantity_required, line_sort, is_active)
    values (v_equipment_type_id, v_resolved_ids[v_i], v_quantities[v_i], v_line_sorts[v_i], true)
    on conflict (equipment_type_id, inventory_item_id) do update
      set quantity_required = excluded.quantity_required,
          line_sort = excluded.line_sort,
          is_active = true;
  end loop;

  delete from public.equipment_bom_components
  where equipment_type_id = v_equipment_type_id
    and inventory_item_id <> all(coalesce(v_resolved_ids, array[]::uuid[]));

  -- --------------------------------------------------------
  -- Step 10: return the full saved recipe in BuildRecipe's OWN frontend
  -- shape (camelCase, item NAMES not bare ids) -- not just counts, and not
  -- database column names the frontend would need an unwritten mapping
  -- layer to consume. outputName falls back to the recipe's own name when
  -- there is no resolved output item, mirroring mapEquipmentTypeRow's
  -- existing `row.output_item?.item_name ?? row.equipment_name` behavior
  -- exactly -- this is not a new fallback invented here.
  -- --------------------------------------------------------
  select jsonb_build_object(
    'equipmentTypeId', et.id,
    'name', et.equipment_name,
    'outputName', coalesce(oi.item_name, et.equipment_name),
    'description', coalesce(et.description, ''),
    'imageUrl', et.image_url,
    'retired', et.is_retired,
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemName', ii.item_name,
        'qty', ebc.quantity_required
      ) order by ebc.line_sort)
      from public.equipment_bom_components ebc
      join public.inventory_items ii on ii.id = ebc.inventory_item_id
      where ebc.equipment_type_id = et.id and ebc.is_active
    ), '[]'::jsonb)
  )
  into v_recipe_json
  from public.equipment_types et
  left join public.inventory_items oi on oi.id = et.output_inventory_item_id
  where et.id = v_equipment_type_id;

  return v_recipe_json;
end;
$$;

revoke all on function public.save_equipment_recipe(uuid, text, text, text, boolean, uuid, text, jsonb) from public;
revoke execute on function public.save_equipment_recipe(uuid, text, text, text, boolean, uuid, text, jsonb) from anon;
grant execute on function public.save_equipment_recipe(uuid, text, text, text, boolean, uuid, text, jsonb) to authenticated;

commit;
