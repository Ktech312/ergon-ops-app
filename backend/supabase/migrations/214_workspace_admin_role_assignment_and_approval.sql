-- Migration 214: Phase 2A/2B of the second-company completion queue --
-- a company's founding admin must be able to assign roles to (and
-- approve) their own team, without becoming a legacy global app_admin.
-- Migration 213's own header explicitly deferred this ("app_user_roles
-- ... needs a workspace resolution path via the TARGET row's own
-- user_id, not the same one-line mechanical pattern used below"). This
-- migration builds that path using the EXISTING workspace-authorization
-- bridge (migration 124/133/204/208), not a new parallel system.
--
begin;

-- ============================================================
-- New shared helper: is_workspace_admin_of_user(check_user_id)
-- ============================================================
-- "Is the CALLER an active admin of whatever workspace check_user_id
-- currently belongs to?" Reused by bridge_set_secondary_roles(),
-- bridge_set_user_allowed_views(), and app_user_status's own RLS below
-- -- all three need exactly this question answered, and all three
-- operate on a TARGET who must already have a workspace_members row
-- (unlike bridge_set_primary_role(), which can CREATE one -- that
-- function keeps its own distinct logic, see below, since
-- "does this brand-new target already have a workspace" is a different
-- question than "is the caller that workspace's admin").
--
-- Correctly returns false (not an error) when check_user_id has no
-- workspace_members row at all, or when the caller is not an active
-- admin of that specific workspace -- both real, expected cases, not
-- exceptional ones.

create or replace function public.is_workspace_admin_of_user(check_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.user_id = check_user_id
      and public.is_active_workspace_member(wm.workspace_id)
      and public.is_workspace_admin(wm.workspace_id)
  );
$$;

revoke all on function public.is_workspace_admin_of_user(uuid) from public;
revoke execute on function public.is_workspace_admin_of_user(uuid) from anon;
grant execute on function public.is_workspace_admin_of_user(uuid) to authenticated;

-- ============================================================
-- bridge_set_primary_role(): widened to also allow a workspace admin
-- acting within their OWN workspace. Distinct logic from the shared
-- helper above -- this function can CREATE a target's first
-- workspace_members row, so "does the target already have a
-- workspace admin'd by the caller" doesn't apply yet at call time.
-- Instead: resolve the CALLER's own workspace first (as before), widen
-- the auth check to include is_workspace_admin(ws_id), and add an
-- explicit guard this function never had before -- reject outright if
-- the target already belongs to a DIFFERENT workspace than the
-- caller's. This closes a real, pre-existing gap for EVERY caller type
-- (not just the new workspace-admin branch): before this migration, a
-- global admin or legacy manager could silently pull an arbitrary
-- target_user_id into their own workspace even if that target already
-- belonged to another company -- harmless in practice only because the
-- frontend always sourced target_user_id from the caller's own Team
-- Roster listing, never enforced by the function itself. Widening this
-- to many per-company admins (one per future self-serve company,
-- instead of a handful of trusted Ergon staff) makes that latent gap a
-- real cross-tenant risk worth closing now, not later.
--
-- resolve_caller_workspace_id() itself already requires the CALLER's
-- own workspace to be active (raises "not active (suspended)"
-- otherwise) -- so a suspended workspace's own admin already cannot
-- reach this function at all, no separate is_active_workspace_member()
-- check needed for the new branch here.

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
  ws_id := public.resolve_caller_workspace_id();

  if not (
    public.is_app_admin(auth.uid())
    or exists (
      select 1 from public.app_user_roles
      where user_id = auth.uid() and role_key = 'manager'
    )
    or public.is_workspace_admin(ws_id)
  ) then
    raise exception 'Only an admin, a manager, or this workspace''s own admin may change a user''s primary role.';
  end if;

  if exists (
    select 1 from public.workspace_members
    where user_id = target_user_id and workspace_id <> ws_id
  ) then
    raise exception 'This account already belongs to a different workspace -- cannot assign a role here.';
  end if;

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

-- ============================================================
-- bridge_set_secondary_roles(): widened using the shared helper.
-- Resolves the target's own membership FIRST (a plain SELECT, no side
-- effects, safe to do before the authorization check) so the widened
-- condition has something to check against; every other line
-- unchanged from migration 204.
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
  select wm.id into member_id
  from public.workspace_members wm
  where wm.user_id = target_user_id
  order by wm.workspace_id
  limit 1;

  if not (
    public.is_app_admin(auth.uid())
    or public.is_workspace_admin_of_user(target_user_id)
  ) then
    raise exception 'Only an admin or this workspace''s own admin may change a user''s secondary roles.';
  end if;

  select role_key into legacy_primary_role
  from public.app_user_roles
  where user_id = target_user_id and is_primary = true;

  if legacy_primary_role is null then
    raise exception 'Cannot set secondary roles: % has no primary role assigned yet.', target_user_id;
  end if;

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

-- ============================================================
-- bridge_set_user_allowed_views(): same shared-helper widening.
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
  if not (
    public.is_app_admin(auth.uid())
    or public.is_workspace_admin_of_user(target_user_id)
  ) then
    raise exception 'Only an admin or this workspace''s own admin may change a user''s tab permissions.';
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

-- ============================================================
-- app_user_roles read side: the write RPCs above are useless if Team
-- Roster (loadAllUserRoles, persistence.ts) can't actually SEE any
-- rows to render in the first place -- "admins read all roles" was
-- still is_app_admin-only, so a workspace-only admin's roster page
-- would render empty despite the writes now working. Widened with the
-- same helper: a workspace admin sees exactly the app_user_roles rows
-- for users who belong to their OWN workspace, nothing more.
-- ============================================================

drop policy if exists "admins read all roles" on public.app_user_roles;
create policy "admins read all roles" on public.app_user_roles for select to authenticated
  using (
    is_app_admin(auth.uid())
    or is_workspace_admin_of_user(user_id)
  );

-- ============================================================
-- Phase 2B: app_user_status -- a workspace admin can see and review
-- (approve/reject) a pending employee who ALREADY has a
-- workspace_members row in their own workspace (e.g. added via
-- bridge_set_primary_role above, or an existing member whose approval
-- status needs correcting).
--
-- Deliberately NOT extended to a target with no workspace_members row
-- at all: this app's only mechanism to WRITE a pending
-- app_user_status row (ensureOwnApprovalRequest) has never carried any
-- workspace affiliation -- there is no way to know which company a
-- genuinely cold, uninvited self-signup is meant to join. That
-- broader gap is real but underspecified (a product decision, not an
-- RLS mechanics question) -- migration 212's invite path is the
-- correct, already-fixed route for adding a NAMED teammate to a
-- specific company; this migration only closes the review-access gap
-- for someone who already has a real membership row.
-- ============================================================

drop policy if exists "users read their own status" on public.app_user_status;
create policy "users read their own status" on public.app_user_status for select to authenticated
  using (
    auth.uid() = user_id
    or is_app_admin(auth.uid())
    or is_app_manager(auth.uid())
    or is_workspace_admin_of_user(user_id)
  );

drop policy if exists "admins and managers review status" on public.app_user_status;
create policy "admins and managers review status" on public.app_user_status for update to authenticated
  using (
    is_app_admin(auth.uid())
    or is_app_manager(auth.uid())
    or is_workspace_admin_of_user(user_id)
  )
  with check (
    is_app_admin(auth.uid())
    or is_app_manager(auth.uid())
    or is_workspace_admin_of_user(user_id)
  );

commit;

-- Confirm 214 is still the next free migration number in
-- backend/supabase/migrations/ before applying. Not applied. Kept
-- local for E's review.
