-- Phase 3 final scoping pass (overnight, 2026-09-19) -- E's standing
-- default: "each company should have its own separate copies, this
-- should not be a question." `product_catalog` (migration 013) is
-- confirmed this-company-specific, not a neutral shared vendor parts
-- list, re-checked directly from source before writing this: every
-- commercial column (`default_sell_price`, `unit_cost`,
-- `markup_percent`, `cost_source`, `billing_frequency`) is a pricing/
-- sales decision, the seed history is explicitly "Ergon's own PandaDoc
-- product export" (migrations 046/051), and the UI's own category set
-- is hard-coded to Ergon's chosen 9 categories (migration 051's own
-- header). Nothing in the schema or UI models a shared/vendor-wide
-- parts list. `catalog_price_change_requests` is a direct, mandatory,
-- cascading FK child (`catalog_item_id ... on delete cascade`,
-- migration 046) -- inherits scoping via that anchor, same pattern as
-- migration 173's `project_schedule_template_phases`.
--
-- Confirm 176 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- product_catalog: root table, no anchor -- same pattern
-- as clients/vendors/team_members.
-- ============================================================

alter table public.product_catalog
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_product_catalog_workspace_id on public.product_catalog(workspace_id);

update public.product_catalog
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.product_catalog where workspace_id is null) then
    raise exception 'backfill incomplete: product_catalog.workspace_id still has nulls';
  end if;
end $$;

alter table public.product_catalog alter column workspace_id set not null;

drop trigger if exists product_catalog_guard_workspace_id on public.product_catalog;
create trigger product_catalog_guard_workspace_id
  before insert or update on public.product_catalog
  for each row execute function public.guard_workspace_id_mutation();

alter table public.product_catalog drop constraint product_catalog_catalog_number_key;
alter table public.product_catalog add constraint product_catalog_workspace_id_catalog_number_key unique (workspace_id, catalog_number);

drop policy if exists "authenticated read product_catalog" on public.product_catalog;
drop policy if exists "manager and admin write product_catalog" on public.product_catalog;

create policy "workspace members read product_catalog"
  on public.product_catalog for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: manager and admin write product_catalog"
  on public.product_catalog for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('manager'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('manager'))
  );

-- ============================================================
-- Section 2 -- catalog_price_change_requests: derive workspace_id from
-- its mandatory parent, same dedicated-trigger pattern as migration
-- 173's project_schedule_template_phases (never falls back to the
-- caller's own workspace -- it always has a real anchor).
-- ============================================================

alter table public.catalog_price_change_requests
  add column if not exists workspace_id uuid references public.workspaces(id);

create index if not exists idx_catalog_price_change_requests_workspace_id on public.catalog_price_change_requests(workspace_id);

update public.catalog_price_change_requests r
set workspace_id = pc.workspace_id
from public.product_catalog pc
where r.catalog_item_id = pc.id
  and r.workspace_id is null;

do $$
begin
  if exists (select 1 from public.catalog_price_change_requests where workspace_id is null) then
    raise exception 'backfill incomplete: catalog_price_change_requests.workspace_id still has nulls';
  end if;
end $$;

alter table public.catalog_price_change_requests alter column workspace_id set not null;

create or replace function public.guard_catalog_price_change_request_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.workspace_id := (select workspace_id from public.product_catalog where id = new.catalog_item_id);
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

revoke all on function public.guard_catalog_price_change_request_workspace_id_mutation() from public;

drop trigger if exists catalog_price_change_requests_guard_workspace_id on public.catalog_price_change_requests;
create trigger catalog_price_change_requests_guard_workspace_id
  before insert or update on public.catalog_price_change_requests
  for each row execute function public.guard_catalog_price_change_request_workspace_id_mutation();

-- RLS: the existing policies mix a "requester's own row" check (by
-- email) with an admin/manager review check -- both ANDed with
-- workspace membership below, never replaced. No DELETE policy exists
-- today (confirmed from source) and none is added here.

drop policy if exists "authenticated create own price change requests" on public.catalog_price_change_requests;
drop policy if exists "requester and admin/manager read price change requests" on public.catalog_price_change_requests;
drop policy if exists "admin/manager review price change requests" on public.catalog_price_change_requests;

create policy "workspace members create own price change requests"
  on public.catalog_price_change_requests for insert to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and lower(requested_by_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "workspace members: requester and admin/manager read price change requests"
  on public.catalog_price_change_requests for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (
      lower(requested_by_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      or public.is_app_admin(auth.uid())
      or public.has_role('manager')
    )
  );

create policy "workspace members: admin/manager review price change requests"
  on public.catalog_price_change_requests for update to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('manager'))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('manager'))
  );

commit;
