-- Phase 3, Stage 5 (workspace-scoped uniqueness, reports, aggregates,
-- functions, triggers, and remaining indirect access paths) -- second
-- migration of this stage, same 2026-09-16 standing authorization as
-- migrations 155-163. Closes the "workspace-scoped uniqueness" gap
-- found during Stage 5's scoping pass (PRODUCT_MASTER_COMPLETION_PLAN.md
-- §11): a set of columns that already live on a workspace-scoped table
-- (real, NOT NULL, trigger-protected `workspace_id`, migrations
-- 117/156/159) still carry a GLOBAL unique constraint/index from their
-- origin migration, untouched since. Once a second workspace exists,
-- this is a real bug: workspace B's own quote ref/SKU/vendor name/etc.
-- would collide with workspace A's identical value and be rejected, or
-- (for the two auto-generated ref sequences) workspace B would silently
-- continue workspace A's own sequence rather than starting its own.
--
-- Every fact below (constraint/index names, current live function
-- bodies) was independently re-confirmed directly against this repo's
-- migration history before writing this file, not assumed from a
-- planning doc or memory:
--
--   1. `clients.name` -- inline `unique` at table creation (migration
--      102), still live as default-named `clients_name_key`.
--   2. `projects.project_name` -- inline `unique` at table creation
--      (migration 001), still live as default-named
--      `projects_project_name_key`.
--   3. `projects.project_number` -- a separate PARTIAL unique INDEX
--      (migration 002, `idx_projects_project_number`, `where
--      project_number is not null`), still live unchanged.
--   4. `vendors.name` -- inline `unique` (migration 001), still live as
--      `vendors_name_key`.
--   5. `inventory_items.sku` -- inline `unique` (migration 001), still
--      live as `inventory_items_sku_key`.
--   6. `purchase_orders.po_number` -- inline `unique` (migration 001),
--      still live as `purchase_orders_po_number_key`.
--   7. `purchase_requests.request_number` -- inline `unique` (migration
--      005), still live as `purchase_requests_request_number_key`.
--   8. `sales_quotes.quote_ref` -- an explicitly named constraint added
--      later (migration 066, `sales_quotes_quote_ref_unique`), still
--      live unchanged.
--   9. `equipment_types.equipment_name` -- a separate unique INDEX added
--      later (migration 020, `idx_equipment_types_equipment_name`,
--      after the column itself was NOT unique at table creation), still
--      live unchanged. `save_equipment_recipe()` (migration 130, latest
--      def 159) hardcodes this exact index name to detect a duplicate-
--      name violation and translate it into its own EC016 error message
--      -- Section 4 below carries that function forward verbatim with
--      only the one string literal updated, in the same migration that
--      renames the index, so the two never drift out of sync.
--
-- Each of these 7 tables' `workspace_id` column is already real, NOT
-- NULL, and trigger-protected (`guard_workspace_id_mutation()`,
-- migration 117) -- no backfill or trigger work needed here, only the
-- constraint swap itself. Confirmed, not assumed: today's single-
-- workspace production data makes every one of these swaps a guaranteed
-- no-op validation (workspace_id is constant across every existing row
-- of a given table, so composite (workspace_id, col) uniqueness is
-- implied by the existing bare unique constraint on col alone).
--
-- Also closes the matching ref-counter gap flagged alongside it by the
-- same scoping pass: `sales_quote_ref_counters`/`project_ref_counters`
-- (migrations 066/067) are `year primary key` only -- genuinely global,
-- calendar-year-keyed, shared by every workspace today. Section 1/2
-- below add a real `workspace_id` column (backfilled to this database's
-- one existing workspace, same three-step shape as every other Stage
-- 1-4 workspace_id rollout), fold it into a new composite primary key
-- `(workspace_id, year)`, and rewrite `assign_sales_quote_ref()`/
-- `assign_project_ref()` (latest live bodies: migration 066 and
-- migration 128 respectively, both re-read directly from source before
-- writing this) to resolve and key by the CALLER's own workspace. Both
-- are BEFORE INSERT trigger functions on the same table as
-- `guard_workspace_id_mutation()` (migration 117's
-- `sales_quotes_guard_workspace_id` / migration 156's
-- `projects_guard_workspace_id`) -- Postgres fires same-timing/same-
-- event triggers on a table in alphabetical order by trigger name, and
-- `..._assign_ref` sorts before `..._guard_workspace_id`, so these
-- functions cannot rely on `new.workspace_id` already being set by the
-- other trigger. Each resolves the caller's workspace itself via the
-- exact same `resolve_caller_workspace_id()` (migration 117) the guard
-- trigger itself calls, so correctness never depends on trigger
-- execution order at all. `assign_sales_quote_ref()` was never
-- previously hardened the way migration 128 hardened
-- `assign_project_ref()` (no `public.` qualification, no
-- `set search_path`, no revoked grants) -- brought up to the same
-- standard here as a direct byproduct of rewriting its body anyway, not
-- separate scope creep.
--
-- Deliberately NOT done by this migration -- each is its own separate
-- decision or migration, not bundled here:
--   - `project_documents.document_number` (also flagged by the Stage 5
--     scoping pass) -- this table has NO `workspace_id` column at all
--     today (confirmed: it has three nullable FK anchors --
--     `project_id`/`purchase_order_id`/`purchase_request_id` -- and is
--     scoped only indirectly, at query time, via
--     `project_document_owner_workspace_id()`, migration 161). A
--     composite unique constraint needs a real, stored column to key
--     on, which a stateless resolver function cannot provide (Postgres
--     requires an index expression to be IMMUTABLE, and this resolver
--     is not -- it depends on other tables' current, mutable state).
--     Adding a brand-new NOT NULL column plus its own derivation
--     trigger to this specific table is a real schema-design decision
--     (which anchor wins when more than one is set; whether to mirror
--     migration 162's channel-specific derivation trigger instead of
--     the generic guard), not a mechanical constraint swap like the
--     nine above -- left for its own reviewed migration.
--   - `equipment_types.equipment_number` -- already flagged as global
--     too, but server-generated and non-product-facing; the master plan
--     explicitly named it low priority and deferred it. Unchanged here.
--   - The three report views, `deletion_log`, storage bucket policies,
--     and the `notification_rules`/etc. governance question -- all
--     separately tracked in `PRODUCT_MASTER_COMPLETION_PLAN.md` §11,
--     none touched by this migration.
--
-- Confirm 164 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- Ref-counter tables: add workspace_id, backfill to this
-- database's one existing workspace, assert no nulls remain, then fold
-- into a new composite primary key. Same three-step backfill shape as
-- migrations 156/159/161 (nullable column -> backfill -> assert -> lock
-- down), condensed since both tables here have no anchor to prefer over
-- the single-workspace fallback (they are standalone counters, not
-- owned by any other row).
-- ============================================================

alter table public.sales_quote_ref_counters
  add column if not exists workspace_id uuid references public.workspaces(id);

alter table public.project_ref_counters
  add column if not exists workspace_id uuid references public.workspaces(id);

update public.sales_quote_ref_counters
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

update public.project_ref_counters
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.sales_quote_ref_counters where workspace_id is null) then
    raise exception 'backfill incomplete: sales_quote_ref_counters.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.project_ref_counters where workspace_id is null) then
    raise exception 'backfill incomplete: project_ref_counters.workspace_id still has nulls';
  end if;
end $$;

alter table public.sales_quote_ref_counters alter column workspace_id set not null;
alter table public.project_ref_counters alter column workspace_id set not null;

alter table public.sales_quote_ref_counters drop constraint sales_quote_ref_counters_pkey;
alter table public.sales_quote_ref_counters add primary key (workspace_id, year);

alter table public.project_ref_counters drop constraint project_ref_counters_pkey;
alter table public.project_ref_counters add primary key (workspace_id, year);

-- ============================================================
-- Section 2 -- assign_sales_quote_ref()/assign_project_ref(): resolve
-- and key by the caller's own workspace. Full bodies carried forward
-- from their current live definitions (migration 066 and migration 128
-- respectively) with only the workspace-resolution and counter-key
-- edits described in this file's header.
-- ============================================================

create or replace function public.assign_sales_quote_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ref_year integer := extract(year from pg_catalog.now())::integer;
  v_workspace_id uuid;
  seq integer;
begin
  if new.quote_ref is not null then
    return new;
  end if;

  v_workspace_id := public.resolve_caller_workspace_id();

  insert into public.sales_quote_ref_counters as sqrc (workspace_id, year, next_seq)
  values (v_workspace_id, ref_year, 2)
  on conflict (workspace_id, year) do update set next_seq = sqrc.next_seq + 1
  returning next_seq - 1 into seq;

  new.quote_ref := 'SQ-' || ref_year || '-' || pg_catalog.lpad(seq::text, 4, '0');
  return new;
end;
$$;

revoke all on function public.assign_sales_quote_ref() from public;
revoke execute on function public.assign_sales_quote_ref() from anon;
revoke execute on function public.assign_sales_quote_ref() from authenticated;

create or replace function public.assign_project_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ref_year integer := extract(year from pg_catalog.now())::integer;
  v_workspace_id uuid;
  seq integer;
begin
  if new.project_number is not null then
    return new;
  end if;

  v_workspace_id := public.resolve_caller_workspace_id();

  insert into public.project_ref_counters as prc (workspace_id, year, next_seq)
  values (v_workspace_id, ref_year, 2)
  on conflict (workspace_id, year) do update set next_seq = prc.next_seq + 1
  returning next_seq - 1 into seq;

  new.project_number := 'PRJ-' || ref_year || '-' || pg_catalog.lpad(seq::text, 4, '0');
  return new;
end;
$$;

revoke all on function public.assign_project_ref() from public;
revoke execute on function public.assign_project_ref() from anon;
revoke execute on function public.assign_project_ref() from authenticated;

-- ============================================================
-- Section 3 -- Workspace-scoped uniqueness on the nine flagged columns.
-- Each swap drops the existing global constraint/index and replaces it
-- with a composite (workspace_id, <column>) equivalent -- same kind
-- (constraint vs. plain unique index) and same NULL-handling (the one
-- partial index keeps its `where ... is not null` clause) as what it
-- replaces.
-- ============================================================

alter table public.clients drop constraint clients_name_key;
alter table public.clients add constraint clients_workspace_id_name_key unique (workspace_id, name);

alter table public.projects drop constraint projects_project_name_key;
alter table public.projects add constraint projects_workspace_id_project_name_key unique (workspace_id, project_name);

drop index if exists idx_projects_project_number;
create unique index idx_projects_workspace_id_project_number
  on public.projects(workspace_id, project_number)
  where project_number is not null;

alter table public.vendors drop constraint vendors_name_key;
alter table public.vendors add constraint vendors_workspace_id_name_key unique (workspace_id, name);

alter table public.inventory_items drop constraint inventory_items_sku_key;
alter table public.inventory_items add constraint inventory_items_workspace_id_sku_key unique (workspace_id, sku);

alter table public.purchase_orders drop constraint purchase_orders_po_number_key;
alter table public.purchase_orders add constraint purchase_orders_workspace_id_po_number_key unique (workspace_id, po_number);

alter table public.purchase_requests drop constraint purchase_requests_request_number_key;
alter table public.purchase_requests add constraint purchase_requests_workspace_id_request_number_key unique (workspace_id, request_number);

alter table public.sales_quotes drop constraint sales_quotes_quote_ref_unique;
alter table public.sales_quotes add constraint sales_quotes_workspace_id_quote_ref_key unique (workspace_id, quote_ref);

drop index if exists idx_equipment_types_equipment_name;
create unique index idx_equipment_types_workspace_id_equipment_name
  on public.equipment_types(workspace_id, equipment_name);

-- ============================================================
-- Section 4 -- save_equipment_recipe(): full body carried forward
-- verbatim from its current live definition (migration 159) with
-- exactly one edit, applied in both of its unique_violation handlers --
-- the hardcoded constraint/index name this function checks to
-- distinguish a duplicate-name conflict from any other conflict must
-- track Section 3's rename of the same index, in this same migration,
-- so the two can never drift out of sync.
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
  -- Step 1: resolve the caller's workspace, then check role.
  -- resolve_caller_workspace_id() (migration 117) is itself hardened
  -- (set search_path=''), so it's safe to call here -- unlike has_role(),
  -- which is NOT hardened and is deliberately not called from this
  -- function.
  --
  -- STAGE 3: this was "Step 2" in migration 130; the old "Step 1"
  -- (active_workspace_id() fail-closed guard) is removed -- see this
  -- section's header comment for why.
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
  -- Step 2: basic recipe-level validation, before anything else runs.
  -- --------------------------------------------------------
  if p_equipment_name is null or length(trim(p_equipment_name)) = 0 then
    raise exception 'This recipe needs a name before it can be saved.' using errcode = 'EC011';
  end if;
  v_equipment_name := trim(p_equipment_name);

  if p_retired is null then
    raise exception 'This recipe''s retired flag is missing.' using errcode = 'EC011';
  end if;

  if p_components is null or jsonb_typeof(p_components) is distinct from 'array' then
    raise exception 'This recipe''s component list must be an explicit list, not missing, null, or a single value/object.' using errcode = 'EC011';
  end if;

  -- --------------------------------------------------------
  -- Step 3: concurrency. Always take the advisory lock on the name first
  -- -- cheap, and it's the only mechanism available for the "genuinely
  -- new" case (there is no row yet to take a row lock on). If a real row
  -- already exists (by id, or by name for a caller with no stable id
  -- yet), the SELECT ... FOR UPDATE below additionally serializes
  -- concurrent saves of that exact recipe.
  -- --------------------------------------------------------
  perform pg_advisory_xact_lock(hashtextextended('equipment_type:' || v_equipment_name, 0));

  if p_equipment_type_id is not null then
    -- STAGE 3: added `and workspace_id = v_caller_workspace_id` -- a
    -- recipe id belonging to another workspace now resolves as
    -- not-found (EC010), same as a genuinely deleted recipe.
    select id into v_equipment_type_id from public.equipment_types where id = p_equipment_type_id and workspace_id = v_caller_workspace_id for update;
    if not found then
      raise exception 'This recipe could not be found -- it may have been deleted.' using errcode = 'EC010';
    end if;
  else
    -- No stable id supplied: fall back to resolving by equipment_name,
    -- exactly as saveDeviceRecipes does today (safe because the name is
    -- genuinely unique, migration 020).
    -- STAGE 3: added `and workspace_id = v_caller_workspace_id` -- a
    -- same-named recipe in another workspace no longer resolves as a
    -- match here (falls through to the genuinely-new insert branch).
    select id into v_equipment_type_id from public.equipment_types where equipment_name = v_equipment_name and workspace_id = v_caller_workspace_id for update;
  end if;

  -- --------------------------------------------------------
  -- Step 4: parse and structurally validate every component, before any
  -- resolution or write. Each element is parsed in its own nested
  -- exception block so a single malformed entry (wrong JSON type) is
  -- reported as a controlled rejection, not a raw cast error.
  -- --------------------------------------------------------
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
  -- Step 5: resolve each component's item_name to a real inventory_items
  -- row. Reject the whole call (not just the affected component) on any
  -- unresolved or ambiguous name -- existing recipe, if any, stays
  -- unchanged, matching the deployed client-side fix's own stance.
  -- --------------------------------------------------------
  for v_i in 1 .. v_component_count loop
    -- STAGE 3: added `and workspace_id = v_caller_workspace_id` -- a
    -- same-named item in another workspace no longer counts as a match.
    select array_agg(id) into v_match_ids
    from public.inventory_items where item_name = v_item_names[v_i] and workspace_id = v_caller_workspace_id;
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
  -- Step 6: output-item resolution. Deliberately tolerant, unlike
  -- component resolution above -- a recipe's own components failing to
  -- resolve blocks the save because the recipe would be functionally
  -- wrong without them; a recipe's output link failing to resolve does
  -- not block the save, matching the existing, already-approved product
  -- behavior this design explicitly does not change. A client-supplied
  -- STABLE id is untrusted input and is verified -- unlike the name
  -- fallback, an invalid stable id is a hard rejection, not tolerated.
  -- --------------------------------------------------------
  if p_output_inventory_item_id is not null then
    -- STAGE 3: added `and workspace_id = v_caller_workspace_id`.
    if not exists (select 1 from public.inventory_items where id = p_output_inventory_item_id and workspace_id = v_caller_workspace_id) then
      raise exception 'This recipe''s output item could not be found -- it may have been deleted.' using errcode = 'EC015';
    end if;
    v_resolved_output_item_id := p_output_inventory_item_id;
  elsif p_output_item_name is not null and length(trim(p_output_item_name)) > 0 then
    -- STAGE 3: added `and workspace_id = v_caller_workspace_id`.
    select array_agg(id) into v_output_match_ids
    from public.inventory_items where item_name = trim(p_output_item_name) and workspace_id = v_caller_workspace_id;
    if coalesce(array_length(v_output_match_ids, 1), 0) = 1 then
      v_resolved_output_item_id := v_output_match_ids[1];
    else
      v_resolved_output_item_id := null;
    end if;
  else
    v_resolved_output_item_id := null;
  end if;

  -- --------------------------------------------------------
  -- Step 7: upsert the equipment_types row itself.
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
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'idx_equipment_types_workspace_id_equipment_name' then
        raise exception 'Another recipe already uses the name "%". Choose a different name.', v_equipment_name using errcode = 'EC016';
      end if;
      raise exception 'This recipe could not be saved due to a conflicting record. Try again.' using errcode = 'EC016';
    end;
  else
    begin
      -- STAGE 3: workspace_id column + v_caller_workspace_id value added
      -- -- never client-supplied.
      insert into public.equipment_types (
        equipment_number, equipment_name, description, image_url,
        output_inventory_item_id, is_retired, retired_at, workspace_id
      ) values (
        'EQ-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
        v_equipment_name, nullif(p_description, ''), nullif(p_image_url, ''),
        v_resolved_output_item_id, p_retired, case when p_retired then now() else null end, v_caller_workspace_id
      )
      returning id into v_equipment_type_id;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'idx_equipment_types_workspace_id_equipment_name' then
        raise exception 'Another recipe already uses the name "%". Choose a different name.', v_equipment_name using errcode = 'EC016';
      end if;
      raise exception 'This recipe could not be saved due to a conflicting record. Try again.' using errcode = 'EC016';
    end;
  end if;

  -- --------------------------------------------------------
  -- Step 8: reconcile equipment_bom_components -- natural-key upsert
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
  -- Step 9: return the full saved recipe in BuildRecipe's OWN frontend
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

-- ============================================================
-- Deliberately NOT done by this migration -- see this file's header
-- and PRODUCT_MASTER_COMPLETION_PLAN.md §11 for the full list:
-- project_documents.document_number (no workspace_id column exists on
-- that table today -- needs its own reviewed migration), the three
-- report views, deletion_log, storage bucket policies for
-- purchase_order_files/sales-quote-images/message-attachments, the
-- notification_rules/standard_install_times/project_schedule_templates
-- governance decision, and the app_sync_events/app_transaction_locks
-- hygiene items.
-- ============================================================
