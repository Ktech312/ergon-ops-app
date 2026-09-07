# Ergon Productization — Phase 1 Implementation Plan (Revision 4 — Final)

Status: **Migration file created (`backend/supabase/migrations/115_workspaces_foundation.sql`), NOT run against any database.** The architecture, bootstrap procedure, empty `platform_admins` roster, slug `ensight`, and stop-and-resolve-manually preflight approach are all approved. This revision applies E's final two narrow corrections. No existing code, table, policy, workflow, or production behavior has been changed. E will run the preflight queries and the migration manually in Supabase Studio after reviewing this revision.
Created: 2026-09-08 · Revision 2: 2026-09-08 · Revision 3: 2026-09-08 · Revision 4 (final): 2026-09-08
Builds on: `PRODUCT_TENANCY_AUDIT.md` (§8 architecture, §9 staged approach, §10 working decisions).

## What changed in Revision 4, and why

Two narrow corrections, requested after the architecture itself was approved:

1. **Every authorization helper now evaluates the authenticated caller internally via `auth.uid()`, instead of accepting an arbitrary acting-user id as a parameter.** `is_platform_admin()` (was `is_platform_admin(check_user_id uuid)`), `is_workspace_admin(check_workspace_id uuid)` (was `is_workspace_admin(check_workspace_id uuid, check_user_id uuid)`), `is_workspace_member(check_workspace_id uuid)`, `is_workspace_member_owner(check_member_id uuid)`, and `can_manage_workspace_member(check_member_id uuid)` all dropped their second parameter. An RLS policy only ever needs to ask "can *the current caller* do this" — there was never a real reason for any of these to accept a different, caller-supplied user id. This also further reduces the information-exposure concern Revision 3's security analysis flagged as an accepted trade-off: since every function now hard-codes `auth.uid()` internally, calling one of these directly via PostgREST's `rpc/<name>` endpoint can only ever answer a question about the caller themselves, never probe an arbitrary pair of other users. `security definer`, `set search_path = ''`, full schema-qualification, and the explicit grants are all unchanged in spirit — only carried forward onto the corrected (shorter) signatures.
2. **Test B is corrected to test what it claims to test.** The original version derived the "other" workspace's id through a `select id from public.workspaces where slug = ...` subquery — but `workspaces`' own RLS (`is_platform_admin() or is_workspace_member(id)`) would hide that row from the simulated admin, since they are deliberately not a member of it. That subquery would silently return no rows, so the later `UPDATE ... where workspace_id = (that subquery)` would affect zero rows *regardless of whether `workspace_members`' write policy works at all* — the test could "pass" for the wrong reason. Corrected: both test workspaces are seeded with fixed, known UUID literals inside the transaction, and the unauthorized `UPDATE` addresses the second workspace by that literal UUID directly, never through a lookup `workspaces`' own RLS could hide. `returning *` is added so a real zero-row result is visibly an empty result set, not just a number to trust.

Everything else — the table design, the bootstrap procedure, the preflight checks, the workspace-seeding fix, the transitional role-list note, the suspended-workspace future requirement, and the overall rollback structure — is unchanged from Revision 3 and already approved.

---

## Plain-English summary: what Phase 1 changes, and what you will see

**You will not see anything different.** No page, button, menu, report, or workflow changes. No existing data is modified, deleted, or moved.

Behind the scenes, once E runs this migration in Supabase Studio, Phase 1:

1. **Creates four new, currently-unused database tables** (`workspaces`, `workspace_members`, `workspace_member_roles`, `platform_admins`), six new helper functions used only by those tables' own security rules, and explicit permission grants so only genuinely signed-in users can even call those functions.
2. **Records that Ensight Technologies is the first workspace**, and copies (never moves or alters) your team's existing admin status and operational role assignments into the new tables.
3. **Leaves `platform_admins` completely empty.** No account is made a platform admin by this migration.

Every existing table, security rule, page, and API route works exactly as it does today. Nothing existing is touched.

---

## Confirmation: nothing has been implemented against any live system

- **The migration file now exists** at `backend/supabase/migrations/115_workspaces_foundation.sql` — created in this revision, per E's explicit "create migration 115" instruction.
- **It has not been run.** No SQL from it has executed against Supabase (or any database). No table, function, policy, or row described in this document exists in production yet.
- **No existing file was touched to create it.** No existing migration, RLS policy, `api/*.js` route, or frontend file was edited.
- **No repository check was skipped**: `npx tsc -b`, `npm run build`, `npm run lint`, `npm test`, and `npm run test:smoke` were all run after adding the migration file and this plan update, to confirm the new SQL file (which the app's own code never references) introduced no regression anywhere else in the repository. Results are in `HANDOFF.md`'s work-log entry for this revision.
- **E will run** the preflight queries and then the migration manually in Supabase Studio, on E's own schedule, after reviewing this document.

---

## Preflight checks — run these against production *before* the migration is run (copy-paste block)

**If any of these return rows, stop — do not run the migration until the underlying data is resolved.** Read-only; safe to run any time.

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
-- this check exists to catch drift, not an expected finding.
select distinct role_key from app_user_roles
where role_key not in (
  'warehouse', 'purchasing', 'pm', 'manager',
  'sales', 'engineering', 'product_development', 'implementation', 'support', 'marketing'
);
-- EXPECTED: zero rows. If any appear, add the missing value to
-- workspace_member_roles' check constraint before migrating, or
-- investigate why an unrecognized role_key exists at all.

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

## The migration (copy-paste block — identical to `backend/supabase/migrations/115_workspaces_foundation.sql`)

See the created file for the authoritative, currently-committed copy. Reproduced here in full for review convenience:

```sql
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

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_workspace_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

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

create unique index if not exists idx_workspace_member_roles_one_primary
  on public.workspace_member_roles(workspace_member_id) where is_primary;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Section 2 -- Helper functions (each evaluates auth.uid() internally)
-- ============================================================

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

create or replace function public.current_user_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select workspace_id from public.workspace_members where user_id = auth.uid();
$$;

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
-- Section 5 -- Data migration
-- ============================================================

insert into public.workspaces (name, slug)
values (
  coalesce((select company_name from public.company_branding where id = true), 'Ensight Technologies'),
  'ensight'
)
on conflict (slug) do nothing;

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

insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
select wm.id, aur.role_key, aur.is_primary
from app_user_roles aur
join public.workspace_members wm
  on wm.user_id = aur.user_id
  and wm.workspace_id = (select id from public.workspaces where slug = 'ensight')
on conflict (workspace_member_id, role_key) do nothing;
```

---

## Platform-admin bootstrap and recovery procedure (unchanged, approved)

```sql
insert into public.platform_admins (user_id)
values ('<the approved account''s auth.users id>');
```

Same direct-SQL pattern for recovery if every platform admin were ever lost. No in-app flow exists or is planned for this. **Not run by this migration** — `platform_admins` ships empty.

---

## `resolveActiveWorkspace()` — server-side resolution pattern (design only, unchanged)

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
    // FUTURE REQUIREMENT, recorded now, not implemented in Phase 1: once
    // this function is wired into a route, it must also check the
    // resolved workspace's `status` and reject with 403 if 'suspended'.
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
drop function if exists public.can_manage_workspace_member(uuid);
drop function if exists public.is_workspace_member_owner(uuid);
drop function if exists public.is_workspace_member(uuid);
drop function if exists public.is_workspace_admin(uuid);
drop function if exists public.is_platform_admin();

drop table if exists public.platform_admins;
drop table if exists public.workspace_member_roles;
drop table if exists public.workspace_members;
drop table if exists public.workspaces;
```

`DROP FUNCTION` automatically removes any grants on it — no explicit `revoke` needed in rollback. No existing table, column, policy, or function is referenced by anything above outside a plain `select` during the one-time data migration.

---

## Security analysis (updated for Revision 4)

- **Search-path injection**: closed, unchanged from Revision 3 — every function sets `search_path = ''` and fully qualifies every table reference.
- **Default over-permissive execution**: closed, unchanged — every function's `PUBLIC` grant is revoked, re-granted only to `authenticated`.
- **Recursion**: eliminated by construction and directly tested (Test F) — unchanged mechanism, now with simpler (fewer-argument) function calls throughout.
- **Information exposure through directly callable RPCs — improved in Revision 4.** Every function now evaluates `auth.uid()` internally instead of accepting a caller-supplied user id. A caller invoking, say, `rpc/can_manage_workspace_member` directly can now only ever learn "can *I* manage this member row" — never "can user X manage user Y's workspace," since there is no longer a parameter through which to ask about anyone but themselves. This closes the residual exposure Revision 3's analysis accepted as a trade-off; there is no longer a trade-off to accept.
- **Test correctness — Test B, specifically fixed.** Revision 3's Test B derived its "other workspace" id through a query against `workspaces`, whose own RLS would have hidden that row from the simulated non-member admin — meaning a "0 rows updated" result could have meant either "the write policy correctly blocked it" or "the row was never found because the lookup silently returned nothing." Revision 4 seeds both test workspaces with literal, known UUIDs and addresses the unauthorized update by that literal directly, so a 0-row result unambiguously demonstrates `workspace_members`' own write policy working, not an artifact of a different table's RLS.
- **Primary-role integrity, cross-workspace containment, platform-admin containment, no change to existing security boundaries, the transitional role-list limitation**: all unchanged from Revision 3, still accurate.

---

## Executable verification SQL

Tests A, C, D, E, F, G, H are **unchanged from Revision 3** (none of them call the helper functions directly by name — they rely on RLS invoking those functions transparently, and the functions' internal use of `auth.uid()` is exactly what those tests were already simulating via `set local request.jwt.claims`, so dropping the extra parameter changes nothing about how those tests behave). Only **Test B is corrected** below.

```sql
-- TEST B (CORRECTED): a workspace admin manages members only in their
-- own workspace. Both test workspaces get fixed, known UUID literals so
-- the unauthorized update targets a real, specific id directly -- never
-- a value looked up through `workspaces`, whose own RLS would hide the
-- second workspace from this simulated admin and make a "0 rows
-- updated" result ambiguous.
begin;
do $$
declare
  ws_admin_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  ws_other_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
  admin_user uuid := '<REPLACE-WITH-REAL-USER-ID-ADMIN>';
  other_user uuid := '<REPLACE-WITH-REAL-USER-ID-OTHER>';
begin
  insert into public.workspaces (id, name, slug) values (ws_admin_id, 'Test Workspace B Admin', 'test-workspace-b-admin');
  insert into public.workspaces (id, name, slug) values (ws_other_id, 'Test Workspace B Other', 'test-workspace-b-other');
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_admin_id, admin_user, true);
  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin) values (ws_other_id, other_user, false);
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub": "<REPLACE-WITH-REAL-USER-ID-ADMIN>", "role": "authenticated"}';

-- Read check, using the known fixed ids directly (never looked up
-- through workspaces, which RLS would filter).
select workspace_id, user_id from public.workspace_members
where workspace_id in ('11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid);
-- EXPECTED: exactly one row, workspace_id = ws_admin_id ('1111...').
-- The row belonging to ws_other_id ('2222...') must not appear.

-- Write check: the unauthorized update target is addressed by its
-- literal, hardcoded workspace_id -- this directly tests
-- workspace_members' own write policy, not a side effect of a different
-- table's RLS hiding a lookup.
update public.workspace_members
set is_workspace_admin = true
where workspace_id = '22222222-2222-2222-2222-222222222222'::uuid
  and user_id = '<REPLACE-WITH-REAL-USER-ID-OTHER>'
returning *;
-- EXPECTED: an empty result set (0 rows). This admin genuinely
-- administers ws_admin_id, not ws_other_id, and the RLS write policy
-- (`is_workspace_admin(workspace_id)`) correctly evaluates to false for
-- ws_other_id regardless of what this admin can or cannot see via a
-- separate table's own policy.
rollback;
```

Tests A, C, D, E, F, G, H (Revision 3, unchanged — reproduced here for completeness):

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
-- is created and used entirely inside this transaction -- rollback
-- guarantees it never persists.
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
-- EXPECTED: every workspace visible, not scoped to just one.
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
-- EXPECTED: every query returns normally and quickly -- no "stack depth
-- limit exceeded" error, no multi-second hang.
rollback;
```

```sql
-- TEST G: only one primary role per member, enforced by the database
-- itself. Uses a PL/pgSQL exception handler (an exception block
-- implicitly creates its own savepoint) so the expected error is caught
-- and confirmed without aborting the script. Deliberately does not
-- switch to the authenticated role -- this tests the raw constraint, not
-- RLS.
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
```

```sql
-- TEST H: existing Ergon behavior is unchanged. Pure read-only -- run
-- once BEFORE the migration and once AFTER; every number must match.
select count(*) from app_admins;
select count(*) from app_user_roles;
select count(*) from projects;
select count(*) from tasks;
select count(*) from sales_quotes;
```

---

## Post-migration verification (copy-paste block)

```sql
-- 1. Exactly one workspace, correctly named and slugged.
select * from public.workspaces;

-- 2. workspace_members has exactly one row per distinct user across
-- app_user_roles union app_admins.
select
  (select count(*) from public.workspace_members) as workspace_members_count,
  (select count(distinct user_id) from (
    select user_id from app_user_roles
    union
    select user_id from app_admins
  ) u) as expected_count;
-- EXPECTED: the two counts match exactly.

-- 3. workspace_member_roles row count equals the pre-migration
-- app_user_roles row count exactly.
select
  (select count(*) from public.workspace_member_roles) as workspace_member_roles_count,
  (select count(*) from app_user_roles) as app_user_roles_count;
-- EXPECTED: the two counts match exactly.

-- 4. The existing admin has a workspace_members row with
-- is_workspace_admin = true.
select wm.* from public.workspace_members wm
join app_known_users aku on aku.user_id = wm.user_id
where aku.email = 'eck1679@gmail.com';
-- EXPECTED: exactly one row, is_workspace_admin = true.

-- 5. platform_admins is empty.
select count(*) from public.platform_admins;
-- EXPECTED: 0.

-- 6. Existing tables are untouched (compare against Test H's
-- before-migration numbers).
select count(*) from app_admins;
select count(*) from app_user_roles;
select count(*) from projects;
select count(*) from tasks;
select count(*) from sales_quotes;
-- EXPECTED: every number identical to what Test H returned before the
-- migration ran.
```

Then run Tests A-G (self-contained, self-cleaning) and spot-check the live app (sign in, confirm dashboard/tasks/projects/Admin all look and behave exactly as before).

---

## Deployment process

Per this repo's standing process (no CI; migrations are applied manually): E runs the preflight block first; if and only if all three return zero rows, E runs the migration block in Supabase Studio; then E and this session complete the post-migration verification block together, followed by Tests A-G.

---

## Remaining decisions

None. The architecture, bootstrap procedure, empty `platform_admins` roster, slug, preflight-remediation approach, and both Revision 4 corrections are all approved. The only remaining step is E reviewing this document and then running the preflight and migration manually in Supabase Studio, on E's own schedule.

---

## Cross-references

- `PRODUCT_TENANCY_AUDIT.md` — §8 (proposed architecture), §9 (staged approach), §10 (working decisions).
- `PRODUCT_PLAN.md` / `PRODUCT_START_PLAN.md` — product direction and discovery approach.
- `backend/supabase/migrations/115_workspaces_foundation.sql` — the migration file itself (created, not run).
- `HANDOFF.md` — records this revision's repository-check results; will record live-verification results once (and if) E runs the migration.
