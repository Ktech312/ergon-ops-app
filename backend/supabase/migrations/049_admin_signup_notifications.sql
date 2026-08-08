-- Lets the app notify every admin when a brand-new user signs up and lands
-- in the pending-approval queue -- previously nothing surfaced this except
-- an admin happening to check Admin -> Pending Approvals. Mirrors
-- get_users_by_role (migration 042) but joins app_admins to
-- app_known_users instead of app_user_roles, since "admin" isn't a
-- role_key -- it's tracked in its own table.
create or replace function get_admin_emails()
returns table (user_id uuid, email text)
language sql
security definer
stable
as $$
  select distinct a.user_id, k.email
  from app_admins a
  left join app_known_users k on k.user_id = a.user_id
  where k.email is not null;
$$;

grant execute on function get_admin_emails() to authenticated;

-- New notification event for the pending-approval queue, reusing migration
-- 024's engine (same pattern as 046's catalog_price_change_* events): widen
-- the check constraint, then seed a default-active in-app rule -- without
-- both of these, notify() silently no-ops for an event type it doesn't
-- recognize, so the alert would never actually appear.
alter table notification_rules drop constraint if exists notification_rules_event_type_check;
alter table notification_rules add constraint notification_rules_event_type_check
  check (event_type in (
    'task_assigned', 'task_overdue', 'task_status_changed',
    'purchase_request_status_changed', 'build_stage_changed',
    'submittal_responded', 'low_stock_reached',
    'catalog_price_change_requested', 'catalog_price_change_reviewed',
    'user_signup_pending'
  ));

insert into notification_rules (event_type, channels, is_active)
values
  ('user_signup_pending', '{in_app}', true)
on conflict (event_type) do nothing;
