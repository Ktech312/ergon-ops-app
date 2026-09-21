-- Migration 191: per-user "last read" cursor for channels and DMs, plus a
-- summarizing RPC driving the sidebar unread/mention highlight. Implements
-- PRODUCT_CHANNEL_UNREAD_MENTIONS_DESIGN.md end to end (E's own verbatim
-- decisions recorded there 2026-09-21). One-line summary: "a general
-- highlight of a channel if there is a new message in there, then once
-- that channel is viewed it un-highlights" (E, first flagged in
-- PRODUCT_EXTERNAL_GUEST_CHANNELS_DESIGN.md §5 item 3), plus a stronger,
-- visually distinct marker when the caller was specifically @mentioned --
-- "Both channels and DMs," one mechanism, not two.
--
-- ============================================================
-- Migration numbering -- coordinating with the concurrently-built
-- file-forwarding feature
-- ============================================================
-- 189 was the last committed migration as of this session's start. Migration
-- 190 (channel_dm_attachment_forwarding, a different feature being built
-- concurrently by another agent tonight) was ALREADY PRESENT ON DISK
-- (untracked, not yet committed) at the moment this file was written --
-- re-checked directly against backend/supabase/migrations/ immediately
-- before writing this file. This migration therefore takes 191, not 190.
-- If 190 is ever reverted/renumbered before either lands in production,
-- this file's own number should be revisited too, same discipline as every
-- migration this session.
--
-- ============================================================
-- Schema -- reproduced from the design doc's own illustrative SQL (§3)
-- essentially verbatim, not reinvented
-- ============================================================
-- One table, not two -- channels and DMs are both "a conversation-shaped
-- thing with messages," matching the design doc's "one mechanism, not two"
-- framing (§1, §3) rather than a channel_message_reads table plus a
-- separate direct_message_reads table.
--
-- No workspace_id column, and deliberately NO foreign key from
-- conversation_id into channels.id or conversations.id (Postgres has no
-- conditional/polymorphic FK) -- this mirrors the design doc's own
-- illustrative schema exactly (§3: "channels.id or conversations.id
-- depending on conversation_kind", no FK drawn). RLS (below) never trusts
-- conversation_id to already be a real, authorized row -- every read of
-- this table is scoped to the caller's own user_id, and the only writer is
-- the caller upserting their OWN cursor for a channel/DM they can already
-- see (enforced client-side by only ever calling this from an already-open
-- thread; a bogus conversation_id a caller upserts for themselves carries
-- no security risk -- it can never expose or affect any OTHER user's data,
-- same "self-scoped, no blast radius" reasoning the design doc's own RLS
-- section (§5) gives for the whole table).
--
-- ============================================================
-- RLS -- the simplest policy in this whole schema, per the design doc's own
-- note (§5), and deliberately so
-- ============================================================
-- `user_id = auth.uid()` for ALL operations (select/insert/update) -- no
-- workspace-scoping branch, no admin-override branch, no guest-specific
-- branch. "Have I read this" is inherently private to the reader, never
-- something another employee (or an admin) needs to see about someone
-- else, and read access to the underlying channel/conversation itself
-- stays governed entirely by THAT table's own existing RLS -- this table
-- never needs to re-derive or duplicate that check.
--
-- Guest verification (this task's own explicit ask): a channel guest
-- (migration 188) is a real auth.users row with a real auth.uid() -- this
-- policy's `user_id = auth.uid()` needs no is_workspace_member()/
-- is_active_workspace_member()-style branch to admit them, because it
-- never checks workspace membership at all. Marking their own one channel
-- read is exactly the kind of self-scoped action a guest should be able to
-- take, and this migration's own test file (Section (c)) asserts this
-- directly rather than merely by omission, matching the "verify writes
-- affected rows" and "guest gets the same treatment, no special-casing"
-- discipline established throughout this session.
--
-- ============================================================
-- get_message_read_summary(): RPC, not a plain client-side query -- why
-- ============================================================
-- The design doc's own §4 "Practically" paragraph already leans this way:
-- "a get_message_read_summary() RPC is the natural shape, mirroring this
-- schema's existing preference for one summarizing RPC over a client-side
-- N-query loop." A plain client-side query would need to (a) fetch every
-- unread message's raw body down to the browser just to run the mention
-- regex client-side, for every channel/DM the caller can see, on every
-- sidebar refresh, and (b) re-derive team_members/app_user_roles lookups
-- client-side that the server already has cheaply in one place. A single
-- SECURITY DEFINER RPC computes both unread_count and mentioned per
-- conversation in one round trip, exactly mirroring
-- get_channel_message_sender_names()'s (migration 189) own posture:
-- SECURITY DEFINER purely so it can read team_members/app_user_roles
-- efficiently in one place, not because it needs to bypass any access
-- control the caller doesn't already have -- every row it aggregates over
-- is a channel/conversation the caller's OWN real RLS already lets them
-- read (the same visibility predicates are reproduced inline below,
-- re-confirmed from their current live source immediately before writing
-- this file: channels' two SELECT policies + is_active_channel_guest(),
-- migration 188; conversations' SELECT policy, migration 187).
--
-- ============================================================
-- "Was I mentioned" -- reusing resolveMentions()'s exact matching rule,
-- not inventing a new one
-- ============================================================
-- Read directly from source before writing this (api/_lib/notificationEvents.js,
-- resolveMentions(), line 132) rather than assumed:
--   const tokens = [...new Set([...text.matchAll(/@([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1].toLowerCase()))];
--   ...
--   const roleEntry = Object.entries(ROLE_LABELS).find(([, label]) => label.replace(/\s+/g, "").toLowerCase() === token);
--   ...
--   const member = teamMembers.find((m) => (m.full_name || "").split(/\s+/)[0]?.toLowerCase() === token);
-- i.e. a `@token` matches EITHER (a) a role label (ROLE_LABELS, same file,
-- line 28) with whitespace stripped and lowercased, OR (b) the first word
-- of a team_members.full_name, lowercased. This migration reproduces BOTH
-- branches, byte-for-byte the same matching rule, evaluated for one
-- specific viewer (the caller) instead of enumerating all recipients:
--   - The regex itself, `@([A-Za-z][A-Za-z0-9_]*)`, applied with PostgreSQL's
--     own 'g' flag via regexp_matches(), identical token boundary rules.
--   - ROLE_LABELS is reproduced inline as a VALUES list (no equivalent
--     table exists in this schema -- the JS object is the only source of
--     truth today) -- if ROLE_LABELS in notificationEvents.js ever changes,
--     this list must be updated to match, same coupling
--     get_channel_message_sender_names() already has with senderNameFor()/
--     teamDisplayName() (migration 189's own header makes the identical
--     point).
--   - "Which roles does the caller hold" reuses app_user_roles directly
--     (the same table has_role() reads, migration 135) -- not a
--     re-derivation, the actual authoritative role-membership table.
--   - "The caller's own first name" is resolved via the caller's
--     team_members row for their own (single, per this schema's current
--     one-workspace-per-user reality -- see migration 187's own identical
--     judgment call) workspace, matched by email exactly like
--     get_channel_message_sender_names() matches a sender's email
--     (case-insensitive, workspace-scoped since migration 175 made
--     team_members.email unique per-workspace, not globally).
--
-- JUDGMENT CALL, flagged for E: a caller's own workspace is resolved once
-- (not per-channel/per-conversation), via the same "share a workspace ->
-- lowest workspace_id wins" tie-break migration 187 already established
-- for exactly this kind of currently-moot multi-workspace ambiguity, with
-- a fallback to the caller's own active channel_guests row's channel
-- workspace for a guest (who has no workspace_members row at all, migration
-- 188's entire design) -- a guest's "own name" for mention-matching purposes
-- is their team_members row (if any) in the one workspace that owns their
-- one guest channel.
--
-- JUDGMENT CALL, flagged for E: a caller's OWN messages are excluded from
-- their own unread_count/mentioned computation (posting in a channel
-- doesn't leave that channel "unread" for the poster, matching Slack's own
-- real behavior -- your own messages advance your own read position
-- implicitly). Not explicitly stated in the design doc, but directly
-- implied by "once that channel is viewed it un-highlights" -- a poster who
-- never reads their own message back would otherwise see a permanently
-- unread channel they themselves just posted in.
--
-- ============================================================
-- Mark-as-read write path -- plain upsert via RLS, not a second RPC
-- ============================================================
-- The design doc's own §3 closing line: "A single upsert on
-- last_read_at = now() when the caller opens/views a channel or DM is the
-- only write this table ever needs" -- and §5: a mention-check RPC needs
-- SECURITY DEFINER only to read team_members/app_user_roles efficiently,
-- "not because it needs to bypass any access control the caller doesn't
-- already have." Marking one's OWN read-state is exactly the inverse case:
-- the table's own RLS (`user_id = auth.uid()`) already fully authorizes it
-- with zero cross-table lookups needed, so a plain PostgREST upsert
-- (`on conflict (user_id, conversation_kind, conversation_id) do update`)
-- from the frontend is simpler than a wrapping RPC and carries no weaker
-- guarantee -- RLS is the real enforcement either way. No RPC is added for
-- this write.
--
-- Confirm 191 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- Schema.
-- ============================================================

create table if not exists public.message_read_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'channel' or 'conversation' -- which id column below is meaningful.
  conversation_kind text not null check (conversation_kind in ('channel', 'conversation')),
  conversation_id uuid not null,  -- channels.id or conversations.id depending on conversation_kind
  last_read_at timestamptz not null default now(),
  primary key (user_id, conversation_kind, conversation_id)
);

create index if not exists idx_message_read_state_user on public.message_read_state(user_id);

alter table public.message_read_state enable row level security;

-- A user can only ever read/write their OWN read-state rows -- no
-- workspace-visibility branch, no admin-override branch, no guest-specific
-- branch needed here at all (unlike almost every other table in this
-- schema). See this file's header for the full reasoning, including why a
-- channel guest is admitted with no extra branch.
drop policy if exists "users manage their own message_read_state" on public.message_read_state;
create policy "users manage their own message_read_state"
  on public.message_read_state for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on table public.message_read_state from public;
revoke all on table public.message_read_state from anon;
grant select, insert, update on table public.message_read_state to authenticated;

-- ============================================================
-- Section 2 -- get_message_read_summary(): one round trip, one row per
-- channel/DM the caller can see AND currently has unread messages in,
-- with a `mentioned` flag computed by reusing resolveMentions()'s own
-- matching rule. See this file's header for the full rationale.
-- ============================================================

create or replace function public.get_message_read_summary()
returns table (
  conversation_kind text,
  conversation_id uuid,
  unread_count integer,
  mentioned boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_my_id uuid := auth.uid();
  v_my_workspace_id uuid;
  v_my_full_name text;
  v_my_token text;
  v_my_role_tokens text[];
begin
  if v_my_id is null then
    return;
  end if;

  -- The one (per this schema's current one-workspace-per-user reality,
  -- migration 187's own identical tie-break) workspace this caller's
  -- "own name" is resolved against -- an ordinary employee's real
  -- workspace_members row, or (for a channel guest, who never has one)
  -- the workspace that owns their one active guest channel.
  select wm.workspace_id into v_my_workspace_id
  from public.workspace_members wm
  where wm.user_id = v_my_id
  order by wm.workspace_id
  limit 1;

  if v_my_workspace_id is null then
    select c.workspace_id into v_my_workspace_id
    from public.channel_guests g
    join public.channels c on c.id = g.channel_id
    where g.user_id = v_my_id
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
    order by c.workspace_id
    limit 1;
  end if;

  if v_my_workspace_id is not null then
    select tm.full_name into v_my_full_name
    from public.team_members tm
    join auth.users u on u.id = v_my_id
    where tm.workspace_id = v_my_workspace_id
      and lower(tm.email) = lower(u.email);
  end if;

  v_my_token := nullif(lower(split_part(btrim(coalesce(v_my_full_name, '')), ' ', 1)), '');

  -- ROLE_LABELS, reproduced verbatim from api/_lib/notificationEvents.js
  -- (line 28) -- see this file's header for the coupling this creates.
  select array(
    select replace(lower(rl.label), ' ', '')
    from (values
      ('warehouse', 'Warehouse'),
      ('purchasing', 'Procurement'),
      ('pm', 'PM'),
      ('manager', 'Manager'),
      ('sales', 'Sales'),
      ('engineering', 'Engineering'),
      ('product_development', 'Product Development'),
      ('implementation', 'Implementation'),
      ('support', 'Support'),
      ('marketing', 'Marketing')
    ) as rl(role_key, label)
    where exists (
      select 1 from public.app_user_roles ur
      where ur.user_id = v_my_id and ur.role_key = rl.role_key
    )
  ) into v_my_role_tokens;

  return query
  with readable_channels as (
    select c.id, c.workspace_id
    from public.channels c
    where (
      (
        public.is_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = v_my_id)
        )
      )
      or public.is_active_channel_guest(c.id)
    )
  ),
  channel_unread as (
    select
      rc.id as conversation_id,
      count(m.id)::integer as unread_count,
      bool_or(
        v_my_token is not null
        and exists (
          select 1 from regexp_matches(coalesce(m.body, ''), '@([A-Za-z][A-Za-z0-9_]*)', 'g') as tok(t)
          where lower(tok.t[1]) = v_my_token or lower(tok.t[1]) = any(v_my_role_tokens)
        )
      ) as mentioned
    from readable_channels rc
    join public.channel_messages m
      on m.channel_id = rc.id
      and m.sender_id <> v_my_id
      and m.created_at > coalesce(
        (
          select mrs.last_read_at from public.message_read_state mrs
          where mrs.user_id = v_my_id and mrs.conversation_kind = 'channel' and mrs.conversation_id = rc.id
        ),
        '-infinity'::timestamptz
      )
    group by rc.id
  ),
  readable_conversations as (
    select c.id, c.workspace_id
    from public.conversations c
    where public.is_workspace_member(c.workspace_id)
      and (c.participant_a_id = v_my_id or c.participant_b_id = v_my_id)
  ),
  conversation_unread as (
    select
      rc.id as conversation_id,
      count(m.id)::integer as unread_count,
      bool_or(
        v_my_token is not null
        and exists (
          select 1 from regexp_matches(coalesce(m.body, ''), '@([A-Za-z][A-Za-z0-9_]*)', 'g') as tok(t)
          where lower(tok.t[1]) = v_my_token or lower(tok.t[1]) = any(v_my_role_tokens)
        )
      ) as mentioned
    from readable_conversations rc
    join public.direct_messages m
      on m.conversation_id = rc.id
      and m.sender_id <> v_my_id
      and m.created_at > coalesce(
        (
          select mrs.last_read_at from public.message_read_state mrs
          where mrs.user_id = v_my_id and mrs.conversation_kind = 'conversation' and mrs.conversation_id = rc.id
        ),
        '-infinity'::timestamptz
      )
    group by rc.id
  )
  select 'channel'::text, cu.conversation_id, cu.unread_count, coalesce(cu.mentioned, false)
  from channel_unread cu
  union all
  select 'conversation'::text, dmu.conversation_id, dmu.unread_count, coalesce(dmu.mentioned, false)
  from conversation_unread dmu;
end;
$$;

revoke all on function public.get_message_read_summary() from public;
revoke execute on function public.get_message_read_summary() from anon;
grant execute on function public.get_message_read_summary() to authenticated;

commit;

-- ============================================================
-- Deliberately NOT done by this migration -- see this file's header for
-- full reasoning on each:
--   - No email/push notification wiring -- the existing `mentioned`
--     in-app/push event (migration 108) already covers alerting; this is
--     purely the new sidebar-level visual state (design doc §1).
--   - No read-receipts-per-message, no "who else has read this"
--     visibility -- a single per-user cursor per channel/DM only, matching
--     Slack's own real model (design doc §3).
--   - direct_messages.read_at (migration 094) is left exactly as-is,
--     untouched -- this table is additive, not a replacement (design
--     doc §3).
--   - Frontend: no frontend file is touched by this migration (kept
--     uncommitted, held for production confirmation per this task's own
--     deployment-ordering instruction).
-- ============================================================
