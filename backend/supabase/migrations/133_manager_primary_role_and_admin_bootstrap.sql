-- Fixes two related, real production problems found together while
-- investigating a report that an approved sign-in's assigned role "did
-- not carry over":
--
-- 1. bridge_set_primary_role() (migration 124) hard-requires the CALLER
--    to be is_app_admin() -- but the Pending Approvals panel's own label
--    reads "New sign-ins wait here until a Manager or Admin lets them
--    in," and its single "Approve" button bundles two actions together:
--    approving the sign-in (a PATCH to app_user_status, no admin check)
--    and assigning the picked primary role (this RPC). A Manager-role
--    approver's click silently succeeds at the first and throws on the
--    second -- the frontend fires both calls unawaited and unsequenced,
--    so the approval still goes through and the row disappears from the
--    queue, leaving the new user approved with zero roles and no visible
--    error the approver would reliably notice. Fixed below by allowing a
--    caller who holds the legacy 'manager' role to call this one RPC,
--    matching the panel's own stated design. The frontend race itself
--    (calling both without sequencing or surfacing a combined failure)
--    is a separate, non-database fix tracked in HANDOFF.md/
--    PRODUCT_MASTER_COMPLETION_PLAN.md -- not something a migration can
--    fix on its own.
--
--    Deliberately NOT extended to bridge_set_secondary_roles(),
--    bridge_grant_admin(), or bridge_revoke_admin() -- nothing in the
--    reported bug or the panel's own copy asks for Manager-level access
--    to those, and granting/revoking admin access itself is a
--    meaningfully more sensitive action than assigning one already-
--    scoped role to a brand-new user during approval. Widening this
--    further is a separate decision, not a natural extension of this
--    one.
--
--    has_role() (migration 023) is deliberately NOT called here even
--    though it already expresses "does this user hold role X" --
--    migration 124's own header notes has_role() was left unhardened
--    (no search_path pin, unqualified table reference) as an explicit,
--    separate decision. Calling an unhardened sibling from inside this
--    hardened function (search_path = '') would reintroduce exactly the
--    nested-helper search-path risk migration 124 was written to close
--    elsewhere in this same file. The equivalent check is inlined below
--    instead, fully qualified, matching this function's own existing
--    style.
--
-- 2. app_admins currently has no row for the account this app's owner
--    actually signed in with (ehren@ensight-technologies.com) -- a
--    one-time production bootstrap gap, not a bug in any function.
--    bridge_grant_admin() itself requires an existing admin to call it
--    (by design, see migration 124 section 6), so if this is genuinely
--    the first admin, no one could grant it through the app itself --
--    this is exactly the kind of one-time gap a direct, reviewed insert
--    is for, not a workaround around that function's own protection.
--    Mirrors bridge_grant_admin()'s own two writes (app_admins,
--    workspace_members.is_workspace_admin) for consistency; both are
--    idempotent (on conflict do nothing / do update) so re-running this
--    migration is harmless if it's ever re-applied.

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
  if not (
    public.is_app_admin(auth.uid())
    or exists (
      select 1 from public.app_user_roles
      where user_id = auth.uid() and role_key = 'manager'
    )
  ) then
    raise exception 'Only an admin or manager may change a user''s primary role.';
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

-- One-time admin bootstrap for the account this app's owner actually
-- signs in with. Safe to re-run: both inserts are idempotent.
do $$
declare
  target_id uuid;
  ws_id uuid;
begin
  select id into target_id from auth.users where email = 'ehren@ensight-technologies.com';

  if target_id is null then
    raise exception 'No auth.users row found for ehren@ensight-technologies.com -- check the email is exactly right before re-running.';
  end if;

  insert into public.app_admins (user_id) values (target_id)
  on conflict (user_id) do nothing;

  ws_id := public.active_workspace_id();

  insert into public.workspace_members (workspace_id, user_id, is_workspace_admin)
  values (ws_id, target_id, true)
  on conflict (workspace_id, user_id) do update set is_workspace_admin = true;
end $$;
