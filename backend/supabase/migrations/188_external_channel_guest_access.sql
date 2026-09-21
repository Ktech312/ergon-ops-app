-- Migration 188: external guest access to a single created channel.
-- Implements PRODUCT_EXTERNAL_GUEST_CHANNELS_DESIGN.md end to end (schema,
-- guard trigger, RLS additions, RPCs) per E's own verbatim decisions
-- recorded there 2026-09-19/2026-09-20. One-line summary of the feature:
-- an internal PM/admin can invite an outside person (e.g. a subcontractor
-- from a different company) into ONE `project`/`client`/`group` channel,
-- with a real named identity, an optional access expiration, and instant
-- admin/PM revocation -- and RLS (not UI hiding) guarantees that guest can
-- never see anything else: no other channel, no section-type channel
-- ("Projects"/"Sales"/"Marketing"), no other table.
--
-- ============================================================
-- Why a channel guest is a real auth.users row but NEVER a
-- workspace_members row
-- ============================================================
-- Design doc §3 item 1, E verbatim: "They will get their own username,
-- they get sent an outside link that allows them a username, just like
-- you would get for Team or Google meeting." A guest needs a persistent,
-- revocable, named session across visits (unlike an anonymous
-- public_share_tokens visitor), so they get a real `auth.users` row --
-- but the one and only grant of access they ever hold is their
-- `channel_guests` row. They are deliberately NEVER inserted into
-- `workspace_members` -- that table is what makes someone a full
-- employee with broad, workspace-wide read access to every other table
-- in this schema (channels, projects, clients, sales, inventory, ...),
-- exactly the blast radius this feature exists to avoid. This migration
-- never writes to workspace_members, and its own test file (Section (c))
-- asserts this directly rather than merely by omission.
--
-- ============================================================
-- What can be invited to what (design doc §3 item 2, E verbatim)
-- ============================================================
-- "employees can invite them to 'Created' rooms, not rooms created by the
-- App by default ... The Project 'Parking garage' can have internal
-- people invited to it or external. But they can Never be invited to a
-- channel, like 'Projects,' 'Sales,' or 'Marketing.'" -- i.e. a guest may
-- be invited to a `project`, `client`, or `group` channel
-- (`public.channels`, `type` check re-confirmed directly from source:
-- backend/supabase/migrations/101_channels.sql:31 originally
-- `('section', 'project', 'client')`, widened to add `'group'` by
-- backend/supabase/migrations/105_group_channels.sql:24), but NEVER a
-- `section`-type channel (the app's own default, auto-seeded, one-per-
-- workspace channels -- 101_channels.sql:73-79). E's explicit requirement
-- ("Never," data-layer language) is enforced by a BEFORE INSERT trigger
-- on both new tables below, not merely hidden in the UI or checked only
-- inside an RPC.
--
-- ============================================================
-- Schema (adapted from the design doc's illustrative SQL, §4, to this
-- repo's real conventions)
-- ============================================================
-- `channel_guests` and `channel_guest_invites` are reproduced from the
-- design doc's illustrative SQL essentially verbatim, with one flagged
-- addition:
--
-- JUDGMENT CALL, flagged for E: `channel_guest_invites` gains an
-- `invited_email` column NOT present in the design doc's illustrative
-- schema (§4). The design doc's own §7 "smallest useful first release"
-- describes inviting by "email + display name + optional expiration,"
-- and this task's own RPC spec requires `create_channel_guest_invite` to
-- accept an `invited_email` parameter -- but email-SENDING is
-- deliberately kept out of this RPC (see below), so that email needs
-- somewhere to live: (a) so the pending-invite still has a record of who
-- it was intended for, useful for an internal "pending guest invites"
-- admin list, and (b) so the separate frontend/API email-sending step
-- (analogous to how `user_invites` itself is emailed -- confirmed no
-- email-sending code lives inside `accept_invite()`/`get_invite_by_token()`,
-- backend/supabase/migrations/041_user_invites.sql:48-123) has something
-- durable to read rather than needing the caller to re-supply it. The
-- bearer-token acceptance mechanism itself is unaffected: like
-- `user_invites`, anyone holding the raw token can accept regardless of
-- which email it lists (matching the design doc's own Google-Meet-link
-- framing, §3 item 1) -- `invited_email` is informational/display-only,
-- never checked by `accept_channel_guest_invite`.
--
-- Neither new table gets a `workspace_id` column -- per the design doc's
-- own RLS approach note (§4, "RLS approach"), containment flows entirely
-- through `channel_id` -> `channels.workspace_id`, the same "child
-- inherits ownership through its parent FK, no new column" convention
-- already used for `channel_messages`/`channel_canvas`/
-- `channel_message_reactions` (backend/supabase/migrations/
-- 162_phase3_messaging_channels_workspace_scoping.sql header).
--
-- ============================================================
-- Authorization rule for creating/viewing/revoking a guest invite or
-- guest row (design doc §5 item 1 + this task's own spec)
-- ============================================================
-- Design doc §5 item 1, E verbatim (answering the file-transfer "room
-- owner" question, reused here for invite/revoke rights per this task's
-- explicit instruction to apply the same principle): "Owner of the
-- channel is the person who created it or a site Admin." Design doc §3
-- item 4, E verbatim (revocation): "Admins, PM's can remove them and
-- their rights [at any time]."
--
-- JUDGMENT CALL, flagged for E: no existing "channel owner" authorization
-- gate was found anywhere in this schema to mirror (channels' own INSERT/
-- UPDATE policies, backend/supabase/migrations/
-- 162_phase3_messaging_channels_workspace_scoping.sql:280-287, are
-- "any active workspace member," not owner-restricted; channel deletion,
-- migration 112, is a bare soft-delete column with no RLS/RPC gate of its
-- own to mirror). Per this task's own explicit fallback instruction, the
-- authorization rule applied below is the same "admin OR per-workspace-
-- admin OR relevant role" additive-OR shape migration 185 established for
-- every other admin-gated action in this schema (per-workspace-admin
-- authorization,
-- backend/supabase/migrations/185_per_workspace_admin_authorization.sql):
--   is_app_admin(auth.uid())
--   or is_workspace_admin(<channel's workspace_id>)
--   or has_role('pm')
--   or <the channel's own created_by = auth.uid()>       -- "the person who created it," per §5 item 1
-- ANDed with is_active_workspace_member(<channel's workspace_id>) so only
-- a real, active employee of the OWNING company can ever manage a guest
-- invite -- this alone also guarantees "a guest can never invite another
-- guest" (design doc §6, defaulted to "no"): a guest never has a
-- workspace_members row at all, so is_active_workspace_member() is always
-- false for them, with no separate check needed.
--
-- A single SECURITY DEFINER helper, channel_guest_manage_authorized(),
-- encodes this rule once, reused by both new tables' RLS AND by the RPCs'
-- own internal checks below (defense in depth -- RLS is the real
-- backstop for any direct-table access, the RPCs re-check so their error
-- messages are clean rather than a bare RLS-denial 403).
--
-- ============================================================
-- The core isolation mechanism: additive OR branches on existing tables
-- ============================================================
-- Every existing RLS policy touched below is reproduced via
-- `drop policy if exists ...` then `create policy` with the exact same
-- name and shape as its current live source (each cited precisely,
-- re-confirmed by direct read of the actual current file immediately
-- before writing this, not from memory), plus exactly one additive
-- top-level `or <guest predicate>` branch -- never removing or replacing
-- any existing condition, matching this whole session's "add an OR,
-- never replace" discipline (migrations 162, 185, 187).
--
-- The guest predicate itself is a new SECURITY DEFINER helper,
-- is_active_channel_guest(check_channel_id), same shape as
-- is_workspace_member()/channel_owner_workspace_id()
-- (backend/supabase/migrations/115_workspaces_foundation.sql:136-147,
-- 162:127-140) -- SECURITY DEFINER is not optional decoration here: every
-- one of these additive branches lives inside another table's RLS
-- predicate, and (per this schema's own established pattern of using a
-- SECURITY DEFINER helper anywhere a policy needs to read a DIFFERENT
-- RLS-protected table -- channel_owner_workspace_id existing for exactly
-- this reason, 162's own Section 2 header) a plain inline
-- `exists (select 1 from public.channel_guests ...)` would itself be
-- subject to channel_guests' OWN RLS as evaluated for the calling
-- (guest) role, which could be fragile/order-dependent. A SECURITY
-- DEFINER function sidesteps that entirely and matches this schema's own
-- established idiom for this exact situation.
--
-- The five touched surfaces, each cited from its real, current (i.e.
-- post-162) shape, re-confirmed directly from source immediately before
-- writing this migration:
--   1. `channels` -- both SELECT policies ("workspace members read open
--      channels" and "...read private group channels",
--      162:261-278) gain the guest branch. INSERT/UPDATE (162:280-287)
--      do NOT -- a guest never creates/renames a channel.
--   2. `channel_messages` -- SELECT (162:294-307) and INSERT
--      (162:309-323) gain the guest branch -- a guest needs to read AND
--      post in their one room (design doc §1: "we can share daily
--      updates, images files, drawings etc").
--   3. `channel_canvas` -- SELECT only (162:345-350) gains the guest
--      branch.
--      JUDGMENT CALL, flagged for E: canvas is deliberately left
--      READ-ONLY for guests, not read-write. Re-read design doc §3/§4/§5
--      for this: E's own words describe a guest's contribution as
--      "daily updates, images files, drawings" -- i.e. messages and
--      file attachments -- and canvas is separately described (migration
--      104's own header) as "a persistent notes/scope doc pinned to the
--      channel," a shared team planning artifact, not a chat surface.
--      Nothing in either round of E's answers requests guest canvas
--      editing, and giving an outside party silent write access to a
--      structural team document by default (rather than opt-in) is the
--      more conservative, reviewable default. If E wants guest canvas
--      editing, it is a one-line additive change (mirror the same guest
--      branch onto channel_canvas's INSERT/UPDATE policies,
--      162:352-357).
--   4. `channel_message_reactions` -- SELECT (162:368-382) and INSERT
--      (162:384-399) gain the guest branch (resolved via a join to
--      channel_messages.channel_id, since this table itself has no
--      channel_id column) -- a guest reacting to a message in their own
--      room is message-adjacent, same posture as posting itself. The
--      DELETE-own-reaction policy (162:401-405, `using (user_id =
--      auth.uid())` only) needs no change -- exactly the same reasoning
--      162's own header already gives for why that policy was untouched
--      by workspace scoping.
--   5. `message-attachments` storage bucket -- the two channel-specific
--      object policies (162:413-445) gain the guest branch -- a guest
--      needs to read AND upload files in their one room (design doc §3
--      item 5, E verbatim: "No file restrictions, any file they upload").
--      The DM-participant message-attachments policies (migration 100)
--      are untouched -- unrelated surface.
--
-- Deliberately NOT touched, and why:
--   - `channel_members` -- guest access is entirely mediated by
--     `channel_guests`, never by `channel_members` (that table remains
--     purely an internal-employee private-group-membership list).
--   - `workspace_members`, `accept_invite()`, `user_invites`, or any
--     other employee-invite path -- untouched, per this task's explicit
--     instruction. This migration's own test file asserts a guest
--     accepting their invite produces NO workspace_members row.
--   - File promotion (design doc §4/§6, "a room owner can transfer an
--     uploaded file to the project's real document store") -- this
--     task's own "what to build" spec (RPC list) does not include a
--     file-promotion RPC, only the four listed below. Deliberately
--     scoped OUT of this migration; flagged for a follow-up, matching
--     this schema's own repeated pattern of shipping the access
--     mechanism first (see 162's header on notification wiring, and the
--     design doc's own §5 item 3 phasing of read-state/mentions as
--     "Phase 2, not a blocker").
--   - Frontend: no frontend file is touched by this migration. A guest
--     landing page needs, at minimum: (a) a call to
--     get_channel_guest_invite_by_token(token) (anon-callable) to render
--     the "you've been invited" page; (b) a client-side
--     supabase.auth.signUp() (or equivalent) call establishing the
--     guest's own real session -- see this migration's own header note
--     below on why accept_channel_guest_invite() assumes this already
--     happened, exactly like accept_invite() does today; (c) a call to
--     accept_channel_guest_invite(token, display_name) from that fresh
--     session; (d) a genuinely separate, minimal guest-only app shell
--     (design doc §4, "Guest-side app experience") -- not built here.
--
-- ============================================================
-- Auth-flow resolution for accept_channel_guest_invite (this task's own
-- flagged open question)
-- ============================================================
-- Researched directly from this app's real, live invite-acceptance flow
-- rather than inventing a new mechanism: `InviteLandingPage`
-- (src/main.tsx:27497-27559) calls `signUpWithPassword(invite.email,
-- password)` -- a CLIENT-SIDE Supabase Auth signup -- BEFORE ever calling
-- `acceptInvite(token, session.accessToken)`, which invokes
-- `accept_invite()` (backend/supabase/migrations/041_user_invites.sql:
-- 75-123) as that brand-new session's own `auth.uid()`. `accept_invite()`
-- itself is granted to `authenticated` only (041:123), never `anon`,
-- because it is only ever meant to be called by a caller who ALREADY has
-- a fresh session by the time it runs.
--
-- `accept_channel_guest_invite()` below matches this exact, already-
-- established pattern structurally (SECURITY DEFINER, `authenticated`-
-- only grant, acts on `auth.uid()` internally, never accepts a
-- caller-supplied user id) -- it does NOT create the `auth.users` row
-- itself. The minimal frontend glue this implies (not built in this
-- backend-only pass, called out explicitly per this task's own
-- instruction): a guest-invite landing page that calls
-- `get_channel_guest_invite_by_token()` (anon-safe) to render the invite,
-- then a client-side Supabase Auth signup call to actually create the
-- guest's account and session, then `accept_channel_guest_invite()` from
-- that fresh session.
--
-- Confirm 188 is still the next free migration number at execution time
-- (187 was the last one applied; 186 was drafted-but-not-yet-applied as
-- of this session's own start -- re-checked directly against
-- backend/supabase/migrations/ immediately before writing this file, and
-- 187 is the real highest number on disk). Not applied. Kept local for
-- E's review.

begin;

-- ============================================================
-- Section 1 -- Schema.
-- ============================================================

create table if not exists public.channel_guests (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) > 0),
  invited_by_email text not null,
  invited_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by_email text,
  unique (channel_id, user_id)
);

create index if not exists idx_channel_guests_channel on public.channel_guests(channel_id);
create index if not exists idx_channel_guests_user on public.channel_guests(user_id);

create table if not exists public.channel_guest_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  channel_id uuid not null references public.channels(id) on delete cascade,
  invited_by_email text not null,
  invited_email text,
  suggested_expires_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz not null default now()
);

create index if not exists idx_channel_guest_invites_channel on public.channel_guest_invites(channel_id);
create index if not exists idx_channel_guest_invites_status on public.channel_guest_invites(status);

alter table public.channel_guests enable row level security;
alter table public.channel_guest_invites enable row level security;

-- ============================================================
-- Section 2 -- Guard trigger: a guest invite or guest row can never
-- target a section-type channel. Matches this schema's established
-- guard-trigger hardening pattern (SECURITY DEFINER, set search_path='',
-- revoke all from public -- see guard_channel_workspace_id_mutation(),
-- 162:197-228, and guard_conversation_workspace_id_mutation(), migration
-- 187:199-238) and reproduces the design doc's own illustrative function
-- (§4) verbatim, only table-qualified.
-- ============================================================

create or replace function public.guard_channel_guest_not_section_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
begin
  select type into v_type from public.channels where id = new.channel_id;
  if v_type = 'section' then
    raise exception 'channel guests can never be invited to a section-type channel';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_channel_guest_not_section_type() from public;

drop trigger if exists channel_guests_guard_not_section on public.channel_guests;
create trigger channel_guests_guard_not_section
  before insert on public.channel_guests
  for each row execute function public.guard_channel_guest_not_section_type();

drop trigger if exists channel_guest_invites_guard_not_section on public.channel_guest_invites;
create trigger channel_guest_invites_guard_not_section
  before insert on public.channel_guest_invites
  for each row execute function public.guard_channel_guest_not_section_type();

-- ============================================================
-- Section 3 -- Helper functions.
-- ============================================================

-- Reused by RLS on the two new tables AND by the RPCs' own internal
-- authorization checks below. See this file's header for the full
-- rationale of this exact rule.
create or replace function public.channel_guest_manage_authorized(check_channel_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.channels c
    where c.id = check_channel_id
      and public.is_active_workspace_member(c.workspace_id)
      and (
        public.is_app_admin(auth.uid())
        or public.is_workspace_admin(c.workspace_id)
        or public.has_role('pm')
        or c.created_by = auth.uid()
      )
  );
$$;

-- Reused as the additive OR branch on every existing table's RLS below.
-- SECURITY DEFINER so it is never itself subject to channel_guests' own
-- RLS when evaluated from inside another table's policy -- see this
-- file's header for why that matters here specifically.
create or replace function public.is_active_channel_guest(check_channel_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.channel_guests g
    where g.channel_id = check_channel_id
      and g.user_id = auth.uid()
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
  );
$$;

revoke all on function public.channel_guest_manage_authorized(uuid) from public;
revoke all on function public.is_active_channel_guest(uuid) from public;
revoke execute on function public.channel_guest_manage_authorized(uuid) from anon;
revoke execute on function public.is_active_channel_guest(uuid) from anon;
grant execute on function public.channel_guest_manage_authorized(uuid) to authenticated;
grant execute on function public.is_active_channel_guest(uuid) to authenticated;

-- ============================================================
-- Section 4 -- RLS on the two new tables.
-- ============================================================

drop policy if exists "authorized inviters manage channel_guest_invites" on public.channel_guest_invites;
create policy "authorized inviters manage channel_guest_invites"
  on public.channel_guest_invites for all to authenticated
  using (public.channel_guest_manage_authorized(channel_id))
  with check (public.channel_guest_manage_authorized(channel_id));

drop policy if exists "authorized managers and self read channel_guests" on public.channel_guests;
create policy "authorized managers and self read channel_guests"
  on public.channel_guests for select to authenticated
  using (public.channel_guest_manage_authorized(channel_id) or user_id = auth.uid());

drop policy if exists "authorized managers write channel_guests" on public.channel_guests;
create policy "authorized managers write channel_guests"
  on public.channel_guests for insert to authenticated
  with check (public.channel_guest_manage_authorized(channel_id));

drop policy if exists "authorized managers revoke channel_guests" on public.channel_guests;
create policy "authorized managers revoke channel_guests"
  on public.channel_guests for update to authenticated
  using (public.channel_guest_manage_authorized(channel_id))
  with check (public.channel_guest_manage_authorized(channel_id));

-- ============================================================
-- Section 5 -- channels: additive guest OR branch on both SELECT
-- policies (current live shape re-confirmed at
-- 162_phase3_messaging_channels_workspace_scoping.sql:261-278).
-- ============================================================

drop policy if exists "workspace members read open channels" on public.channels;
create policy "workspace members read open channels" on public.channels for select to authenticated
  using (
    (
      public.is_workspace_member(workspace_id)
      and (type in ('section', 'project', 'client') or (type = 'group' and private = false))
    )
    or public.is_active_channel_guest(channels.id)
  );

drop policy if exists "workspace members read private group channels" on public.channels;
create policy "workspace members read private group channels" on public.channels for select to authenticated
  using (
    (
      public.is_workspace_member(workspace_id)
      and type = 'group'
      and private = true
      and (
        created_by = auth.uid()
        or exists (select 1 from public.channel_members m where m.channel_id = channels.id and m.user_id = auth.uid())
      )
    )
    or public.is_active_channel_guest(channels.id)
  );

-- ============================================================
-- Section 6 -- channel_messages: additive guest OR branch on SELECT
-- (162:294-307) and INSERT (162:309-323).
-- ============================================================

drop policy if exists "workspace members read channel_messages" on public.channel_messages;
create policy "workspace members read channel_messages" on public.channel_messages for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_messages.channel_id
        and public.is_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
        )
    )
    or public.is_active_channel_guest(channel_messages.channel_id)
  );

drop policy if exists "workspace members send channel_messages" on public.channel_messages;
create policy "workspace members send channel_messages" on public.channel_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      exists (
        select 1 from public.channels c
        where c.id = channel_messages.channel_id
          and public.is_active_workspace_member(c.workspace_id)
          and (
            c.type in ('section', 'project', 'client')
            or (c.type = 'group' and c.private = false)
            or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
          )
      )
      or public.is_active_channel_guest(channel_messages.channel_id)
    )
  );

-- ============================================================
-- Section 7 -- channel_canvas: additive guest OR branch on SELECT only
-- (162:349-350). INSERT/UPDATE (162:352-357) are deliberately untouched
-- -- see this file's header, "canvas is read-only for guests."
-- ============================================================

drop policy if exists "workspace members read channel_canvas" on public.channel_canvas;
create policy "workspace members read channel_canvas" on public.channel_canvas for select to authenticated
  using (
    public.is_workspace_member(public.channel_owner_workspace_id(channel_id))
    or public.is_active_channel_guest(channel_id)
  );

-- ============================================================
-- Section 8 -- channel_message_reactions: additive guest OR branch on
-- SELECT (162:368-382) and INSERT (162:384-399), resolved via a join to
-- channel_messages.channel_id. DELETE-own-reaction (162:401-405) is
-- untouched, matching 162's own precedent for that exact policy.
-- ============================================================

drop policy if exists "workspace members read channel_message_reactions" on public.channel_message_reactions;
create policy "workspace members read channel_message_reactions" on public.channel_message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.channel_messages m
      join public.channels c on c.id = m.channel_id
      where m.id = channel_message_reactions.message_id
        and public.is_workspace_member(c.workspace_id)
        and (
          c.type in ('section', 'project', 'client')
          or (c.type = 'group' and c.private = false)
          or exists (select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = auth.uid())
        )
    )
    or exists (
      select 1 from public.channel_messages m
      where m.id = channel_message_reactions.message_id
        and public.is_active_channel_guest(m.channel_id)
    )
  );

drop policy if exists "workspace members add own channel_message_reactions" on public.channel_message_reactions;
create policy "workspace members add own channel_message_reactions" on public.channel_message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      exists (
        select 1 from public.channel_messages m
        join public.channels c on c.id = m.channel_id
        where m.id = channel_message_reactions.message_id
          and public.is_active_workspace_member(c.workspace_id)
          and (
            c.type in ('section', 'project', 'client')
            or (c.type = 'group' and c.private = false)
            or exists (select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = auth.uid())
          )
      )
      or exists (
        select 1 from public.channel_messages m
        where m.id = channel_message_reactions.message_id
          and public.is_active_channel_guest(m.channel_id)
      )
    )
  );

-- ============================================================
-- Section 9 -- message-attachments storage bucket: additive guest OR
-- branch on the two channel-specific object policies (162:413-445). The
-- DM-participant policies (migration 100) are untouched.
-- ============================================================

drop policy if exists "workspace members read channel message-attachments" on storage.objects;
create policy "workspace members read channel message-attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and (
      exists (
        select 1 from public.channels c
        where storage.objects.name like c.id::text || '/%'
          and public.is_workspace_member(c.workspace_id)
          and (
            c.type in ('section', 'project', 'client')
            or (c.type = 'group' and c.private = false)
            or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
          )
      )
      or exists (
        select 1 from public.channels c
        where storage.objects.name like c.id::text || '/%'
          and public.is_active_channel_guest(c.id)
      )
    )
  );

drop policy if exists "workspace members write channel message-attachments" on storage.objects;
create policy "workspace members write channel message-attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and (
      exists (
        select 1 from public.channels c
        where storage.objects.name like c.id::text || '/%'
          and public.is_active_workspace_member(c.workspace_id)
          and (
            c.type in ('section', 'project', 'client')
            or (c.type = 'group' and c.private = false)
            or exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
          )
      )
      or exists (
        select 1 from public.channels c
        where storage.objects.name like c.id::text || '/%'
          and public.is_active_channel_guest(c.id)
      )
    )
  );

-- ============================================================
-- Section 10 -- RPCs.
-- ============================================================

-- 10a. create_channel_guest_invite: the inviter's action. Does NOT send
-- an email itself -- mirrors user_invites' own separation of concerns
-- (041_user_invites.sql has no email-sending code; that is a separate
-- frontend/API-route concern). invited_email is returned so the caller
-- can hand it straight to that separate step.
create or replace function public.create_channel_guest_invite(
  p_channel_id uuid,
  p_invited_email text,
  p_suggested_expires_at timestamptz default null
)
returns table (
  outcome text,
  invite_id uuid,
  token text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_channel_type text;
  v_new_id uuid;
  v_new_token text;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to create a channel guest invite';
  end if;

  select type into v_channel_type from public.channels where id = p_channel_id;

  if v_channel_type is null then
    return query select 'channel_not_found'::text, null::uuid, null::text;
    return;
  end if;

  if not public.channel_guest_manage_authorized(p_channel_id) then
    raise exception 'Only the channel creator, an admin, or a PM at the owning workspace may invite a guest to this channel.' using errcode = 'EC001';
  end if;

  -- Defense in depth: the BEFORE INSERT trigger below is the real
  -- enforcement of "never a section-type channel," this is just a clean
  -- pre-check so the caller gets a structured outcome instead of a raw
  -- trigger exception.
  if v_channel_type = 'section' then
    return query select 'section_channel_forbidden'::text, null::uuid, null::text;
    return;
  end if;

  v_actor_email := (select email from auth.users where id = v_actor_id);

  insert into public.channel_guest_invites (channel_id, invited_by_email, invited_email, suggested_expires_at)
  values (p_channel_id, v_actor_email, nullif(btrim(coalesce(p_invited_email, '')), ''), p_suggested_expires_at)
  returning channel_guest_invites.id, channel_guest_invites.token into v_new_id, v_new_token;

  return query select 'created'::text, v_new_id, v_new_token;
end;
$$;

revoke all on function public.create_channel_guest_invite(uuid, text, timestamptz) from public;
revoke execute on function public.create_channel_guest_invite(uuid, text, timestamptz) from anon;
grant execute on function public.create_channel_guest_invite(uuid, text, timestamptz) to authenticated;

-- 10b. get_channel_guest_invite_by_token: anon-safe lookup for the
-- pre-account "accept this invite" landing page. Mirrors
-- get_invite_by_token's own sanitized-projection shape
-- (041_user_invites.sql:48-66) -- never exposes the raw table (which
-- would leak the token itself and every invited email to anyone who
-- could query channel_guest_invites directly).
create or replace function public.get_channel_guest_invite_by_token(p_token text)
returns table (
  channel_id uuid,
  channel_name text,
  workspace_name text,
  invited_by_email text,
  invited_email text,
  suggested_expires_at timestamptz,
  status text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    c.id,
    c.name,
    w.name,
    i.invited_by_email,
    i.invited_email,
    i.suggested_expires_at,
    case
      when i.status = 'pending' and i.suggested_expires_at is not null and i.suggested_expires_at <= now()
        then 'expired'
      else i.status
    end
  from public.channel_guest_invites i
  join public.channels c on c.id = i.channel_id
  join public.workspaces w on w.id = c.workspace_id
  where i.token = p_token;
$$;

revoke all on function public.get_channel_guest_invite_by_token(text) from public;
grant execute on function public.get_channel_guest_invite_by_token(text) to anon, authenticated;

-- 10c. accept_channel_guest_invite: called by the guest's own
-- freshly-created session, mirroring accept_invite()'s exact posture
-- (041_user_invites.sql:75-123 and src/main.tsx:27526-27559) -- the
-- client-side Supabase Auth signup happens BEFORE this is ever called;
-- this function never creates an auth.users row itself and never touches
-- workspace_members.
create or replace function public.accept_channel_guest_invite(
  p_token text,
  p_display_name text
)
returns table (
  outcome text,
  guest_channel_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  invite_row public.channel_guest_invites;
  v_channel_type text;
  v_trimmed_name text;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to accept a channel guest invite';
  end if;

  v_trimmed_name := btrim(coalesce(p_display_name, ''));
  if char_length(v_trimmed_name) = 0 then
    return query select 'invalid_display_name'::text, null::uuid;
    return;
  end if;

  select * into invite_row
  from public.channel_guest_invites
  where token = p_token
    and status = 'pending'
    and (suggested_expires_at is null or suggested_expires_at > now())
  for update;

  if invite_row.id is null then
    return query select 'not_found_or_expired'::text, null::uuid;
    return;
  end if;

  select public.channels.type into v_channel_type from public.channels where public.channels.id = invite_row.channel_id;

  -- Defense in depth -- the BEFORE INSERT trigger on channel_guests is
  -- the real enforcement.
  if v_channel_type = 'section' then
    return query select 'section_channel_forbidden'::text, null::uuid;
    return;
  end if;

  insert into public.channel_guests (channel_id, user_id, display_name, invited_by_email, expires_at)
  values (invite_row.channel_id, v_actor_id, v_trimmed_name, invite_row.invited_by_email, invite_row.suggested_expires_at)
  on conflict (channel_id, user_id) do update
    set display_name = excluded.display_name,
        revoked_at = null,
        revoked_by_email = null,
        expires_at = excluded.expires_at;

  update public.channel_guest_invites
  set status = 'accepted'
  where id = invite_row.id;

  return query select 'accepted'::text, invite_row.channel_id;
end;
$$;

revoke all on function public.accept_channel_guest_invite(text, text) from public;
revoke execute on function public.accept_channel_guest_invite(text, text) from anon;
grant execute on function public.accept_channel_guest_invite(text, text) to authenticated;

-- 10d. revoke_channel_guest: instant admin/PM/channel-creator revocation,
-- independent of expiration (design doc §3 item 4).
create or replace function public.revoke_channel_guest(p_channel_guest_id uuid)
returns table (
  outcome text,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_channel_id uuid;
  v_revoked_at timestamptz;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to revoke a channel guest';
  end if;

  select channel_id into v_channel_id from public.channel_guests where id = p_channel_guest_id;

  if v_channel_id is null then
    return query select 'not_found'::text, null::timestamptz;
    return;
  end if;

  if not public.channel_guest_manage_authorized(v_channel_id) then
    raise exception 'Only the channel creator, an admin, or a PM at the owning workspace may revoke this channel guest.' using errcode = 'EC001';
  end if;

  v_actor_email := (select email from auth.users where id = v_actor_id);

  update public.channel_guests
  set revoked_at = now(), revoked_by_email = v_actor_email
  where channel_guests.id = p_channel_guest_id
    and channel_guests.revoked_at is null
  returning channel_guests.revoked_at into v_revoked_at;

  if v_revoked_at is null then
    return query select 'already_revoked'::text, null::timestamptz;
    return;
  end if;

  return query select 'revoked'::text, v_revoked_at;
end;
$$;

revoke all on function public.revoke_channel_guest(uuid) from public;
revoke execute on function public.revoke_channel_guest(uuid) from anon;
grant execute on function public.revoke_channel_guest(uuid) to authenticated;

commit;

-- ============================================================
-- Deliberately NOT done by this migration -- see this file's header for
-- full reasoning on each:
--   - File promotion (design doc §4/§6) -- out of this task's own RPC
--     spec, tracked as a follow-up.
--   - Guest canvas write access -- read-only by judgment call, flagged
--     for E's review.
--   - Any frontend change -- guest invite UI, guest accept landing page,
--     and the separate minimal guest-only app shell are all a distinct,
--     larger follow-up.
--   - Read-state/@mention notification wiring (design doc §5 item 3) --
--     explicitly scoped as its own future Phase 2 in the design doc.
-- ============================================================
