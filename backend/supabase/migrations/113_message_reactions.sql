-- Migration 113: emoji reactions on messages -- the single most
-- recognizable Slack feature Ergon's Messages hub was missing. E, from a
-- real Teams sidebar/chat-header screenshot plus "we need it to be a
-- combination of Teams and Slack features."
--
-- Two mirrored tables (channel_message_reactions / direct_message_reactions),
-- same "channel_messages mirrors direct_messages" convention this schema
-- has kept since migration 094/101 rather than one polymorphic table.
-- `unique (message_id, user_id, emoji)` makes "react" a toggle: the client
-- inserts to add, deletes its own row to remove, and can never double-add
-- the same emoji twice.
--
-- RLS mirrors each parent message table's own read/write scoping exactly
-- (private group-channel membership for channel reactions, conversation
-- participancy for DM reactions) so a reaction never leaks visibility a
-- reader wouldn't already have via the message itself.

create table if not exists channel_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references channel_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists idx_channel_message_reactions_message on channel_message_reactions(message_id);

alter table channel_message_reactions enable row level security;

drop policy if exists "authenticated read channel_message_reactions" on channel_message_reactions;
create policy "authenticated read channel_message_reactions" on channel_message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.channel_messages m
      join public.channels c on c.id = m.channel_id
      where m.id = channel_message_reactions.message_id
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = auth.uid())
        )
    )
  );

drop policy if exists "authenticated add own channel_message_reactions" on channel_message_reactions;
create policy "authenticated add own channel_message_reactions" on channel_message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.channel_messages m
      join public.channels c on c.id = m.channel_id
      where m.id = channel_message_reactions.message_id
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = auth.uid())
        )
    )
  );

drop policy if exists "authenticated remove own channel_message_reactions" on channel_message_reactions;
create policy "authenticated remove own channel_message_reactions" on channel_message_reactions for delete to authenticated
  using (user_id = auth.uid());

create table if not exists direct_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references direct_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists idx_direct_message_reactions_message on direct_message_reactions(message_id);

alter table direct_message_reactions enable row level security;

drop policy if exists "participants read direct_message_reactions" on direct_message_reactions;
create policy "participants read direct_message_reactions" on direct_message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.direct_messages dm
      join public.conversations c on c.id = dm.conversation_id
      where dm.id = direct_message_reactions.message_id
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
    )
  );

drop policy if exists "participants add own direct_message_reactions" on direct_message_reactions;
create policy "participants add own direct_message_reactions" on direct_message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.direct_messages dm
      join public.conversations c on c.id = dm.conversation_id
      where dm.id = direct_message_reactions.message_id
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
    )
  );

drop policy if exists "participants remove own direct_message_reactions" on direct_message_reactions;
create policy "participants remove own direct_message_reactions" on direct_message_reactions for delete to authenticated
  using (user_id = auth.uid());
