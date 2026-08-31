-- Migration 104: Canvas, mapped from Slack's per-channel Canvas tab. E,
-- reviewing real Slack workspace screenshots, confirmed this is wanted:
-- "Canvas -> a persistent notes/scope doc pinned to the channel."
--
-- One row per channel, plain text content, last-editor tracked the same
-- way channel_messages tracks its sender. Same broad "any authenticated
-- user" read/write posture as channels/channel_messages (migration 101) --
-- this is a shared team doc, not a private one.

create table if not exists channel_canvas (
  channel_id uuid primary key references channels(id) on delete cascade,
  content text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table channel_canvas enable row level security;

drop policy if exists "authenticated read channel_canvas" on channel_canvas;
create policy "authenticated read channel_canvas" on channel_canvas for select to authenticated using (true);

drop policy if exists "authenticated write channel_canvas" on channel_canvas;
create policy "authenticated write channel_canvas" on channel_canvas for insert to authenticated with check (true);

drop policy if exists "authenticated update channel_canvas" on channel_canvas;
create policy "authenticated update channel_canvas" on channel_canvas for update to authenticated using (true) with check (true);
