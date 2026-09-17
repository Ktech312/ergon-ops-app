-- Phase 3, Stage 3 (Purchasing, inventory, vendors, warehouses, and
-- receiving) -- approved by E under the same 2026-09-16 standing
-- authorization as migrations 155-158. This is the OWNERSHIP half of
-- Stage 3, mirroring the exact two-step pattern already proven for every
-- prior group (117/155 = Clients+Sales, 156/157 = Projects+Tasks): this
-- migration adds real, trigger-enforced workspace_id to the ROOT tables
-- of this group and backfills every existing row -- it does NOT change
-- any RLS policy. Every policy remains exactly what it is today after
-- this migration. RLS tightening for this group is a separate, later
-- migration (160), once this ownership metadata is live and verified.
--
-- Table-group scope for Stage 3, decided by revalidating the current FK
-- graph and RLS state directly against the schema (grepped across all
-- 158 prior migrations), not assumed from planning docs:
--   ROOT tables (this migration, real workspace_id column each):
--     - `vendors` -- standalone reference table, no FK anchor at all.
--     - `locations` -- "warehouse" is a location_type value on this
--       table, not a separate warehouses table; confirmed no other
--       warehouse* table exists anywhere in 001-158.
--     - `inventory_items` -- standalone catalog table.
--     - `purchase_orders` -- notably still fully open (`using(true)`
--       write policy from 001, never included in migration 023's
--       role-based RLS pass, unlike purchase_requests/inventory_*).
--     - `purchase_requests` -- flat table, no separate
--       purchase_request_lines table exists.
--     - `equipment_types` -- named explicitly in migration 158's
--       "deliberately not done" section as the reason
--       save_equipment_recipe() still calls active_workspace_id();
--       this migration is what retires that call site (see Section 7).
--     - `build_transactions`.
--   CHILD tables (no new column, ownership inherited through FK,
--   containment added via resolver function in the RLS migration):
--     purchase_order_lines, purchase_order_files, purchase_order_receipts,
--     purchase_order_holds (all -> purchase_orders), inventory_balances,
--     inventory_movements, inventory_transactions (-> inventory_items,
--     with a location/project fallback where relevant),
--     project_inventory_allocations, project_allocation_history
--     (-> projects, already scoped since 156 -- these two are the
--     strongest-anchored children in the whole group),
--     equipment_bom_components (-> equipment_types).
--   Deliberately EXCLUDED from Stage 3, confirmed by direct schema read:
--     `project_shipping_addresses`/`project_shipments`/
--     `project_shipment_lines`/`project_shipment_photos` -- these were
--     flagged as Stage 3 candidates by migration 156's own header, but
--     on inspection they are Documents/Notifications-adjacent delivery
--     records (project_documents.purchase_request_id links the two
--     domains, but shipments themselves carry no purchasing/inventory
--     data of their own) -- properly Stage 4 ("Documents, notifications,
--     channels, jobs, share-link records, and storage"), not this one.
--
-- Confirmed via a repo-wide grep of all 158 prior migrations: zero
-- RPC/security-definer function writes to ANY table in this domain
-- except save_equipment_recipe() (130, equipment_types +
-- equipment_bom_components) and replace_project_bom_lines() (131/132,
-- read-only against inventory_items for name/id resolution, and whose
-- own workspace guard belongs to project_bom_lines' Stage 2 scoping, not
-- this one). Every other write in this domain (purchase orders, PO
-- lines, purchase requests, inventory balances/movements, vendors,
-- locations, build transactions) goes directly through PostgREST, gated
-- only by RLS -- so, unlike the Sales/Clients/Share-link groups, this
-- group's containment work is almost entirely an RLS/column exercise,
-- not an RPC-hardening exercise. Migration 160 will confirm this again
-- directly before writing any policy.
--
-- Backfill anchor priority, chosen per-table using the FK graph as it
-- exists TODAY (`projects` has had workspace_id since migration 156):
--   - locations: prefer the linked project's workspace (project_id is
--     nullable and mostly unused per migration 018's own comment about
--     the single "Main Warehouse" row, but still the best signal where
--     present), else the single existing active workspace.
--   - purchase_requests: prefer the linked project's workspace, else the
--     single existing active workspace.
--   - vendors: no anchor exists -- single existing active workspace only.
--   - inventory_items: prefer the preferred vendor's workspace (now
--     resolvable, since vendors is backfilled earlier in this same
--     transaction), else the single existing active workspace.
--   - equipment_types: prefer its output inventory item's workspace (now
--     resolvable, inventory_items backfilled earlier in this same
--     transaction), else the single existing active workspace.
--   - build_transactions: prefer its equipment type's workspace (now
--     resolvable), else the single existing active workspace.
--   - purchase_orders: prefer the linked source purchase request's
--     workspace, else the linked vendor's workspace (both now
--     resolvable), else the single existing active workspace.
-- All of these resolve to the identical value today (exactly one real
-- workspace exists in production), but the priority order is the
-- documented, correct behavior for whenever this backfill logic is ever
-- re-read, matching every prior ownership migration's own convention
-- (117, 156).
--
-- Confirm 159 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- Schema: nullable for now, made NOT NULL later in this
-- same transaction.
-- ============================================================

alter table public.vendors
  add column if not exists workspace_id uuid references public.workspaces(id);

alter table public.locations
  add column if not exists workspace_id uuid references public.workspaces(id);

alter table public.inventory_items
  add column if not exists workspace_id uuid references public.workspaces(id);

alter table public.purchase_orders
  add column if not exists workspace_id uuid references public.workspaces(id);

alter table public.purchase_requests
  add column if not exists workspace_id uuid references public.workspaces(id);

alter table public.equipment_types
  add column if not exists workspace_id uuid references public.workspaces(id);

alter table public.build_transactions
  add column if not exists workspace_id uuid references public.workspaces(id);

-- ============================================================
-- Section 2 -- Indexes
-- ============================================================

create index if not exists idx_vendors_workspace_id on public.vendors(workspace_id);
create index if not exists idx_locations_workspace_id on public.locations(workspace_id);
create index if not exists idx_inventory_items_workspace_id on public.inventory_items(workspace_id);
create index if not exists idx_purchase_orders_workspace_id on public.purchase_orders(workspace_id);
create index if not exists idx_purchase_requests_workspace_id on public.purchase_requests(workspace_id);
create index if not exists idx_equipment_types_workspace_id on public.equipment_types(workspace_id);
create index if not exists idx_build_transactions_workspace_id on public.build_transactions(workspace_id);

-- ============================================================
-- Section 3 -- Backfill, in dependency order (each table's preferred
-- anchor must itself already be backfilled before it can be used as a
-- source). Idempotent: every update matches zero rows (no-op) on any
-- re-run, since it only ever targets workspace_id is null.
-- ============================================================

-- locations: prefer the linked project's workspace.
update public.locations l
set workspace_id = p.workspace_id
from public.projects p
where l.project_id = p.id
  and l.workspace_id is null;

update public.locations
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- purchase_requests: prefer the linked project's workspace.
update public.purchase_requests pr
set workspace_id = p.workspace_id
from public.projects p
where pr.project_id = p.id
  and pr.workspace_id is null;

update public.purchase_requests
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- vendors: no anchor, fallback only.
update public.vendors
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- inventory_items: prefer the preferred vendor's workspace (vendors just
-- backfilled above, in this same transaction).
update public.inventory_items ii
set workspace_id = v.workspace_id
from public.vendors v
where ii.preferred_vendor_id = v.id
  and ii.workspace_id is null;

update public.inventory_items
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- equipment_types: prefer its output inventory item's workspace
-- (inventory_items just backfilled above).
update public.equipment_types et
set workspace_id = ii.workspace_id
from public.inventory_items ii
where et.output_inventory_item_id = ii.id
  and et.workspace_id is null;

update public.equipment_types
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- build_transactions: prefer its equipment type's workspace
-- (equipment_types just backfilled above).
update public.build_transactions bt
set workspace_id = et.workspace_id
from public.equipment_types et
where bt.equipment_type_id = et.id
  and bt.workspace_id is null;

update public.build_transactions
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- purchase_orders: prefer the linked source purchase request's
-- workspace, else the linked vendor's workspace (both just backfilled
-- above).
update public.purchase_orders po
set workspace_id = pr.workspace_id
from public.purchase_requests pr
where po.source_request_id = pr.id
  and po.workspace_id is null;

update public.purchase_orders po
set workspace_id = v.workspace_id
from public.vendors v
where po.vendor_id = v.id
  and po.workspace_id is null;

update public.purchase_orders
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

-- ============================================================
-- Section 4 -- In-migration assertion: abort the whole transaction if
-- the backfill missed anything.
-- ============================================================

do $$
begin
  if exists (select 1 from public.vendors where workspace_id is null) then
    raise exception 'backfill incomplete: vendors.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.locations where workspace_id is null) then
    raise exception 'backfill incomplete: locations.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.inventory_items where workspace_id is null) then
    raise exception 'backfill incomplete: inventory_items.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.purchase_orders where workspace_id is null) then
    raise exception 'backfill incomplete: purchase_orders.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.purchase_requests where workspace_id is null) then
    raise exception 'backfill incomplete: purchase_requests.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.equipment_types where workspace_id is null) then
    raise exception 'backfill incomplete: equipment_types.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.build_transactions where workspace_id is null) then
    raise exception 'backfill incomplete: build_transactions.workspace_id still has nulls';
  end if;
end $$;

-- ============================================================
-- Section 5 -- Ownership triggers. Reuses guard_workspace_id_mutation()
-- (migration 117) verbatim -- it is table-agnostic, already hardened
-- (security definer, search_path=''), and already proven correct in
-- production for six tables across three prior stages. No new trigger
-- function is created by this migration.
-- ============================================================

drop trigger if exists vendors_guard_workspace_id on public.vendors;
create trigger vendors_guard_workspace_id
  before insert or update on public.vendors
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists locations_guard_workspace_id on public.locations;
create trigger locations_guard_workspace_id
  before insert or update on public.locations
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists inventory_items_guard_workspace_id on public.inventory_items;
create trigger inventory_items_guard_workspace_id
  before insert or update on public.inventory_items
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists purchase_orders_guard_workspace_id on public.purchase_orders;
create trigger purchase_orders_guard_workspace_id
  before insert or update on public.purchase_orders
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists purchase_requests_guard_workspace_id on public.purchase_requests;
create trigger purchase_requests_guard_workspace_id
  before insert or update on public.purchase_requests
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists equipment_types_guard_workspace_id on public.equipment_types;
create trigger equipment_types_guard_workspace_id
  before insert or update on public.equipment_types
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists build_transactions_guard_workspace_id on public.build_transactions;
create trigger build_transactions_guard_workspace_id
  before insert or update on public.build_transactions
  for each row execute function public.guard_workspace_id_mutation();

-- ============================================================
-- Section 6 -- Enforce NOT NULL. Every existing row was just verified
-- non-null in Section 4, and every future write has been
-- trigger-protected since Section 5, both within this same transaction.
-- ============================================================

alter table public.vendors alter column workspace_id set not null;
alter table public.locations alter column workspace_id set not null;
alter table public.inventory_items alter column workspace_id set not null;
alter table public.purchase_orders alter column workspace_id set not null;
alter table public.purchase_requests alter column workspace_id set not null;
alter table public.equipment_types alter column workspace_id set not null;
alter table public.build_transactions alter column workspace_id set not null;

-- ============================================================
-- Section 7 -- Retire the active_workspace_id() fail-closed guard in
-- save_equipment_recipe() now that equipment_types has real
-- workspace_id. This is the exact retirement migration 158 predicted
-- and documented as pending for this stage.
--
-- Full function body carried forward VERBATIM from migration 130 (the
-- real, currently-live definition -- re-read directly from that file
-- before writing this, not from memory or from any planning doc), with
-- exactly five targeted edits, each marked "-- STAGE 3:" inline below:
--   1. The old Step 1 (`perform public.active_workspace_id()` fail-
--      closed try/catch, raising EC008) is removed outright -- it
--      asserted "exactly one workspace exists in the whole database,"
--      which is no longer the right check now that equipment_types
--      resolves its OWN caller-scoped workspace via
--      resolve_caller_workspace_id() (already present as the old
--      Step 2, unchanged, now renumbered Step 1). EC008 becomes unused
--      by this function; not reassigned to anything else here.
--   2. The existing-recipe id lookup and the equipment_name fallback
--      lookup (old Step 4) both gain `and workspace_id =
--      v_caller_workspace_id`, so a recipe id or name belonging to
--      another workspace resolves the same as "not found" (EC010) --
--      equipment_name stays globally unique (migration 020) until
--      Stage 5's own workspace-scoped-uniqueness pass, so this is a
--      containment check only, not a uniqueness-scope change.
--   3. Component name resolution (old Step 6) gains `and workspace_id =
--      v_caller_workspace_id` on the inventory_items lookup -- a
--      same-named item in another workspace no longer resolves as a
--      match (falls through to EC012 unresolved, correctly).
--   4. Output-item resolution (old Step 7) gains the same workspace
--      filter on both the stable-id existence check and the
--      item_name fallback lookup.
--   5. The equipment_types INSERT (old Step 8, new-recipe branch) gains
--      a workspace_id column, set to v_caller_workspace_id -- never
--      client-supplied. The UPDATE branch needs no change: it is only
--      reached after the workspace-filtered lookup in edit 2 above
--      already confirmed the row belongs to the caller's workspace.
-- Nothing else in the ~430-line body is touched -- same validation,
-- same concurrency/advisory-lock handling, same error codes, same
-- return shape.
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
      if v_constraint_name = 'idx_equipment_types_equipment_name' then
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
      if v_constraint_name = 'idx_equipment_types_equipment_name' then
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
-- Deliberately NOT done by this migration, matching migrations 117/156's
-- own precedent exactly:
--   - No RLS policy on any table is touched. Every policy (both the
--     `using(true)` ones from 001/003/005 and the role-gated ones added
--     by migration 023) remains exactly what it is today. This migration
--     adds tamper-proof ownership METADATA only, on top of whatever
--     access rule already governs each table -- not access containment.
--     RLS tightening for this group is migration 160, next.
--   - No child table (purchase_order_lines and the ten others named in
--     this file's header) gets its own workspace_id column -- ownership
--     is inherited through the required FK, exactly like every prior
--     group's child tables.
--   - replace_project_bom_lines()'s own active_workspace_id() call is
--     NOT touched here -- it belongs to project_bom_lines' Stage 2
--     scoping (already live), and its use of active_workspace_id() is
--     coincidental (inventory_items is read-only there, for name/id
--     resolution), not a real dependency on this migration.
--   - The legacy admin-role bridge functions' active_workspace_id()
--     calls (124/133) are untouched -- they operate on workspace-less
--     app_admins/app_user_roles and are explicitly out of scope for
--     every stage, as documented since migration 155.
-- ============================================================
