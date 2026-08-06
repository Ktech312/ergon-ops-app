-- Lets a task be assigned to an entire role/group instead of one person --
-- "if it's engineering, all the engineers should receive the request." A
-- task now has either an individual assignee (assignee_user_id/email, from
-- migration 018) or a role-wide assignment (assigned_role_key), never both;
-- the app enforces that mutual exclusivity client-side.

alter table tasks add column if not exists assigned_role_key text;

create index if not exists idx_tasks_assigned_role_key on tasks(assigned_role_key);

-- Lets the app look up who to notify when a task is assigned to a role,
-- without opening up read access to everyone's role rows (app_user_roles'
-- RLS otherwise only lets a user read their own row -- see migration 010).
-- Joins to app_known_users (populated on every sign-in) for an email to
-- notify, since notifications are keyed by email, not user_id.
create or replace function get_users_by_role(target_role text)
returns table (user_id uuid, email text)
language sql
security definer
stable
as $$
  select distinct r.user_id, k.email
  from app_user_roles r
  left join app_known_users k on k.user_id = r.user_id
  where r.role_key = target_role
    and k.email is not null;
$$;

grant execute on function get_users_by_role(text) to authenticated;
