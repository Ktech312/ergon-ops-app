-- Migration 105: freeform group channels -- the "create your own channel"
-- half of the Slack/ClickUp roadmap that never got built in migration
-- 101 (that one only covers the fixed Section/Project/Client channels).
-- E: "Create group chats that are private or can be unlocked, also be
-- able to add people to them." / "I know we talked about creating new
-- tabs independently I don't see that."
--
-- Design: a 4th channels.type, 'group' -- anyone can create one, private
-- by default (only explicit members can see/read/post), with an
-- "unlock" action that flips it to broadly visible (same posture as
-- every Section/Project/Client channel). Membership is a real table
-- (channel_members) since this is the first channel type that isn't
-- broadly readable by the whole team -- Section/Project/Client channels
-- stay exactly as broad as before, this only adds a second, narrower
-- path for 'group' channels.
--
-- Security note, learned the hard way in migration 103 (unqualified
-- `name` inside a correlated subquery silently bound to the wrong
-- table's own `name` column): every policy below fully qualifies every
-- column reference (c.id, m.channel_id, channel_messages.channel_id,
-- storage.objects.name) rather than relying on scope fallback.

alter table channels drop constraint if exists channels_type_check;
alter table channels add constraint channels_type_check check (type in ('section', 'project', 'client', 'group'));
alter table channels add column if not exists private boolean not null default true;
alter table channels add column if not exists created_by uuid references auth.users(id) on delete set null;

create table if not exists channel_members (
  channel_id uuid not null references channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

alter table channel_members enable row level security;
drop policy if exists "authenticated read channel_members" on channel_members;
create policy "authenticated read channel_members" on channel_members for select to authenticated using (true);
drop policy if exists "authenticated write channel_members" on channel_members;
create policy "authenticated write channel_members" on channel_members for insert to authenticated with check (true);
drop policy if exists "authenticated delete channel_members" on channel_members;
create policy "authenticated delete channel_members" on channel_members for delete to authenticated using (true);

-- channels: the old blanket "using (true)" read policy would leak
-- private group channels to everyone -- split into an open half (same
-- as before, plus unlocked groups) and a membership-gated half for
-- private groups.
drop policy if exists "authenticated read channels" on channels;
create policy "authenticated read open channels" on channels for select to authenticated
  using (type in ('section', 'project', 'client') or (type = 'group' and private = false));
create policy "authenticated read private group channels" on channels for select to authenticated
  using (type = 'group' and private = true and exists (select 1 from public.channel_members m where m.channel_id = channels.id and m.user_id = auth.uid()));

-- channel_messages: same split needed here, and in the attachment
-- storage policies below -- reading the channel row being locked down
-- doesn't help if the messages/files inside it are still openly
-- readable by anyone who guesses/enumerates the channel id.
drop policy if exists "authenticated read channel_messages" on channel_messages;
create policy "authenticated read channel_messages" on channel_messages for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_messages.channel_id
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
  );

drop policy if exists "authenticated send channel_messages" on channel_messages;
create policy "authenticated send channel_messages" on channel_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.channels c
      where c.id = channel_messages.channel_id
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
  );

drop policy if exists "authenticated read channel message-attachments" on storage.objects;
drop policy if exists "authenticated write channel message-attachments" on storage.objects;

create policy "authenticated read channel message-attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.channels c
      where storage.objects.name like c.id::text || '/%'
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
  );

create policy "authenticated write channel message-attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.channels c
      where storage.objects.name like c.id::text || '/%'
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
  );
