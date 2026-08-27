-- Migration 095: Web Push subscriptions, second half of E's DM + alerts
-- request ("once the icon is on their phone, they will get alerts for
-- messages or new tasks"). Real Web Push (VAPID), same protocol VLTD uses
-- -- see HANDOFF.md for the full research on VLTD's implementation and
-- why this one is wired differently.
--
-- One person can have several rows (phone + laptop both subscribed) --
-- push fans out to every device they've turned it on for. `endpoint` is
-- globally unique per device+browser install, so it's the natural
-- upsert/de-dupe key (re-subscribing the same device just refreshes keys,
-- doesn't create a duplicate row).
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

-- Only the send endpoint (server-side, using the Supabase service-role
-- key, which bypasses RLS entirely) ever reads across users -- a browser
-- session only ever needs to manage its own subscription rows.
create policy "users manage their own push subscriptions"
  on push_subscriptions for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Wires push into the existing notification engine (migration 024)
-- instead of a one-off bypass -- "push" becomes a normal 4th channel
-- alongside in_app/email/slack, so an admin can turn any event's push
-- alerts on/off from the same Notification Rules panel.
alter table notification_deliveries drop constraint if exists notification_deliveries_channel_check;
alter table notification_deliveries add constraint notification_deliveries_channel_check
  check (channel in ('in_app', 'email', 'slack', 'teams', 'push'));

-- New event type: a direct message arriving (migration 094). Seeded
-- push-only (not in_app/email/slack) -- an in-app bell entry for every DM
-- would just duplicate the dedicated unread badge Messages already has.
alter table notification_rules drop constraint if exists notification_rules_event_type_check;
alter table notification_rules add constraint notification_rules_event_type_check
  check (event_type in (
    'task_assigned', 'task_overdue', 'task_status_changed',
    'purchase_request_status_changed', 'build_stage_changed',
    'submittal_responded', 'low_stock_reached', 'direct_message_received'
  ));

insert into notification_rules (event_type, channels, is_active)
values ('direct_message_received', '{push}'::text[], true)
on conflict (event_type) do nothing;
