# Ergon Productization — Phase 1 Implementation Plan (Revision 2)

Status: **Plan for review — Phase 1 is not yet approved for implementation.** No migration file has been created, no SQL has been run against any database, no RLS policy has changed, no server route or frontend file has been edited. This revision responds to E's review of Revision 1 and corrects eight specific issues before migration 115 is created.
Created: 2026-09-08 · Revised: 2026-09-08 (Revision 2, following E's structural/security review)
Builds on: `PRODUCT_TENANCY_AUDIT.md` (the audit and its §10 working decisions), of which this plan implements Phase 1 of the 8-phase staged approach in §9.

## What changed in this revision, and why

E's review of Revision 1 found eight real issues before implementation — each is addressed below, not just acknowledged:

1. **Membership and operational roles were conflated in one table.** Revision 1's `workspace_members` mixed "is this person part of the workspace, and are they an admin" with "what operational role(s) do they hold" in a single row. Split into `workspace_members` (membership + admin flag only) and `workspace_member_roles` (role assignments, separate table).
2. **A fallback `'manager'` role was wrongly assigned to an admin with no operational role.** A workspace administrator is a real, valid state with zero operational roles — removed the fallback insert entirely; such an admin now correctly gets a `workspace_members` row and simply no `workspace_member_roles` rows.
3. **"One primary role" was not actually enforced.** Revision 1 copied `app_user_roles`' own admitted gap (migration `040_role_expansion_multi_role.sql:24-29` states its primary-role uniqueness is "enforced at the application layer... rather than a DB constraint"). Revision 2 uses a real `unique` partial index, which Postgres does enforce at the database level for any writer, not just the app.
4. **SQL statement order was wrong.** Revision 1 interleaved table creation, RLS policies, and the helper functions those policies call — a policy would have referenced a function that didn't exist yet at that point in the script. Revision 2 is strictly ordered: all tables, then all functions, then RLS enable + policies, then triggers, then data migration.
5. **A policy on `workspace_members` queried `workspace_members` directly** (`exists (select 1 from workspace_members admin_row where ...)` inside a policy defined *on* `workspace_members`) — a self-referencing RLS pattern with real recursion risk. Redesigned around `security definer` helper functions for every cross-row check, exactly mirroring the one pattern already proven safe in this codebase (`is_app_admin()` is called from within `app_admins`' own RLS policies today, and works because of how Postgres handles `security definer` function ownership — see "Why this avoids recursion" below, and Test F for how to directly confirm it).
6. **No bootstrap/recovery procedure was defined for `platform_admins`.** Documented explicitly below — same out-of-band, direct-SQL pattern this codebase already uses for `app_admins` (there was never an in-app way to create the first admin either). `platform_admins` stays empty in Phase 1.
7. **Workspace slug was left as an open question.** Settled: `'ensight'` — Ergon is the product; Ensight is the first customer workspace.
8. **No executable verification was provided for the specific access-control claims this design makes.** Eight SQL test blocks added, one per scenario E named, written to run in Supabase Studio's SQL editor using Supabase's own documented JWT-simulation convention.

---

## Plain-English summary: what Phase 1 changes, and what you will see

**You will not see anything different.** No page, button, menu, report, or workflow changes. No existing data is modified, deleted, or moved.

Behind the scenes, Phase 1:

1. **Creates four new, currently-unused database tables** (`workspaces`, `workspace_members`, `workspace_member_roles`, `platform_admins`) that don't yet connect to anything else in the app.
2. **Records that Ensight Technologies is the first workspace**, and copies (never moves or alters) your team's existing admin status and operational role assignments into the new tables as that workspace's membership records.
3. **Leaves `platform_admins` completely empty.** No account — not even the existing admin account — is made a platform admin by this migration. That is a separate, later decision.

After Phase 1, every existing table, security rule, page, and API route works exactly as it does today. Nothing existing is touched — this plan changes only what the four new tables contain.

---

## Corrected schema (for review — not created as a migration file, not run)

Organized in the order it would actually execute: all tables, then all functions, then RLS + policies, then triggers, then the one-time data migration. This ordering is itself one of the corrections from Revision 1.

### Section 1 — Tables

```sql
-- Proposed migration 115_workspaces_foundation.sql (NOT YET CREATED)
-- Fully additive: no existing table, column, policy, or function is altered.

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per (workspace, user) -- membership and admin status ONLY.
-- Operational roles live in workspace_member_roles, not here, so a
-- workspace admin can exist with zero operational roles (see Section 5).
create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_workspace_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

-- One row per (workspace_member, role) -- mirrors app_user_roles'
-- existing shape (migration 040: one row per user per role_key, an
-- is_primary flag) but scoped to a workspace_members row instead of a
-- bare user_id, and with primary-role uniqueness actually enforced this
-- time (see the partial unique index below).
create table if not exists workspace_member_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_member_id uuid not null references workspace_members(id) on delete cascade,
  role_key text not null check (role_key in (
    'warehouse', 'purchasing', 'pm', 'manager',
    'sales', 'engineering', 'product_development', 'implementation', 'support', 'marketing'
  )),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_member_id, role_key)
);

-- A REAL, database-enforced constraint (unlike app_user_roles' own
-- non-unique idx_app_user_roles_primary, migration 040:29, which its own
-- comment admits is app-layer-only) -- Postgres rejects any second insert/
-- update that would set is_primary = true for a workspace_member_id that
-- already has one. Enforced for every writer, not just this app's code.
create unique index if not exists idx_workspace_member_roles_one_primary
  on workspace_member_roles(workspace_member_id) where is_primary;

-- Deliberately small and separate from workspace_members -- platform-admin
-- access is a distinct, more sensitive concept from workspace
-- administration (working decision #2). No rows are inserted by this
-- migration; see "Platform-admin bootstrap and recovery" below.
create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
```

### Section 2 — Helper functions (all referenced tables now exist)

Every RLS policy below calls one of these functions instead of embedding a raw subquery against `workspace_members`/`workspace_member_roles` directly. This is the fix for issue #5 (recursion) — see "Why this avoids recursion" immediately after.

```sql
create or replace function is_platform_admin(check_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from platform_admins where user_id = check_user_id);
$$;

create or replace function is_workspace_admin(check_workspace_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = check_workspace_id
      and user_id = check_user_id
      and is_workspace_admin
  );
$$;

create or replace function is_workspace_member(check_workspace_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = check_workspace_id and user_id = check_user_id
  );
$$;

-- Used by workspace_member_roles' policies so they never need a raw
-- subquery against workspace_members either.
create or replace function get_workspace_member_owner(check_workspace_member_id uuid)
returns uuid
language sql
security definer
stable
as $$
  select user_id from workspace_members where id = check_workspace_member_id;
$$;

create or replace function get_workspace_member_workspace(check_workspace_member_id uuid)
returns uuid
language sql
security definer
stable
as $$
  select workspace_id from workspace_members where id = check_workspace_member_id;
$$;

-- Convenience helper for the future resolveActiveWorkspace() server
-- pattern (Section 6) -- not called by any existing code yet.
create or replace function current_user_workspace_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select workspace_id from workspace_members where user_id = auth.uid();
$$;

create or replace function set_workspace_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
```

**Why this avoids recursion.** A `security definer` function executes with the privileges of the function's *owner*, not the calling user. In this schema (as with every existing `security definer` function — `is_app_admin`, `has_role`, `get_users_by_role`, etc.), the owner is whichever role runs the migration in Supabase Studio, which is also the table owner. Postgres does not apply a table's own row-level-security policies to that table's owner unless `FORCE ROW LEVEL SECURITY` is explicitly set (it is not, here or anywhere else in this schema). So when a policy on `workspace_members` calls `is_workspace_admin(...)`, the query *inside* that function runs as the owning role and bypasses `workspace_members`' RLS entirely for that one internal lookup — it never re-triggers the policy that called it. This is not a new assumption; it is the exact mechanism `is_app_admin()` already relies on today, called from within `app_admins`' own RLS policies, in production, without issue. Every policy below uses this pattern — no policy anywhere in this design contains a raw subquery against the table it is defined on, or against any table whose own policies could call back into it. Test F below is the concrete, executable confirmation of this claim, not just the architectural argument for it.

### Section 3 — RLS enable + policies (all referenced functions now exist)

```sql
alter table workspaces enable row level security;

-- Members of a workspace can see its name; platform admins see all of
-- them. No one can see a workspace they are not part of.
create policy "members and platform admins read workspaces"
  on workspaces for select to authenticated
  using (is_platform_admin(auth.uid()) or is_workspace_member(id, auth.uid()));

-- Only platform admins create/edit workspaces in Phase 1 -- a workspace
-- admin's own settings UI for renaming their workspace is later-phase
-- work, not Phase 1.
create policy "platform admins manage workspaces"
  on workspaces for all to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

alter table workspace_members enable row level security;

create policy "users read their own membership"
  on workspace_members for select to authenticated
  using (auth.uid() = user_id);

create policy "workspace admins read memberships in their own workspace"
  on workspace_members for select to authenticated
  using (is_workspace_admin(workspace_id, auth.uid()));

create policy "platform admins read all memberships"
  on workspace_members for select to authenticated
  using (is_platform_admin(auth.uid()));

create policy "workspace admins manage memberships in their own workspace"
  on workspace_members for all to authenticated
  using (is_workspace_admin(workspace_id, auth.uid()))
  with check (is_workspace_admin(workspace_id, auth.uid()));

create policy "platform admins manage all memberships"
  on workspace_members for all to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

alter table workspace_member_roles enable row level security;

create policy "users read their own role rows"
  on workspace_member_roles for select to authenticated
  using (get_workspace_member_owner(workspace_member_id) = auth.uid());

create policy "workspace admins manage role rows in their own workspace"
  on workspace_member_roles for all to authenticated
  using (is_workspace_admin(get_workspace_member_workspace(workspace_member_id), auth.uid()))
  with check (is_workspace_admin(get_workspace_member_workspace(workspace_member_id), auth.uid()));

create policy "platform admins manage all role rows"
  on workspace_member_roles for all to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

alter table platform_admins enable row level security;

create policy "platform admins read platform admin list"
  on platform_admins for select to authenticated
  using (is_platform_admin(auth.uid()));

create policy "platform admins manage platform admin list"
  on platform_admins for all to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));
```

Note the deliberate absence of any `exists (select 1 from workspace_members ...)` or `exists (select 1 from workspace_member_roles ...)` written directly inside a policy body anywhere above — every cross-row check goes through Section 2's functions. This is a stricter, more auditable rule than "just fix the one recursive policy Revision 1 had" — it applies uniformly so a future edit to any of these policies can't accidentally reintroduce the same class of bug.

### Section 4 — Triggers

```sql
drop trigger if exists workspaces_set_updated_at on workspaces;
create trigger workspaces_set_updated_at
  before update on workspaces
  for each row execute function set_workspace_updated_at();

drop trigger if exists workspace_members_set_updated_at on workspace_members;
create trigger workspace_members_set_updated_at
  before update on workspace_members
  for each row execute function set_workspace_updated_at();
```

### Section 5 — Data migration (seed the first workspace, carry over existing data)

```sql
-- 1. Seed the one workspace, named from today's company_branding, slug
--    "ensight" (settled: Ergon is the product, Ensight is the first
--    customer workspace).
insert into workspaces (name, slug)
select coalesce(company_name, 'Ensight Technologies'), 'ensight'
from company_branding
where id = true
on conflict (slug) do nothing;

-- 2. One workspace_members row for every distinct user who has EITHER an
--    existing app_admins row OR an app_user_roles row (the union of both
--    sets) -- so an admin with no operational role still becomes a real
--    member, and is_workspace_admin is set directly from app_admins with
--    NO fallback role assigned to anyone.
insert into workspace_members (workspace_id, user_id, is_workspace_admin)
select
  w.id,
  u.user_id,
  exists (select 1 from app_admins aa where aa.user_id = u.user_id)
from (
  select user_id from app_user_roles
  union
  select user_id from app_admins
) u
cross join (select id from workspaces where slug = 'ensight') w
on conflict (workspace_id, user_id) do nothing;

-- 3. Carry over every existing (user, role) assignment into
--    workspace_member_roles. An admin with no app_user_roles row simply
--    gets no rows here -- correct and intentional, not a gap to fill.
insert into workspace_member_roles (workspace_member_id, role_key, is_primary)
select wm.id, aur.role_key, aur.is_primary
from app_user_roles aur
join workspace_members wm
  on wm.user_id = aur.user_id
  and wm.workspace_id = (select id from workspaces where slug = 'ensight')
on conflict (workspace_member_id, role_key) do nothing;
```

No fallback insert exists for an admin with no `app_user_roles` row — that gap in Revision 1 is fully removed, not just narrowed. Verified against production 2026-09-08: the one existing admin, `eck1679@gmail.com`, will get exactly one `workspace_members` row (`is_workspace_admin = true`); how many `workspace_member_roles` rows (zero or more) they get depends entirely on whatever `app_user_roles` rows already exist for that account today, carried over as-is.

---

## Platform-admin bootstrap and recovery procedure

`platform_admins` has RLS requiring `is_platform_admin(auth.uid())` to insert or manage rows — which means, by design, there is no in-app way to create the *first* platform admin (the same chicken-and-egg shape `app_admins` already has: `PRODUCT_TENANCY_AUDIT.md` §2 confirms admin bootstrapping for `app_admins` was never done via migration either — it happened out-of-band).

**Bootstrap procedure**: when E decides to grant platform-admin status to a specifically approved account, run this directly in Supabase Studio's SQL editor (the same manual-migration channel every other schema change in this project already goes through):

```sql
insert into platform_admins (user_id)
values ('<the approved account''s auth.users id>');
```

**Recovery procedure**: if every platform-admin account were ever lost (e.g., an account deactivated), the same direct SQL insert, run by E as the Supabase project owner, is the recovery path — no in-app "become platform admin" flow, no email-based invite for this specific role. This is a deliberate minimization of the attack surface for the platform's most sensitive permission, consistent with working decision #2 ("granted only to specifically approved designated Ergon product operators").

**Phase 1 explicitly does not run this insert for anyone**, including the existing admin account. `platform_admins` ships empty. Verified after migration (Test E below, and the production verification checklist) that it stays that way until a separate, explicit decision is made.

---

## `resolveActiveWorkspace()` — the server-side resolution pattern (design only, unchanged from Revision 1)

Per working decision #4 ("the server must resolve the active workspace from authenticated workspace membership; never trust a browser-provided workspace ID without validating membership"):

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

Documented for review per working decision #4; not wired into any route in Phase 1, since no existing table has a `workspace_id` column yet.

---

## Rollback plan

Reverse creation order — child tables and their dependents before parents, functions last:

```sql
-- Rollback for migration 115 (if ever needed)
drop trigger if exists workspace_members_set_updated_at on workspace_members;
drop trigger if exists workspaces_set_updated_at on workspaces;

drop policy if exists "platform admins manage platform admin list" on platform_admins;
drop policy if exists "platform admins read platform admin list" on platform_admins;
drop policy if exists "platform admins manage all role rows" on workspace_member_roles;
drop policy if exists "workspace admins manage role rows in their own workspace" on workspace_member_roles;
drop policy if exists "users read their own role rows" on workspace_member_roles;
drop policy if exists "platform admins manage all memberships" on workspace_members;
drop policy if exists "workspace admins manage memberships in their own workspace" on workspace_members;
drop policy if exists "platform admins read all memberships" on workspace_members;
drop policy if exists "workspace admins read memberships in their own workspace" on workspace_members;
drop policy if exists "users read their own membership" on workspace_members;
drop policy if exists "platform admins manage workspaces" on workspaces;
drop policy if exists "members and platform admins read workspaces" on workspaces;

drop function if exists set_workspace_updated_at();
drop function if exists current_user_workspace_ids();
drop function if exists get_workspace_member_workspace(uuid);
drop function if exists get_workspace_member_owner(uuid);
drop function if exists is_workspace_member(uuid, uuid);
drop function if exists is_workspace_admin(uuid, uuid);
drop function if exists is_platform_admin(uuid);

drop table if exists platform_admins;
drop table if exists workspace_member_roles;
drop table if exists workspace_members;
drop table if exists workspaces;
```

No existing table, column, policy, or function is referenced by anything above outside a plain `select` during the one-time data migration (Section 5) — rollback removes only what Phase 1 added, with zero risk to any existing row anywhere.

---

## Security analysis

- **Recursion**: eliminated by construction (Section 2/3's uniform "policies call functions, never raw subqueries against RLS-protected tables" rule) and directly tested (Test F). The mechanism relied on — table owners/`security definer` function owners bypass their own table's RLS — is the same one this codebase's existing `is_app_admin()`/`has_role()` functions already depend on in production; this plan extends an already-validated pattern rather than introducing a new one.
- **Privilege escalation**: a non-admin cannot grant themselves `is_workspace_admin` (Test C) because `workspace_members`' `UPDATE`/`INSERT` policies require `is_workspace_admin(workspace_id, auth.uid())` or `is_platform_admin(auth.uid())` to already be true for the *acting* user — there is no policy path that lets a plain member modify their own or anyone else's admin flag.
- **Cross-workspace containment**: a workspace admin's write access is always scoped by `workspace_id` inside `is_workspace_admin()` — they cannot manage a membership row in a workspace they do not administer (Test B).
- **Platform-admin containment**: `platform_admins` itself requires an existing platform admin to modify — see the bootstrap procedure above for how the first one is ever created, deliberately out-of-band rather than through any in-app mechanism.
- **Primary-role integrity**: enforced by a real partial unique index (Test G), not application discipline alone — this is a genuine improvement over the pre-existing `app_user_roles` pattern, not just parity with it.
- **No change to any existing security boundary**: every existing table's RLS, every existing route's `requireAuth`/`requireRole` check, and every existing Storage policy is completely untouched by this migration (Test H).
- **Known, accepted limitation carried over from Revision 1, unchanged**: the `security definer` recursion-avoidance mechanism depends on these functions being owned by a role that bypasses RLS on these specific tables (the table-owning/migration-running role). If this project ever runs migrations under a different, non-owning role in the future, this assumption would need re-verification — not a concern for E's current manual-Studio-run process, but worth remembering if that process ever changes.

---

## Executable verification SQL

Run these in Supabase Studio's SQL editor, after migration 115 and its data migration have both run, using Supabase's own documented pattern for simulating a signed-in user in the SQL editor (`set local role authenticated; set local request.jwt.claims to '{"sub": "<uuid>", "role": "authenticated"}';`). Replace every placeholder UUID with a real one from your own data before running. Each block ends with `reset role;` so it doesn't leak into the next block or your own session.

```sql
-- TEST A: an ordinary member reads only their own membership
set local role authenticated;
set local request.jwt.claims to '{"sub": "<non-admin-user-uuid>", "role": "authenticated"}';
select * from workspace_members;
-- EXPECTED: exactly one row, user_id = the tested user. No other member's row visible.
reset role;

-- TEST B: a workspace admin manages members only in their own workspace
set local role authenticated;
set local request.jwt.claims to '{"sub": "<workspace-admin-uuid>", "role": "authenticated"}';
select workspace_id, user_id from workspace_members;
-- EXPECTED: every row's workspace_id matches this admin's own workspace(s) only.
update workspace_members set is_workspace_admin = true
  where workspace_id = '<a-different-workspace-id>' and user_id = '<some-user-uuid>';
-- EXPECTED: 0 rows updated (blocked by RLS, not an error) -- confirms containment.
reset role;

-- TEST C: a non-admin cannot manage memberships
set local role authenticated;
set local request.jwt.claims to '{"sub": "<non-admin-user-uuid>", "role": "authenticated"}';
update workspace_members set is_workspace_admin = true where user_id = '<non-admin-user-uuid>';
-- EXPECTED: 0 rows updated -- a non-admin cannot even self-promote.
reset role;

-- TEST D: a user belonging to multiple workspaces sees exactly those rows
--   (requires seeding a second workspace + membership row for this test user first)
set local role authenticated;
set local request.jwt.claims to '{"sub": "<multi-workspace-user-uuid>", "role": "authenticated"}';
select workspace_id from workspace_members;
-- EXPECTED: one row per workspace that user actually belongs to -- no more, no fewer.
select wmr.* from workspace_member_roles wmr
  join workspace_members wm on wm.id = wmr.workspace_member_id;
-- EXPECTED: role rows for that user's own memberships across both workspaces only.
reset role;

-- TEST E: a platform admin's intended access (requires one bootstrapped
--   test platform admin -- see the bootstrap procedure; do not run this
--   against eck1679@gmail.com unless platform-admin status has been
--   separately, explicitly approved for that account)
set local role authenticated;
set local request.jwt.claims to '{"sub": "<platform-admin-uuid>", "role": "authenticated"}';
select count(*) from workspace_members;
-- EXPECTED: total count across ALL workspaces, not just one.
select * from workspaces;
-- EXPECTED: every workspace visible, not only ones this account is a member of.
reset role;

-- TEST F: no RLS recursion
set local role authenticated;
set local request.jwt.claims to '{"sub": "<any-real-user-uuid>", "role": "authenticated"}';
select * from workspace_members;
select * from workspace_member_roles;
select * from workspaces;
-- EXPECTED: every query returns normally and quickly. The concrete failure
-- mode of real recursion is a "stack depth limit exceeded" error or a
-- multi-second hang -- neither should occur. Optionally prefix each select
-- with `explain analyze` to confirm no runaway plan.
reset role;

-- TEST G: only one primary role per member is enforced by the database itself
insert into workspace_member_roles (workspace_member_id, role_key, is_primary)
values ('<a-real-workspace-member-id>', 'sales', true);
insert into workspace_member_roles (workspace_member_id, role_key, is_primary)
values ('<the-same-workspace-member-id>', 'manager', true);
-- EXPECTED: the second insert FAILS with a unique_violation on
-- idx_workspace_member_roles_one_primary. Roll back both test rows after
-- confirming (`delete from workspace_member_roles where workspace_member_id = '<...>' and role_key in ('sales');`).

-- TEST H: existing Ergon behavior is unchanged
-- Run once BEFORE migration 115 and once AFTER; every number must match.
select count(*) from app_admins;
select count(*) from app_user_roles;
select count(*) from projects;
select count(*) from tasks;
select count(*) from sales_quotes;
-- EXPECTED: identical counts before and after -- Phase 1 never writes to,
-- and (apart from one-time SELECTs during the data migration) never even
-- reads from, any existing table's data path outside this verification.
```

---

## Production verification checklist

1. Confirm exactly one row exists in `workspaces`, `slug = 'ensight'`, `name` matching `company_branding.company_name` at migration time.
2. Confirm `workspace_members` has exactly one row per distinct user across `app_user_roles` ∪ `app_admins` (a simple `select count(distinct user_id) from (select user_id from app_user_roles union select user_id from app_admins) u;` compared against `select count(*) from workspace_members;`).
3. Confirm `workspace_member_roles`'s row count equals the pre-migration `app_user_roles` row count exactly.
4. Confirm the existing admin (`eck1679@gmail.com`) has a `workspace_members` row with `is_workspace_admin = true`.
5. Confirm `platform_admins` has **zero** rows.
6. Run Test H's before/after row-count comparison on every existing table you consider load-bearing.
7. Run Tests A-G above against real (or deliberately seeded test) accounts.
8. Spot-check the live app: sign in, confirm the dashboard, tasks, projects, and Admin panel all look and behave exactly as before — expected: zero visible difference.

---

## Deployment process

Per this repo's standing process (no CI; migrations are applied manually), once this plan is approved: the exact SQL from Sections 1-5 above is handed to E in full (as this document already does), E runs it in Supabase Studio, and the production verification checklist above is completed together before this phase is considered done — the same pattern every prior migration in `HANDOFF.md` has followed.

---

## Decisions still needed before this plan is approved for implementation

1. **Approve or amend the corrected schema, functions, and policies above.**
2. **Approve the platform-admin bootstrap/recovery procedure** — direct SQL insert by E in Supabase Studio, no in-app mechanism. If a different mechanism is wanted, specify it.
3. **Confirm no one is bootstrapped as a platform admin during Phase 1** — this plan assumes `platform_admins` ships and stays empty; a future, separate decision names who (if anyone) gets platform-admin status.
4. **Explicit go-ahead to create migration 115 and hand it to E to run.** This document remains a plan for review until that go-ahead is given.

---

## Cross-references

- `PRODUCT_TENANCY_AUDIT.md` — §8 (proposed architecture), §9 (the full 8-phase staged approach), §10 (the twelve working decisions this plan builds against).
- `PRODUCT_PLAN.md` / `PRODUCT_START_PLAN.md` — product direction and discovery approach.
- `HANDOFF.md` — will record the actual migration once (and if) it is approved and run.
