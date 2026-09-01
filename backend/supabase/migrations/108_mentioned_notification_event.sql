-- Migration 108: @mentions -- E: "I need to be able alert people, so tag
-- them @Sales or @Ehren so it would send me an Alert." New "mentioned"
-- notification event, routed through the exact same notify()/
-- notification_rules engine every other event already uses (migration
-- 024) -- @Sales resolves to the existing "sales" role group
-- (ROLE_KEY_OPTIONS/loadUsersByRole, already used for role-assigned
-- tasks), @Ehren resolves to a team member by first name.
--
-- notification_rules.event_type has a whitelist CHECK constraint --
-- 'mentioned' has to be added to it before a row for it can be inserted.
--
-- First attempt at this migration failed live: "check constraint ...
-- is violated by some row." The list above was built by grepping past
-- migration files for the constraint's definition, but that constraint
-- has been dropped and recreated several times since 024 (046, 049, 054,
-- 095), each widening it further, and grepping missed the accumulated
-- values -- exactly the same mistake 054's own migration comment
-- describes an earlier draft of *that* migration making. Queried the
-- live table directly this time instead of trusting file history:
-- build_stage_changed, catalog_price_change_requested,
-- catalog_price_change_reviewed, low_stock_reached,
-- purchase_request_status_changed, quote_proposal_responded,
-- submittal_responded, task_assigned, task_overdue, task_status_changed,
-- user_signup_pending. (Notably, 'direct_message_received' from
-- migration 095 has no row and isn't in the live constraint either --
-- that migration's own insert apparently never took, a separate
-- pre-existing gap, not something this migration touches.)
alter table notification_rules drop constraint if exists notification_rules_event_type_check;
alter table notification_rules add constraint notification_rules_event_type_check check (event_type in (
  'task_assigned', 'task_overdue', 'task_status_changed',
  'purchase_request_status_changed', 'build_stage_changed',
  'submittal_responded', 'low_stock_reached',
  'catalog_price_change_requested', 'catalog_price_change_reviewed',
  'user_signup_pending', 'quote_proposal_responded',
  'mentioned'
));

-- Defaults to in_app + push -- an @mention is meant to interrupt (E's own
-- word: "Alert"), not sit quietly in the bell like the lower-urgency
-- events above default to. Editable afterward in Admin > Notification
-- Rules like every other event type.
insert into notification_rules (event_type, channels, is_active) values
  ('mentioned', '{in_app,push}', true)
on conflict (event_type) do nothing;
