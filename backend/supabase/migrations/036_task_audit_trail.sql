-- Task audit trail: who created a task and when, an explicit Close/Reopen
-- action tracked by who and when, and a running activity log of every save
-- (what changed, by whom, and when) -- all requested directly by E after
-- seeing the Edit Task modal had no record of any of this.
--
-- created_by (uuid, migration 015) already exists but auth.users is not
-- exposed through the REST API, so the app can never turn that id into a
-- human-readable email on its own. created_by_email is captured client-side
-- at creation time (the same pattern sales_quotes.created_by_email already
-- uses), and backfilled here, best-effort, for existing rows via the
-- app_known_users directory (migration 012) -- this can only be done from a
-- migration since it's a service-role query across two tables, not a REST
-- call the client could make.
--
-- closed_by_email/closed_at are deliberately separate from the existing
-- status/completed_at pair: "Close" is an explicit, auditable action (button
-- in the UI), not just a side effect of picking "Done" from the status
-- dropdown. Reopening clears both, and the task can be closed again later.

alter table tasks add column if not exists created_by_email text;
alter table tasks add column if not exists closed_by_email text;
alter table tasks add column if not exists closed_at timestamptz;

update tasks t
set created_by_email = u.email
from app_known_users u
where u.user_id = t.created_by
  and t.created_by_email is null;

create table if not exists task_activity_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  actor_email text,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_activity_log_task on task_activity_log(task_id, created_at);

alter table task_activity_log enable row level security;

-- Read/insert only -- no update/delete policy, so entries are effectively
-- append-only from the client (matches an audit log's whole purpose).
create policy "authenticated read task_activity_log"
  on task_activity_log for select to authenticated using (true);

create policy "authenticated insert task_activity_log"
  on task_activity_log for insert to authenticated with check (true);
