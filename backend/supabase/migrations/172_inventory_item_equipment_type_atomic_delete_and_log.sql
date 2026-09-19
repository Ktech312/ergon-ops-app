-- Phase 3, Stage 5 -- closes the one residual gap migration 166 left
-- open by design: `inventory_item`/`equipment_type` are the only two
-- `deletion_log` entity types that are genuinely hard-deleted, and the
-- log write happens AFTER the delete already succeeded (two separate
-- client-driven HTTP calls, `src/persistence.ts`) -- by the time
-- `derive_deletion_log_workspace_id()` (migration 166) runs, the source
-- row (and its `workspace_id`) is already gone, so those two entity
-- types' log rows stay `workspace_id = null` (visible to everyone,
-- same exposure as before migration 166, not worsened, but not closed
-- either).
--
-- Fix: three new atomic RPCs replacing the current two-step
-- lookup-then-delete-then-log client flow for `deleteInventoryItem()`,
-- `forceDeleteInventoryItem()`, and `deleteEquipmentType()`
-- (`src/persistence.ts:5917-5995`, `6446-6489`). Each RPC does the
-- lookup, authorization check, delete, and log insert in ONE
-- transaction -- `workspace_id` is captured from the row BEFORE it is
-- deleted, so there is no longer a gap for the log entry to fall
-- into. Every one of the existing functions' documented behaviors is
-- preserved exactly (re-read directly from source before writing this,
-- not from memory or from any planning doc):
--
--   - A lookup miss (item already gone, or a same-session
--     not-yet-synced create) is a silent SUCCESS, no log entry --
--     exactly the existing `{ ok: true }` short-circuit in both
--     `deleteInventoryItem()`'s and `deleteEquipmentType()`'s current
--     bodies.
--   - A real FK-RESTRICT conflict (stock/movement/BOM/PO history for
--     an inventory item; build history for an equipment type) is
--     mapped to the exact same friendly message text the client
--     currently produces for that same HTTP 409, via `exception when
--     foreign_key_violation` -- not a raw Postgres error.
--   - `force_delete_inventory_item_and_log()` preserves
--     `forceDeleteInventoryItem()`'s one distinguishing step exactly:
--     clearing ONLY the caller's own zero-quantity `inventory_balances`
--     row(s) before retrying, never a non-zero one, and still failing
--     (with different wording) if any other real history blocks it.
--   - The log entry's `entity_label` matches exactly: item name (or
--     sku fallback) for inventory items, with the same literal
--     `" (admin force-delete)"` suffix for the force path; the
--     equipment name string for equipment types.
--   - Authorization is copied verbatim from each table's real current
--     DELETE policy (migration 160): `is_active_workspace_member(
--     workspace_id) and (is_app_admin(auth.uid()) or has_role(
--     'warehouse'))` -- these RPCs are security definer and therefore
--     bypass RLS entirely, so this check must be, and is, restated
--     explicitly rather than relied on implicitly (same stated
--     rationale as migration 161's storage-bucket policies for the
--     same class of "policy runs independently, restate it" reasoning).
--
-- One deliberate, load-bearing change from the current lookup query
-- shape: the current client code looks up by `sku`/`equipment_name`
-- alone, with no workspace filter (correct at the time, since the
-- lookup ran as a plain authenticated SELECT under RLS, which already
-- filtered to the caller's own workspace). These RPCs are security
-- definer and do NOT go through RLS, and since migration 164 made both
-- `sku` and `equipment_name` uniqueness workspace-scoped rather than
-- global, TWO DIFFERENT workspaces can now legitimately have a row
-- with the identical `sku`/`equipment_name` value -- an unfiltered
-- lookup here would be genuinely ambiguous (could silently resolve to
-- the WRONG workspace's row of the same name). Each lookup below is
-- therefore explicitly scoped to `workspace_id = v_caller_workspace_id`
-- from the start -- this also means there is no separate "found, but
-- wrong workspace" disclosure branch needed (unlike e.g. migration
-- 163's `replace_project_bom_lines()`, which receives an untrusted
-- foreign id directly from the caller): by construction, this lookup
-- only ever considers the caller's own workspace's rows, so anything
-- it doesn't find is treated as the existing "nothing to delete"
-- success case, not a new disclosure risk.
--
-- The atomic `insert ... returning id` immediately followed by an
-- `update ... set workspace_id = ...` (rather than trying to make
-- migration 166's `derive_deletion_log_workspace_id()` trust a
-- caller-supplied value for these two entity types) is deliberate:
-- `deletion_log` has no UPDATE policy at all (migration 088 only ever
-- defined SELECT and INSERT), so an ordinary authenticated client
-- could never perform this second step -- only a security definer
-- function's own internal privilege can, and `derive_deletion_log_
-- workspace_id()` is BEFORE INSERT only, never fired by an UPDATE, so
-- this cleanly sets the real value with no risk of a client spoofing a
-- workspace_id for these two entity types via a direct POST (which
-- still, correctly, gets nulled by the unchanged trigger). Migration
-- 166 itself is not edited or rerun.
--
-- Confirm 172 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

create or replace function public.delete_inventory_item_and_log(
  p_sku text,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_workspace_id uuid;
  v_item_id uuid;
  v_item_name text;
  v_deleted_count int;
  v_log_id uuid;
begin
  begin
    v_caller_workspace_id := public.resolve_caller_workspace_id();
  exception when sqlstate 'P0001' then
    raise exception 'Your workspace access is unavailable or ambiguous. Contact an administrator.' using errcode = 'EC007';
  end;

  select id, item_name into v_item_id, v_item_name
  from public.inventory_items
  where sku = p_sku and workspace_id = v_caller_workspace_id
  for update;

  if v_item_id is null then
    return jsonb_build_object('ok', true, 'outcome', 'not_found');
  end if;

  if not (
    public.is_active_workspace_member(v_caller_workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  ) then
    raise exception 'Only a warehouse team member or workspace administrator may delete an inventory item.' using errcode = 'EC009';
  end if;

  begin
    delete from public.inventory_items where id = v_item_id;
  exception when foreign_key_violation then
    raise exception 'Can''t delete -- this item has stock, movement, or build-BOM history. Use Retire instead to keep it out of the picker without losing that history.' using errcode = 'EC026';
  end;
  get diagnostics v_deleted_count = row_count;

  if v_deleted_count = 0 then
    raise exception 'Delete didn''t remove anything -- you may not have permission.' using errcode = 'EC027';
  end if;

  insert into public.deletion_log (entity_type, entity_id, entity_label, action, actor_email)
  values ('inventory_item', v_item_id, coalesce(v_item_name, p_sku), 'deleted', p_actor_email)
  returning id into v_log_id;
  update public.deletion_log set workspace_id = v_caller_workspace_id where id = v_log_id;

  return jsonb_build_object('ok', true, 'outcome', 'deleted');
end;
$$;

revoke all on function public.delete_inventory_item_and_log(text, text) from public;
revoke execute on function public.delete_inventory_item_and_log(text, text) from anon;
grant execute on function public.delete_inventory_item_and_log(text, text) to authenticated;

create or replace function public.force_delete_inventory_item_and_log(
  p_sku text,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_workspace_id uuid;
  v_item_id uuid;
  v_item_name text;
  v_deleted_count int;
  v_log_id uuid;
begin
  begin
    v_caller_workspace_id := public.resolve_caller_workspace_id();
  exception when sqlstate 'P0001' then
    raise exception 'Your workspace access is unavailable or ambiguous. Contact an administrator.' using errcode = 'EC007';
  end;

  select id, item_name into v_item_id, v_item_name
  from public.inventory_items
  where sku = p_sku and workspace_id = v_caller_workspace_id
  for update;

  if v_item_id is null then
    return jsonb_build_object('ok', true, 'outcome', 'not_found');
  end if;

  if not (
    public.is_active_workspace_member(v_caller_workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  ) then
    raise exception 'Only a warehouse team member or workspace administrator may delete an inventory item.' using errcode = 'EC009';
  end if;

  delete from public.inventory_balances
  where inventory_item_id = v_item_id
    and quantity_on_hand = 0
    and quantity_reserved = 0;

  begin
    delete from public.inventory_items where id = v_item_id;
  exception when foreign_key_violation then
    raise exception 'Still can''t delete -- this item has real movement, build-BOM, or purchase order history, not just an empty stock record. Use Retire instead.' using errcode = 'EC026';
  end;
  get diagnostics v_deleted_count = row_count;

  if v_deleted_count = 0 then
    raise exception 'Delete didn''t remove anything -- you may not have permission.' using errcode = 'EC027';
  end if;

  insert into public.deletion_log (entity_type, entity_id, entity_label, action, actor_email)
  values ('inventory_item', v_item_id, coalesce(v_item_name, p_sku) || ' (admin force-delete)', 'deleted', p_actor_email)
  returning id into v_log_id;
  update public.deletion_log set workspace_id = v_caller_workspace_id where id = v_log_id;

  return jsonb_build_object('ok', true, 'outcome', 'deleted');
end;
$$;

revoke all on function public.force_delete_inventory_item_and_log(text, text) from public;
revoke execute on function public.force_delete_inventory_item_and_log(text, text) from anon;
grant execute on function public.force_delete_inventory_item_and_log(text, text) to authenticated;

create or replace function public.delete_equipment_type_and_log(
  p_equipment_name text,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_workspace_id uuid;
  v_equipment_type_id uuid;
  v_deleted_count int;
  v_log_id uuid;
begin
  begin
    v_caller_workspace_id := public.resolve_caller_workspace_id();
  exception when sqlstate 'P0001' then
    raise exception 'Your workspace access is unavailable or ambiguous. Contact an administrator.' using errcode = 'EC007';
  end;

  select id into v_equipment_type_id
  from public.equipment_types
  where equipment_name = p_equipment_name and workspace_id = v_caller_workspace_id
  for update;

  if v_equipment_type_id is null then
    return jsonb_build_object('ok', true, 'outcome', 'not_found');
  end if;

  if not (
    public.is_active_workspace_member(v_caller_workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('warehouse'))
  ) then
    raise exception 'Only a warehouse team member or workspace administrator may delete an equipment type.' using errcode = 'EC009';
  end if;

  begin
    delete from public.equipment_types where id = v_equipment_type_id;
  exception when foreign_key_violation then
    raise exception 'Can''t delete -- this equipment type has build history. Use Retire instead to keep it out of the picker without losing that history.' using errcode = 'EC026';
  end;
  get diagnostics v_deleted_count = row_count;

  if v_deleted_count = 0 then
    raise exception 'Delete didn''t remove anything -- you may not have permission to delete equipment types.' using errcode = 'EC027';
  end if;

  insert into public.deletion_log (entity_type, entity_id, entity_label, action, actor_email)
  values ('equipment_type', v_equipment_type_id, p_equipment_name, 'deleted', p_actor_email)
  returning id into v_log_id;
  update public.deletion_log set workspace_id = v_caller_workspace_id where id = v_log_id;

  return jsonb_build_object('ok', true, 'outcome', 'deleted');
end;
$$;

revoke all on function public.delete_equipment_type_and_log(text, text) from public;
revoke execute on function public.delete_equipment_type_and_log(text, text) from anon;
grant execute on function public.delete_equipment_type_and_log(text, text) to authenticated;

commit;
