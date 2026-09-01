-- Migration 112: delete/retire a channel. E: "No way to delete items or
-- even rooms, Delete or Retire should be the options for the chat rooms
-- that are created by people." Only applies to user-created ('group')
-- channels in the UI -- Section/Project/Client channels stay permanent
-- ("never dies") per the original roadmap design.
--
-- Same soft-delete shape as every other entity in this app (migration
-- 088's deletion_log, e.g. project_locations: deleted_at/deleted_by_email
-- + a paired restore that nulls them back out) rather than a real
-- destructive delete -- consistent with how nothing else in Ergon is
-- ever unrecoverably deleted from the UI.

alter table channels add column if not exists deleted_at timestamptz;
alter table channels add column if not exists deleted_by_email text;
