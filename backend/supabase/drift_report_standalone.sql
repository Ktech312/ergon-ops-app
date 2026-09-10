-- Standalone, read-only drift report (revision 2 -- expanded per E's
-- review) -- comparing the legacy authorization tables (app_user_roles,
-- app_admins) against the newer workspace tables (workspace_members,
-- workspace_member_roles). Zero writes. Safe to run anytime, including
-- in production, before migration 124 exists.
--
-- Changes from the first draft: shows total workspace count and every
-- workspace's own status (not just a bare active count), joins
-- app_known_users for a recognizable email beside every user_id where
-- one exists, and includes the explicit workspace_id on every
-- workspace-side row so a discrepancy against a specific workspace is
-- never ambiguous.
--
-- Run each block separately (or all together -- every statement is a
-- plain SELECT) and share the actual row output back for review. Nothing
-- here resolves a discrepancy automatically -- per E's explicit
-- instruction, that only happens after human review.

-- 0. Every workspace row that exists, with its own status -- not just an
-- active count. If this returns anything other than exactly one row with
-- status = 'active', stop and resolve that first -- everything below
-- assumes a single active workspace.
select id as workspace_id, name, slug, status, created_at
from workspaces
order by created_at;

-- 1a. Users with a legacy role who have no workspace_members row at all.
select u.user_id, k.email, u.role_key, u.is_primary
from app_user_roles u
left join app_known_users k on k.user_id = u.user_id
where not exists (
  select 1 from workspace_members wm where wm.user_id = u.user_id
)
order by u.user_id;

-- 1b. Users with legacy global-admin status who have no workspace_members
-- row at all.
select a.user_id, k.email
from app_admins a
left join app_known_users k on k.user_id = a.user_id
where not exists (
  select 1 from workspace_members wm where wm.user_id = a.user_id
)
order by a.user_id;

-- 2. Users present in workspace_members with no legacy presence at all
-- (neither a role nor admin status in the old tables).
select wm.id as workspace_member_id, wm.workspace_id, wm.user_id, k.email
from workspace_members wm
left join app_known_users k on k.user_id = wm.user_id
where not exists (select 1 from app_user_roles u where u.user_id = wm.user_id)
  and not exists (select 1 from app_admins a where a.user_id = wm.user_id)
order by wm.user_id;

-- 3. Role-set differences: a (user, role_key) pair that exists on one
-- side but not the other.
select
  coalesce(l.user_id, w.user_id) as user_id,
  k.email,
  w.workspace_id,
  l.role_key as legacy_only_role_key,
  w.role_key as workspace_only_role_key
from app_user_roles l
full outer join (
  select wm.user_id, wm.workspace_id, wmr.role_key
  from workspace_member_roles wmr
  join workspace_members wm on wm.id = wmr.workspace_member_id
) w on l.user_id = w.user_id and l.role_key = w.role_key
left join app_known_users k on k.user_id = coalesce(l.user_id, w.user_id)
where l.role_key is null or w.role_key is null
order by user_id;

-- 4. Primary-role differences: same user, different primary role_key (or
-- primary on only one side).
select
  coalesce(l.user_id, w.user_id) as user_id,
  k.email,
  w.workspace_id,
  l.role_key as legacy_primary_role,
  w.role_key as workspace_primary_role
from (select user_id, role_key from app_user_roles where is_primary) l
full outer join (
  select wm.user_id, wm.workspace_id, wmr.role_key
  from workspace_member_roles wmr
  join workspace_members wm on wm.id = wmr.workspace_member_id
  where wmr.is_primary
) w on l.user_id = w.user_id
left join app_known_users k on k.user_id = coalesce(l.user_id, w.user_id)
where l.role_key is distinct from w.role_key
order by user_id;

-- 5. Legacy global-admin vs. workspace-admin differences.
select
  coalesce(l.user_id, w.user_id) as user_id,
  k.email,
  w.workspace_id,
  (l.user_id is not null) as is_legacy_admin,
  (w.user_id is not null) as is_workspace_admin
from app_admins l
full outer join (select user_id, workspace_id from workspace_members where is_workspace_admin) w
  on l.user_id = w.user_id
left join app_known_users k on k.user_id = coalesce(l.user_id, w.user_id)
where l.user_id is null or w.user_id is null
order by user_id;

-- 6a. Duplicate is_primary=true rows per user in app_user_roles -- this
-- table's "only one primary" rule is enforced ONLY at the app layer
-- (migration 040's own comment admits this), so a real duplicate here is
-- possible and worth knowing about regardless of the bridge.
select u.user_id, k.email, count(*) as primary_role_count
from app_user_roles u
left join app_known_users k on k.user_id = u.user_id
where u.is_primary
group by u.user_id, k.email
having count(*) > 1;

-- 6b. Duplicate (user_id, role_key) pairs in app_user_roles -- should be
-- impossible given the unique index; sanity check only.
select u.user_id, k.email, u.role_key, count(*)
from app_user_roles u
left join app_known_users k on k.user_id = u.user_id
group by u.user_id, k.email, u.role_key
having count(*) > 1;

-- 6c. workspace_member_roles rows whose workspace_member_id doesn't
-- resolve -- should be impossible given the FK; sanity check only.
select wmr.id, wmr.workspace_member_id
from workspace_member_roles wmr
where not exists (select 1 from workspace_members wm where wm.id = wmr.workspace_member_id);

-- 6d. workspace_members rows with zero role rows and not a workspace
-- admin -- an orphaned membership (a member with nothing granted).
select wm.id as workspace_member_id, wm.workspace_id, wm.user_id, k.email
from workspace_members wm
left join app_known_users k on k.user_id = wm.user_id
where wm.is_workspace_admin = false
  and not exists (select 1 from workspace_member_roles wmr where wmr.workspace_member_id = wm.id);
