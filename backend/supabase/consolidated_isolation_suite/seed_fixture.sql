-- One minimal, realistic starting fixture: a single auth.users row for the
-- one real account this app has ever actually bootstrapped admin access
-- for (ehren@ensight-technologies.com -- see migration 133's own "one-time
-- admin bootstrap" block, which requires this exact row to already exist
-- by email before it runs).
--
-- Deliberately NOT a synthetic workspace/workspace_members/app_admins
-- fixture built by hand: every later piece of state every canonical test
-- file's discovery query needs --
--   select am.user_id, wm.workspace_id, wm.is_workspace_admin
--   from app_admins am
--   join workspace_members wm on wm.user_id = am.user_id
--   join workspaces w on w.id = wm.workspace_id
--   where w.status = 'active'
--   limit 1;
-- -- is produced by the REAL migrations themselves once this one row
-- exists: migration 115 creates the one workspace and backfills
-- workspace_members/app_admins-driven admin status, migration 116 renames
-- it to slug 'ergon-test', and migration 133 inserts this account into
-- app_admins and grants it is_workspace_admin. Seeding anything more here
-- would substitute a hand-built shortcut for the real migration path this
-- suite exists to exercise.
--
-- Apply this AFTER platform_stub.sql and BEFORE backend/supabase/migrations/001,
-- so every migration file that touches auth.users, app_admins, or
-- workspace_members sees exactly the real production bootstrap shape.

insert into auth.users (id, email)
values (gen_random_uuid(), 'ehren@ensight-technologies.com');
