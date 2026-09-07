# Ergon Productization — Phase 1 Implementation Plan (Revision 3)

Status: **Plan for review — Phase 1 is not yet approved for implementation.** No migration file has been created, no SQL has been run against any database, no RLS policy has changed, no server route or frontend file has been edited. This revision is a final hardening pass requested by E before implementation approval — Revision 2 was approved conceptually (separated membership/role tables, slug `ensight`, no fallback role, manual Studio deployment, empty `platform_admins`, out-of-band bootstrap); this revision hardens the security-definer functions, replaces identifier-returning helpers, makes every test transaction-safe, adds preflight data checks, and fixes the `company_branding`-fallback edge case.
Created: 2026-09-08 · Revision 2: 2026-09-08 · Revision 3: 2026-09-08 (final hardening pass)
Builds on: `PRODUCT_TENANCY_AUDIT.md` (§8 architecture, §9 staged approach, §10 working decisions).

## What changed in Revision 3, and why

1. **Every `security definer` function now sets `search_path = ''` and fully schema-qualifies every table reference** (`public.workspace_members`, `public.platform_admins`, etc.), closing the search-path-injection class of vulnerability these functions were otherwise exposed to (a user able to create an object earlier in an unqualified search path could otherwise redirect what the function actually reads). Every function also has its default `PUBLIC` execute grant explicitly revoked, with execute re-granted only to `authenticated` — no function is anonymously callable, and none carries the Postgres default of "everyone can call this" that even the codebase's own pre-existing `is_app_admin()`/`has_role()` currently have.
2. **`get_workspace_member_owner()` and `get_workspace_member_workspace()` — both of which returned a raw UUID to the caller — are replaced with boolean-only helpers**: `is_workspace_member_owner(member_id, user_id)` and `can_manage_workspace_member(member_id, acting_user_id)`. Neither leaks any identifier; both return only a yes/no answer to the exact question the calling policy needs answered.
3. **Every executable test is now a self-contained, transaction-wrapped script** that creates its own second-workspace/membership/role/platform-admin fixtures inside the transaction and ends in `rollback` — no test requires a pre-existing fixture, and none leaves anything behind, including the one test that grants a temporary platform-admin row (the rollback undoes it before it could ever matter). The one test that expects a real error (Test G, the primary-role constraint) uses a PL/pgSQL exception handler — the standard, documented Postgres pattern for "expect and confirm one specific error without aborting the surrounding script" — verified against Postgres's actual documented behavior for exception blocks (they establish an implicit savepoint), not just described.
4. **Three preflight queries are added**, to be run against production *before* migration 115 is ever created: they check for the exact conditions that would make the new constraints reject existing data, with a clear instruction to stop and resolve rather than run the migration if any of them return rows.
5. **The workspace-seeding statement is restructured** so it always creates exactly one `ensight` workspace even if `company_branding` has zero rows — Revision 2's version would have silently inserted nothing in that case (a real, if unlikely, edge case, and it's now closed at the SQL level rather than assumed away).
6. **A "transitional limitation" note is added** documenting that the fixed 10-value `role_key` list must become workspace-configurable before a second company can define its own roles — explicitly not expanded in Phase 1, since doing so now would be scope creep with no current use.
7. **A forward requirement is recorded** for `resolveActiveWorkspace()`: once it is actually wired into a route (a later phase), it must reject a resolved workspace whose `status` is `'suspended'`. Not applicable in Phase 1 (the function isn't wired in yet, and no workspace is ever suspended in Phase 1), but written down now so it isn't lost by the time it matters.

---

## Plain-English summary: what Phase 1 changes, and what you will see

**You will not see anything different.** No page, button, menu, report, or workflow changes. No existing data is modified, deleted, or moved.

Behind the scenes, Phase 1:

1. **Creates four new, currently-unused database tables** (`workspaces`, `workspace_members`, `workspace_member_roles`, `platform_admins`), six new helper functions used only by those tables' own security rules, and explicit permission grants so only genuinely signed-in users (never anonymous visitors) can even call those functions.
2. **Records that Ensight Technologies is the first workspace**, and copies (never moves or alters) your team's existing admin status and operational role assignments into the new tables.
3. **Leaves `platform_admins` completely empty.** No account is made a platform admin by this migration.

Every existing table, security rule, page, and API route works exactly as it does today. Nothing existing is touched.

---

## Preflight checks — run these against production *before* migration 115 is created

These check for the specific data conditions that would make the new tables' constraints reject existing rows during the one-time data migration. **If any of these return rows, stop — do not create or run migration 115 until the underlying data is resolved.** Read-only; safe to run any time.

```sql
-- PREFLIGHT 1: any user with more than one app_user_roles row marked
-- is_primary. app_user_roles' own primary-role uniqueness was never a
-- real database constraint (migration 040's own comment admits it is
-- "enforced at the application layer... rather than a DB constraint") --
-- so it is possible, if unlikely, for this to have drifted. The new
-- workspace_member_roles table's unique partial index would reject the
-- second such row outright during migration.
select user_id, count(*) as primary_count
from app_user_roles
where is_primary
group by user_id
having count(*) > 1;
-- EXPECTED: zero rows. If any user appears here, decide (manually, not
-- automatically) which of their roles should remain primary and update
-- app_user_roles accordingly before proceeding.

-- PREFLIGHT 2: any role_key value not in the list workspace_member_roles'
-- check constraint will accept. app_user_roles has its own matching check
-- constraint already, so this should be structurally impossible today --
-- this check exists to catch drift (e.g. a role added to one constraint
-- but not mirrored to the other) rather than an expected finding.
select distinct role_key from app_user_roles
where role_key not in (
  'warehouse', 'purchasing', 'pm', 'manager',
  'sales', 'engineering', 'product_development', 'implementation', 'support', 'marketing'
);
-- EXPECTED: zero rows. If any appear, add the missing value to
-- workspace_member_roles' check constraint (Section 1) before migrating,
-- or investigate why an unrecognized role_key exists at all.

-- PREFLIGHT 3: every user referenced by app_user_roles/app_admins
-- actually exists in auth.users. Already guaranteed by both tables' own
-- `references auth.users(id) on delete cascade` foreign keys -- this is a
-- sanity check confirming that guarantee holds, not an expected finding.
select user_id, 'app_user_roles' as source from app_user_roles aur
where not exists (select 1 from auth.users au where au.id = aur.user_id)
union
select user_id, 'app_admins' as source from app_admins aa
where not exists (select 1 from auth.users au where au.id = aa.user_id);
-- EXPECTED: zero rows, always. A non-empty result here would indicate
-- database corruption outside this migration's scope -- stop and
-- investigate rather than proceeding.
```

---

## Corrected schema (for review — not created as a migration file, not run)

### Section 1 — Tables

```sql
-- Proposed migration 115_workspaces_foundation.sql (NOT YET CREATED)
-- Fully additive: no existing table, column, policy, or function is altered.

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
-- can validly exist with zero operational roles.
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
-- copied verbatim from app_user_roles' own existing constraint. It must
-- become workspace-configurable before a second company can define its
-- own role vocabulary -- but expanding or generalizing it now would be
-- scope creep with no current use, since only one workspace (Ensight)
-- exists and it already uses exactly this vocabulary. Left as a fixed
-- list deliberately for Phase 1; revisit in the phase that actually
-- onboards a second company (PRODUCT_TENANCY_AUDIT.md §9).
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
-- non-unique idx_app_user_roles_primary, migration 040:29) -- Postgres
-- rejects any second insert/update setting is_primary = true for a
-- workspace_member_id that already has one primary role. Enforced for
-- every writer, not just this app's code. See Test G for a direct,
-- transaction-safe confirmation.
create unique index if not exists idx_workspace_member_roles_one_primary
  on public.workspace_member_roles(workspace_member_id) where is_primary;

-- Deliberately small and separate from workspace_members -- platform-
-- admin access is a distinct, more sensitive concept from workspace
-- administration (working decision #2). No rows are inserted by this
-- migration; see "Platform-admin bootstrap and recovery" below.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
```

### Section 2 — Helper functions (hardened: `search_path = ''`, fully schema-qualified, boolean-only)

Every function below is `security definer` with `set search_path = ''` — meaning no schema is implicitly searched, so every table reference must be (and is) written with its full `public.` or `auth.` prefix. This is the standard, documented Postgres mitigation for search-path injection in `security definer` functions, and it means these functions are hardened beyond what this codebase's existing `is_app_admin()`/`has_role()` currently do — not a new, unproven technique, just a stricter version of the same tool.

```sql
create or replace function public.is_platform_admin(check_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = check_user_id
  );
$$;

create or replace function public.is_workspace_admin(check_workspace_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = check_workspace_id
      and wm.user_id = check_user_id
      and wm.is_workspace_admin
  );
$$;

create or replace function public.is_workspace_member(check_workspace_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = check_workspace_id and wm.user_id = check_user_id
  );
$$;

-- Replaces Revision 2's get_workspace_member_owner() (which returned a
-- raw user_id). Answers exactly the question the calling policy needs:
-- "is this specific member row owned by this specific user?" -- nothing
-- more is ever exposed.
create or replace function public.is_workspace_member_owner(check_member_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.id = check_member_id and wm.user_id = check_user_id
  );
$$;

-- Replaces Revision 2's get_workspace_member_workspace() (which returned
-- a raw workspace_id, requiring the caller to then separately call
-- is_workspace_admin() with it). Folds both steps into one boolean
-- answer, so no workspace identifier is ever handed back to a policy
-- that only needed a yes/no.
create or replace function public.can_manage_workspace_member(check_member_id uuid, acting_user_id uuid)
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
      and admin_row.user_id = acting_user_id
      and admin_row.is_workspace_admin
  );
$$;

-- Convenience helper for the future resolveActiveWorkspace() server
-- pattern (see below) -- not called by any existing code yet.
create or replace function public.current_user_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.workspace_members where user_id = auth.uid();
$$;
```

**Not `security definer`, and out of scope for this hardening pass**: `set_workspace_updated_at()` (the timestamp trigger) touches no schema-qualified object — it only reads/writes `new.updated_at`, a record field, and calls `now()`, a built-in that resolves via `pg_catalog` regardless of `search_path` — so it carries none of the risk this hardening addresses and is left as a plain trigger function, defined in Section 4.

### Section 2b — Explicit grants (must come after the functions exist; must come before RLS policies call them)

Postgres grants `EXECUTE` to `PUBLIC` automatically on function creation. Every function above has that default grant explicitly revoked, then re-granted only to `authenticated` — no function is callable by an anonymous visitor, and none is left at Postgres's permissive default.

```sql
revoke execute on function public.is_platform_admin(uuid) from public;
revoke execute on function public.is_workspace_admin(uuid, uuid) from public;
revoke execute on function public.is_workspace_member(uuid, uuid) from public;
revoke execute on function public.is_workspace_member_owner(uuid, uuid) from public;
revoke execute on function public.can_manage_workspace_member(uuid, uuid) from public;
revoke execute on function public.current_user_workspace_ids() from public;

grant execute on function public.is_platform_admin(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid, uuid) to authenticated;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.is_workspace_member_owner(uuid, uuid) to authenticated;
grant execute on function public.can_manage_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.current_user_workspace_ids() to authenticated;
```

**Confirming these still work when called from RLS policies**: every policy in Section 3 below is evaluated for queries running as the `authenticated` role (the role Supabase's PostgREST layer connects as for any signed-in request) — exactly the role each function above is granted to. If a grant were missing, every policy calling that function would fail outright with "permission denied for function," not silently misbehave — a loud, obvious failure mode. Tests A-F below exercise every one of these policies end-to-end as the `authenticated` role; if any grant were wrong, those tests would fail immediately and unambiguously, not pass by accident.

### Section 3 — RLS enable + policies (all referenced functions and grants now exist)

```sql
alter table public.workspaces enable row level security;

create policy "members and platform admins read workspaces"
  on public.workspaces for select to authenticated
  using (public.is_platform_admin(auth.uid()) or public.is_workspace_member(id, auth.uid()));

create policy "platform admins manage workspaces"
  on public.workspaces for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

alter table public.workspace_members enable row level security;

create policy "users read their own membership"
  on public.workspace_members for select to authenticated
  using (auth.uid() = user_id);

create policy "workspace admins read memberships in their own workspace"
  on public.workspace_members for select to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()));

create policy "platform admins read all memberships"
  on public.workspace_members for select to authenticated
  using (public.is_platform_admin(auth.uid()));

create policy "workspace admins manage memberships in their own workspace"
  on public.workspace_members for all to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()))
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

create policy "platform admins manage all memberships"
  on public.workspace_members for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

alter table public.workspace_member_roles enable row level security;

create policy "users read their own role rows"
  on public.workspace_member_roles for select to authenticated
  using (public.is_workspace_member_owner(workspace_member_id, auth.uid()));

create policy "workspace admins manage role rows in their own workspace"
  on public.workspace_member_roles for all to authenticated
  using (public.can_manage_workspace_member(workspace_member_id, auth.uid()))
  with check (public.can_manage_workspace_member(workspace_member_id, auth.uid()));

create policy "platform admins manage all role rows"
  on public.workspace_member_roles for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

alter table public.platform_admins enable row level security;

create policy "platform admins read platform admin list"
  on public.platform_admins for select to authenticated
  using (public.is_platform_admin(auth.uid()));

create policy "platform admins manage platform admin list"
  on public.platform_admins for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));
```

No policy above contains a raw subquery against an RLS-protected table — every cross-row check goes through a Section 2 function. This rule is applied uniformly, not just to the one policy Revision 2 got wrong, so a future edit to any of these can't accidentally reintroduce self-referencing recursion.

### Section 4 — Triggers

```sql
create or replace function public.set_workspace_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_workspace_updated_at();

drop trigger if exists workspace_members_set_updated_at on public.workspace_members;
create trigger workspace_members_set_updated_at
  before update on public.workspace_members
  for each row execute function public.set_workspace_updated_at();
```

### Section 5 — Data migration (robust to a missing `company_branding` row)

```sql
-- 1. Seed the one workspace. Uses a scalar subquery inside VALUES, not an
-- INSERT ... SELECT ... FROM company_branding -- the earlier form would
-- silently insert NOTHING if company_branding had zero rows (an
-- INSERT...SELECT with an empty FROM result inserts zero rows; coalesce
-- inside that SELECT only helps when the row exists but the column is
-- null, not when the row is entirely absent). A scalar subquery used as
-- a plain value expression evaluates to NULL when it matches no rows --
-- well-defined SQL behavior -- so coalesce correctly falls back to the
-- literal default name either way, and exactly one workspace row is
-- always created.
insert into public.workspaces (name, slug)
values (
  coalesce((select company_name from public.company_branding where id = true), 'Ensight Technologies'),
  'ensight'
)
on conflict (slug) do nothing;

-- 2. One workspace_members row for every distinct user who has EITHER an
--    existing app_admins row OR an app_user_roles row -- so an admin with
--    no operational role still becomes a real member, with
--    is_workspace_admin set directly from app_admins and NO fallback role
--    assigned to anyone.
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
--    app_user_roles row gets no rows here -- correct and intentional.
insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
select wm.id, aur.role_key, aur.is_primary
from app_user_roles aur
join public.workspace_members wm
  on wm.user_id = aur.user_id
  and wm.workspace_id = (select id from public.workspaces where slug = 'ensight')
on conflict (workspace_member_id, role_key) do nothing;
```

---

## Platform-admin bootstrap and recovery procedure (unchanged from Revision 2, approved conceptually)

`platform_admins` requires an existing platform admin to insert or manage rows via its own RLS — by design, there is no in-app way to create the first one, mirroring exactly how `app_admins` was originally bootstrapped (never via migration; always out-of-band).

**Bootstrap**: when E approves granting platform-admin status to a specific account, run directly in Supabase Studio:

```sql
insert into public.platform_admins (user_id)
values ('<the approved account''s auth.users id>');
```

**Recovery**: the same direct SQL insert, run by E as the Supabase project owner, if every platform admin were ever lost. No in-app flow, no email-based invite for this role — a deliberate minimization of the attack surface for the platform's most sensitive permission.

**Phase 1 explicitly does not run this insert for anyone.** `platform_admins` ships empty and stays empty until a separate, explicit decision names who gets it.

---

## `resolveActiveWorkspace()` — server-side resolution pattern (design only)

Unchanged core design from Revision 2, with one addition: a recorded future requirement.

```js
// PROPOSED DESIGN -- not implemented, not wired into any route in Phase 1.
export async function resolveActiveWorkspace(req, res, user, supabaseUrl, serviceRoleKey) {
  const requestedId = req.headers["x-workspace-id"] || req.body?.workspaceId;
  const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };
  const response = await fetch(
    `${supabaseUrl}/rest/v1/workspace_members?user_id=eq.${user.id}&select=workspace_id`,
    { headers },
  );
  const memberships = await response.json();
  const memberIds = memberships.map((m) => m.workspace_id);

  if (requestedId) {
    if (!memberIds.includes(requestedId)) {
      res.status(403).json({ error: "You are not a member of that workspace." });
      return null;
    }
    // FUTURE REQUIREMENT, recorded now, not implemented in Phase 1 (no
    // route calls this function yet, and no workspace is ever suspended
    // in Phase 1): once this function is actually wired into a route,
    // it must also look up the resolved workspace's `status` and reject
    // with 403 if it is 'suspended', not just confirm membership.
    return requestedId;
  }
  if (memberIds.length === 1) return memberIds[0];
  if (memberIds.length === 0) {
    res.status(403).json({ error: "You are not a member of any workspace." });
    return null;
  }
  res.status(400).json({ error: "Multiple workspaces found; specify which one." });
  return null;
}
```

---

## Rollback plan

```sql
-- Rollback for migration 115 (if ever needed)
drop trigger if exists workspace_members_set_updated_at on public.workspace_members;
drop trigger if exists workspaces_set_updated_at on public.workspaces;

drop policy if exists "platform admins manage platform admin list" on public.platform_admins;
drop policy if exists "platform admins read platform admin list" on public.platform_admins;
drop policy if exists "platform admins manage all role rows" on public.workspace_member_roles;
drop policy if exists "workspace admins manage role rows in their own workspace" on public.workspace_member_roles;
drop policy if exists "users read their own role rows" on public.workspace_member_roles;
drop policy if exists "platform admins manage all memberships" on public.workspace_members;
drop policy if exists "workspace admins manage memberships in their own workspace" on public.workspace_members;
drop policy if exists "platform admins read all memberships" on public.workspace_members;
drop policy if exists "workspace admins read memberships in their own workspace" on public.workspace_members;
drop policy if exists "users read their own membership" on public.workspace_members;
drop policy if exists "platform admins manage workspaces" on public.workspaces;
drop policy if exists "members and platform admins read workspaces" on public.workspaces;

drop function if exists public.set_workspace_updated_at();
drop function if exists public.current_user_workspace_ids();
drop function if exists public.can_manage_workspace_member(uuid, uuid);
drop function if exists public.is_workspace_member_owner(uuid, uuid);
drop function if exists public.is_workspace_member(uuid, uuid);
drop function if exists public.is_workspace_admin(uuid, uuid);
drop function if exists public.is_platform_admin(uuid);

drop table if exists public.platform_admins;
drop table if exists public.workspace_member_roles;
drop table if exists public.workspace_members;
drop table if exists public.workspaces;
```

No existing table, column, policy, or function is referenced by anything above outside a plain `select` during the one-time data migration — rollback removes only what Phase 1 added, with zero risk to any existing row anywhere. `DROP FUNCTION` automatically removes any grants on it, so no explicit `revoke` is needed in rollback.

---

## Security analysis

- **Search-path injection**: closed. Every `security definer` function sets `search_path = ''` and fully qualifies every table reference (`public.x`, `auth.users`) — nothing is resolved implicitly, so there is no schema-precedence trick available to redirect what these functions read.
- **Default over-permissive execution**: closed. Every function's automatic `PUBLIC` execute grant is explicitly revoked and re-granted only to `authenticated`. `anon` cannot call any of them. This is stricter than the codebase's own pre-existing `is_app_admin()`/`has_role()`, which currently carry Postgres's default `PUBLIC` grant — worth a note for a possible future retrofit of those, but out of scope for touching existing functions in Phase 1.
- **Recursion**: eliminated by construction (no policy anywhere contains a raw subquery against an RLS-protected table) and directly tested (Test F). The underlying mechanism — a `security definer` function's owner bypassing that table's own RLS — is the same one `is_app_admin()` already relies on safely in production; this plan extends an already-validated pattern rather than introducing a new one.
- **Information exposure through directly callable RPCs**: minimized, not eliminated, and the residual exposure is stated plainly rather than glossed over. Because every function above lives in the `public` schema, Supabase's PostgREST layer exposes each as a callable `POST /rest/v1/rpc/<name>` endpoint to any `authenticated` caller (per the grants above) — this is unavoidable for any function meant to be called from an RLS policy, and is exactly as true of the existing `is_app_admin(uuid)` today. What Revision 3 does reduce: (a) no function returns a raw identifier (UUID) to the caller anymore — every one of them answers only a yes/no question about a caller-supplied pair of ids; (b) `anon` cannot call any of them at all, only `authenticated`. What remains, and is accepted as a reasonable trade-off matching the existing codebase's own pattern: an authenticated caller can call e.g. `can_manage_workspace_member(<some member id>, <some other user's id>)` directly and learn a true/false fact about a workspace-admin relationship between two arbitrary ids they supply — never the underlying data itself, just a boolean about a relationship. If this residual is ever judged unacceptable, the fix would be to drop the `check_user_id`/`acting_user_id` parameters entirely and hard-code `auth.uid()` inside each function body — not done here, to keep these functions reusable for the exact verification tests below, which need to check the relationship for a specific test-fixture user, not only "the current session's own user."
- **Primary-role integrity**: enforced by a real unique partial index (Test G), not application discipline — a genuine improvement over `app_user_roles`' own admitted gap, not just parity with it.
- **Cross-workspace containment**: a workspace admin's write access is always scoped by `workspace_id` inside `is_workspace_admin()`/`can_manage_workspace_member()` — Test B confirms an admin cannot reach into a workspace they don't administer.
- **Platform-admin containment**: `platform_admins` requires an existing platform admin to modify; the bootstrap procedure is the only way to create the first one, deliberately out-of-band.
- **No change to any existing security boundary**: every existing table's RLS, every existing route's auth check, and every existing Storage policy is completely untouched (Test H).
- **Known, carried-over limitation**: the recursion-avoidance mechanism depends on these functions being owned by a role that bypasses RLS on these tables (the table-owning/migration-running role in Supabase Studio). Not a concern for E's current manual-run process; worth re-verifying if that process ever changes.
- **Transitional limitation, documented not fixed**: the fixed `role_key` list must become workspace-configurable before a second company can define its own roles. Explicitly deferred past Phase 1 (see Section 1's inline comment) — expanding it now would be unused scope, since only one workspace exists.

---

## Executable verification SQL

Every test below is self-contained: it creates whatever workspaces/memberships/roles/platform-admin rows it needs *inside its own transaction*, using **real, existing `auth.users` ids you already have** (a rolled-back transaction has zero lasting effect on a real user, so any real id is safe to reference here — do not fabricate a fake id; the foreign keys require a real one to exist). Every test ends in `rollback` — nothing here requires a permanent test record, and nothing here can leave a `platform_admins` row behind, including Test E.

Replace every `<REPLACE-...>` placeholder with a real `auth.users` id before running. Run each block on its own in Supabase Studio's SQL editor.

```sql
-- TEST A: an ordinary member reads only their own membership
begin;
do $$
declare
  ws_id uuid;
  u1 uuid := '<REPLACE-WITH-REAL-USER-ID-1>';
  u2 uuid := '<REPLACE-WITH-REAL-USER-ID-2>';
begin
  insert into public.workspaces (name, slug) values ('Test Workspace A', 'test-workspace-a') returning id into ws_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_id, u1, false);
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_id, u2, false);
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<REPLACE-WITH-REAL-USER-ID-1>", "role": "authenticated"}';
select user_id from public.workspace_members
where workspace_id = (select id from public.workspaces where slug = 'test-workspace-a');
-- EXPECTED: exactly one row, user_id = REAL-USER-ID-1. User 2's row is NOT visible.
rollback;
```

```sql
-- TEST B: a workspace admin manages members only in their own workspace
begin;
do $$
declare
  ws_admin uuid;
  ws_other uuid;
  admin_user uuid := '<REPLACE-WITH-REAL-USER-ID-ADMIN>';
  other_user uuid := '<REPLACE-WITH-REAL-USER-ID-OTHER>';
begin
  insert into public.workspaces (name, slug) values ('Test Workspace B Admin', 'test-workspace-b-admin') returning id into ws_admin;
  insert into public.workspaces (name, slug) values ('Test Workspace B Other', 'test-workspace-b-other') returning id into ws_other;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_admin, admin_user, true);
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_other, other_user, false);
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<REPLACE-WITH-REAL-USER-ID-ADMIN>", "role": "authenticated"}';

select workspace_id, user_id from public.workspace_members
where workspace_id in (select id from public.workspaces where slug in ('test-workspace-b-admin', 'test-workspace-b-other'));
-- EXPECTED: only the row in test-workspace-b-admin is visible.

update public.workspace_members set is_workspace_admin = true
where workspace_id = (select id from public.workspaces where slug = 'test-workspace-b-other')
  and user_id = '<REPLACE-WITH-REAL-USER-ID-OTHER>';
-- EXPECTED: 0 rows updated -- blocked by RLS, confirms containment.
rollback;
```

```sql
-- TEST C: a non-admin cannot manage memberships
begin;
do $$
declare
  ws_id uuid;
  plain_user uuid := '<REPLACE-WITH-REAL-USER-ID-PLAIN>';
begin
  insert into public.workspaces (name, slug) values ('Test Workspace C', 'test-workspace-c') returning id into ws_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_id, plain_user, false);
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<REPLACE-WITH-REAL-USER-ID-PLAIN>", "role": "authenticated"}';
update public.workspace_members set is_workspace_admin = true
where user_id = '<REPLACE-WITH-REAL-USER-ID-PLAIN>'
  and workspace_id = (select id from public.workspaces where slug = 'test-workspace-c');
-- EXPECTED: 0 rows updated -- a non-admin cannot even self-promote.
rollback;
```

```sql
-- TEST D: a user belonging to multiple workspaces sees exactly those
begin;
do $$
declare
  ws1 uuid;
  ws2 uuid;
  wm1 uuid;
  wm2 uuid;
  multi_user uuid := '<REPLACE-WITH-REAL-USER-ID-MULTI>';
begin
  insert into public.workspaces (name, slug) values ('Test Workspace D1', 'test-workspace-d1') returning id into ws1;
  insert into public.workspaces (name, slug) values ('Test Workspace D2', 'test-workspace-d2') returning id into ws2;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws1, multi_user, false) returning id into wm1;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws2, multi_user, false) returning id into wm2;
  insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary) values (wm1, 'sales', true);
  insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary) values (wm2, 'pm', true);
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<REPLACE-WITH-REAL-USER-ID-MULTI>", "role": "authenticated"}';
select workspace_id from public.workspace_members where user_id = '<REPLACE-WITH-REAL-USER-ID-MULTI>';
-- EXPECTED: exactly two rows -- test-workspace-d1's and test-workspace-d2's ids.
select wmr.role_key, wm.workspace_id from public.workspace_member_roles wmr
  join public.workspace_members wm on wm.id = wmr.workspace_member_id
  where wm.user_id = '<REPLACE-WITH-REAL-USER-ID-MULTI>';
-- EXPECTED: 'sales' paired with d1's workspace_id, 'pm' paired with d2's.
rollback;
```

```sql
-- TEST E: a platform admin's intended access. The platform_admins row
-- inserted here is created and used entirely inside this transaction --
-- rollback guarantees it never persists, so this test cannot leave a
-- real platform-admin grant behind.
begin;
do $$
declare
  platform_admin_user uuid := '<REPLACE-WITH-REAL-USER-ID-PLATFORM>';
begin
  insert into public.platform_admins (user_id) values (platform_admin_user);
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<REPLACE-WITH-REAL-USER-ID-PLATFORM>", "role": "authenticated"}';
select count(*) from public.workspaces;
-- EXPECTED: every workspace visible (including the real "ensight"
-- workspace, once migration 115 has run), not scoped to just one.
select count(*) from public.workspace_members;
-- EXPECTED: total membership count across ALL workspaces.
rollback;
```

```sql
-- TEST F: no RLS recursion
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<REPLACE-WITH-ANY-REAL-USER-ID>", "role": "authenticated"}';
select * from public.workspace_members;
select * from public.workspace_member_roles;
select * from public.workspaces;
-- EXPECTED: every query returns normally and quickly. The concrete
-- failure mode of real recursion is a "stack depth limit exceeded" error
-- or a multi-second hang -- neither should occur. Optionally prefix each
-- select with `explain analyze` to also confirm no runaway plan.
rollback;
```

```sql
-- TEST G: only one primary role per member, enforced by the database
-- itself. Uses a PL/pgSQL exception handler -- the standard, documented
-- Postgres pattern for catching one specific expected error inside a
-- block without aborting the surrounding transaction (an exception
-- handler in a DO/function block implicitly creates its own savepoint).
-- This test intentionally does NOT switch to the authenticated role,
-- since it is testing the raw database constraint, not RLS -- it runs as
-- whichever role Supabase Studio's SQL editor connects as by default
-- (which bypasses RLS entirely as the table owner), isolating exactly
-- what is being tested.
begin;
do $$
declare
  ws_id uuid;
  test_user uuid := '<REPLACE-WITH-REAL-USER-ID-G>';
  member_id uuid;
begin
  insert into public.workspaces (name, slug) values ('Test Workspace G', 'test-workspace-g') returning id into ws_id;
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_id, test_user, false) returning id into member_id;

  insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
  values (member_id, 'sales', true);

  begin
    insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
    values (member_id, 'manager', true);
    raise exception 'TEST G FAILED: a second primary role was allowed -- the constraint did not fire.';
  exception
    when unique_violation then
      raise notice 'TEST G PASSED: second primary role correctly rejected by idx_workspace_member_roles_one_primary.';
  end;
end $$;
rollback;
-- EXPECTED output: a NOTICE reading "TEST G PASSED: ...". If instead you
-- see an ERROR reading "TEST G FAILED: ...", the constraint did not work
-- as designed -- do not proceed with the migration.
```

```sql
-- TEST H: existing Ergon behavior is unchanged. Pure read-only SELECTs --
-- there is nothing to roll back here, and no transaction wrapper is
-- needed for a query that writes nothing. Run once BEFORE migration 115
-- and once AFTER; every number must match exactly.
select count(*) from app_admins;
select count(*) from app_user_roles;
select count(*) from projects;
select count(*) from tasks;
select count(*) from sales_quotes;
-- EXPECTED: identical counts before and after -- Phase 1 never writes to
-- any existing table, and only ever reads from them during the one-time
-- data migration (Section 5), never as part of ordinary operation.
```

---

## Production verification checklist

1. Confirm exactly one row exists in `workspaces`, `slug = 'ensight'`, `name` matching `company_branding.company_name` at migration time (or the literal fallback `'Ensight Technologies'` if that table had no row).
2. Confirm `workspace_members` has exactly one row per distinct user across `app_user_roles` ∪ `app_admins`.
3. Confirm `workspace_member_roles`'s row count equals the pre-migration `app_user_roles` row count exactly.
4. Confirm the existing admin (`eck1679@gmail.com`) has a `workspace_members` row with `is_workspace_admin = true`.
5. Confirm `platform_admins` has **zero** rows.
6. Run Test H's before/after row-count comparison.
7. Run Tests A-G above (each is self-contained and self-cleaning).
8. Spot-check the live app: sign in, confirm the dashboard, tasks, projects, and Admin panel all look and behave exactly as before.
9. Confirm the three preflight checks (above) were run *before* the migration and returned zero rows each.

---

## Deployment process

Per this repo's standing process (no CI; migrations are applied manually): once this plan is approved, the exact SQL from the Preflight and Sections 1-5 above is handed to E in full, E runs the preflight checks first, then (only if all three return zero rows) runs the migration in Supabase Studio, and the production verification checklist is completed together — the same pattern every prior migration in `HANDOFF.md` has followed.

---

## Decisions still needed before this plan is approved for implementation

1. **Approve or amend the hardened schema, functions, grants, and policies above.**
2. **Confirm the preflight-check remediation approach** — this plan recommends stopping and manually resolving any data issue found (never auto-resolving, e.g. never auto-picking a "winning" primary role) — confirm this is the right default.
3. **Explicit go-ahead to create migration 115 and hand it to E to run.** This document remains a plan for review until that go-ahead is given.

Everything else from Revision 2's decision list is now settled (schema shape, bootstrap procedure, no Phase-1 platform-admin assignment, slug).

---

## Cross-references

- `PRODUCT_TENANCY_AUDIT.md` — §8 (proposed architecture), §9 (staged approach), §10 (working decisions).
- `PRODUCT_PLAN.md` / `PRODUCT_START_PLAN.md` — product direction and discovery approach.
- `HANDOFF.md` — will record the actual migration once (and if) it is approved and run.
