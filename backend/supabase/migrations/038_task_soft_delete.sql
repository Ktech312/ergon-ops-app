-- Deleting a task from the UI previously ran a real DELETE, which (via the
-- cascade on task_activity_log.task_id, migration 036) silently wiped that
-- task's entire audit trail along with it -- the opposite of what an audit
-- trail is for, and no record of who deleted it or when. E asked directly:
-- if tasks can be deleted, that needs to be tracked in case someone deletes
-- something they shouldn't.
--
-- Delete is now a soft delete: the row and its full activity history stay in
-- place, stamped with who deleted it and when, and just drop out of the
-- normal task lists (see persistence.ts loadTasks). It stays visible and
-- restorable from the Deleted Tasks panel on the Tasks board.

alter table tasks add column if not exists deleted_by_email text;
alter table tasks add column if not exists deleted_at timestamptz;

create index if not exists idx_tasks_deleted_at on tasks(deleted_at);
