-- Migration 203: multi-person direct conversations. **APPROVED by E, 2026-09-23/24** -- a
-- separate ad-hoc group-DM surface, distinct from the existing named group-channel feature
-- (migration 105). Responds to E's own long-standing ask, recorded in migration 162's header
-- (2026-09-17): "conversations/direct_messages... support more than two participants,
-- Slack/Teams-style... a real, separate feature... tracked as a new item, not part of Phase 3."
--
-- E's approved shape (see PRODUCT_MULTIPERSON_CONVERSATIONS_DESIGN.md for full detail):
-- "New message" picks 1+ recipients -- exactly 1 uses the existing deduplicated 1:1
-- conversation, 2+ creates an ad-hoc group DM, no name required (title is optional, the
-- frontend derives a label from participant names by default). Lives under Direct Messages,
-- not Channels. Ordinary messages/reactions/attachments/unread/notifications; explicitly NOT
-- Tasks/Files/Canvas/public-private/guest access -- those stay channel-only features.
-- Workspace containment stays exactly as migration 187 established it (2026-09-17 reversal of
-- the OLDER "conversations stay cross-workspace" decision, migration 162's original header) --
-- this migration does not reopen or revert that; every branch below builds on top of it.
--
-- **CORRECTED before sending, per E's own explicit review, 2026-09-24: membership is FIXED at
-- creation for this first release.** The original draft included an "add people to an existing
-- group" path (a member-add RLS policy + an add_conversation_member() RPC) -- E flagged the
-- real risk directly: adding a new participant to an existing group would expose that new
-- participant to the group's entire PRIOR message history (direct_messages carries no
-- per-message "who could see this when it was sent" boundary -- every read policy below is
-- "are you a member NOW," not "were you a member THEN"). Both the member-add and member-leave
-- paths are removed from this migration. `conversation_members` has NO insert/delete RLS
-- policy at all beyond SELECT -- the only way a row is ever created is
-- create_group_conversation()'s own atomic, SECURITY DEFINER insert of every starting member
-- at creation time, in the same transaction as the conversation row itself. To change who's in
-- a group, a user starts a new group DM -- Add People and Leave Group are deliberately not
-- built this release (see design doc for the follow-up this unblocks once real membership-
-- history semantics are designed).
--
-- Design summary (full detail in the design doc): additive only. Every existing 1:1
-- conversation, and every future 1:1 conversation created via getOrCreateConversation()'s
-- existing participant_a_id/participant_b_id upsert, is completely untouched -- same columns,
-- same unique constraint, same canonical-pair ordering, zero behavior change. A new group
-- conversation (is_group = true) leaves participant_a_id/participant_b_id null and expresses
-- membership entirely through a new conversation_members table (identical shape to
-- channel_members, migration 105, minus channel_members' own insert/delete policies -- see
-- above for why those are deliberately not carried over). Every existing RLS policy/RPC
-- predicate that currently reads "participant_a_id = X or participant_b_id = X" (11
-- occurrences across migrations 094, 113, 187, 190, 191) gets one more OR'd branch checking
-- conversation_members -- the original two-column check stays exactly as it is today, so an
-- existing 1:1 conversation's access control is provably unchanged by this migration.
--
-- message_read_state (migration 191) needs ZERO changes -- it was already built generic over
-- (user_id, conversation_kind, conversation_id), never actually assuming exactly two
-- participants. This migration's own canonical test proves that by exercising it against a
-- real 3-person group, not just asserting it by inspection.

begin;

-- ============================================================
-- Section 1 -- conversations: is_group/title/created_by, participant columns become nullable
-- (a group conversation has neither), conversation_members join table.
-- ============================================================

alter table public.conversations
  alter column participant_a_id drop not null,
  alter column participant_b_id drop not null,
  add column if not exists is_group boolean not null default false,
  add column if not exists title text,
  add column if not exists created_by uuid references auth.users(id);

-- A 1:1 conversation must keep both participant columns (the existing constraint already
-- enforces participant_a_id <> participant_b_id and the canonical a < b ordering for those
-- rows); a group conversation must have neither -- membership lives in conversation_members
-- only. Keeps the two shapes from ever being ambiguously mixed.
alter table public.conversations
  drop constraint if exists conversations_group_shape_check;
alter table public.conversations
  add constraint conversations_group_shape_check check (
    (is_group = false and participant_a_id is not null and participant_b_id is not null)
    or (is_group = true and participant_a_id is null and participant_b_id is null)
  );

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists idx_conversation_members_user on public.conversation_members(user_id);

-- Backfill: every EXISTING conversation (all 1:1 today) gets its two participants mirrored
-- into conversation_members, so read-state and any future membership-based query behave
-- uniformly across old and new rows without a special case for pre-migration conversations.
insert into public.conversation_members (conversation_id, user_id)
select id, participant_a_id from public.conversations
on conflict (conversation_id, user_id) do nothing;
insert into public.conversation_members (conversation_id, user_id)
select id, participant_b_id from public.conversations
on conflict (conversation_id, user_id) do nothing;

alter table public.conversation_members enable row level security;

-- Read scope deliberately TIGHTER than channel_members' own precedent (migration 105:
-- "authenticated read channel_members using (true)", no workspace check at all) -- a group
-- DM's membership list is more sensitive than a channel's, so this is workspace-scoped.
drop policy if exists "workspace members read conversation_members" on public.conversation_members;
create policy "workspace members read conversation_members"
  on public.conversation_members for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and public.is_workspace_member(c.workspace_id)
    )
  );

-- Deliberately NO insert or delete policy on conversation_members beyond the SELECT above.
-- Membership is fixed at creation for this first release (see this file's header) -- the only
-- row-creating path is create_group_conversation()'s own SECURITY DEFINER insert, which runs
-- as the function owner and so is unaffected by RLS regardless of policy state. With zero
-- insert/delete policies, Postgres RLS defaults to deny for both commands via any other route
-- (a raw PostgREST insert/delete against this table), which is exactly the intended posture --
-- not an oversight. Adding "add a member"/"leave" policies is real follow-up work, gated on
-- designing real per-message visibility semantics first (a new member must never see history
-- from before they joined) -- explicitly not attempted here.
drop policy if exists "existing members add conversation_members" on public.conversation_members;
drop policy if exists "members leave conversation_members" on public.conversation_members;

-- ============================================================
-- Section 2 -- workspace containment. A 1:1 conversation keeps the exact existing
-- two-participant intersection logic (migration 187) untouched. A group conversation has no
-- fixed "second participant" to intersect against at INSERT time -- membership is added one
-- row at a time, same as channel_members -- so it stamps workspace_id from the CREATOR's own
-- active workspace (resolve_caller_workspace_id(), the same resolver used everywhere else in
-- this schema for exactly this "no second anchor" situation), and a new
-- guard_conversation_member_workspace_id() trigger on conversation_members INSERT rejects
-- adding anyone who isn't an active member of that same workspace.
-- ============================================================

create or replace function public.guard_conversation_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shared_workspace_id uuid;
begin
  if TG_OP = 'INSERT' then
    if new.is_group then
      new.workspace_id := public.resolve_caller_workspace_id();
      return new;
    end if;

    select wm_a.workspace_id into shared_workspace_id
    from public.workspace_members wm_a
    join public.workspace_members wm_b on wm_b.workspace_id = wm_a.workspace_id
    join public.workspaces w on w.id = wm_a.workspace_id
    where wm_a.user_id = new.participant_a_id
      and wm_b.user_id = new.participant_b_id
      and w.status = 'active'
    order by wm_a.workspace_id
    limit 1;

    if shared_workspace_id is null then
      raise exception 'conversation participants must share an active workspace';
    end if;

    new.workspace_id := shared_workspace_id;
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'workspace_id is immutable through ordinary writes -- reassignment requires a separately reviewed privileged procedure';
    end if;
    return new;
  end if;

  return new;
end;
$$;

create or replace function public.guard_conversation_member_workspace_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv_workspace_id uuid;
begin
  select workspace_id into conv_workspace_id from public.conversations where id = new.conversation_id;
  if conv_workspace_id is null then
    raise exception 'Conversation not found.';
  end if;
  if not exists (
    select 1 from public.workspace_members wm
    where wm.user_id = new.user_id and wm.workspace_id = conv_workspace_id and wm.status = 'active'
  ) then
    raise exception 'Cannot add a member who is not an active member of this conversation''s workspace.';
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_members_guard_workspace on public.conversation_members;
create trigger conversation_members_guard_workspace
  before insert on public.conversation_members
  for each row execute function public.guard_conversation_member_workspace_id();

-- ============================================================
-- Section 3 -- conversations/direct_messages/direct_message_reactions RLS: one more OR'd
-- branch checking conversation_members, added alongside every existing participant_a_id/
-- participant_b_id check, never replacing it.
-- ============================================================

drop policy if exists "workspace participants read their conversations" on public.conversations;
create policy "workspace participants read their conversations"
  on public.conversations for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (
      auth.uid() = participant_a_id or auth.uid() = participant_b_id
      or exists (select 1 from public.conversation_members cm where cm.conversation_id = id and cm.user_id = auth.uid())
    )
  );

drop policy if exists "workspace participants create their conversations" on public.conversations;
create policy "workspace participants create their conversations"
  on public.conversations for insert to authenticated
  with check (
    public.is_active_workspace_member(workspace_id)
    and (
      auth.uid() = participant_a_id or auth.uid() = participant_b_id
      or (is_group and created_by = auth.uid())
    )
  );

drop policy if exists "workspace participants read their messages" on public.direct_messages;
create policy "workspace participants read their messages"
  on public.direct_messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.is_workspace_member(c.workspace_id)
        and (
          c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid()
          or exists (select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id = auth.uid())
        )
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
        and (
          c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid()
          or exists (select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id = auth.uid())
        )
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
        and (
          c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid()
          or exists (select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id = auth.uid())
        )
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
        and (
          c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid()
          or exists (select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id = auth.uid())
        )
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
        and (
          c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid()
          or exists (select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id = auth.uid())
        )
    )
  );

-- forward_attachment() (migration 190): same one-line OR addition on its destination
-- conversation check, nothing else in this function changes.
create or replace function public.forward_attachment(
  p_source_kind text,          -- 'channel_message' | 'direct_message'
  p_source_id uuid,
  p_destination_kind text,     -- 'channel' | 'conversation'
  p_destination_id uuid,
  p_message_body text default null
)
returns table (outcome text, new_id uuid, source_storage_path text, destination_storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_source_parent_id uuid;
  v_storage_path text;
  v_new_storage_path text;
  v_file_name text;
  v_mime_type text;
  v_size_bytes bigint;
  v_dest_workspace_id uuid;
  v_new_id uuid;
  v_body text;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to forward a file';
  end if;

  if p_source_kind not in ('channel_message', 'direct_message') then
    raise exception 'p_source_kind must be channel_message or direct_message';
  end if;
  if p_destination_kind not in ('channel', 'conversation') then
    raise exception 'p_destination_kind must be channel or conversation';
  end if;

  perform public.resolve_caller_workspace_id();

  if p_source_kind = 'channel_message' then
    select m.channel_id, m.attachment_storage_path, m.attachment_file_name, m.attachment_mime_type, m.attachment_size_bytes
      into v_source_parent_id, v_storage_path, v_file_name, v_mime_type, v_size_bytes
    from public.channel_messages m
    join public.channels c on c.id = m.channel_id
    where m.id = p_source_id
      and public.is_workspace_member(c.workspace_id)
      and (
        c.type in ('section', 'project', 'client')
        or (c.type = 'group' and c.private = false)
        or exists (select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = v_actor_id)
      );
  else
    select dm.conversation_id, dm.attachment_storage_path, dm.attachment_file_name, dm.attachment_mime_type, dm.attachment_size_bytes
      into v_source_parent_id, v_storage_path, v_file_name, v_mime_type, v_size_bytes
    from public.direct_messages dm
    join public.conversations conv on conv.id = dm.conversation_id
    where dm.id = p_source_id
      and public.is_workspace_member(conv.workspace_id)
      and (
        conv.participant_a_id = v_actor_id or conv.participant_b_id = v_actor_id
        or exists (select 1 from public.conversation_members cm where cm.conversation_id = conv.id and cm.user_id = v_actor_id)
      );
  end if;

  if v_source_parent_id is null then
    return query select 'source_not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if v_storage_path is null then
    return query select 'source_has_no_attachment'::text, null::uuid, null::text, null::text;
    return;
  end if;

  v_body := nullif(btrim(coalesce(p_message_body, '')), '');

  v_new_storage_path := p_destination_id::text || '/' ||
    (extract(epoch from clock_timestamp()) * 1000)::bigint::text || '-' ||
    substring(regexp_replace(coalesce(nullif(btrim(v_file_name), ''), 'file'), '[^a-zA-Z0-9_.-]+', '_', 'g') from 1 for 120);

  if p_destination_kind = 'channel' then
    select c.workspace_id into v_dest_workspace_id from public.channels c where c.id = p_destination_id;
    if v_dest_workspace_id is null then
      raise exception 'Destination channel not found.';
    end if;
    if not (
      public.is_active_workspace_member(v_dest_workspace_id)
      and exists (
        select 1 from public.channels c
        where c.id = p_destination_id
          and (
            c.type in ('section', 'project', 'client')
            or (c.type = 'group' and c.private = false)
            or exists (select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = v_actor_id)
          )
      )
    ) then
      raise exception 'You do not have permission to forward into that channel.' using errcode = '42501';
    end if;

    insert into public.channel_messages (
      channel_id, sender_id, body,
      attachment_storage_path, attachment_file_name, attachment_mime_type, attachment_size_bytes,
      forwarded_from_message_id, forwarded_from_kind
    ) values (
      p_destination_id, v_actor_id, v_body,
      v_new_storage_path, v_file_name, v_mime_type, v_size_bytes,
      p_source_id, p_source_kind
    ) returning id into v_new_id;
  else
    if not exists (
      select 1 from public.conversations conv
      where conv.id = p_destination_id
        and public.is_active_workspace_member(conv.workspace_id)
        and (
          conv.participant_a_id = v_actor_id or conv.participant_b_id = v_actor_id
          or exists (select 1 from public.conversation_members cm where cm.conversation_id = conv.id and cm.user_id = v_actor_id)
        )
    ) then
      raise exception 'You do not have permission to forward into that conversation.' using errcode = '42501';
    end if;

    insert into public.direct_messages (
      conversation_id, sender_id, body,
      attachment_storage_path, attachment_file_name, attachment_mime_type, attachment_size_bytes,
      forwarded_from_message_id, forwarded_from_kind
    ) values (
      p_destination_id, v_actor_id, v_body,
      v_new_storage_path, v_file_name, v_mime_type, v_size_bytes,
      p_source_id, p_source_kind
    ) returning id into v_new_id;
  end if;

  return query select 'forwarded'::text, v_new_id, v_storage_path, v_new_storage_path;
end;
$$;

revoke all on function public.forward_attachment(text, uuid, text, uuid, text) from public;
revoke execute on function public.forward_attachment(text, uuid, text, uuid, text) from anon;
grant execute on function public.forward_attachment(text, uuid, text, uuid, text) to authenticated;

-- ============================================================
-- Section 3b -- message-attachments storage.objects policies (migration 100). Found during
-- the "review against every current conversation/message/reaction/attachment/read-state
-- policy" pass E asked for before sending this migration -- these two were missed in the
-- first draft. Migration 187's header explicitly left them untouched at the time because they
-- "already key off actual conversation PARTICIPANCY," which was true and sufficient for a
-- fixed two-participant world -- but a real GROUP member needs the same OR'd branch every
-- other conversation-scoped policy in this migration already gets, or they could never
-- upload/view their own group's attachments at all.
-- ============================================================

drop policy if exists "conversation participants read message-attachments" on storage.objects;
create policy "conversation participants read message-attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.conversations c
      where (
        c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid()
        or exists (select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id = auth.uid())
      )
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
      where (
        c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid()
        or exists (select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id = auth.uid())
      )
        and name like c.id::text || '/%'
    )
  );

-- ============================================================
-- Section 4 -- create_group_conversation(): the ONLY write path that can ever create a
-- conversation_members row this release (see this file's header -- membership fixed at
-- creation, no add/remove). SECURITY DEFINER so the initial multi-row membership insert
-- (creator + every starting member) happens atomically, in the same transaction as the
-- conversation row itself -- there is deliberately no separate "add people" RPC.
-- p_title is optional (nullable) -- the first-release frontend does not require or prompt for
-- one; the DM list derives a display label from participant names by default, same as it
-- already does for a 1:1 conversation's "other participant" name today.
-- ============================================================

create or replace function public.create_group_conversation(p_title text, p_member_user_ids uuid[])
returns public.conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_workspace_id uuid;
  v_conversation public.conversations;
  v_member_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to start a group conversation';
  end if;
  if p_member_user_ids is null or array_length(p_member_user_ids, 1) is null or array_length(p_member_user_ids, 1) < 2 then
    raise exception 'A group conversation needs at least 2 other members';
  end if;

  v_actor_workspace_id := public.resolve_caller_workspace_id();

  foreach v_member_id in array p_member_user_ids loop
    if not exists (
      select 1 from public.workspace_members wm
      where wm.user_id = v_member_id and wm.workspace_id = v_actor_workspace_id and wm.status = 'active'
    ) then
      raise exception 'Every member must be an active member of your own workspace.';
    end if;
  end loop;

  insert into public.conversations (is_group, title, created_by, participant_a_id, participant_b_id)
  values (true, nullif(btrim(coalesce(p_title, '')), ''), v_actor_id, null, null)
  returning * into v_conversation;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_conversation.id, v_actor_id)
  on conflict (conversation_id, user_id) do nothing;

  foreach v_member_id in array p_member_user_ids loop
    insert into public.conversation_members (conversation_id, user_id)
    values (v_conversation.id, v_member_id)
    on conflict (conversation_id, user_id) do nothing;
  end loop;

  return v_conversation;
end;
$$;

revoke all on function public.create_group_conversation(text, uuid[]) from public;
revoke execute on function public.create_group_conversation(text, uuid[]) from anon;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

commit;
