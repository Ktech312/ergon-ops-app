-- Transitional compatibility bridge between the legacy authorization
-- tables (app_user_roles, app_admins -- read by has_role()/is_app_admin(),
-- which every existing RLS policy in this app still calls) and the real
-- workspace infrastructure (workspaces, workspace_members,
-- workspace_member_roles -- built by migration 115, renamed by migration
-- 116, not yet wired into any actual authorization check anywhere).
--
-- REVISION 2 (this file) -- corrects seven issues found in review of the
-- first draft, none of which had been run in production:
--   1. is_app_admin(uuid) itself was unhardened (no search_path='', an
--      unqualified `app_admins` reference) -- the exact same nested-helper
--      failure class found live during migration 123's own verification,
--      here caught in review before ever running. Redefined below with
--      the same discipline as every other function in this file.
--   2. bridge_set_secondary_roles() had no protection against demoting a
--      user's primary role into a secondary one, no check that the
--      legacy and workspace primary roles already agree before touching
--      secondary roles, and silently created an empty workspace
--      membership row for a user who had none -- all fixed below.
--   3. setUserAllowedViews() -- the actual FIFTH live direct-write
--      function, previously left unbridged while the file's own
--      documentation incorrectly implied all five had been handled --
--      now has its own hardened bridge_set_user_allowed_views() RPC.
--   4. active_workspace_id() only checked the ACTIVE workspace count,
--      not the TOTAL row count -- a second, merely-suspended workspace
--      would have passed the old check. Now requires exactly one
--      workspace row in total, which must be active.
--   5. bridge_revoke_admin() had no protection against removing the
--      last remaining global admin, which would have locked the whole
--      app's admin-management screen out with no recovery path short of
--      a manual database fix.
--   6/7. Drift reporting and testing gaps addressed directly in the
--      standalone drift report and the separate test script.
--
-- This migration does NOT narrow or remove any existing RLS policy on
-- the legacy tables, does NOT activate any restrictive policy, and does
-- NOT touch has_role()/is_app_manager() (siblings of is_app_admin() with
-- the same latent unqualified-reference issue, deliberately NOT
-- hardened here -- out of scope for this round, not silently ignored).
-- Closing the direct-write bypass (revoking/narrowing the existing
-- "admins manage all roles"-style policies) is deliberately a LATER,
-- separate migration, run only after these functions are proven live
-- and correct.

begin;

-- ============================================================
-- Section 1 -- is_app_admin(uuid), hardened. Same signature, same logic,
-- same return value for every existing caller (grepped: 18 files, every
-- single call site uses the identical `is_app_admin(auth.uid())` shape
-- inside an RLS using()/with check() clause -- none of them are
-- themselves search_path-restricted, so this change is invisible to all
-- of them). The only behavioral fact worth documenting plainly: this
-- function accepts an arbitrary user id as a parameter, not just
-- auth.uid() -- any authenticated caller can ask "is user X an admin?"
-- for any X, not only themselves. That was already true before this
-- change (grant execute ... to authenticated predates migration 124
-- entirely) and is unchanged by this hardening -- recorded here because
-- it's a real fact about this function's exposure, not because this
-- migration is introducing it.
-- ============================================================

create or replace function public.is_app_admin(check_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = check_user_id);
$$;

revoke all on function public.is_app_admin(uuid) from public;
grant execute on function public.is_app_admin(uuid) to authenticated;

-- ============================================================
-- Section 2 -- active_workspace_id(): strengthened. Requires exactly one
-- workspace ROW IN TOTAL (not just one with status='active') -- a second
-- workspace that's merely suspended is just as unsafe for this bridge as
-- a second active one, since legacy roles have no workspace dimension at
-- all and would silently apply to whichever workspace a bridge function
-- resolved. The sole workspace must also actually be active.
-- ============================================================

create or replace function public.active_workspace_id()
returns uuid
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  result uuid;
  total_count integer;
  found_status text;
begin
  select count(*) into total_count from public.workspaces;

  if total_count <> 1 then
    raise exception 'Bridge functions require exactly one workspace row to exist in total, found %. Onboarding a second workspace (even suspended) is blocked until Phase 3 removes this dependency (PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md Part 9.7.1, point 8).', total_count;
  end if;

  select id, status into result, found_status from public.workspaces limit 1;

  if found_status <> 'active' then
    raise exception 'Bridge functions require the sole workspace to be active, found status ''%''.', found_status;
  end if;

  return result;
end;
$$;

revoke all on function public.active_workspace_id() from public;
revoke execute on function public.active_workspace_id() from anon;
grant execute on function public.active_workspace_id() to authenticated;

-- ============================================================
-- Section 3 -- bridge_set_primary_role(): unchanged from the first draft
-- (review found no issue with this one) -- replaces setPrimaryUserRole()'s
-- direct writes (persistence.ts). Legacy-side logic is byte-for-byte the
-- same delete-then-upsert shape the original function already used. This
-- remains the ONLY bridge function that creates a workspace_members row
-- for a user who doesn't have one yet -- every other function below
-- requires one to already exist.
-- ============================================================

create or replace function public.bridge_set_primary_role(target_user_id uuid, new_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_id uuid;
  member_id uuid;
begin
  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may change a user''s primary role.';
  end if;

  ws_id := public.active_workspace_id();

  delete from public.app_user_roles
  where user_id = target_user_id and is_primary = true and role_key <> new_role_key;

  insert into public.app_user_roles (user_id, role_key, is_primary, updated_at)
  values (target_user_id, new_role_key, true, now())
  on conflict (user_id, role_key) do update
    set is_primary = true, updated_at = now();

  select id into member_id from public.workspace_members
  where workspace_id = ws_id and user_id = target_user_id;

  if member_id is null then
    insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
    values (ws_id, target_user_id, false)
    returning id into member_id;
  end if;

  delete from public.workspace_member_roles
  where workspace_member_id = member_id and is_primary = true and role_key <> new_role_key;

  insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
  values (member_id, new_role_key, true)
  on conflict (workspace_member_id, role_key) do update
    set is_primary = true;
end;
$$;

revoke all on function public.bridge_set_primary_role(uuid, text) from public;
revoke execute on function public.bridge_set_primary_role(uuid, text) from anon;
grant execute on function public.bridge_set_primary_role(uuid, text) to authenticated;

-- ============================================================
-- Section 4 -- bridge_set_secondary_roles(): rewritten. Now verifies,
-- before writing anything: the target has a legacy primary role; the
-- target has a workspace membership already (never creates one here);
-- the target has a workspace primary role; the legacy and workspace
-- primary roles agree with each other; and the requested secondary set
-- doesn't include the primary role itself. Any failure raises before
-- either table is touched -- atomic by construction (a plpgsql function
-- body is one implicit transaction; an uncaught exception rolls back
-- everything the function itself had done up to that point).
-- ============================================================

create or replace function public.bridge_set_secondary_roles(target_user_id uuid, new_role_keys text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  legacy_primary_role text;
  workspace_primary_role text;
  member_id uuid;
  rk text;
begin
  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may change a user''s secondary roles.';
  end if;

  perform public.active_workspace_id();

  select role_key into legacy_primary_role
  from public.app_user_roles
  where user_id = target_user_id and is_primary = true;

  if legacy_primary_role is null then
    raise exception 'Cannot set secondary roles: % has no primary role assigned yet.', target_user_id;
  end if;

  select wm.id into member_id
  from public.workspace_members wm
  where wm.user_id = target_user_id;

  if member_id is null then
    raise exception 'Cannot set secondary roles: % has no workspace membership yet -- set a primary role first (bridge_set_primary_role creates it).', target_user_id;
  end if;

  select wmr.role_key into workspace_primary_role
  from public.workspace_member_roles wmr
  where wmr.workspace_member_id = member_id and wmr.is_primary = true;

  if workspace_primary_role is null then
    raise exception 'Cannot set secondary roles: % has a legacy primary role but no matching workspace primary role. Resolve this drift first -- see bridge_drift_report().', target_user_id;
  end if;

  if legacy_primary_role is distinct from workspace_primary_role then
    raise exception 'Cannot set secondary roles: legacy primary role (%) and workspace primary role (%) disagree for %. Resolve this drift first -- see bridge_drift_report().', legacy_primary_role, workspace_primary_role, target_user_id;
  end if;

  if new_role_keys is not null and legacy_primary_role = any(new_role_keys) then
    raise exception 'Cannot set ''%'' as a secondary role for % -- it is already this user''s primary role.', legacy_primary_role, target_user_id;
  end if;

  delete from public.app_user_roles where user_id = target_user_id and is_primary = false;

  if new_role_keys is not null and array_length(new_role_keys, 1) is not null then
    foreach rk in array new_role_keys loop
      insert into public.app_user_roles (user_id, role_key, is_primary, updated_at)
      values (target_user_id, rk, false, now())
      on conflict (user_id, role_key) do update
        set is_primary = false, updated_at = now();
    end loop;
  end if;

  delete from public.workspace_member_roles where workspace_member_id = member_id and is_primary = false;

  if new_role_keys is not null and array_length(new_role_keys, 1) is not null then
    foreach rk in array new_role_keys loop
      insert into public.workspace_member_roles (workspace_member_id, role_key, is_primary)
      values (member_id, rk, false)
      on conflict (workspace_member_id, role_key) do update
        set is_primary = false;
    end loop;
  end if;
end;
$$;

revoke all on function public.bridge_set_secondary_roles(uuid, text[]) from public;
revoke execute on function public.bridge_set_secondary_roles(uuid, text[]) from anon;
grant execute on function public.bridge_set_secondary_roles(uuid, text[]) to authenticated;

-- ============================================================
-- Section 5 -- bridge_set_user_allowed_views(): NEW. This is the actual
-- fifth live direct-write function (setUserAllowedViews(), persistence.ts)
-- that the first draft of this migration left unbridged while its own
-- comments incorrectly said all five had been handled. Legacy-only by
-- design -- workspace_member_roles has no allowed_views equivalent, and
-- none is added here -- but it must go through this same controlled RPC
-- surface so the later policy-narrowing migration can close ALL direct
-- writes to app_user_roles at once, not four out of five. It also calls
-- active_workspace_id() before writing anything, same as every other
-- transitional writer -- this function changes a global legacy
-- permission and must be gated by the same single-workspace safety
-- invariant as the rest of the bridge, even though its own write never
-- touches a workspace table directly.
-- ============================================================

create or replace function public.bridge_set_user_allowed_views(target_user_id uuid, new_allowed_views text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  matching_row_count integer;
begin
  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may change a user''s tab permissions.';
  end if;

  perform public.active_workspace_id();

  select count(*) into matching_row_count
  from public.app_user_roles
  where user_id = target_user_id and is_primary = true;

  if matching_row_count = 0 then
    raise exception 'Cannot set tab permissions: % has no primary role assigned yet.', target_user_id;
  elsif matching_row_count > 1 then
    raise exception 'Cannot set tab permissions: % has % primary-role rows (should be exactly one) -- resolve this data issue before changing tab permissions.', target_user_id, matching_row_count;
  end if;

  update public.app_user_roles
  set allowed_views = new_allowed_views, updated_at = now()
  where user_id = target_user_id and is_primary = true;
end;
$$;

revoke all on function public.bridge_set_user_allowed_views(uuid, text[]) from public;
revoke execute on function public.bridge_set_user_allowed_views(uuid, text[]) from anon;
grant execute on function public.bridge_set_user_allowed_views(uuid, text[]) to authenticated;

-- ============================================================
-- Section 6 -- bridge_grant_admin() / bridge_revoke_admin(). Grant is
-- unchanged from the first draft. Revoke now protects the last remaining
-- global admin -- without this, the app's own admin-management screen
-- could revoke its way into a state with zero admins and no recovery
-- path short of a manual database fix. This is TRANSITIONAL protection
-- only, for the legacy app_admins table as it exists today -- removing
-- the actual final legacy admin, if that's ever genuinely intended (e.g.
-- during the Phase 3 migration that retires app_admins entirely),
-- requires its own separately reviewed migration, not a workaround
-- around this check.
--
-- bridge_revoke_admin() also now takes a transaction-scoped Postgres
-- advisory lock (pg_advisory_xact_lock) before counting admins. This is
-- required because the final-admin check is a "count, then decide"
-- sequence over an AGGREGATE, not a single row -- ordinary row-level
-- locking doesn't protect it. Two concurrent calls revoking two
-- DIFFERENT admins (A and B, with exactly two admins total) could each
-- independently run `select count(*) from app_admins`, each see 2 under
-- READ COMMITTED isolation (since neither has committed yet), each
-- conclude "safe, not the last one," and both commit -- leaving zero
-- admins despite neither individual check being wrong in isolation. The
-- advisory lock forces every concurrent bridge_revoke_admin call to run
-- strictly one at a time: whichever call is blocked re-acquires the lock
-- (and re-counts) only after the first has committed or rolled back, so
-- the count it sees always reflects that prior call's real, committed
-- effect. The lock is released automatically at this transaction's
-- commit/rollback (the "_xact_" variant, not the session-scoped one) --
-- no explicit unlock call is needed or safe to add.
--
-- The is_app_admin(auth.uid()) check is now performed TWICE: once before
-- waiting for the lock (a fast, non-authoritative rejection that spares
-- an obviously-unauthorized caller the wait), and again immediately
-- after acquiring it (the authoritative check the actual decision relies
-- on). This closes a real three-admin race the single pre-lock check
-- left open: admins X, Y, Z all exist. X calls bridge_revoke_admin(Z);
-- Y calls bridge_revoke_admin(X); both pass the fast pre-lock check
-- (X and Y are each still admins at that instant). Y's call happens to
-- acquire the lock first, revokes X, commits, releases the lock -- X is
-- now genuinely no longer an admin. X's call, which had been blocked
-- waiting, now acquires the lock and -- WITHOUT a recheck -- would
-- proceed straight to counting admins and revoking Z, using an
-- authorization decision (`X is an admin`) that was true when first
-- checked but is stale by the time it actually executes. The recheck
-- after acquiring the lock catches exactly this: X's second
-- is_app_admin() call now correctly returns false, and the request is
-- rejected instead of a just-revoked caller still managing to revoke
-- someone else. Every reference to a Postgres builtin inside the lock
-- call is fully schema-qualified (pg_catalog.pg_advisory_xact_lock,
-- pg_catalog.hashtext) for consistency with this function's
-- search_path='' -- pg_catalog is always implicitly searched regardless
-- of search_path, so this qualification isn't strictly load-bearing, but
-- matches the fully-qualify-everything discipline used throughout this
-- migration rather than relying on that implicit behavior.
-- ============================================================

create or replace function public.bridge_grant_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_id uuid;
begin
  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may grant admin access.';
  end if;

  ws_id := public.active_workspace_id();

  insert into public.app_admins (user_id) values (target_user_id)
  on conflict (user_id) do nothing;

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
  values (ws_id, target_user_id, true)
  on conflict (workspace_id, user_id) do update set is_workspace_admin = true;
end;
$$;

revoke all on function public.bridge_grant_admin(uuid) from public;
revoke execute on function public.bridge_grant_admin(uuid) from anon;
grant execute on function public.bridge_grant_admin(uuid) to authenticated;

create or replace function public.bridge_revoke_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_id uuid;
  admin_count integer;
begin
  -- Fast, non-authoritative rejection -- spares an obviously-unauthorized
  -- caller the wait for the lock below. Not sufficient on its own: see
  -- the mandatory recheck immediately after the lock is acquired.
  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may revoke admin access.';
  end if;

  -- Acquire before rechecking or changing anything -- see the header
  -- comment above for why this specific lock is required, and why the
  -- authorization check must be repeated once it's held.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bridge_admin_revoke_lock'));

  -- Authoritative recheck. The caller's own admin status could have been
  -- revoked by whichever transaction just released this lock -- the
  -- fast check above ran before waiting and cannot be trusted once the
  -- wait is over (see the three-admin scenario in the header comment).
  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may revoke admin access (caller''s admin status was revoked while this request was waiting).';
  end if;

  if not exists (select 1 from public.app_admins where user_id = target_user_id) then
    raise exception '% is not currently a global administrator -- nothing to revoke. Their workspace-admin status, if any, is left untouched: it may have been granted independently of this legacy path, and this function must never silently strip it.', target_user_id;
  end if;

  -- Recount while holding the lock -- this is the value the final-admin
  -- decision actually depends on; anything read before the lock was
  -- acquired could already be stale.
  select count(*) into admin_count from public.app_admins;

  if admin_count <= 1 then
    raise exception 'Cannot revoke %: they are the last remaining global administrator. Removing the final legacy admin requires a separately reviewed Phase 3 migration, not this transitional bridge.', target_user_id;
  end if;

  ws_id := public.active_workspace_id();

  delete from public.app_admins where user_id = target_user_id;

  update public.workspace_members
  set is_workspace_admin = false
  where workspace_id = ws_id and user_id = target_user_id;
end;
$$;

revoke all on function public.bridge_revoke_admin(uuid) from public;
revoke execute on function public.bridge_revoke_admin(uuid) from anon;
grant execute on function public.bridge_revoke_admin(uuid) to authenticated;

-- ============================================================
-- Section 7 -- bridge_drift_report(): unchanged in shape from the first
-- draft; now benefits automatically from is_app_admin()'s hardening.
-- Workspace-count/status detail and user-email enrichment are handled in
-- the standalone drift report (backend/supabase/drift_report_standalone.sql)
-- rather than duplicated here, since that script is what's meant to be
-- read by a person -- this RPC's jsonb `detail` column already carries
-- the same underlying facts for programmatic/repeat use.
-- ============================================================

create or replace function public.bridge_drift_report()
returns table (check_name text, user_id uuid, detail jsonb)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may run the drift report.';
  end if;

  return query
  select 'legacy_role_user_missing_workspace_membership'::text, u.user_id,
    jsonb_build_object('role_key', u.role_key, 'is_primary', u.is_primary)
  from public.app_user_roles u
  where not exists (select 1 from public.workspace_members wm where wm.user_id = u.user_id)

  union all
  select 'legacy_admin_missing_workspace_membership'::text, a.user_id, '{}'::jsonb
  from public.app_admins a
  where not exists (select 1 from public.workspace_members wm where wm.user_id = a.user_id)

  union all
  select 'workspace_user_missing_legacy_presence'::text, wm.user_id, '{}'::jsonb
  from public.workspace_members wm
  where not exists (select 1 from public.app_user_roles u where u.user_id = wm.user_id)
    and not exists (select 1 from public.app_admins a where a.user_id = wm.user_id)

  union all
  select 'role_set_mismatch'::text, coalesce(l.user_id, w.user_id),
    jsonb_build_object('legacy_only_role', l.role_key, 'workspace_only_role', w.role_key)
  from public.app_user_roles l
  full outer join (
    select wm.user_id, wmr.role_key
    from public.workspace_member_roles wmr
    join public.workspace_members wm on wm.id = wmr.workspace_member_id
  ) w on l.user_id = w.user_id and l.role_key = w.role_key
  where l.role_key is null or w.role_key is null

  union all
  select 'primary_role_mismatch'::text, coalesce(l.user_id, w.user_id),
    jsonb_build_object('legacy_primary_role', l.role_key, 'workspace_primary_role', w.role_key)
  from (select user_id, role_key from public.app_user_roles where is_primary) l
  full outer join (
    select wm.user_id, wmr.role_key
    from public.workspace_member_roles wmr
    join public.workspace_members wm on wm.id = wmr.workspace_member_id
    where wmr.is_primary
  ) w on l.user_id = w.user_id
  where l.role_key is distinct from w.role_key

  union all
  select 'admin_status_mismatch'::text, coalesce(l.user_id, w.user_id),
    jsonb_build_object('is_legacy_admin', l.user_id is not null, 'is_workspace_admin', w.user_id is not null)
  from public.app_admins l
  full outer join (select user_id from public.workspace_members where is_workspace_admin) w
    on l.user_id = w.user_id
  where l.user_id is null or w.user_id is null

  union all
  select 'legacy_duplicate_primary_roles'::text, aur.user_id, jsonb_build_object('count', count(*))
  from public.app_user_roles aur
  where aur.is_primary
  group by aur.user_id
  having count(*) > 1

  union all
  select 'orphaned_workspace_member_role'::text, null::uuid, jsonb_build_object('workspace_member_roles_id', wmr.id)
  from public.workspace_member_roles wmr
  where not exists (select 1 from public.workspace_members wm where wm.id = wmr.workspace_member_id)

  union all
  select 'orphaned_workspace_membership'::text, wm.user_id, '{}'::jsonb
  from public.workspace_members wm
  where wm.is_workspace_admin = false
    and not exists (select 1 from public.workspace_member_roles wmr where wmr.workspace_member_id = wm.id);
end;
$$;

revoke all on function public.bridge_drift_report() from public;
revoke execute on function public.bridge_drift_report() from anon;
grant execute on function public.bridge_drift_report() to authenticated;

commit;

-- ============================================================
-- Deliberately NOT done by this migration, per E's explicit instruction:
--   - No existing RLS policy on app_user_roles/app_admins is touched.
--     Direct writes to those tables remain possible for anyone RLS
--     already allows -- closing that bypass is a separate, later
--     migration, only after these functions are confirmed live and
--     correct.
--   - has_role() and is_app_manager() have the same latent unqualified-
--     reference issue is_app_admin() had -- NOT hardened here, out of
--     scope for this specific round, not silently overlooked.
--   - 'billing' (or any new role_key) is not added to either role_key
--     check constraint here -- that's Stage 2 schema work.
--   - No capability tables, no down-payment/clearance fields, no
--     assigned-PM field -- all separate, later Stage 2 work.
-- ============================================================
