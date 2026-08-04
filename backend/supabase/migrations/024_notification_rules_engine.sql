-- Phase 15: automation & notification rules engine.
-- Tier 1 (in-app bell) is fully functional with this migration alone -- no
-- new secrets needed. Email and Slack/Teams channels are represented in
-- the data model (so the "programmable" admin UI can toggle them now) but
-- do not actually deliver yet -- that needs a provider secret, which is a
-- separate sign-off per the roadmap.

create table if not exists notification_rules (
  id uuid primary key default gen_random_uuid(),
  event_type text not null unique check (event_type in (
    'task_assigned', 'task_overdue', 'task_status_changed',
    'purchase_request_status_changed', 'build_stage_changed',
    'submittal_responded', 'low_stock_reached'
  )),
  channels text[] not null default '{in_app}'::text[],
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into notification_rules (event_type, channels, is_active) values
  ('task_assigned', '{in_app}', true),
  ('task_overdue', '{in_app}', true),
  ('task_status_changed', '{in_app}', false),
  ('purchase_request_status_changed', '{in_app}', false),
  ('build_stage_changed', '{in_app}', false),
  ('submittal_responded', '{in_app}', true),
  ('low_stock_reached', '{in_app}', false)
on conflict (event_type) do nothing;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  event_type text not null,
  title text not null,
  body text not null default '',
  related_entity_type text,
  related_entity_id text,
  dedupe_key text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient on notifications(recipient_email, is_read, created_at desc);
create unique index if not exists idx_notifications_dedupe on notifications(dedupe_key) where dedupe_key is not null;

create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'slack', 'teams')),
  status text not null default 'sent' check (status in ('sent', 'failed', 'skipped')),
  error_message text,
  sent_at timestamptz not null default now()
);

alter table notification_rules enable row level security;
alter table notifications enable row level security;
alter table notification_deliveries enable row level security;

create policy "authenticated read notification_rules"
  on notification_rules for select to authenticated using (true);

create policy "admins and managers write notification_rules"
  on notification_rules for all to authenticated
  using (is_app_admin(auth.uid()) or is_app_manager(auth.uid()))
  with check (is_app_admin(auth.uid()) or is_app_manager(auth.uid()));

-- Any signed-in user can create a notification (it's the acting user's
-- client generating an alert for someone else, e.g. assigning a task to a
-- teammate) -- but can only read/update their own.
create policy "authenticated create notifications"
  on notifications for insert to authenticated with check (true);

create policy "recipients read their own notifications"
  on notifications for select to authenticated
  using (lower(recipient_email) = lower(coalesce(auth.jwt() ->> 'email', '')) or is_app_admin(auth.uid()));

create policy "recipients update their own notifications"
  on notifications for update to authenticated
  using (lower(recipient_email) = lower(coalesce(auth.jwt() ->> 'email', '')) or is_app_admin(auth.uid()))
  with check (lower(recipient_email) = lower(coalesce(auth.jwt() ->> 'email', '')) or is_app_admin(auth.uid()));

create policy "authenticated read notification_deliveries"
  on notification_deliveries for select to authenticated using (true);

create policy "authenticated create notification_deliveries"
  on notification_deliveries for insert to authenticated with check (true);
