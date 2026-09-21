-- Migration 189: narrowly-scoped sender-name resolution for a channel
-- guest (follow-up to migration 188, external channel guest access).
--
-- ============================================================
-- The gap this closes
-- ============================================================
-- `GuestChannelShell` (src/main.tsx, built on top of migration 188 in
-- commit 9cd9faf) reuses `ChannelDiscussion`'s own message-thread
-- rendering, whose `senderNameFor` resolves a sender's display name via
-- `app_known_users` (sender_id -> email) then `team_members` (email ->
-- full_name), exactly like the normal employee-facing app. Both of those
-- tables require workspace membership to read (migration 188's RLS
-- additions never touched either one -- confirmed by direct re-read of
-- their current policies: `app_known_users`, migration 187's own
-- rewritten "self or admin or shares a workspace" policy; `team_members`,
-- migration 175's "workspace members read team_members" policy -- neither
-- has a channel-guest OR branch), and a guest correctly has no
-- `workspace_members` row at all (migration 188's entire design). So
-- today, every OTHER person's message in a guest's one channel renders as
-- "Unknown user" to that guest -- a real usability gap for a chat-style
-- feature (not knowing who you're talking to defeats the point), even
-- though it is not a security issue: the guest simply cannot resolve
-- other people's identities client-side, they just see an unattributed
-- message.
--
-- ============================================================
-- Why this is a new, narrowly-scoped RPC and not a wider grant
-- ============================================================
-- The fix must stay narrowly scoped -- widening a guest's read access to
-- `app_known_users`/`team_members` themselves would leak the entire
-- company directory, exactly the blast radius migration 188 exists to
-- prevent (see 188's own header, "never a workspace_members row"). So
-- this migration adds exactly one new SECURITY DEFINER RPC,
-- `get_channel_message_sender_names(p_channel_id)`, that resolves ONLY
-- the display names of senders of messages that actually exist in the
-- ONE channel the caller is authorized to see -- never the full
-- directory, never any other channel.
--
-- Authorization mirrors `channel_messages`' own real, current SELECT
-- policy ("workspace members read channel_messages",
-- 188_external_channel_guest_access.sql:456-469, itself an additive
-- OR-branch on top of 162's original) exactly, re-derived here rather
-- than re-used as a table policy since this is a function, not a table
-- read: EITHER a normal workspace member with the same real read access
-- to this channel that policy grants (workspace member AND (open
-- section/project/client channel, OR a non-private group channel, OR an
-- explicit `channel_members` row for a private group)), OR
-- `is_active_channel_guest(p_channel_id)` (migration 188's own helper,
-- reused verbatim -- this is exactly the predicate that already governs
-- whether this same guest can read the channel's messages at all, so
-- reusing it here keeps this RPC's authorization boundary identical to
-- the boundary already enforced on the underlying data).
--
-- Deliberately returns an EMPTY result set (not a raised exception) for
-- an unauthorized caller/channel, matching the safe-empty posture RLS
-- itself already gives this same caller on `public.channels`/
-- `public.channel_messages` directly (an unauthorized `select` against
-- either returns zero rows, not an error) -- this also avoids letting the
-- RPC's own error behavior become an oracle for "does this channel_id
-- exist," which the direct-table read never was either.
--
-- ============================================================
-- Display-name preference order -- mirrored from senderNameFor's real,
-- current logic, not invented fresh
-- ============================================================
-- Read directly from source before writing this (src/main.tsx):
--   const emailByUserId = new Map(knownUsers.map((user) => [user.userId, user.email]));
--   function senderNameFor(senderId: string) {
--     const email = emailByUserId.get(senderId);
--     return email ? teamDisplayName(email, teamMembers) : "Unknown user";
--   }
-- and `teamDisplayName` (src/main.tsx:15499-15506):
--   function teamDisplayName(email, teamMembers) {
--     const member = teamMembers.find((entry) => entry.email && entry.email.toLowerCase() === email.toLowerCase());
--     const name = member?.fullName?.trim();
--     if (!name) return email.split("@")[0] || email;
--     return member?.roleTitle?.trim() ? `${name} ${member.roleTitle.trim()}` : name;
--   }
-- i.e. the REAL preference order an employee viewer already sees is:
-- (1) `app_known_users.email` resolves the sender_id at all -- if not,
--     "Unknown user"; (2) `team_members.full_name` for the matching email
--     (case-insensitive), plus a trailing `role_title` if one is set;
--     (3) if no team_members match (or full_name is blank), the LOCAL
--     PART of the email (before the `@`), not the full email address.
-- This function reproduces that exact order server-side, restricted to
-- `team_members` rows in the channel's OWN workspace (teamMembers as
-- passed into ChannelDiscussion is already workspace-scoped in the
-- normal app; migration 175 also means `team_members.email` is now only
-- unique per-workspace, not globally, so this restriction is required
-- for correctness, not just parity). A sender with no `app_known_users`
-- row at all is simply omitted from the result (same as today's
-- "Unknown user" outcome for that one sender) rather than inventing a
-- fourth fallback layer (e.g. `auth.users.email`) the real client logic
-- doesn't have.
--
-- Confirm 189 is still the next free migration number at execution time
-- (188 was the last one applied; re-checked directly against
-- backend/supabase/migrations/ immediately before writing this file, and
-- 188 is the real highest number on disk). Not applied. Kept local for
-- E's review.

begin;

create or replace function public.get_channel_message_sender_names(p_channel_id uuid)
returns table (
  user_id uuid,
  display_name text
)
language sql
security definer
stable
set search_path = ''
as $$
  with authorized_channel as (
    select c.id, c.workspace_id
    from public.channels c
    where c.id = p_channel_id
      and (
        (
          public.is_workspace_member(c.workspace_id)
          and (
            c.type in ('section', 'project', 'client')
            or (c.type = 'group' and c.private = false)
            or exists (
              select 1 from public.channel_members m
              where m.channel_id = c.id and m.user_id = auth.uid()
            )
          )
        )
        or public.is_active_channel_guest(c.id)
      )
  )
  select distinct on (m.sender_id)
    m.sender_id,
    coalesce(
      nullif(
        btrim(tm.full_name) || case
          when tm.role_title is not null and btrim(tm.role_title) <> '' then ' ' || btrim(tm.role_title)
          else ''
        end,
        ''
      ),
      nullif(split_part(au.email, '@', 1), ''),
      au.email
    ) as display_name
  from public.channel_messages m
  join authorized_channel ac on ac.id = m.channel_id
  join public.app_known_users au on au.user_id = m.sender_id
  left join public.team_members tm
    on tm.workspace_id = ac.workspace_id
    and lower(tm.email) = lower(au.email)
  where m.channel_id = p_channel_id
  order by m.sender_id;
$$;

revoke all on function public.get_channel_message_sender_names(uuid) from public;
revoke execute on function public.get_channel_message_sender_names(uuid) from anon;
grant execute on function public.get_channel_message_sender_names(uuid) to authenticated;

commit;
