-- Wires up the 3 notification event types that had a working rule row +
-- CHECK-constraint entry since migration 024 but nothing in the app ever
-- called notify() with them: purchase_request_status_changed,
-- build_stage_changed, low_stock_reached. Per E's answers on 2026-08-08:
--   - purchase_request_status_changed -> the requester AND the Purchasing role
--   - build_stage_changed             -> the Warehouse role
--   - low_stock_reached               -> Purchasing, Warehouse, and Admins
--
-- purchase_requests already has a requested_by uuid column (migration 001),
-- but auth.users isn't exposed through the REST API, so -- same reasoning as
-- created_by_email on tasks (migration 036) -- we need a plain-text email
-- column the client can read/write directly.
alter table purchase_requests add column if not exists requested_by_email text;

-- Best-effort backfill for existing rows via the app_known_users directory
-- (migration 012), same approach as 036's created_by_email backfill.
update purchase_requests p
set requested_by_email = u.email
from app_known_users u
where u.user_id = p.requested_by
  and p.requested_by_email is null;

-- These three rules were seeded is_active = false in 024 because nothing
-- fired them yet -- now that the app actually calls notify() for all three,
-- turn them on by default. (Still editable per-user in Admin > Notification
-- Rules afterward.)
update notification_rules
set is_active = true
where event_type in ('purchase_request_status_changed', 'build_stage_changed', 'low_stock_reached');
