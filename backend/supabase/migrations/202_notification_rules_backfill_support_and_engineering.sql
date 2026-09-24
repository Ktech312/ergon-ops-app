-- ============================================================
-- Migration 202: backfill the notification_rules default rows that
-- migrations 200 (support_case_assigned) and 201 (product_request_reviewed)
-- should have inserted alongside their CHECK-constraint widening.
--
-- Root cause: ruleActive() in the frontend (src/main.tsx) looks up
-- notification_rules by event_type and returns false when no row exists
-- at all -- widening the CHECK constraint only makes the value legal, it
-- does not make the event fire. Both events were live-tested in
-- production and confirmed silently not firing because of this gap.
--
-- migrations 200/201 modeled their "insert a default row" comment on
-- migration 149's pre-Phase-3 pattern (`on conflict (event_type)`), but
-- migration 173 (2026-09-18, E's explicit per-workspace decision) changed
-- notification_rules to workspace-scoped: dropped the global
-- notification_rules_event_type_key unique constraint and replaced it
-- with notification_rules_workspace_id_event_type_key, unique on
-- (workspace_id, event_type). A global `on conflict (event_type)` insert
-- no longer matches any constraint (confirmed: 42P10 on first attempt of
-- this migration) -- this rewrite inserts one row per existing workspace
-- instead, the correct post-173 shape every other config-table backfill
-- in this schema already follows.
--
-- Second confirmed failure on the first attempt at that fix: migration
-- 173's own notification_rules_guard_workspace_id trigger (reusing
-- guard_workspace_id_mutation(), migration 117) unconditionally
-- overwrites new.workspace_id with resolve_caller_workspace_id() on every
-- INSERT -- it exists to stop an authenticated end user spoofing another
-- workspace's id on their own writes, not to gate admin/migration-time
-- seeding. The SQL editor's session has no auth.uid() workspace
-- membership of its own, so resolve_caller_workspace_id() raised "no
-- workspace membership found for current user". Fix: disable that one
-- trigger for the duration of this seed insert, then re-enable it --
-- the guard is back in force for every real user-facing write the moment
-- this migration commits.
-- ============================================================

alter table public.notification_rules disable trigger notification_rules_guard_workspace_id;

insert into public.notification_rules (workspace_id, event_type, channels, is_active)
select id, 'support_case_assigned', '{in_app}', true from public.workspaces
on conflict (workspace_id, event_type) do nothing;

insert into public.notification_rules (workspace_id, event_type, channels, is_active)
select id, 'product_request_reviewed', '{in_app}', true from public.workspaces
on conflict (workspace_id, event_type) do nothing;

alter table public.notification_rules enable trigger notification_rules_guard_workspace_id;

commit;
