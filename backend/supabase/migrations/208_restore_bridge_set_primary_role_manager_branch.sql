-- Migration 208: URGENT -- restore bridge_set_primary_role()'s manager
-- authorization branch, silently dropped by migration 204.
--
-- Found by the consolidated isolation suite (2026-09-25, running
-- migration_133_manager_primary_role_and_admin_bootstrap_tests.sql against
-- the full 001-207 replay for the first time since 204 landed): the test
-- failed with "a real manager-role (non-admin) caller was rejected by
-- bridge_set_primary_role -- expected this to succeed after migration 133."
--
-- Root cause, confirmed directly from both migration files, not assumed:
-- migration 133 (backend/supabase/migrations/133_manager_primary_role_and_
-- admin_bootstrap.sql:66-71) changed this function's authorization check
-- from admin-only to `is_app_admin(auth.uid()) OR (caller holds the
-- 'manager' role)` -- migration 133's own header states this was a
-- deliberate widening, and explicitly NOT extended to
-- bridge_grant_admin()/bridge_set_secondary_roles()/bridge_revoke_admin(),
-- which stay admin-only by design (133:23-24). Migration 204
-- (backend/supabase/migrations/204_fix_bridge_functions_multi_workspace.sql)
-- redefined bridge_set_primary_role() to fix an unrelated, real,
-- confirmed production outage (active_workspace_id()'s "exactly one
-- workspace in the whole database" guard breaking the moment a second real
-- workspace existed) -- but 204's own redefinition used ONLY
-- `is_app_admin(auth.uid())`, silently reverting the manager branch 133 had
-- added. 204's header claims "byte-for-byte identical to migration 124"
-- for the parts it didn't intend to change -- that claim was accurate
-- against migration 124's OWN original text, but wrong against the
-- function's REAL, live, migration-133-amended state at the time 204 was
-- written. This means: since migration 204 was applied to production
-- (2026-09-24), any real manager (non-admin) who previously could set a
-- user's primary role via bridge_set_primary_role() has been silently
-- rejected -- a real, live regression, not merely a stale test assumption
-- (unlike the analogous migration-124-test correction made the same day
-- this migration was written, which really was just a stale test
-- expecting since-superseded behavior -- this one is different: 133's
-- manager branch was never superseded or intentionally removed by any
-- later, reviewed decision, it was lost by accident).
--
-- Fix: redefine bridge_set_primary_role() once more, restoring 133's exact
-- authorization condition verbatim, while keeping 204's real fix (resolving
-- the caller's own workspace via resolve_caller_workspace_id() instead of
-- the removed, database-wide active_workspace_id() guard) exactly as it
-- is. Every other line reproduced verbatim from 204's current, live body --
-- only the `if not (...) then raise exception` condition changes.
--
-- Neither migration 133 nor migration 204 is edited or rerun, per this
-- repo's standing discipline -- this is migration 208, a new, targeted
-- correction.
--
-- Confirm 208 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review -- URGENT, live regression,
-- same severity class as migrations 165/168/170/174/204 itself.

begin;

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
    raise exception 'Only an admin or a manager may change a user''s primary role.';
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

commit;
