-- Migration 099: Slack user ID per roster member, groundwork for per-person
-- Slack DM notifications (E: "put this on the list to work on the backend
-- part overnight, I want to be as close as possible without linking the
-- account yet").
--
-- team_members already holds full_name/role_title (migration for Display
-- name editing, 2026-08-30) and is already readable by any signed-in user
-- via the normal session token -- reusing it here keeps the same pattern
-- instead of adding a new table+RLS policy just for one more per-person
-- text field. The actual Slack Bot Token/webhook still needs a real Slack
-- App from E before anything sends -- this column only lets an admin
-- record each person's Slack member ID ahead of time so the moment the
-- bot token is added, delivery works with zero further code changes.

alter table team_members add column if not exists slack_user_id text;
