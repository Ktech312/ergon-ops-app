-- Migration 218: workspace_enabled_modules -- Phase 4 (guided onboarding)
-- decision-free foundation, "enabled modules" piece. E's own answer to the
-- one genuine open design question this required (2026-09-26), reproduced
-- so the reasoning below can be checked against it directly:
--
--   "Disabling a module removes it from navigation and access for everyone
--   in that workspace immediately, including existing members. Preserve
--   its data so re-enabling restores access. Block direct URL access and
--   backend operations for disabled modules. Workspace admins must retain
--   access to the module-settings control needed to re-enable it. Record
--   enable/disable changes in the audit log."
--
-- ============================================================
-- Design: workspace_enabled_modules is opt-OUT, not opt-in -- a workspace
-- with no row for a given module_key is treated as ENABLED (is_module_
-- enabled() below coalesces a missing row to true). This means every
-- existing workspace (K-Tech, Ergon itself, any future company) needs
-- zero backfill and sees zero behavior change until a workspace admin
-- explicitly disables something. Only a disable ever needs a row.
--
-- Writes happen exclusively through set_workspace_module_enabled(), a
-- SECURITY DEFINER RPC (same posture as migration 198's suspend_company/
-- reactivate_company) -- the table itself grants authenticated SELECT
-- only, no direct insert/update/delete. Every enable/disable call writes
-- one audit row to the new workspace_module_audit_log table in the same
-- implicit transaction, satisfying the audit requirement above.
--
-- Backend enforcement ("block ... backend operations for disabled
-- modules") is added in this same migration for the Support and
-- Engineering modules specifically -- these are the two most recent,
-- fully self-contained modules (migrations 200/201), each with a small,
-- unambiguous set of dedicated tables and no cross-module table sharing,
-- making them safe to gate in one pass. Generalizing this same trigger
-- pattern to every other toggleable module (purchasing, inventory,
-- vendors, projects, sales, marketing, client_ledger, reports,
-- saas_calendar, library) is NOT done here -- several of those tables
-- (e.g. projects) are read across multiple views/modules at once, and
-- gating them correctly needs its own careful per-table audit rather
-- than being rushed alongside this migration. This is a deliberate,
-- explicitly-scoped follow-up, recorded in HANDOFF.md, not an oversight.
-- The frontend enforcement (nav hiding + direct-URL/route redirect) is
-- generic and applies to every toggleable module, not just these two.
-- ============================================================

begin;

create table if not exists public.workspace_enabled_modules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  module_key text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (workspace_id, module_key)
);

create index if not exists idx_workspace_enabled_modules_workspace_id
  on public.workspace_enabled_modules(workspace_id);

alter table public.workspace_enabled_modules enable row level security;

create policy "members read own workspace enabled modules"
  on public.workspace_enabled_modules for select to authenticated
  using (public.is_app_admin(auth.uid()) or public.is_workspace_member(workspace_id));

revoke all on public.workspace_enabled_modules from public;
revoke all on public.workspace_enabled_modules from anon;
grant select on public.workspace_enabled_modules to authenticated;

create or replace function public.is_module_enabled(check_workspace_id uuid, check_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select enabled from public.workspace_enabled_modules
     where workspace_id = check_workspace_id and module_key = check_module_key),
    true
  );
$$;

revoke all on function public.is_module_enabled(uuid, text) from public;
revoke execute on function public.is_module_enabled(uuid, text) from anon;
grant execute on function public.is_module_enabled(uuid, text) to authenticated;

-- ============================================================
-- Audit log. Deliberately separate from company_admin_audit_log
-- (migration 198) -- that table is platform-level (a workspace's own
-- lifecycle, read only by is_platform_admin()); this one is a workspace's
-- own admin action, read by that workspace's own admins.
-- ============================================================

create table if not exists public.workspace_module_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  module_key text not null,
  action text not null check (action in ('enabled', 'disabled')),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_workspace_module_audit_log_workspace_id
  on public.workspace_module_audit_log(workspace_id, created_at desc);

alter table public.workspace_module_audit_log enable row level security;

create policy "workspace admins read own workspace module audit log"
  on public.workspace_module_audit_log for select to authenticated
  using (
    public.is_app_admin(auth.uid())
    or (public.is_active_workspace_member(workspace_id) and public.is_workspace_admin(workspace_id))
  );

revoke all on public.workspace_module_audit_log from public;
revoke all on public.workspace_module_audit_log from anon;
grant select on public.workspace_module_audit_log to authenticated;

create or replace function public.set_workspace_module_enabled(p_module_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  v_workspace_id := public.resolve_caller_workspace_id();

  if not (public.is_app_admin(auth.uid()) or public.is_workspace_admin(v_workspace_id)) then
    raise exception 'Only a workspace admin may change module settings';
  end if;

  insert into public.workspace_enabled_modules (workspace_id, module_key, enabled, updated_at, updated_by)
  values (v_workspace_id, p_module_key, p_enabled, clock_timestamp(), auth.uid())
  on conflict (workspace_id, module_key)
  do update set enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  insert into public.workspace_module_audit_log (workspace_id, actor_user_id, module_key, action)
  values (v_workspace_id, auth.uid(), p_module_key, case when p_enabled then 'enabled' else 'disabled' end);
end;
$$;

revoke all on function public.set_workspace_module_enabled(text, boolean) from public;
revoke execute on function public.set_workspace_module_enabled(text, boolean) from anon;
grant execute on function public.set_workspace_module_enabled(text, boolean) to authenticated;

-- ============================================================
-- Backend enforcement -- Support module. Data is preserved (no delete,
-- no column change) -- disabling only blocks reads/writes going forward;
-- re-enabling restores full access to everything already there.
-- ============================================================

create or replace function public.guard_support_case_module_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_module_enabled(new.workspace_id, 'support') then
    raise exception 'The Support module is disabled for this workspace';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_support_case_module_enabled() from public;

drop trigger if exists support_cases_guard_module_enabled on public.support_cases;
create trigger support_cases_guard_module_enabled
  before insert or update on public.support_cases
  for each row execute function public.guard_support_case_module_enabled();

drop policy if exists "workspace members read support_cases" on public.support_cases;
create policy "workspace members read support_cases"
  on public.support_cases for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.is_module_enabled(workspace_id, 'support'));

create or replace function public.guard_support_case_child_module_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_module_enabled(public.support_case_owner_workspace_id(new.support_case_id), 'support') then
    raise exception 'The Support module is disabled for this workspace';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_support_case_child_module_enabled() from public;

drop trigger if exists support_case_assets_guard_module_enabled on public.support_case_assets;
create trigger support_case_assets_guard_module_enabled
  before insert on public.support_case_assets
  for each row execute function public.guard_support_case_child_module_enabled();

drop trigger if exists support_case_activity_guard_module_enabled on public.support_case_activity;
create trigger support_case_activity_guard_module_enabled
  before insert on public.support_case_activity
  for each row execute function public.guard_support_case_child_module_enabled();

drop policy if exists "workspace members read support_case_assets" on public.support_case_assets;
create policy "workspace members read support_case_assets"
  on public.support_case_assets for select to authenticated
  using (
    public.is_workspace_member(public.support_case_owner_workspace_id(support_case_id))
    and public.is_module_enabled(public.support_case_owner_workspace_id(support_case_id), 'support')
  );

drop policy if exists "workspace members read support_case_activity" on public.support_case_activity;
create policy "workspace members read support_case_activity"
  on public.support_case_activity for select to authenticated
  using (
    public.is_workspace_member(public.support_case_owner_workspace_id(support_case_id))
    and public.is_module_enabled(public.support_case_owner_workspace_id(support_case_id), 'support')
  );

-- ============================================================
-- Backend enforcement -- Engineering module. Same shape as Support above.
-- ============================================================

create or replace function public.guard_product_request_module_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_module_enabled(new.workspace_id, 'engineering_requests') then
    raise exception 'The Engineering module is disabled for this workspace';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_product_request_module_enabled() from public;

drop trigger if exists product_requests_guard_module_enabled on public.product_requests;
create trigger product_requests_guard_module_enabled
  before insert or update on public.product_requests
  for each row execute function public.guard_product_request_module_enabled();

drop policy if exists "workspace members read product_requests" on public.product_requests;
create policy "workspace members read product_requests"
  on public.product_requests for select to authenticated
  using (public.is_workspace_member(workspace_id) and public.is_module_enabled(workspace_id, 'engineering_requests'));

create or replace function public.guard_product_request_review_module_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_module_enabled(public.product_request_owner_workspace_id(new.product_request_id), 'engineering_requests') then
    raise exception 'The Engineering module is disabled for this workspace';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_product_request_review_module_enabled() from public;

drop trigger if exists product_request_reviews_guard_module_enabled on public.product_request_reviews;
create trigger product_request_reviews_guard_module_enabled
  before insert on public.product_request_reviews
  for each row execute function public.guard_product_request_review_module_enabled();

drop policy if exists "workspace members read product_request_reviews" on public.product_request_reviews;
create policy "workspace members read product_request_reviews"
  on public.product_request_reviews for select to authenticated
  using (
    public.is_workspace_member(public.product_request_owner_workspace_id(product_request_id))
    and public.is_module_enabled(public.product_request_owner_workspace_id(product_request_id), 'engineering_requests')
  );

commit;

-- Confirm 219 is still the next free migration number before running any
-- migration this session generates after this one. Not applied. Kept
-- local for E's review.
