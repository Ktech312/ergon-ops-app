-- Phase 3 final scoping pass (overnight, 2026-09-19) -- extends E's
-- standing decision from migration 173 ("each company should have its
-- own separate copies, this should not be a question") to three more
-- admin-configured library tables that a PRIOR, now-superseded draft
-- pass (migration 166's own header, written before E's ruling) had
-- classified as "genuinely global, no workspace concept at all":
-- `presales_hardware_rules`, `site_hardware_rules`, `form_schema_fields`
-- (+ its parent `form_schemas`). These are the exact same shape as
-- `notification_rules`/`standard_install_times`/`project_schedule_templates`
-- -- admin-configured rule/definition libraries with no per-row
-- customer/project anchor -- and nothing distinguishes them from those
-- three in a way that would justify a different answer. Re-confirmed
-- directly from source before writing this, not from migration 166's
-- stale classification:
--
--   - `presales_hardware_rules` (migration 028) -- flat, tier-keyed
--     rules feeding BOM auto-generation. Natural key:
--     `(tier, base_item_name)`.
--   - `site_hardware_rules` (migration 045) -- flat, metric-keyed rules,
--     same shape. Natural key: `(metric, item_name)`.
--   - `form_schemas` (migration 026) -- form DEFINITIONS (e.g.
--     "after_sales_handover", "sales_site_intake"), keyed by
--     `form_key`. Two different companies plausibly want different
--     handover/intake questions, same reasoning as schedule templates.
--   - `form_schema_fields` (migration 026) -- direct, mandatory,
--     cascading FK child of `form_schemas` -- inherits scoping via that
--     anchor, same pattern as `project_schedule_template_phases`.
--   - `project_handovers` (migration 026) and
--     `sales_quote_intake_responses` (migration 058) both reference
--     `form_schema_id` directly and mandatorily -- both are ALSO
--     one-hop children of `project_id`/`quote_id` respectively (already
--     workspace-scoped tables), which is the anchor actually used here,
--     not `form_schema_id` -- a response row's workspace is the
--     PROJECT's or QUOTE's workspace, not incidentally whichever
--     workspace's copy of the form schema it happened to be filled out
--     against.
--
-- Also closes the matching follow-up: migration 166's
-- `derive_deletion_log_workspace_id()` hard-coded `null` for
-- `presales_hardware_rule`/`site_hardware_rule`/`form_schema_field`
-- (the same stale classification) -- fixed here via a plain lookup,
-- same technique migration 173 already used for `schedule_template_phase`
-- (all three of these are soft-deleted, migration 088, so the row still
-- exists when the log write happens -- no atomic-RPC situation).
-- Migration 166 itself is not edited or rerun.
--
-- Confirm 177 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- presales_hardware_rules: root table, no anchor.
-- ============================================================

alter table public.presales_hardware_rules
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_presales_hardware_rules_workspace_id on public.presales_hardware_rules(workspace_id);

update public.presales_hardware_rules
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.presales_hardware_rules where workspace_id is null) then
    raise exception 'backfill incomplete: presales_hardware_rules.workspace_id still has nulls';
  end if;
end $$;

alter table public.presales_hardware_rules alter column workspace_id set not null;

drop trigger if exists presales_hardware_rules_guard_workspace_id on public.presales_hardware_rules;
create trigger presales_hardware_rules_guard_workspace_id
  before insert or update on public.presales_hardware_rules
  for each row execute function public.guard_workspace_id_mutation();

drop index if exists idx_presales_rules_tier_item;
create unique index idx_presales_hardware_rules_workspace_id_tier_item
  on public.presales_hardware_rules(workspace_id, tier, base_item_name);

drop policy if exists "authenticated read presales_hardware_rules" on public.presales_hardware_rules;
drop policy if exists "pm and admin write presales_hardware_rules" on public.presales_hardware_rules;

create policy "workspace members read presales_hardware_rules"
  on public.presales_hardware_rules for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: pm and admin write presales_hardware_rules"
  on public.presales_hardware_rules for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

-- ============================================================
-- Section 2 -- site_hardware_rules: root table, no anchor.
-- ============================================================

alter table public.site_hardware_rules
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_site_hardware_rules_workspace_id on public.site_hardware_rules(workspace_id);

update public.site_hardware_rules
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.site_hardware_rules where workspace_id is null) then
    raise exception 'backfill incomplete: site_hardware_rules.workspace_id still has nulls';
  end if;
end $$;

alter table public.site_hardware_rules alter column workspace_id set not null;

drop trigger if exists site_hardware_rules_guard_workspace_id on public.site_hardware_rules;
create trigger site_hardware_rules_guard_workspace_id
  before insert or update on public.site_hardware_rules
  for each row execute function public.guard_workspace_id_mutation();

drop index if exists idx_site_hardware_rules_metric_item;
create unique index idx_site_hardware_rules_workspace_id_metric_item
  on public.site_hardware_rules(workspace_id, metric, item_name);

drop policy if exists "authenticated read site_hardware_rules" on public.site_hardware_rules;
drop policy if exists "pm manager and admin write site_hardware_rules" on public.site_hardware_rules;

create policy "workspace members read site_hardware_rules"
  on public.site_hardware_rules for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: pm manager and admin write site_hardware_rules"
  on public.site_hardware_rules for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm') or public.has_role('manager'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm') or public.has_role('manager'))
  );

-- ============================================================
-- Section 3 -- form_schemas: root table, no anchor.
-- ============================================================

alter table public.form_schemas
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_form_schemas_workspace_id on public.form_schemas(workspace_id);

update public.form_schemas
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.form_schemas where workspace_id is null) then
    raise exception 'backfill incomplete: form_schemas.workspace_id still has nulls';
  end if;
end $$;

alter table public.form_schemas alter column workspace_id set not null;

drop trigger if exists form_schemas_guard_workspace_id on public.form_schemas;
create trigger form_schemas_guard_workspace_id
  before insert or update on public.form_schemas
  for each row execute function public.guard_workspace_id_mutation();

alter table public.form_schemas drop constraint form_schemas_form_key_key;
alter table public.form_schemas add constraint form_schemas_workspace_id_form_key_key unique (workspace_id, form_key);

drop policy if exists "authenticated read form_schemas" on public.form_schemas;
drop policy if exists "pm and admin write form_schemas" on public.form_schemas;

create policy "workspace members read form_schemas"
  on public.form_schemas for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: pm and admin write form_schemas"
  on public.form_schemas for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

-- ============================================================
-- Section 4 -- form_schema_fields: derive from its mandatory parent,
-- same dedicated-trigger pattern as migration 173/176's child tables.
-- ============================================================

alter table public.form_schema_fields
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_form_schema_fields_workspace_id on public.form_schema_fields(workspace_id);

update public.form_schema_fields f
set workspace_id = s.workspace_id
from public.form_schemas s
where f.form_schema_id = s.id
  and f.workspace_id is null;

do $$
begin
  if exists (select 1 from public.form_schema_fields where workspace_id is null) then
    raise exception 'backfill incomplete: form_schema_fields.workspace_id still has nulls';
  end if;
end $$;

alter table public.form_schema_fields alter column workspace_id set not null;

create or replace function public.guard_form_schema_field_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.workspace_id := (select workspace_id from public.form_schemas where id = new.form_schema_id);
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

revoke all on function public.guard_form_schema_field_workspace_id_mutation() from public;

drop trigger if exists form_schema_fields_guard_workspace_id on public.form_schema_fields;
create trigger form_schema_fields_guard_workspace_id
  before insert or update on public.form_schema_fields
  for each row execute function public.guard_form_schema_field_workspace_id_mutation();

drop policy if exists "authenticated read form_schema_fields" on public.form_schema_fields;
drop policy if exists "pm and admin write form_schema_fields" on public.form_schema_fields;

create policy "workspace members read form_schema_fields"
  on public.form_schema_fields for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: pm and admin write form_schema_fields"
  on public.form_schema_fields for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm'))
  );

-- ============================================================
-- Section 5 -- deletion_log follow-up: presales_hardware_rule/
-- site_hardware_rule/form_schema_field were classified "genuinely
-- global" by migration 166 -- no longer true. All three are
-- soft-deleted (migration 088), so this is a plain lookup, not an
-- atomic-RPC situation. Every other CASE branch carried forward
-- verbatim from migration 173's own version, only these three changed.
-- Migration 166 itself is not edited or rerun.
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
      select workspace_id into v_workspace_id from public.form_schema_fields where id = new.entity_id;
    when 'presales_hardware_rule' then
      select workspace_id into v_workspace_id from public.presales_hardware_rules where id = new.entity_id;
    when 'site_hardware_rule' then
      select workspace_id into v_workspace_id from public.site_hardware_rules where id = new.entity_id;
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
