# Ergon Productization — Phase 1 Implementation Plan

Status: **Plan for review — nothing in this document has been implemented.** No migration file has been created, no SQL has been run, no RLS policy has changed, no server route or frontend file has been edited.
Created: 2026-09-08
Builds on: `PRODUCT_TENANCY_AUDIT.md` (the audit and its §10 working decisions, set by E on 2026-09-08), which this plan implements the first phase of (§9's original 8-phase staged approach, Phase 1 specifically).

---

## Plain-English summary: what Phase 1 changes, and what you will see

**You will not see anything different.** No page, button, menu, report, or workflow changes. No existing data is modified, deleted, or moved.

Behind the scenes, Phase 1 does exactly two things:

1. **Creates three new, currently-unused database tables** (`workspaces`, `workspace_members`, `platform_admins`) that don't yet connect to anything else in the app. Nothing reads from them yet; nothing writes to them yet (except the one-time migration step below).
2. **Records the fact that Ensight Technologies is "the first workspace"** by inserting exactly one row into the new `workspaces` table, and copies (not moves) your existing team's admin and role assignments into the new `workspace_members` table as membership records for that one workspace.

After Phase 1, every existing table, every existing security rule, every existing page, and every existing API route works exactly as it does today — none of them are touched. Phase 1 is the foundation the later phases (described in `PRODUCT_TENANCY_AUDIT.md` §9) will build on; it does not, by itself, add any workspace-awareness to the app you actually use.

**Why do it this way first?** So that if anything about this specific step needs correcting, it can be undone completely — nothing existing was ever touched, so there is nothing to repair.

---

## Scope: what's in, what's explicitly out

**In scope for Phase 1:**
- Create `workspaces`, `workspace_members`, `platform_admins` tables, with RLS on each (new tables only).
- Create two new `security definer` helper functions: `is_platform_admin(uuid)` and `current_user_workspace_ids()` (mirroring the existing `is_app_admin()`/`has_role()` pattern this codebase already uses).
- Design (not yet build into any route) the `resolveActiveWorkspace()` server-side pattern per working decision #4.
- Insert exactly one `workspaces` row for Ensight Technologies.
- Migrate every existing `app_admins`/`app_user_roles` row into a corresponding `workspace_members` row pointing at that one workspace.
- Leave `platform_admins` empty — per working decision #2, no platform-admin roster is assigned in this pass.
- A rollback script.
- A production verification checklist.

**Explicitly out of scope for Phase 1** (later phases, per `PRODUCT_TENANCY_AUDIT.md` §9):
- Adding `workspace_id` to any existing table (`projects`, `sales_quotes`, `clients`, etc.).
- Changing any existing RLS policy.
- Changing any `api/*.js` route to enforce a workspace boundary.
- Changing Storage bucket policies.
- Building any workspace-switcher UI.
- Onboarding a second company — this is explicitly gated behind independent verification of later phases, per `PRODUCT_START_PLAN.md` principle #10.

---

## Proposed schema (for review — not created as a migration file, not run)

```sql
-- Proposed migration 115_workspaces_foundation.sql (NOT YET CREATED)
-- Fully additive: no existing table, policy, or function is altered.

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table workspaces enable row level security;

-- Any authenticated user can see the name of a workspace they belong to
-- (needed for a future switcher UI); nobody can see a workspace they are
-- not a member of. Platform admins can see all of them.
create policy "members and platform admins read workspaces"
  on workspaces for select to authenticated
  using (
    is_platform_admin(auth.uid())
    or exists (select 1 from workspace_members wm where wm.workspace_id = workspaces.id and wm.user_id = auth.uid())
  );

-- Only platform admins can create/edit workspaces in Phase 1 -- workspace
-- admins managing their own workspace's name/branding comes with the
-- onboarding/settings UI in a later phase, not Phase 1.
create policy "platform admins manage workspaces"
  on workspaces for all to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null check (role_key in (
    'warehouse', 'purchasing', 'pm', 'manager',
    'sales', 'engineering', 'product_development', 'implementation', 'support', 'marketing'
  )),
  is_primary boolean not null default true,
  is_workspace_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mirrors app_user_roles' existing shape exactly (migration 040): one row
-- per (user, role) within a workspace, not one row per user.
create unique index if not exists idx_workspace_members_workspace_user_role
  on workspace_members(workspace_id, user_id, role_key);

create index if not exists idx_workspace_members_primary
  on workspace_members(workspace_id, user_id) where is_primary;

alter table workspace_members enable row level security;

create policy "users read their own memberships"
  on workspace_members for select to authenticated
  using (auth.uid() = user_id or is_platform_admin(auth.uid()));

-- Workspace admins can see and manage every membership row in a workspace
-- they administer -- but NOT rows in a different workspace, even if they
-- are also a platform admin's colleague. This is the actual tenant
-- boundary this whole plan exists to build toward -- get it right here
-- even though nothing outside this table depends on it yet.
create policy "workspace admins read their own workspace's memberships"
  on workspace_members for select to authenticated
  using (
    exists (
      select 1 from workspace_members admin_row
      where admin_row.workspace_id = workspace_members.workspace_id
        and admin_row.user_id = auth.uid()
        and admin_row.is_workspace_admin
    )
  );

create policy "workspace admins and platform admins manage memberships"
  on workspace_members for all to authenticated
  using (
    is_platform_admin(auth.uid())
    or exists (
      select 1 from workspace_members admin_row
      where admin_row.workspace_id = workspace_members.workspace_id
        and admin_row.user_id = auth.uid()
        and admin_row.is_workspace_admin
    )
  )
  with check (
    is_platform_admin(auth.uid())
    or exists (
      select 1 from workspace_members admin_row
      where admin_row.workspace_id = workspace_members.workspace_id
        and admin_row.user_id = auth.uid()
        and admin_row.is_workspace_admin
    )
  );

-- Deliberately small and separate from workspace_members -- per working
-- decision #2, platform-admin access is a distinct, more sensitive concept
-- from workspace administration. No rows are inserted by this migration.
create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table platform_admins enable row level security;

create policy "platform admins read platform admin list"
  on platform_admins for select to authenticated
  using (is_platform_admin(auth.uid()));

create policy "platform admins manage platform admin list"
  on platform_admins for all to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));

create or replace function is_platform_admin(check_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from platform_admins where user_id = check_user_id);
$$;

-- Convenience helper for the future resolveActiveWorkspace() server pattern
-- (see below) -- not called by any existing code yet.
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

drop trigger if exists workspaces_set_updated_at on workspaces;
create trigger workspaces_set_updated_at
  before update on workspaces
  for each row execute function set_workspace_updated_at();

drop trigger if exists workspace_members_set_updated_at on workspace_members;
create trigger workspace_members_set_updated_at
  before update on workspace_members
  for each row execute function set_workspace_updated_at();

-- === Data migration: seed the first workspace and carry over existing
-- === admin/role assignments. Fully additive -- app_admins, app_user_roles,
-- === and company_branding are only ever read here, never written to.

-- 1. Seed the one workspace from today's company_branding name.
insert into workspaces (name, slug)
select coalesce(company_name, 'Ergon'), 'ensight'
from company_branding
where id = true
on conflict (slug) do nothing;

-- 2. Carry over every existing (user, role) assignment as a membership of
--    that one workspace.
insert into workspace_members (workspace_id, user_id, role_key, is_primary, is_workspace_admin)
select w.id, aur.user_id, aur.role_key, aur.is_primary, false
from app_user_roles aur
cross join (select id from workspaces where slug = 'ensight') w
on conflict (workspace_id, user_id, role_key) do nothing;

-- 3. Mark existing app_admins as workspace admins of that one workspace.
update workspace_members wm
set is_workspace_admin = true
from app_admins aa, workspaces w
where wm.user_id = aa.user_id and wm.workspace_id = w.id and w.slug = 'ensight';

-- 4. Edge case: an admin who has no app_user_roles row at all today (admin
--    status but no operational role selected) still needs at least one
--    workspace_members row to be a real member of the workspace. Fallback
--    role is 'manager' -- the closest existing equivalent to "admin with no
--    specific operational role." Confirm this default before running (see
--    "Decisions still needed" below) -- as of 2026-09-08's verification,
--    the one existing admin (eck1679@gmail.com) may or may not already
--    have an app_user_roles row; this statement is a no-op if they do.
insert into workspace_members (workspace_id, user_id, role_key, is_primary, is_workspace_admin)
select w.id, aa.user_id, 'manager', true, true
from app_admins aa
cross join (select id from workspaces where slug = 'ensight') w
where not exists (select 1 from app_user_roles aur where aur.user_id = aa.user_id)
on conflict (workspace_id, user_id, role_key) do nothing;
```

---

## `resolveActiveWorkspace()` — the server-side resolution pattern (design only)

Per working decision #4 ("the server must resolve the active workspace from authenticated workspace membership; never trust a browser-provided workspace ID without validating membership"), the proposed pattern for a future `api/_lib/resolveActiveWorkspace.js` (not created in Phase 1, since no route uses it yet) is:

```js
// PROPOSED DESIGN -- not implemented. Mirrors the existing requireAuth.js/
// requireRole.js pattern: takes the request and the already-verified user,
// returns a workspace id the caller is DEFINITELY a real member of, or
// writes an error response and returns null.
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
    // Client suggested a workspace -- validate it's one this user is
    // actually a member of before trusting it for anything.
    if (!memberIds.includes(requestedId)) {
      res.status(403).json({ error: "You are not a member of that workspace." });
      return null;
    }
    return requestedId;
  }
  if (memberIds.length === 1) return memberIds[0]; // the common case today -- exactly one workspace
  if (memberIds.length === 0) {
    res.status(403).json({ error: "You are not a member of any workspace." });
    return null;
  }
  // Belongs to more than one workspace and didn't specify -- a later phase's
  // UI would send X-Workspace-Id once a switcher exists; until then this is
  // an explicit, safe failure rather than guessing which one was meant.
  res.status(400).json({ error: "Multiple workspaces found; specify which one." });
  return null;
}
```

This is documented here for review because working decision #4 asked for the mechanism to be designed, but it is **not wired into any route in Phase 1** — there is nothing for it to scope yet, since no existing table has a `workspace_id` column until a later phase.

---

## Rollback plan

Because Phase 1 never modifies an existing table, column, policy, or function — it only adds new ones — rollback is a straightforward drop, with zero risk to any existing data:

```sql
-- Rollback for migration 115 (if ever needed)
drop trigger if exists workspace_members_set_updated_at on workspace_members;
drop trigger if exists workspaces_set_updated_at on workspaces;
drop function if exists set_workspace_updated_at();
drop function if exists current_user_workspace_ids();
drop function if exists is_platform_admin(uuid);
drop table if exists platform_admins;
drop table if exists workspace_members;
drop table if exists workspaces;
```

No existing table is referenced by a foreign key from any of these new tables in a way that would block this rollback (workspace_members references `auth.users`, `workspaces` — both either pre-existing and untouched, or being dropped together here). No existing row anywhere is deleted or altered by either the forward migration or this rollback.

---

## Production verification checklist (after running, before calling Phase 1 done)

1. Confirm exactly one row exists in `workspaces`, with `name` matching whatever `company_branding.company_name` held at migration time.
2. Confirm `workspace_members` row count equals the pre-migration `app_user_roles` row count, plus one row per admin who had no prior `app_user_roles` row (should be 0 or a small number, given only one admin exists today).
3. Confirm the existing admin (`eck1679@gmail.com`) has at least one `workspace_members` row with `is_workspace_admin = true`.
4. Confirm `platform_admins` has **zero** rows — this is the explicit check that no platform-admin status was accidentally assigned.
5. Confirm no existing table's row count changed (a simple before/after count on `app_admins`, `app_user_roles`, `projects`, `tasks`, or any other table of your choosing — none should differ, since nothing existing was written to).
6. Spot-check the live app: sign in, confirm the dashboard, tasks, projects, and Admin panel all look and behave exactly as they did before this migration ran (expected: no visible difference at all).
7. Confirm rollback works in a non-production environment first if there's any hesitation — this plan's rollback script has not itself been executed anywhere yet.

---

## Decisions still needed before this specific plan can be implemented

These are narrower than `PRODUCT_TENANCY_AUDIT.md` §10's twelve broader decisions — they're the remaining specifics needed to actually run the SQL above:

1. **Approve or amend the exact schema above** — table/column names, the RLS policies on the three new tables, and the two new helper functions.
2. **Confirm the first workspace's `slug`** — this plan proposes `'ensight'`; should it instead be `'ergon'`, or something else entirely?
3. **Confirm the fallback role for an admin with no existing `app_user_roles` row** — this plan proposes `'manager'` as the closest existing equivalent; confirm or choose a different default.
4. **Confirm who runs this migration and when** — per this repo's standing process (no CI; migrations are applied manually in Supabase Studio by E), this would be handed off the same way every other migration in `HANDOFF.md` has been: exact SQL provided, run manually, then live-verified together.
5. **Explicit go-ahead to proceed** — this document is a plan for review; nothing runs until it's approved.

---

## Cross-references

- `PRODUCT_TENANCY_AUDIT.md` — the audit this plan implements the first phase of; §8 (proposed architecture), §9 (the full 8-phase staged approach, of which this is Phase 1), §10 (the twelve working decisions this plan builds against).
- `PRODUCT_PLAN.md` / `PRODUCT_START_PLAN.md` — product direction and discovery approach.
- `HANDOFF.md` — will record the actual migration once (and if) it is approved and run, per this repo's standing documentation convention.
