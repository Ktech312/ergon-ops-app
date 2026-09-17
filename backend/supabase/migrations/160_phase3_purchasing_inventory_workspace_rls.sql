-- Phase 3, Stage 3 RLS half (Purchasing, inventory, vendors, warehouses,
-- and receiving) -- approved by E under the same 2026-09-16 standing
-- authorization as migrations 155-159. This is the RLS half of Stage 3,
-- following migration 159's ownership half (workspace_id on the seven
-- root tables, confirmed applied and tested in production 2026-09-17)
-- exactly the way migration 157 followed migration 156 for
-- Projects+Tasks.
--
-- Table-group scope: the seven root tables migration 159's own header
-- already scoped and justified (`vendors`, `locations`, `inventory_items`,
-- `purchase_orders`, `purchase_requests`, `equipment_types`,
-- `build_transactions`), plus their children, all inheriting ownership
-- through a required FK (no new column): `purchase_order_lines`,
-- `purchase_order_files`, `purchase_order_receipts`, `purchase_order_holds`
-- (-> purchase_orders), `inventory_balances`, `inventory_movements`
-- (-> inventory_items), `inventory_transactions` (no single NOT NULL
-- anchor -- see Section 1's note), `project_inventory_allocations`
-- (-> projects, reusing migration 157's own resolver), `project_allocation_history`
-- (-> projects or inventory_items, both nullable -- see Section 1),
-- `equipment_bom_components` (-> equipment_types). Not re-derived here.
--
-- Confirmed directly (re-verified against current source, not assumed
-- from migration 159's own header, which predates this file): this
-- domain has almost no RPC layer -- `save_equipment_recipe()` was the
-- only RPC writing here, already hardened by migration 159.
-- `replace_project_bom_lines()` only reads `inventory_items` (name/id
-- resolution) and its own workspace guard belongs to `project_bom_lines`
-- (Stage 2). No RPC changes in this migration -- purely RLS + three new
-- owner-resolver helper functions.
--
-- Material drift found from a naive "treat every table like migration
-- 157's project children" assumption, confirmed by direct read before
-- writing any policy below:
--   1. `vendors`, `locations`, `purchase_orders`, `purchase_order_lines`,
--      `purchase_order_files`, `purchase_order_receipts`,
--      `purchase_order_holds`, `project_inventory_allocations` have
--      NEVER had a role gate (still exactly `using(true)` from their
--      creating migration) -- migration 023's role-based RLS pass did
--      not touch any of them (confirmed: `purchase_orders` and its
--      children are conspicuously absent from that migration despite
--      being purchasing/warehouse-adjacent). Workspace scoping is added
--      with NO role gate for these eight tables, matching their current
--      shape exactly.
--   2. `inventory_items`, `inventory_balances`, `inventory_movements`,
--      `inventory_transactions`, `equipment_types`,
--      `equipment_bom_components`, `build_transactions`,
--      `project_allocation_history`, `purchase_requests` DO have an
--      existing role gate from migration 023
--      (`is_app_admin(auth.uid()) or has_role('warehouse')` for the
--      inventory/equipment/build cluster, `has_role('purchasing')` for
--      purchase_requests). The workspace predicate is added ALONGSIDE
--      these via AND, not instead of them -- the same "alongside, not
--      instead of" pattern used throughout migrations 155/157.
--   3. `inventory_transactions` has no NOT NULL anchor column at all
--      (`project_id`, `purchase_order_id`, `equipment_type_id` are all
--      nullable) -- confirmed vestigial (migration 021's own comment:
--      the app moved to `inventory_movements.build_transaction_id`
--      instead; no insert into this table anywhere in 001-159 outside a
--      one-time backfill). Resolved inline via
--      `coalesce(project_owner_workspace_id(project_id),
--      purchase_order_owner_workspace_id(purchase_order_id),
--      equipment_type_owner_workspace_id(equipment_type_id))` -- a row
--      with all three null resolves to a null workspace and becomes
--      inaccessible (`is_workspace_member(null)` is false), a safe
--      fail-closed outcome for a table with no live writes, not a
--      dedicated resolver function (no single-column anchor exists to
--      wrap one around).
--   4. `project_allocation_history.project_id` is nullable (unlike
--      `project_inventory_allocations.project_id`, which is NOT NULL and
--      reuses migration 157's `project_owner_workspace_id()` directly).
--      Resolved inline via `coalesce(project_owner_workspace_id(project_id),
--      inventory_item_owner_workspace_id(inventory_item_id))`, same
--      reasoning as point 3.
--   5. `inventory_balances` (item + location) and `inventory_movements`
--      (item + from/to location) each have more than one table they
--      could theoretically anchor to. Both are anchored on
--      `inventory_item_id` alone (their one universally-NOT-NULL FK) --
--      a deliberate single-anchor choice, matching migration 157's own
--      precedent for `project_locations` et al. (anchored on `project_id`
--      alone despite the row also referencing other tables).
--   6. `purchase_order_files`' own storage-bucket object policies
--      (`"authenticated read/write/update/delete purchase-order-files
--      objects"`, on `storage.objects`, migration 081) are DELIBERATELY
--      NOT touched by this migration -- storage is explicitly Stage 4
--      territory ("Documents, notifications, channels, jobs, share-link
--      records, and storage"), not this one. Only the `purchase_order_files`
--      TABLE's own RLS (the metadata row, not the underlying object) is
--      scoped here.
--
-- Preserves current authorized same-workspace behavior throughout: with
-- exactly one real workspace in production today, every policy below
-- evaluates to exactly the same true/false outcome the pre-existing
-- role-gated/using(true) logic already produced for every current real
-- user.
--
-- Confirm 160 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- New owner-resolver helper functions. Same pattern as
-- migrations 155/157 -- security definer, read the target table under
-- the OWNER's privileges, return NULL (never raise) for a dangling/
-- invalid id. `project_owner_workspace_id()` (migration 157) and
-- `is_workspace_member()`/`is_active_workspace_member()` (migration 115)
-- already exist and are reused verbatim, not recreated.
-- ============================================================

create or replace function public.purchase_order_owner_workspace_id(p_purchase_order_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.purchase_orders where id = p_purchase_order_id;
$$;

create or replace function public.inventory_item_owner_workspace_id(p_inventory_item_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.inventory_items where id = p_inventory_item_id;
$$;

create or replace function public.equipment_type_owner_workspace_id(p_equipment_type_id uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.equipment_types where id = p_equipment_type_id;
$$;

revoke execute on function public.purchase_order_owner_workspace_id(uuid) from public;
revoke execute on function public.inventory_item_owner_workspace_id(uuid) from public;
revoke execute on function public.equipment_type_owner_workspace_id(uuid) from public;
grant execute on function public.purchase_order_owner_workspace_id(uuid) to authenticated;
grant execute on function public.inventory_item_owner_workspace_id(uuid) to authenticated;
grant execute on function public.equipment_type_owner_workspace_id(uuid) to authenticated;

-- ============================================================
-- Section 2 -- vendors, locations: full replace, no role gate (never
-- touched by migration 023, still exactly using(true) today).
-- ============================================================

drop policy if exists "authenticated read vendors" on public.vendors;
drop policy if exists "authenticated write vendors" on public.vendors;

create policy "workspace members read vendors"
  on public.vendors for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members insert vendors"
  on public.vendors for insert to authenticated
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members update vendors"
  on public.vendors for update to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members delete vendors"
  on public.vendors for delete to authenticated
  using (public.is_active_workspace_member(workspace_id));

drop policy if exists "authenticated read locations" on public.locations;
drop policy if exists "authenticated write locations" on public.locations;

create policy "workspace members read locations"
  on public.locations for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members insert locations"
  on public.locations for insert to authenticated
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members update locations"
  on public.locations for update to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members delete locations"
  on public.locations for delete to authenticated
  using (public.is_active_workspace_member(workspace_id));

-- ============================================================
-- Section 3 -- inventory_items: read scoped to workspace; write keeps
-- its existing warehouse/admin role gate (migration 023), ANDed with
-- the new workspace check, not replaced.
-- ============================================================

drop policy if exists "authenticated read inventory_items" on public.inventory_items;
drop policy if exists "warehouse and admin write inventory_items" on public.inventory_items;

create policy "workspace members read inventory_items"
  on public.inventory_items for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: warehouse and admin insert inventory_items"
  on public.inventory_items for insert to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin update inventory_items"
  on public.inventory_items for update to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin delete inventory_items"
  on public.inventory_items for delete to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

-- ============================================================
-- Section 4 -- purchase_orders: full replace, no role gate (confirmed
-- absent from migration 023's list, still exactly using(true) today,
-- unlike its purchasing-adjacent sibling purchase_requests).
-- ============================================================

drop policy if exists "authenticated read purchase_orders" on public.purchase_orders;
drop policy if exists "authenticated write purchase_orders" on public.purchase_orders;

create policy "workspace members read purchase_orders"
  on public.purchase_orders for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members insert purchase_orders"
  on public.purchase_orders for insert to authenticated
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members update purchase_orders"
  on public.purchase_orders for update to authenticated
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

create policy "workspace members delete purchase_orders"
  on public.purchase_orders for delete to authenticated
  using (public.is_active_workspace_member(workspace_id));

-- ============================================================
-- Section 5 -- purchase_orders' children, no role gate (purchase_order_lines,
-- purchase_order_files, purchase_order_receipts, purchase_order_holds).
-- purchase_order_files' own storage.objects policies are untouched --
-- Stage 4 territory (see this file's header, point 6).
-- ============================================================

drop policy if exists "authenticated read purchase_order_lines" on public.purchase_order_lines;
drop policy if exists "authenticated write purchase_order_lines" on public.purchase_order_lines;

create policy "workspace members read purchase_order_lines"
  on public.purchase_order_lines for select to authenticated
  using (public.is_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members insert purchase_order_lines"
  on public.purchase_order_lines for insert to authenticated
  with check (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members update purchase_order_lines"
  on public.purchase_order_lines for update to authenticated
  using (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)))
  with check (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members delete purchase_order_lines"
  on public.purchase_order_lines for delete to authenticated
  using (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

drop policy if exists "authenticated read purchase_order_files" on public.purchase_order_files;
drop policy if exists "authenticated write purchase_order_files" on public.purchase_order_files;

create policy "workspace members read purchase_order_files"
  on public.purchase_order_files for select to authenticated
  using (public.is_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members insert purchase_order_files"
  on public.purchase_order_files for insert to authenticated
  with check (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members update purchase_order_files"
  on public.purchase_order_files for update to authenticated
  using (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)))
  with check (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members delete purchase_order_files"
  on public.purchase_order_files for delete to authenticated
  using (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

drop policy if exists "authenticated read purchase_order_receipts" on public.purchase_order_receipts;
drop policy if exists "authenticated write purchase_order_receipts" on public.purchase_order_receipts;

create policy "workspace members read purchase_order_receipts"
  on public.purchase_order_receipts for select to authenticated
  using (public.is_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members insert purchase_order_receipts"
  on public.purchase_order_receipts for insert to authenticated
  with check (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members update purchase_order_receipts"
  on public.purchase_order_receipts for update to authenticated
  using (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)))
  with check (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members delete purchase_order_receipts"
  on public.purchase_order_receipts for delete to authenticated
  using (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

drop policy if exists "authenticated read purchase_order_holds" on public.purchase_order_holds;
drop policy if exists "authenticated write purchase_order_holds" on public.purchase_order_holds;

create policy "workspace members read purchase_order_holds"
  on public.purchase_order_holds for select to authenticated
  using (public.is_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members insert purchase_order_holds"
  on public.purchase_order_holds for insert to authenticated
  with check (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members update purchase_order_holds"
  on public.purchase_order_holds for update to authenticated
  using (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)))
  with check (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

create policy "workspace members delete purchase_order_holds"
  on public.purchase_order_holds for delete to authenticated
  using (public.is_active_workspace_member(public.purchase_order_owner_workspace_id(purchase_order_id)));

-- ============================================================
-- Section 6 -- purchase_requests: read scoped to workspace; write keeps
-- its existing purchasing/admin role gate (migration 023), ANDed with
-- the new workspace check.
-- ============================================================

drop policy if exists "authenticated read purchase_requests" on public.purchase_requests;
drop policy if exists "purchasing and admin write purchase_requests" on public.purchase_requests;

create policy "workspace members read purchase_requests"
  on public.purchase_requests for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: purchasing and admin insert purchase_requests"
  on public.purchase_requests for insert to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('purchasing'))
  );

create policy "workspace members: purchasing and admin update purchase_requests"
  on public.purchase_requests for update to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('purchasing'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('purchasing'))
  );

create policy "workspace members: purchasing and admin delete purchase_requests"
  on public.purchase_requests for delete to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('purchasing'))
  );

-- ============================================================
-- Section 7 -- equipment_types: read scoped to workspace; write keeps
-- its existing warehouse/admin role gate (migration 023).
-- ============================================================

drop policy if exists "authenticated read equipment_types" on public.equipment_types;
drop policy if exists "warehouse and admin write equipment_types" on public.equipment_types;

create policy "workspace members read equipment_types"
  on public.equipment_types for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: warehouse and admin insert equipment_types"
  on public.equipment_types for insert to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin update equipment_types"
  on public.equipment_types for update to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin delete equipment_types"
  on public.equipment_types for delete to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

-- ============================================================
-- Section 8 -- equipment_bom_components: child of equipment_types, same
-- warehouse/admin role gate (migration 023).
-- ============================================================

drop policy if exists "authenticated read equipment_bom_components" on public.equipment_bom_components;
drop policy if exists "warehouse and admin write equipment_bom_components" on public.equipment_bom_components;

create policy "workspace members read equipment_bom_components"
  on public.equipment_bom_components for select to authenticated
  using (public.is_workspace_member(public.equipment_type_owner_workspace_id(equipment_type_id)));

create policy "workspace members: warehouse and admin insert equipment_bom_components"
  on public.equipment_bom_components for insert to authenticated
  with check (
    public.is_active_workspace_member(public.equipment_type_owner_workspace_id(equipment_type_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin update equipment_bom_components"
  on public.equipment_bom_components for update to authenticated
  using (
    public.is_active_workspace_member(public.equipment_type_owner_workspace_id(equipment_type_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  )
  with check (
    public.is_active_workspace_member(public.equipment_type_owner_workspace_id(equipment_type_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin delete equipment_bom_components"
  on public.equipment_bom_components for delete to authenticated
  using (
    public.is_active_workspace_member(public.equipment_type_owner_workspace_id(equipment_type_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

-- ============================================================
-- Section 9 -- build_transactions: read scoped to workspace; write keeps
-- its existing warehouse/admin role gate (migration 023).
-- ============================================================

drop policy if exists "authenticated read build_transactions" on public.build_transactions;
drop policy if exists "warehouse and admin write build_transactions" on public.build_transactions;

create policy "workspace members read build_transactions"
  on public.build_transactions for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: warehouse and admin insert build_transactions"
  on public.build_transactions for insert to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin update build_transactions"
  on public.build_transactions for update to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin delete build_transactions"
  on public.build_transactions for delete to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

-- ============================================================
-- Section 10 -- inventory_balances, inventory_movements: anchored on
-- inventory_item_id alone (their one universally-NOT-NULL FK -- see
-- this file's header, point 5). Same warehouse/admin role gate.
-- ============================================================

drop policy if exists "authenticated read inventory_balances" on public.inventory_balances;
drop policy if exists "warehouse and admin write inventory_balances" on public.inventory_balances;

create policy "workspace members read inventory_balances"
  on public.inventory_balances for select to authenticated
  using (public.is_workspace_member(public.inventory_item_owner_workspace_id(inventory_item_id)));

create policy "workspace members: warehouse and admin insert inventory_balances"
  on public.inventory_balances for insert to authenticated
  with check (
    public.is_active_workspace_member(public.inventory_item_owner_workspace_id(inventory_item_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin update inventory_balances"
  on public.inventory_balances for update to authenticated
  using (
    public.is_active_workspace_member(public.inventory_item_owner_workspace_id(inventory_item_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  )
  with check (
    public.is_active_workspace_member(public.inventory_item_owner_workspace_id(inventory_item_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin delete inventory_balances"
  on public.inventory_balances for delete to authenticated
  using (
    public.is_active_workspace_member(public.inventory_item_owner_workspace_id(inventory_item_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

drop policy if exists "authenticated read inventory_movements" on public.inventory_movements;
drop policy if exists "warehouse and admin write inventory_movements" on public.inventory_movements;

create policy "workspace members read inventory_movements"
  on public.inventory_movements for select to authenticated
  using (public.is_workspace_member(public.inventory_item_owner_workspace_id(inventory_item_id)));

create policy "workspace members: warehouse and admin insert inventory_movements"
  on public.inventory_movements for insert to authenticated
  with check (
    public.is_active_workspace_member(public.inventory_item_owner_workspace_id(inventory_item_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin update inventory_movements"
  on public.inventory_movements for update to authenticated
  using (
    public.is_active_workspace_member(public.inventory_item_owner_workspace_id(inventory_item_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  )
  with check (
    public.is_active_workspace_member(public.inventory_item_owner_workspace_id(inventory_item_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin delete inventory_movements"
  on public.inventory_movements for delete to authenticated
  using (
    public.is_active_workspace_member(public.inventory_item_owner_workspace_id(inventory_item_id))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

-- ============================================================
-- Section 11 -- inventory_transactions: no single NOT NULL anchor (see
-- this file's header, point 3) -- resolved inline via a three-way
-- coalesce. Same warehouse/admin role gate.
-- ============================================================

drop policy if exists "authenticated read inventory_transactions" on public.inventory_transactions;
drop policy if exists "warehouse and admin write inventory_transactions" on public.inventory_transactions;

create policy "workspace members read inventory_transactions"
  on public.inventory_transactions for select to authenticated
  using (public.is_workspace_member(coalesce(
    public.project_owner_workspace_id(project_id),
    public.purchase_order_owner_workspace_id(purchase_order_id),
    public.equipment_type_owner_workspace_id(equipment_type_id)
  )));

create policy "workspace members: warehouse and admin insert inventory_transactions"
  on public.inventory_transactions for insert to authenticated
  with check (
    public.is_active_workspace_member(coalesce(
      public.project_owner_workspace_id(project_id),
      public.purchase_order_owner_workspace_id(purchase_order_id),
      public.equipment_type_owner_workspace_id(equipment_type_id)
    ))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin update inventory_transactions"
  on public.inventory_transactions for update to authenticated
  using (
    public.is_active_workspace_member(coalesce(
      public.project_owner_workspace_id(project_id),
      public.purchase_order_owner_workspace_id(purchase_order_id),
      public.equipment_type_owner_workspace_id(equipment_type_id)
    ))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  )
  with check (
    public.is_active_workspace_member(coalesce(
      public.project_owner_workspace_id(project_id),
      public.purchase_order_owner_workspace_id(purchase_order_id),
      public.equipment_type_owner_workspace_id(equipment_type_id)
    ))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin delete inventory_transactions"
  on public.inventory_transactions for delete to authenticated
  using (
    public.is_active_workspace_member(coalesce(
      public.project_owner_workspace_id(project_id),
      public.purchase_order_owner_workspace_id(purchase_order_id),
      public.equipment_type_owner_workspace_id(equipment_type_id)
    ))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

-- ============================================================
-- Section 12 -- project_inventory_allocations: project_id is NOT NULL --
-- reuses migration 157's project_owner_workspace_id() directly, no new
-- resolver. No role gate (never touched by migration 023, still exactly
-- using(true) today, unlike its newer sibling project_allocation_history).
-- ============================================================

drop policy if exists "authenticated read project_inventory_allocations" on public.project_inventory_allocations;
drop policy if exists "authenticated write project_inventory_allocations" on public.project_inventory_allocations;

create policy "workspace members read project_inventory_allocations"
  on public.project_inventory_allocations for select to authenticated
  using (public.is_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members insert project_inventory_allocations"
  on public.project_inventory_allocations for insert to authenticated
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members update project_inventory_allocations"
  on public.project_inventory_allocations for update to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)))
  with check (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

create policy "workspace members delete project_inventory_allocations"
  on public.project_inventory_allocations for delete to authenticated
  using (public.is_active_workspace_member(public.project_owner_workspace_id(project_id)));

-- ============================================================
-- Section 13 -- project_allocation_history: project_id and
-- inventory_item_id both nullable (see this file's header, point 4) --
-- resolved inline via a two-way coalesce. Same warehouse/admin role
-- gate.
-- ============================================================

drop policy if exists "authenticated read project_allocation_history" on public.project_allocation_history;
drop policy if exists "warehouse and admin write project_allocation_history" on public.project_allocation_history;

create policy "workspace members read project_allocation_history"
  on public.project_allocation_history for select to authenticated
  using (public.is_workspace_member(coalesce(
    public.project_owner_workspace_id(project_id),
    public.inventory_item_owner_workspace_id(inventory_item_id)
  )));

create policy "workspace members: warehouse and admin insert project_allocation_history"
  on public.project_allocation_history for insert to authenticated
  with check (
    public.is_active_workspace_member(coalesce(
      public.project_owner_workspace_id(project_id),
      public.inventory_item_owner_workspace_id(inventory_item_id)
    ))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin update project_allocation_history"
  on public.project_allocation_history for update to authenticated
  using (
    public.is_active_workspace_member(coalesce(
      public.project_owner_workspace_id(project_id),
      public.inventory_item_owner_workspace_id(inventory_item_id)
    ))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  )
  with check (
    public.is_active_workspace_member(coalesce(
      public.project_owner_workspace_id(project_id),
      public.inventory_item_owner_workspace_id(inventory_item_id)
    ))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

create policy "workspace members: warehouse and admin delete project_allocation_history"
  on public.project_allocation_history for delete to authenticated
  using (
    public.is_active_workspace_member(coalesce(
      public.project_owner_workspace_id(project_id),
      public.inventory_item_owner_workspace_id(inventory_item_id)
    ))
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  );

commit;

-- ============================================================
-- Deliberately NOT done by this migration:
--   - No RPC is touched -- confirmed directly (not assumed) that this
--     domain has no RPC writing to any table in scope besides
--     save_equipment_recipe(), already hardened by migration 159.
--   - purchase_order_files' storage.objects bucket policies are
--     untouched -- Stage 4 territory (see this file's header, point 6).
--   - No table in this migration gets a new workspace_id column -- every
--     table here either already has one (from migration 159) or
--     inherits ownership through FK, exactly like every prior group's
--     child tables.
--   - equipment_name's global (not workspace-scoped) unique index
--     (migration 020) is untouched -- workspace-scoped uniqueness is
--     Stage 5's job, not this one.
-- ============================================================
