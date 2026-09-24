-- Migration 204: fix the legacy-authorization bridge functions for a real multi-workspace
-- world. Found live in production, 2026-09-24, immediately after fixing the recurring 42P10
-- errors also improved this exact error's visibility: an admin trying to set a user's primary
-- role got "Could not set primary role: Bridge functions require exactly one workspace row to
-- exist in total, found 2." -- `active_workspace_id()` (migration 124) is a deliberate,
-- documented, fail-closed guard written back when exactly one workspace existed in the whole
-- database by architectural necessity. `PRODUCT_MASTER_COMPLETION_PLAN.md` §11 (Group 1's own
-- cross-cutting finding) explicitly flagged this: "Stage 6 (final reconciliation) must confirm
-- every remaining active_workspace_id() call site has been retired before stage 7 (onboarding)
-- begins -- a second real workspace cannot safely be created while any RPC still depends on
-- 'exactly one workspace in the whole database.'" Stage 7 shipped anyway (2026-09-22/23) and
-- real additional workspaces now exist (ZZ Test Signup Co, ZZ Test 199 Notification Co v2) --
-- this is the confirmed, live consequence: every one of the five bridge_* functions in
-- migration 124 that calls active_workspace_id() has been broken for every admin, for every
-- role-management action, since the moment a second real workspace was approved.
--
-- This is NOT the full "migrate away from app_admins/app_user_roles entirely" rework
-- PRODUCT_MASTER_COMPLETION_PLAN.md §11 tracks as its own larger, unscheduled stage-6-adjacent
-- item -- that's still real, separate, future work. This migration is narrower and much lower
-- risk: each function's actual use of the resolved workspace id is re-examined on its own
-- merits and replaced with the correct, already-established Phase 3 idiom for that specific
-- need, with NO change to which legacy tables are written or how. `active_workspace_id()`
-- itself is untouched -- it's still correct and still needed by its other, unrelated call
-- sites (replace_project_bom_lines and others tracked in the §11 finding above); only these
-- five functions stop calling it.
--
-- Per-function fix, each justified by what the resolved workspace id is actually used for:
--   - bridge_set_primary_role() / bridge_grant_admin(): both may need to CREATE a
--     workspace_members row for a target user who doesn't have one yet -- this genuinely needs
--     to resolve "which workspace." Both are gated on is_app_admin() (a GLOBAL flag) but are
--     invoked from the ordinary per-company Admin page's Team Roster (not the separate
--     Ergon Platform console, which uses is_platform_admin() for actual cross-company
--     management) -- so the correct workspace is the CALLER's own, via
--     resolve_caller_workspace_id() (migration 117), the same resolver used everywhere else in
--     this schema for exactly this "no second anchor" situation (e.g. migration 203's
--     create_group_conversation() just used the same pattern for the same reason).
--   - bridge_set_secondary_roles() / bridge_revoke_admin(): both only need to LOOK UP a target
--     user's EXISTING workspace_members row, never create one -- neither actually needs to
--     resolve or assume anything about "the" workspace at all. Both already filtered by
--     `user_id = target_user_id` with no workspace_id predicate (bridge_set_secondary_roles
--     always did; bridge_revoke_admin's final UPDATE is changed here to match) -- correct
--     today because a user belongs to at most one workspace in this app's whole architecture
--     (the same judgment call migration 187's header already made explicitly), and safer than
--     forcing "the caller's workspace" onto a target who might genuinely belong to a different
--     one than the calling admin manages. The active_workspace_id() call in both was PURELY a
--     blocking gate with no functional use of its return value -- removed outright.
--   - bridge_set_user_allowed_views(): writes only to the legacy app_user_roles table, no
--     workspace concept involved at all -- its active_workspace_id() call was also purely a
--     blocking gate with zero functional purpose. Removed outright.

begin;

-- ============================================================
-- bridge_set_primary_role(): ws_id now resolves the CALLER's own workspace, not "the sole
-- workspace in the database." Everything else byte-for-byte identical to migration 124.
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

  ws_id := public.resolve_caller_workspace_id();

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
-- bridge_set_secondary_roles(): the active_workspace_id() gate is simply removed -- its
-- return value was never used, and the existing member_id lookup (user_id only, no workspace
-- predicate) is unaffected and already correct. Everything else unchanged from migration 124.
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

  select role_key into legacy_primary_role
  from public.app_user_roles
  where user_id = target_user_id and is_primary = true;

  if legacy_primary_role is null then
    raise exception 'Cannot set secondary roles: % has no primary role assigned yet.', target_user_id;
  end if;

  select wm.id into member_id
  from public.workspace_members wm
  where wm.user_id = target_user_id
  order by wm.workspace_id
  limit 1;

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
-- bridge_set_user_allowed_views(): the active_workspace_id() gate is simply removed -- this
-- function never touched a workspace table and never used the return value. Everything else
-- unchanged from migration 124.
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
-- bridge_grant_admin(): ws_id now resolves the CALLER's own workspace, same reasoning as
-- bridge_set_primary_role() above. Everything else unchanged from migration 124.
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

  ws_id := public.resolve_caller_workspace_id();

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

-- ============================================================
-- bridge_revoke_admin(): no longer resolves or requires any single workspace at all -- the
-- final UPDATE now matches on user_id alone (same reasoning as bridge_set_secondary_roles
-- above: this only needs to find the target's EXISTING membership, never create one, and
-- forcing it through "the caller's workspace" would be actively wrong if the target belongs
-- to a different one than the calling admin manages). Every other check (last-admin
-- protection, the advisory lock, the double authorization recheck) is completely unchanged
-- from migration 124 -- none of that logic depended on ws_id.
-- ============================================================

create or replace function public.bridge_revoke_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_count integer;
begin
  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may revoke admin access.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bridge_admin_revoke_lock'));

  if not public.is_app_admin(auth.uid()) then
    raise exception 'Only an admin may revoke admin access (caller''s admin status was revoked while this request was waiting).';
  end if;

  if not exists (select 1 from public.app_admins where user_id = target_user_id) then
    raise exception '% is not currently a global administrator -- nothing to revoke. Their workspace-admin status, if any, is left untouched: it may have been granted independently of this legacy path, and this function must never silently strip it.', target_user_id;
  end if;

  select count(*) into admin_count from public.app_admins;

  if admin_count <= 1 then
    raise exception 'Cannot revoke %: they are the last remaining global administrator. Removing the final legacy admin requires a separately reviewed Phase 3 migration, not this transitional bridge.', target_user_id;
  end if;

  delete from public.app_admins where user_id = target_user_id;

  update public.workspace_members
  set is_workspace_admin = false
  where user_id = target_user_id;
end;
$$;

revoke all on function public.bridge_revoke_admin(uuid) from public;
revoke execute on function public.bridge_revoke_admin(uuid) from anon;
grant execute on function public.bridge_revoke_admin(uuid) to authenticated;

commit;
