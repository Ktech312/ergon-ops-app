-- Phase 3, Stage 5 -- E's explicit decision, 2026-09-18: `notification_rules`,
-- `standard_install_times`, `project_schedule_templates` (+ its child
-- `project_schedule_template_phases`) currently have exactly ONE shared
-- copy each, used by every workspace. E: "each company should have its
-- own separate copies, this should not be a question." This migration
-- workspace-scopes all four tables -- their entire schema, RLS, and
-- uniqueness has been global since creation (migrations 024/025) with
-- zero changes since (re-confirmed directly from source before writing
-- this, not from memory or from any planning doc).
--
-- Load-bearing facts this design depends on, each re-confirmed directly:
--
--   1. `notification_rules.event_type`'s real CHECK constraint has 14
--      values today (widened 7 times since migration 024's original 7 --
--      migrations 046/049/054/095/108/110/149), not the smaller set an
--      earlier planning note assumed. Every consumer of this table
--      (client-side `ruleActive()`, `main.tsx`, and every server-side RPC
--      that checks `is_active`) already treats a MISSING row as "this
--      event type is off" via `coalesce(..., false)` or an `undefined`
--      lookup -- never an error. This means a newly created workspace
--      with zero seeded rows does not break anything technically, but
--      DOES mean every notification type is silently off for it until
--      seeded -- a real, known, accepted consequence of not solving
--      workspace provisioning here (see point 4).
--   2. All three tables' existing role-gated write policies
--      (`is_app_admin`/`is_app_manager`/`has_role('pm')`) are, and remain,
--      completely workspace-unaware -- confirmed these role-check
--      functions never consult `workspace_members`. ANDing in a
--      workspace-membership check (`is_active_workspace_member(
--      workspace_id)`) is therefore required, not optional, or a
--      PM/admin in Workspace A could still write into Workspace B's rows
--      once they have a real `workspace_id` to target.
--   3. `project_schedule_template_phases` is SOFT-deleted (a `PATCH`
--      setting `deleted_at`/`deleted_by_email`,
--      `deleteScheduleTemplatePhase()` in `src/persistence.ts`), unlike
--      `inventory_item`/`equipment_type` (migration 172) -- the row still
--      exists at the moment its `deletion_log` entry is written, so
--      unlike those two, no atomic RPC is needed here: migration 166's
--      `derive_deletion_log_workspace_id()` can simply look the real
--      column up now that one exists, same as every other soft-deleted
--      entity type it already handles correctly.
--   4. Auto-seeding a brand-new workspace's own default
--      `notification_rules`/`standard_install_times`/
--      `project_schedule_templates` rows is DELIBERATELY NOT done here --
--      identical reasoning to migration 162's own deferral of
--      auto-seeding a new workspace's default channels: no reviewed,
--      trusted workspace-creation path exists yet (Stage 7, "company
--      onboarding and no-code workspace configuration," has not started).
--      Bolting seed logic onto `workspaces` INSERT now would either trust
--      a caller-supplied `workspace_id` (reopening exactly the spoofing
--      gap `guard_workspace_id_mutation()` exists to close) or invent an
--      unreviewed bypass. Belongs with Stage 7's own reviewed provisioning
--      procedure, tracked in `PRODUCT_MASTER_COMPLETION_PLAN.md`.
--   5. `standard_install_times.category`'s existing partial unique index
--      is the literal upsert conflict target the client already relies on
--      (`upsertStandardInstallTime()`, `POST
--      standard_install_times?on_conflict=category`). Once this becomes a
--      composite `(workspace_id, category)` index, that PostgREST
--      `on_conflict` parameter MUST also change to name both columns, or
--      every save of this table starts failing immediately -- this is a
--      real, coordinated frontend change (in the companion commit), not
--      optional cleanup. Unlike migration 172's RPC change, the risk here
--      runs the OTHER direction: this migration alone, without its
--      frontend companion, temporarily breaks `upsertStandardInstallTime()`
--      for every workspace (the old `on_conflict=category` no longer
--      matches any real constraint) -- the frontend fix must be deployed
--      immediately after this migration is confirmed, not held back this
--      time.
--
-- Confirm 173 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- Schema: nullable for now, backfilled below, then locked
-- down NOT NULL in this same transaction (same three-step shape as
-- every other Stage 1-4/5 workspace_id rollout).
-- ============================================================

alter table public.notification_rules
  add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.standard_install_times
  add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.project_schedule_templates
  add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.project_schedule_template_phases
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_notification_rules_workspace_id on public.notification_rules(workspace_id);
create index if not exists idx_standard_install_times_workspace_id on public.standard_install_times(workspace_id);
create index if not exists idx_project_schedule_templates_workspace_id on public.project_schedule_templates(workspace_id);
create index if not exists idx_project_schedule_template_phases_workspace_id on public.project_schedule_template_phases(workspace_id);

-- ============================================================
-- Section 2 -- Backfill. notification_rules/standard_install_times/
-- project_schedule_templates have no anchor of their own (they are the
-- root of their own domain) -- fall back directly to this database's
-- one existing workspace, same pattern as every other Stage 1-4/5
-- backfill with no better anchor available.
-- project_schedule_template_phases DOES have a real anchor
-- (`template_id`, not null) -- backfilled from its own parent, not the
-- fallback.
-- ============================================================

update public.notification_rules
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

update public.standard_install_times
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

update public.project_schedule_templates
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

update public.project_schedule_template_phases p
set workspace_id = t.workspace_id
from public.project_schedule_templates t
where p.template_id = t.id
  and p.workspace_id is null;

do $$
begin
  if exists (select 1 from public.notification_rules where workspace_id is null) then
    raise exception 'backfill incomplete: notification_rules.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.standard_install_times where workspace_id is null) then
    raise exception 'backfill incomplete: standard_install_times.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.project_schedule_templates where workspace_id is null) then
    raise exception 'backfill incomplete: project_schedule_templates.workspace_id still has nulls';
  end if;
  if exists (select 1 from public.project_schedule_template_phases where workspace_id is null) then
    raise exception 'backfill incomplete: project_schedule_template_phases.workspace_id still has nulls';
  end if;
end $$;

alter table public.notification_rules alter column workspace_id set not null;
alter table public.standard_install_times alter column workspace_id set not null;
alter table public.project_schedule_templates alter column workspace_id set not null;
alter table public.project_schedule_template_phases alter column workspace_id set not null;

-- ============================================================
-- Section 3 -- Ownership triggers. notification_rules/
-- standard_install_times/project_schedule_templates reuse
-- guard_workspace_id_mutation() (migration 117) verbatim -- table-agnostic,
-- already hardened, already proven correct for every other root table in
-- this repo. project_schedule_template_phases gets its OWN dedicated
-- trigger instead (same shape as migration 162's channel-specific guard)
-- -- it has a real, mandatory anchor (`template_id`, not null) to derive
-- from, so it should never fall back to the caller's own workspace the
-- way a true no-anchor table would.
-- ============================================================

drop trigger if exists notification_rules_guard_workspace_id on public.notification_rules;
create trigger notification_rules_guard_workspace_id
  before insert or update on public.notification_rules
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists standard_install_times_guard_workspace_id on public.standard_install_times;
create trigger standard_install_times_guard_workspace_id
  before insert or update on public.standard_install_times
  for each row execute function public.guard_workspace_id_mutation();

drop trigger if exists project_schedule_templates_guard_workspace_id on public.project_schedule_templates;
create trigger project_schedule_templates_guard_workspace_id
  before insert or update on public.project_schedule_templates
  for each row execute function public.guard_workspace_id_mutation();

create or replace function public.guard_schedule_template_phase_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.workspace_id := (select workspace_id from public.project_schedule_templates where id = new.template_id);
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'workspace_id is immutable through ordinary writes -- reassignment requires a separately reviewed privileged procedure';
    end if;
    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_schedule_template_phase_workspace_id_mutation() from public;

drop trigger if exists project_schedule_template_phases_guard_workspace_id on public.project_schedule_template_phases;
create trigger project_schedule_template_phases_guard_workspace_id
  before insert or update on public.project_schedule_template_phases
  for each row execute function public.guard_schedule_template_phase_workspace_id_mutation();

-- ============================================================
-- Section 4 -- Uniqueness: each table's existing global constraint
-- swapped for a composite (workspace_id, <column>) equivalent, same
-- pattern as migration 164.
-- ============================================================

alter table public.notification_rules drop constraint notification_rules_event_type_key;
alter table public.notification_rules add constraint notification_rules_workspace_id_event_type_key unique (workspace_id, event_type);

drop index if exists idx_standard_install_times_category;
drop index if exists idx_standard_install_times_item;
create unique index idx_standard_install_times_workspace_id_category
  on public.standard_install_times(workspace_id, category)
  where inventory_item_id is null;
create unique index idx_standard_install_times_workspace_id_item
  on public.standard_install_times(workspace_id, inventory_item_id)
  where inventory_item_id is not null;

alter table public.project_schedule_templates drop constraint project_schedule_templates_name_key;
alter table public.project_schedule_templates add constraint project_schedule_templates_workspace_id_name_key unique (workspace_id, name);

-- ============================================================
-- Section 5 -- RLS: workspace-scoped, ANDed with the existing role gate
-- (never replaced -- these role checks are still meaningful, just not
-- sufficient alone once a second workspace exists).
-- ============================================================

drop policy if exists "authenticated read notification_rules" on public.notification_rules;
drop policy if exists "admins and managers write notification_rules" on public.notification_rules;

create policy "workspace members read notification_rules"
  on public.notification_rules for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: admins and managers write notification_rules"
  on public.notification_rules for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.is_app_manager(auth.uid()))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.is_app_manager(auth.uid()))
  );

drop policy if exists "authenticated read standard_install_times" on public.standard_install_times;
drop policy if exists "pm and admin write standard_install_times" on public.standard_install_times;

create policy "workspace members read standard_install_times"
  on public.standard_install_times for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: pm and admin write standard_install_times"
  on public.standard_install_times for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

drop policy if exists "authenticated read project_schedule_templates" on public.project_schedule_templates;
drop policy if exists "pm and admin write project_schedule_templates" on public.project_schedule_templates;

create policy "workspace members read project_schedule_templates"
  on public.project_schedule_templates for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: pm and admin write project_schedule_templates"
  on public.project_schedule_templates for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

drop policy if exists "authenticated read project_schedule_template_phases" on public.project_schedule_template_phases;
drop policy if exists "pm and admin write project_schedule_template_phases" on public.project_schedule_template_phases;

create policy "workspace members read project_schedule_template_phases"
  on public.project_schedule_template_phases for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: pm and admin write project_schedule_template_phases"
  on public.project_schedule_template_phases for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

-- ============================================================
-- Section 6 -- deletion_log follow-up: 'schedule_template_phase' was
-- one of the four entity types migration 166 classified as "genuinely
-- global, no workspace concept" -- true at the time, no longer true now
-- that this table has a real workspace_id. Since the phase row is
-- SOFT-deleted (still exists when the log write happens), this is a
-- plain lookup, not an atomic-RPC situation like migration 172's --
-- every other CASE branch carried forward verbatim, only this one
-- changed. Migration 166 itself is not edited or rerun.
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
      select workspace_id into v_workspace_id from public.project_schedule_template_phases where id = new.entity_id;
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
      v_workspace_id := null; -- known residual gap: hard-deleted before this insert runs, see migration 172 for the atomic-RPC alternative used for new deletes
    when 'equipment_type' then
      v_workspace_id := null; -- known residual gap: hard-deleted before this insert runs, see migration 172 for the atomic-RPC alternative used for new deletes
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

commit;
