-- Migration 094: real person-to-person direct messaging, ported from the
-- VLTD sister project (C:\Users\EK\VLTD) at E's request ("I have a direct
-- message and alert system built into it now, I think we need that on this
-- also"). Chose "full DM feature + push together" when asked to scope it.
--
-- Deliberately NOT a copy of VLTD's schema -- VLTD's `profiles.id` IS
-- `auth.users.id` (every conversation participant is a real logged-in
-- user by construction). Ergon has no such guarantee: `team_members`
-- (migration 019) is explicitly "NOT tied to auth.users -- someone can be
-- assigned tasks before they've ever logged in," so it's the wrong source
-- for "who can receive a DM." The real anchor for "an actual logged-in
-- person" in this app is `app_known_users` (migration 012:
-- user_id references auth.users(id), populated on login) -- conversations
-- reference that identity directly.
--
-- app_known_users' existing read policy is admin-or-self only (migration
-- 012: "users and admins read directory"), which blocks the "start a new
-- conversation, search for who to message" picker for anyone but an
-- admin. RLS policies of the same command type are OR'd together in
-- Postgres, so this ADDS a broader read policy rather than replacing the
-- existing one -- consistent with how team_members/vendors are already
-- broadly readable to any authenticated user on this small internal team.
create policy "authenticated read app_known_users for messaging"
  on app_known_users for select to authenticated using (true);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  participant_a_id uuid not null references auth.users(id) on delete cascade,
  participant_b_id uuid not null references auth.users(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Canonical ordering (lower id always in participant_a_id) makes the
  -- pair unique regardless of who started it -- the client sorts the two
  -- ids before every read/write, same convention VLTD uses.
  check (participant_a_id <> participant_b_id),
  check (participant_a_id < participant_b_id),
  unique (participant_a_id, participant_b_id)
);

create index if not exists idx_conversations_participant_a on conversations(participant_a_id, last_message_at desc);
create index if not exists idx_conversations_participant_b on conversations(participant_b_id, last_message_at desc);

create table if not exists direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) > 0 and char_length(body) <= 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists idx_direct_messages_conversation on direct_messages(conversation_id, created_at);

-- Keeps last_message_at accurate for sorting the inbox without a client
-- round-trip -- matches the "trigger stamps a summary column" pattern
-- already used elsewhere in this schema (e.g. purchase_orders totals).
create or replace function bump_conversation_last_message_at()
returns trigger as $$
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists direct_messages_bump_conversation on direct_messages;
create trigger direct_messages_bump_conversation
  after insert on direct_messages
  for each row execute function bump_conversation_last_message_at();

alter table conversations enable row level security;
alter table direct_messages enable row level security;

create policy "participants read their conversations"
  on conversations for select to authenticated
  using (auth.uid() = participant_a_id or auth.uid() = participant_b_id);

create policy "participants create their conversations"
  on conversations for insert to authenticated
  with check (auth.uid() = participant_a_id or auth.uid() = participant_b_id);

create policy "participants read their messages"
  on direct_messages for select to authenticated
  using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
    )
  );

create policy "participants send messages in their conversations"
  on direct_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
    )
  );

-- Marking a message read: only the recipient (not the sender) should be
-- able to set read_at, and only within a conversation they're actually in.
create policy "recipients mark messages read"
  on direct_messages for update to authenticated
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from conversations c
      where c.id = conversation_id
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
    )
  )
  with check (sender_id <> auth.uid());
