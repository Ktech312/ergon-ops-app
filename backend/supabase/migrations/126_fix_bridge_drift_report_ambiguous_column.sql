-- Live-discovered follow-up to migration 124. bridge_drift_report()
-- declares `returns table (check_name text, user_id uuid, detail jsonb)`
-- -- in plpgsql, those output column names become implicit variables in
-- scope for the entire function body (the same bug class that hit
-- respond_to_quote_proposal() during migration 119's live debugging,
-- Postgres error 42702). Every branch of the function's UNION ALL
-- qualifies its references correctly except two, which reference a
-- table with no alias inside a derived subquery before that subquery is
-- itself aliased:
--
--   from (select user_id, role_key from public.app_user_roles where is_primary) l
--   ...
--   full outer join (select user_id from public.workspace_members where is_workspace_admin) w
--
-- In both cases the bare `user_id` is ambiguous between the table column
-- and the function's own `user_id` OUT-parameter. This fails
-- unconditionally on every call, not just under specific data -- the
-- function has never successfully executed since migration 124 was
-- applied. Confirmed live: "ERROR: 42702: column reference "user_id" is
-- ambiguous" when called from migration_124_bridge_tests.sql's Section 7.
--
-- Fix: alias the source table directly inside both subqueries (`aur`,
-- `wm`), matching the pattern every other branch already uses. No
-- signature or return-shape change -- create or replace is sufficient,
-- no DROP needed. No other function in migration 124 has this exposure:
-- bridge_drift_report() is the only one with a RETURNS TABLE shape among
-- them (the rest return void or a scalar), so this bug class doesn't
-- recur elsewhere in that migration.

begin;

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
  from (select aur.user_id, aur.role_key from public.app_user_roles aur where aur.is_primary) l
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
  full outer join (select wm.user_id from public.workspace_members wm where wm.is_workspace_admin) w
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
