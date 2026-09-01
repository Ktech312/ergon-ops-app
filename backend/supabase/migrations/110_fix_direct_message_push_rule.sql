-- Migration 110: direct_message_received push notifications have
-- likely never actually fired. Found live while diagnosing migration
-- 108's own constraint failure -- migration 095 intended to seed this
-- event (push-only, not in_app: "an in-app bell entry for every DM
-- would just duplicate the dedicated unread badge Messages already
-- has"), but that migration's own constraint rewrite dropped several
-- other event types that had been added since 024 (046, 049, 054) --
-- if 095 ever actually ran as written, it would have hit the exact same
-- "check constraint is violated by some row" error migration 108 just
-- hit, and 'direct_message_received' would never have made it into
-- either the constraint or the table. Confirmed by querying the live
-- table directly: no row for this event_type exists.
--
-- notify("direct_message_received", ...) is already called from the
-- app (main.tsx, DM send handler) -- this migration is the only piece
-- that was missing.

alter table notification_rules drop constraint if exists notification_rules_event_type_check;
alter table notification_rules add constraint notification_rules_event_type_check check (event_type in (
  'task_assigned', 'task_overdue', 'task_status_changed',
  'purchase_request_status_changed', 'build_stage_changed',
  'submittal_responded', 'low_stock_reached',
  'catalog_price_change_requested', 'catalog_price_change_reviewed',
  'user_signup_pending', 'quote_proposal_responded',
  'mentioned', 'direct_message_received'
));

insert into notification_rules (event_type, channels, is_active)
values ('direct_message_received', '{push}', true)
on conflict (event_type) do nothing;
