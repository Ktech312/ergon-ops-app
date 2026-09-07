-- Phase 1 of Ergon's productization tenant-isolation work (see
-- PRODUCT_TENANCY_AUDIT.md and PRODUCT_PHASE1_PLAN.md, Revision 4 --
-- approved by E after three review rounds). Fully additive: no existing
-- table, column, policy, function, or row is altered by this migration.
-- No existing route, RLS policy, or workflow changes behavior as a
-- result of this file running -- it only creates new, currently-unused
-- structure and copies (never moves) existing admin/role assignments
-- into it, for exactly one workspace ("ensight", the existing Ergon/
-- Ensight company). See PRODUCT_PHASE1_PLAN.md for the full design
-- rationale, security analysis, executable tests, and rollback script --
-- this file is the SQL alone, not a substitute for reading that plan.
--
-- Before running this migration: run the three preflight queries in
-- PRODUCT_PHASE1_PLAN.md (also reproduced in HANDOFF.md) against
-- production. If any of them return rows, STOP and resolve the
-- underlying data issue manually before proceeding -- do not run this
-- migration until all three return zero rows.
--
-- platform_admins ships EMPTY. No account -- including today's sole
-- app_admins account -- is granted platform-admin status by this
-- migration. That is a separate, later, explicitly-approved action (see
-- the bootstrap procedure in PRODUCT_PHASE1_PLAN.md).

-- ============================================================
-- Section 1 -- Tables
-- ============================================================

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per (workspace, user) -- membership and admin status ONLY.
-- Operational roles live in workspace_member_roles, so a workspace admin
-- can validly exist with zero operational roles (no fallback role is
-- ever assigned -- see Section 5).
create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_workspace_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

-- One row per (workspace_member, role) -- mirrors app_user_roles'
-- existing shape (one row per user per role_key, an is_primary flag),
-- scoped to a workspace_members row instead of a bare user_id.
--
-- TRANSITIONAL LIMITATION, documented on purpose: this role_key list is
-- copied verbatim from app_user_roles' own existing check constraint. It
-- must become workspace-configurable before a second company can define
-- its own role vocabulary -- expanding or generalizing it now would be
-- scope creep with no current use, since only one workspace (Ensight)
-- exists and it already uses exactly this vocabulary. Revisit in the
-- phase that actually onboards a second company
-- (PRODUCT_TENANCY_AUDIT.md §9).
create table if not exists public.workspace_member_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_member_id uuid not null references public.workspace_members(id) on delete cascade,
  role_key text not null check (role_key in (
    'warehouse', 'purchasing', 'pm', 'manager',
    'sales', 'engineering', 'product_development', 'implementation', 'support', 'marketing'
  )),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_member_id, role_key)
);

-- A REAL, database-enforced constraint (unlike app_user_roles' own
-- non-unique idx_app_user_roles_primary, migration 040:29, whose own
-- comment admits it is app-layer-only) -- Postgres rejects any second
-- insert/update setting is_primary = true for a workspace_member_id that
-- already has one primary role, for every writer, not just this app's
-- code.
create unique index if not exists idx_workspace_member_roles_one_primary
  on public.workspace_member_roles(workspace_member_id) where is_primary;

-- Deliberately small and separate from workspace_members -- platform-
-- admin access is a distinct, more sensitive concept from workspace
-- administration. No rows are inserted by this migration; see the
-- bootstrap procedure in PRODUCT_PHASE1_PLAN.md.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Section 2 -- Helper functions
-- ============================================================
-- Every function is `security definer` with `set search_path = ''` and
-- fully schema-qualifies every table reference (public.x, auth.users) --
-- no schema is implicitly searched, closing the search-path-injection
-- class of vulnerability. Every function evaluates the AUTHENTICATED
-- CALLER internally via auth.uid() rather than accepting an arbitrary
-- acting-user id as a parameter -- an RLS policy only ever needs to ask
-- "can the current caller do this," never "can some other named user do
-- this," so there is no reason for any of these to accept one. This also
-- means a caller who invokes one of these directly via PostgREST's
-- rpc/<name> endpoint (unavoidable for any function callable from an RLS
-- policy) can only ever learn something about themselves, never probe an
-- arbitrary pair of other users' relationships.

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(check_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = check_workspace_id
      and wm.user_id = auth.uid()
      and wm.is_workspace_admin
  );
$$;

create or replace function public.is_workspace_member(check_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = check_workspace_id and wm.user_id = auth.uid()
  );
$$;

-- Answers exactly the question the calling policy needs: "does this
-- specific workspace_member_roles row belong to the current caller?"
-- Never returns or exposes any identifier.
create or replace function public.is_workspace_member_owner(check_member_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.id = check_member_id and wm.user_id = auth.uid()
  );
$$;

-- Answers "can the current caller manage this workspace_member_roles
-- row?" (i.e. are they a workspace admin of the same workspace that
-- member belongs to) in one boolean, so no workspace identifier is ever
-- handed back to a policy that only needed a yes/no.
create or replace function public.can_manage_workspace_member(check_member_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members target
    join public.workspace_members admin_row
      on admin_row.workspace_id = target.workspace_id
    where target.id = check_member_id
      and admin_row.user_id = auth.uid()
      and admin_row.is_workspace_admin
  );
$$;

-- Convenience helper for the future resolveActiveWorkspace() server
-- pattern (PRODUCT_PHASE1_PLAN.md) -- not called by any existing code
-- yet, and not wired into any route by this migration.
create or replace function public.current_user_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.workspace_members where user_id = auth.uid();
$$;

-- Not security definer, and not in scope for the search-path hardening
-- above -- this trigger touches no schema-qualified object (only a
-- record field and the built-in now(), which resolves via pg_catalog
-- regardless of search_path).
create or replace function public.set_workspace_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- Section 2b -- Explicit grants
-- ============================================================
-- Postgres grants EXECUTE to PUBLIC automatically on function creation.
-- Every function above has that default explicitly revoked, then
-- re-granted only to `authenticated` -- no function here is callable by
-- an anonymous visitor, and none is left at Postgres's permissive
-- default (stricter than this codebase's existing is_app_admin()/
-- has_role(), which still carry that default today -- not touched by
-- this migration).

revoke execute on function public.is_platform_admin() from public;
revoke execute on function public.is_workspace_admin(uuid) from public;
revoke execute on function public.is_workspace_member(uuid) from public;
revoke execute on function public.is_workspace_member_owner(uuid) from public;
revoke execute on function public.can_manage_workspace_member(uuid) from public;
revoke execute on function public.current_user_workspace_ids() from public;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_member_owner(uuid) to authenticated;
grant execute on function public.can_manage_workspace_member(uuid) to authenticated;
grant execute on function public.current_user_workspace_ids() to authenticated;

-- ============================================================
-- Section 3 -- RLS enable + policies
-- ============================================================
-- No policy below contains a raw subquery against an RLS-protected
-- table -- every cross-row check goes through a Section 2 function,
-- applied uniformly to avoid any self-referencing recursion (the
-- mechanism this relies on -- a security definer function's owner
-- bypassing that table's own RLS -- is the same one is_app_admin()
-- already relies on safely in production today).

alter table public.workspaces enable row level security;

create policy "members and platform admins read workspaces"
  on public.workspaces for select to authenticated
  using (public.is_platform_admin() or public.is_workspace_member(id));

create policy "platform admins manage workspaces"
  on public.workspaces for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter table public.workspace_members enable row level security;

create policy "users read their own membership"
  on public.workspace_members for select to authenticated
  using (auth.uid() = user_id);

create policy "workspace admins read memberships in their own workspace"
  on public.workspace_members for select to authenticated
  using (public.is_workspace_admin(workspace_id));

create policy "platform admins read all memberships"
  on public.workspace_members for select to authenticated
  using (public.is_platform_admin());

create policy "workspace admins manage memberships in their own workspace"
  on public.workspace_members for all to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create policy "platform admins manage all memberships"
  on public.workspace_members for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter table public.workspace_member_roles enable row level security;

create policy "users read their own role rows"
  on public.workspace_member_roles for select to authenticated
  using (public.is_workspace_member_owner(workspace_member_id));

create policy "workspace admins manage role rows in their own workspace"
  on public.workspace_member_roles for all to authenticated
  using (public.can_manage_workspace_member(workspace_member_id))
  with check (public.can_manage_workspace_member(workspace_member_id));

create policy "platform admins manage all role rows"
  on public.workspace_member_roles for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter table public.platform_admins enable row level security;

create policy "platform admins read platform admin list"
  on public.platform_admins for select to authenticated
  using (public.is_platform_admin());

create policy "platform admins manage platform admin list"
  on public.platform_admins for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ============================================================
-- Section 4 -- Triggers
-- ============================================================

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_workspace_updated_at();

drop trigger if exists workspace_members_set_updated_at on public.workspace_members;
create trigger workspace_members_set_updated_at
  before update on public.workspace_members
  for each row execute function public.set_workspace_updated_at();

-- ============================================================
-- Section 5 -- Data migration (seed the first workspace, carry over
-- existing admin/role assignments)
-- ============================================================

-- 1. Seed the one workspace. Uses a scalar subquery inside VALUES, not an
-- INSERT ... SELECT ... FROM company_branding -- the latter would
-- silently insert NOTHING if company_branding had zero rows. A scalar
-- subquery used as a plain value expression evaluates to NULL when it
-- matches no rows (well-defined SQL behavior), so coalesce reliably
-- falls back to the literal default name either way, and exactly one
-- workspace row is always created.
insert into public.workspaces (name, slug)
values (
  coalesce((select company_name from public.company_branding where id = true), 'Ensight Technologies'),
  'ensight'
)
on conflict (slug) do nothing;

-- 2. One workspace_members row for every distinct user who has EITHER an
-- existing app_admins row OR an app_user_roles row -- so an admin with
-- no operational role still becomes a real member, with
-- is_workspace_admin set directly from app_admins and NO fallback role
-- assigned to anyone.
insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
select
  w.id,
  u.user_id,
  exists (select 1 from app_admins aa where aa.user_id = u.user_id)
from (
  select user_id from app_user_roles
  union
  select user_id from app_admins
) u
cross join (select id from public.workspaces where slug = 'ensight') w
on conflict (workspace_id, user_id) do nothing;

-- 3. Carry over every existing (user, role) assignment. An admin with no
-- app_user_roles row gets no rows here -- correct and intentional, not a
-- gap to fill.
insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
select wm.id, aur.role_key, aur.is_primary
from app_user_roles aur
join public.workspace_members wm
  on wm.user_id = aur.user_id
  and wm.workspace_id = (select id from public.workspaces where slug = 'ensight')
on conflict (workspace_member_id, role_key) do nothing;
