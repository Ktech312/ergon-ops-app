-- Migration 206: fix a real bug in migration 203 (already applied) -- found live, 2026-09-24,
-- running the corrected canonical test: `ERROR: 42P17: infinite recursion detected in policy for
-- relation "conversations"`, raised on a plain 1:1 `insert into conversations ... returning id`.
--
-- Root cause: `conversations`' own SELECT policy (migration 203) reads `conversation_members` in
-- a plain subquery to check group membership; `conversation_members`'s own SELECT policy
-- (migration 203) reads `conversations` right back to check workspace membership. Neither
-- function is SECURITY DEFINER, so each subquery is evaluated under the CALLER's own role and
-- re-triggers the OTHER table's RLS policy -- a genuine mutual-recursion cycle that only
-- manifests when a real row is actually read or RETURNING'd (never during the migration's own
-- DDL, which is why this wasn't caught until the canonical test's first live INSERT).
--
-- Fix: the same technique this schema already uses everywhere for exactly this shape
-- (is_workspace_member(), is_active_workspace_member(), etc.) -- a new SECURITY DEFINER helper,
-- is_conversation_member(), that reads conversation_members bypassing RLS internally (security
-- definer functions run as the function owner, not the querying role, so their own internal
-- queries never re-trigger RLS on the tables they touch). Every policy that used to inline
-- `exists (select 1 from conversation_members cm where ...)` now calls this function instead --
-- breaks the conversations<->conversation_members cycle at its source, and is also the more
-- consistent, faster form (one function call instead of a fresh RLS-checked subquery scan) used
-- throughout this whole schema already. forward_attachment()/create_group_conversation() are
-- untouched -- both are themselves SECURITY DEFINER, so their own internal queries were never
-- part of this recursion in the first place.
--
-- Per this repo's standing rule, migration 203 itself is NOT edited or rerun.

begin;

create or replace function public.is_conversation_member(check_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = check_conversation_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
revoke execute on function public.is_conversation_member(uuid) from anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;

-- ============================================================
-- conversations SELECT -- THE fix that actually breaks the recursion (this is the policy that
-- was cycling with conversation_members' own SELECT policy).
-- ============================================================

drop policy if exists "workspace participants read their conversations" on public.conversations;
create policy "workspace participants read their conversations"
  on public.conversations for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (
      auth.uid() = participant_a_id or auth.uid() = participant_b_id
      or public.is_conversation_member(id)
    )
  );

-- ============================================================
-- direct_messages / direct_message_reactions / message-attachments storage policies: same
-- substitution for consistency and to avoid a second RLS-checked subquery on every message
-- read/write -- none of these were themselves part of the recursion (conversation_members'
-- policy only reads conversations, not direct_messages/reactions/storage.objects), but they all
-- inlined the identical now-redundant subquery pattern.
-- ============================================================

drop policy if exists "workspace participants read their messages" on public.direct_messages;
create policy "workspace participants read their messages"
  on public.direct_messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.is_workspace_member(c.workspace_id)
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid() or public.is_conversation_member(c.id))
    )
  );

drop policy if exists "workspace participants send messages in their conversations" on public.direct_messages;
create policy "workspace participants send messages in their conversations"
  on public.direct_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.is_active_workspace_member(c.workspace_id)
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid() or public.is_conversation_member(c.id))
    )
  );

drop policy if exists "workspace recipients mark messages read" on public.direct_messages;
create policy "workspace recipients mark messages read"
  on public.direct_messages for update to authenticated
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.is_workspace_member(c.workspace_id)
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid() or public.is_conversation_member(c.id))
    )
  )
  with check (sender_id <> auth.uid());

drop policy if exists "participants read direct_message_reactions" on public.direct_message_reactions;
create policy "participants read direct_message_reactions" on public.direct_message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.direct_messages dm
      join public.conversations c on c.id = dm.conversation_id
      where dm.id = direct_message_reactions.message_id
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid() or public.is_conversation_member(c.id))
    )
  );

drop policy if exists "participants add own direct_message_reactions" on public.direct_message_reactions;
create policy "participants add own direct_message_reactions" on public.direct_message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.direct_messages dm
      join public.conversations c on c.id = dm.conversation_id
      where dm.id = direct_message_reactions.message_id
        and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid() or public.is_conversation_member(c.id))
    )
  );

drop policy if exists "conversation participants read message-attachments" on storage.objects;
create policy "conversation participants read message-attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.conversations c
      where (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid() or public.is_conversation_member(c.id))
        and name like c.id::text || '/%'
    )
  );

drop policy if exists "conversation participants write message-attachments" on storage.objects;
create policy "conversation participants write message-attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.conversations c
      where (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid() or public.is_conversation_member(c.id))
        and name like c.id::text || '/%'
    )
  );

commit;
