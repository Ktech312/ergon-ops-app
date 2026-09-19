-- Phase 3, Stage 5 (workspace-scoped uniqueness, reports, aggregates,
-- functions, triggers, and remaining indirect access paths) -- third
-- migration of this stage, same 2026-09-16 standing authorization as
-- migrations 155-165. Closes `deletion_log`'s confirmed live
-- cross-workspace leak: this polymorphic audit table (migration 088)
-- has no `workspace_id` and a fully open (`using(true)`) SELECT policy
-- -- any authenticated user in any workspace can currently read every
-- OTHER workspace's full deletion audit trail (entity labels, actor
-- emails, timestamps).
--
-- Scoping pass (repo-wide read of every `logDeletionEvent(...)` call
-- site in src/persistence.ts, the single shared writer, not just the
-- migration-088 comment's own summary, which turned out incomplete and
-- used different literal strings than the real code): 21 distinct
-- `entity_type` literals are actually written today. Each is one of
-- three cases:
--
--   1. Directly scoped or one/two-hop resolvable (17 of 21) -- every
--      one of these already has an existing `*_owner_workspace_id()`
--      resolver reused directly, or a direct `workspace_id` column, no
--      new resolver written here: `channel`, `sales_quote` (direct);
--      `task_hardware_dependency` -> `task_owner_workspace_id()`;
--      `installed_asset`/`project_stakeholder`/`project_location` ->
--      `project_owner_workspace_id()`; `purchase_order_file` ->
--      `purchase_order_owner_workspace_id()`; `sales_quote_bom_line`/
--      `sales_quote_location` -> `sales_quote_owner_workspace_id()`;
--      `sales_quote_location_item`/`sales_quote_location_image` ->
--      `sales_quote_location_owner_workspace_id()`;
--      `project_location_item`/`project_location_image` ->
--      `project_location_owner_workspace_id()`; `project_shipment_photo`
--      -> `project_shipment_owner_workspace_id()`; `build_transaction`
--      (direct column, included for completeness -- see point 3 below
--      for why this branch is presently unreachable in practice).
--   2. Genuinely global, no workspace concept at all (4 of 21):
--      `schedule_template_phase`, `form_schema_field`,
--      `presales_hardware_rule`, `site_hardware_rule` -- all confirmed
--      admin-configured global libraries with no project/workspace
--      anchor anywhere in their schema (same governance category as
--      `notification_rules`/`standard_install_times` elsewhere in Stage
--      5). These rows get `workspace_id = null` and stay visible to
--      every authenticated user, same as today -- not a regression,
--      a deliberate, documented choice.
--   3. Two known, NOT fully closed by this migration (2 of 21):
--      `inventory_item` and `equipment_type` are the only two entity
--      types in the whole app that are genuinely HARD-deleted (real
--      `DELETE`, confirmed in `src/persistence.ts`), and the deletion-log
--      write happens AFTER that delete already succeeded -- by the time
--      any trigger on `deletion_log` could run, the source row (and its
--      `workspace_id`) is already gone. A trigger-based derivation
--      fundamentally cannot resolve these two after the fact. This
--      migration leaves their rows `workspace_id = null` (visible to
--      every workspace, same residual exposure as today, NOT worsened)
--      rather than guessing or silently dropping them -- fully closing
--      this requires capturing `workspace_id` client-side BEFORE the
--      DELETE and writing both the delete and the log entry atomically
--      (e.g. a security-definer RPC replacing the current two-step
--      client-driven pattern), which is real, separate design work, not
--      bundled into this migration. Flagged to E as a known open item,
--      not silently accepted.
--
-- Separately discovered, NOT fixed here (out of this migration's theme,
-- pre-existing and unrelated to workspace scoping): `build_transaction`
-- deletion-log writes appear to have been silently broken since they
-- were added -- `entity_id` is populated with `build_number` (a string
-- like "BUILD-0001", the app's own natural key for this entity, per
-- `src/persistence.ts`'s own comment), not a real uuid, but this
-- column is `uuid not null`. Every such insert has almost certainly
-- been rejected by PostgREST before ever reaching Postgres, and
-- `logDeletionEvent()` never inspects the fetch response, so this fails
-- silently. In practice this means there is likely nothing to
-- workspace-scope for this entity_type today (no rows exist to leak) --
-- worth E confirming directly (`select count(*) from deletion_log where
-- entity_type = 'build_transaction'`) -- but the underlying bug (fix
-- the frontend to pass a real uuid, or change how this entity type is
-- logged) is its own separate fix, not a workspace-containment issue.
--
-- Confirm 166 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- Schema: nullable, by design, permanently (not "nullable
-- for now" like every other Stage 1-4 rollout) -- the 4 genuinely-global
-- entity types and the 2 currently-unresolvable ones (see header) are
-- INTENDED to stay null forever, not a transitional backfill state.
-- ============================================================

alter table public.deletion_log
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_deletion_log_workspace_id on public.deletion_log(workspace_id);

-- ============================================================
-- Section 2 -- derive_deletion_log_workspace_id(): BEFORE INSERT
-- trigger, security definer (this repo's own migration 164/165
-- incident is the direct lesson here -- every consumer of another
-- security-definer resolver must itself be security definer, or the
-- call fails under the real 'authenticated' role with 42501). Always
-- derives server-side from entity_type/entity_id -- never trusts a
-- client-supplied workspace_id, exactly the same stance
-- guard_workspace_id_mutation() (migration 117) already takes for every
-- other workspace_id column in this codebase. An entity_type not
-- recognized by this dispatch fails the whole insert loudly (fail
-- closed) rather than silently logging an unscoped row forever the
-- moment a future call site adds a new entity_type without updating
-- this function -- deletion_log writes are already best-effort and
-- fault-tolerant on the client side (logDeletionEvent() never inspects
-- the fetch response), so this cannot block the underlying
-- delete/restore action itself, only (silently, as today) the audit
-- trail entry for a genuinely unhandled type.
-- ============================================================

create or replace function public.derive_deletion_log_workspace_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  case new.entity_type
    when 'channel' then
      select workspace_id into v_workspace_id from public.channels where id = new.entity_id;
    when 'schedule_template_phase' then
      v_workspace_id := null; -- genuinely global, no workspace concept
    when 'form_schema_field' then
      v_workspace_id := null; -- genuinely global, no workspace concept
    when 'presales_hardware_rule' then
      v_workspace_id := null; -- genuinely global, no workspace concept
    when 'site_hardware_rule' then
      v_workspace_id := null; -- genuinely global, no workspace concept
    when 'task_hardware_dependency' then
      select public.task_owner_workspace_id(task_id) into v_workspace_id
      from public.task_hardware_dependencies where id = new.entity_id;
    when 'inventory_item' then
      v_workspace_id := null; -- known residual gap: hard-deleted before this insert runs, see this file's header
    when 'equipment_type' then
      v_workspace_id := null; -- known residual gap: hard-deleted before this insert runs, see this file's header
    when 'build_transaction' then
      select workspace_id into v_workspace_id from public.build_transactions where id = new.entity_id;
    when 'installed_asset' then
      select public.project_owner_workspace_id(project_id) into v_workspace_id
      from public.installed_assets where id = new.entity_id;
    when 'project_stakeholder' then
      select public.project_owner_workspace_id(project_id) into v_workspace_id
      from public.project_stakeholders where id = new.entity_id;
    when 'purchase_order_file' then
      select public.purchase_order_owner_workspace_id(purchase_order_id) into v_workspace_id
      from public.purchase_order_files where id = new.entity_id;
    when 'sales_quote' then
      select workspace_id into v_workspace_id from public.sales_quotes where id = new.entity_id;
    when 'sales_quote_bom_line' then
      select public.sales_quote_owner_workspace_id(quote_id) into v_workspace_id
      from public.sales_quote_bom_lines where id = new.entity_id;
    when 'sales_quote_location' then
      select public.sales_quote_owner_workspace_id(quote_id) into v_workspace_id
      from public.sales_quote_locations where id = new.entity_id;
    when 'sales_quote_location_item' then
      select public.sales_quote_location_owner_workspace_id(quote_location_id) into v_workspace_id
      from public.sales_quote_location_items where id = new.entity_id;
    when 'sales_quote_location_image' then
      select public.sales_quote_location_owner_workspace_id(quote_location_id) into v_workspace_id
      from public.sales_quote_location_images where id = new.entity_id;
    when 'project_location' then
      select public.project_owner_workspace_id(project_id) into v_workspace_id
      from public.project_locations where id = new.entity_id;
    when 'project_location_item' then
      select public.project_location_owner_workspace_id(project_location_id) into v_workspace_id
      from public.project_location_items where id = new.entity_id;
    when 'project_location_image' then
      select public.project_location_owner_workspace_id(project_location_id) into v_workspace_id
      from public.project_location_images where id = new.entity_id;
    when 'project_shipment_photo' then
      select public.project_shipment_owner_workspace_id(shipment_id) into v_workspace_id
      from public.project_shipment_photos where id = new.entity_id;
    else
      raise exception 'deletion_log: unrecognized entity_type "%" -- add a resolution case to derive_deletion_log_workspace_id() before logging this entity type.', new.entity_type;
  end case;

  new.workspace_id := v_workspace_id;
  return new;
end;
$$;

revoke all on function public.derive_deletion_log_workspace_id() from public;
revoke execute on function public.derive_deletion_log_workspace_id() from anon;
revoke execute on function public.derive_deletion_log_workspace_id() from authenticated;

drop trigger if exists deletion_log_derive_workspace_id on public.deletion_log;
create trigger deletion_log_derive_workspace_id
  before insert on public.deletion_log
  for each row execute function public.derive_deletion_log_workspace_id();

-- ============================================================
-- Section 3 -- SELECT policy: workspace-scoped for real rows, still
-- visible to everyone for the deliberately-null ones (global entity
-- types and the two known residual-gap types). is_workspace_member()
-- (migration 115) is used here rather than resolve_caller_workspace_id()
-- deliberately -- the latter RAISES on zero or ambiguous active
-- membership, which would be unsafe inside a bare RLS USING clause
-- (it would turn "this caller should see nothing" into a hard query
-- error); is_workspace_member() is a plain boolean, exactly the same
-- pattern every other Stage 1-4 read policy in this repo already uses
-- (e.g. migration 157's `using (public.is_workspace_member(workspace_id))`
-- on `projects`). The existing INSERT policy is untouched -- it was
-- already `with check(true)`, and stays that way: workspace_id is never
-- client-trusted regardless (Section 2's trigger always overwrites it),
-- so the permissive check on it is correct, not a gap.
-- ============================================================

drop policy if exists "authenticated read deletion_log" on public.deletion_log;
create policy "workspace members read deletion_log"
  on public.deletion_log for select to authenticated
  using (workspace_id is null or public.is_workspace_member(workspace_id));

commit;
