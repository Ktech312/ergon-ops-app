# External Guest Access to Created Channels — First Design (NOT IMPLEMENTED)

Status: **DESIGN ONLY. No production code, no migration.** Written from E's own direct answers,
2026-09-19 (verbatim decisions below, not inferred). This is a genuinely new kind of identity for this
app — distinct from a full employee (`workspace_members`) and distinct from an anonymous share-link
visitor (`public_share_tokens`, no persistent identity at all) — so it gets its own design pass before
any migration, the same discipline used for the Support/Engineering modules.

## 1. The problem, in E's own words

> "Example: New project and we are using an electrical subcon from a different company. We can invite
> them in to that channel, we can share daily updates, images files, drawings etc. But they would be
> limited to that room and the files in that room alone."

An outside person (a subcontractor, a client's own site contact, etc.) needs to participate in ONE
project's channel — post updates, upload photos/drawings, read what your own team posts — with zero
visibility into anything else in the company: no other projects, no Sales, no Marketing, no other
channel, nothing.

## 2. What already exists (do not re-build)

- **Channels** (migrations 094/101/104/105/112/113/162): `channels` table, `type` in
  (`section`/`project`/`client`/`group`). `section` channels ("Projects," "Sales," "Marketing," etc.)
  are the app's own default, auto-seeded, one-per-workspace channels. `project`/`client` channels
  anchor to one real project/client row. `group` channels are user-created, optionally `private`.
  `channel_members` already exists as a real per-row membership table, but today it is ONLY consulted
  for private `group` channels — `section`/`project`/`client` channels are visible to the whole
  workspace by default, `channel_members` is never checked for them (confirmed by direct read of every
  RLS policy on `channels`/`channel_messages`/`channel_canvas`/the `message-attachments` bucket).
- **`message-attachments` storage bucket** (migration 100/101/105/162) already keys channel file access
  off the same channel-visibility rule as messages — no separate design needed for "files in the room,"
  it already rides along with whatever gates the channel itself.
- **The proposal Q&A precedent** (migrations 149/150) proves this app can already support a real,
  two-way, written interaction from someone with no full account, gated to one entity, via a
  `security definer` RPC + bearer token — the closest existing precedent for "outsider participates,
  nothing else," but built for a one-shot Q&A thread, not a persistent named identity. E's answer below
  asks for something closer to a real, revocable, named identity (his own words: "just like you would
  get for Team or Google meeting") — so this design leans on the invite-link MECHANISM from that
  precedent (a bearer token that grants a specific, narrow capability) without reusing its anonymous,
  no-identity shape.

## 3. E's decisions, verbatim, 2026-09-19

1. **Identity**: "They will get their own username, they get sent an outside link that allows them a
   username, just like you would get for Team or Google meeting." — a guest is a real, named,
   persistent identity for the life of their access, not an anonymous token-only interaction. They pick
   (or are given) a name when they accept the invite link.
2. **What can be invited to what**: "employees can invite them to 'Created' rooms, not rooms created by
   the App by default... The Project 'Parking garage' can have internal people invited to it or
   external. But they can Never be invited to a channel, like 'Projects,' 'Sales,' or 'Marketing.'" — a
   guest may ONLY be invited into a `project`, `client`, or user-created `group` channel. A guest can
   NEVER be invited into a `section`-type channel, under any circumstance. This must be enforced at the
   data layer, not just hidden in the UI.
3. **Expiration**: "When invited you can set a time for them to expire, just like shared file in Google
   docs." — the inviter sets an expiration timestamp at invite time; access lapses automatically once
   passed.
4. **Manual revocation**: "Admins, PM's can remove them and their rights [at any time]." — independent
   of expiration, an admin or PM can revoke a guest's access immediately.
5. **No file restrictions**: "No file restrictions, any file they upload."
6. **File promotion**: "A Owner of that Chat group should be able to transfer it [an uploaded file] to a
   Project or other Divisions of the company." — a file the guest uploads into the room is NOT
   automatically part of the project's permanent record; an internal owner of that room can explicitly
   move/copy it into the project's real document store (or elsewhere in the company) when they want to
   keep it.

## 4. Proposed schema (illustrative — not a migration)

```sql
-- Confirm the next free migration number at execution time.

-- A guest is a real auth.users row (so they have a persistent, revocable
-- session across visits, unlike an anonymous share-link token) but is
-- NEVER given a workspace_members row -- that would make them a full
-- employee with broad company access, exactly what this feature must
-- not do. A guest's only access grant is this table.
create table channel_guests (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,          -- the name they set when accepting
  invited_by_email text not null,
  invited_at timestamptz not null default now(),
  expires_at timestamptz,               -- null = no expiration set
  revoked_at timestamptz,               -- manual revoke, independent of expiry
  revoked_by_email text,
  unique (channel_id, user_id)
);

-- The invite link itself, before the guest has an account -- mirrors
-- user_invites' own shape (migration 041) but is a DISTINCT table and
-- DISTINCT accept function, since accepting a channel-guest invite must
-- NEVER create a workspace_members row the way accept_invite() (migration
-- 181) does for a real employee invite.
create table channel_guest_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  channel_id uuid not null references channels(id) on delete cascade,
  invited_by_email text not null,
  suggested_expires_at timestamptz,      -- carried into channel_guests on accept
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz not null default now()
);

-- Enforced at creation time, not just in the UI: a guest invite (or a
-- guest row) can never target a section-type channel. A CHECK constraint
-- alone can't join to another table, so this needs a trigger (mirroring
-- this project's established guard-trigger pattern) that looks up
-- channels.type and rejects the insert outright if it's 'section'.
create or replace function guard_channel_guest_not_section_type()
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
-- (attached as a BEFORE INSERT trigger on both channel_guest_invites and channel_guests)
```

**RLS approach**: every existing RLS policy on `channels`/`channel_messages`/`channel_canvas`/the
`message-attachments` storage bucket gains one additional OR branch —
`exists (select 1 from channel_guests g where g.channel_id = <this row's channel> and g.user_id =
auth.uid() and g.revoked_at is null and (g.expires_at is null or g.expires_at > now()))` — alongside
the existing `is_workspace_member(...)` check, never replacing it. A guest's `auth.uid()` simply never
appears in `workspace_members` at all, so every OTHER table in the app (projects list, sales, inventory,
every other channel) stays exactly as closed to them as it is to a stranger today — the guest grant is
additive and narrow by construction, not a broader role that needs separately locking down.

**Guest-side app experience** (not a schema question, but load-bearing for the isolation guarantee):
the frontend needs a genuinely separate, minimal view for a guest session — not the normal app shell
with most things hidden, but a dedicated small UI showing only the room(s) they're a guest in. Silently
hiding nav items in the main app is not sufficient isolation on its own if any other component fetches
data by assumption rather than by explicit permission check — RLS is the real backstop, but the UX
should not even attempt to render the full app shell for a guest session.

**File promotion** (§3 item 6): a new action, available to whoever created the channel/room (or any
admin/PM — see open question below), that copies a `message-attachments` object into `project-documents`
(or wherever it's being "transferred" to) and creates the matching metadata row there — reusing the
existing upload/metadata-row pattern for the destination table, not inventing a new one. This is a
copy, not a move — the original room message/attachment stays exactly where it was for the room's own
history.

## 5. E's answers to round 2, verbatim, 2026-09-20

1. **Room owner (file-transfer rights)**: "Owner of the channel is the person who created it or a site
   Admin." — both the channel's creator AND any site admin can transfer a file out of the room, not
   just one or the other.
2. **Guest history visibility**: "Full history." — a guest sees the room's entire message history from
   before they joined, same as an employee joining any existing channel today.
3. **Notification behavior**: "They should be notified if their name is tagged in the message, there
   should be a general highlight of a channel if there is a new message in there, then once that
   channel is viewed it un-highlights" (referencing Slack's own unread-badge/@mention pattern).
   **This does not exist anywhere in this app's channel system today** (confirmed — `channels`/
   `channel_messages` have no read-state or mention-tracking of any kind). It's real, valuable, and not
   specific to guests — every employee would benefit from it too. Scoped as **Phase 2**, a separate
   follow-up after the core guest-access mechanism (§4/§6) ships, not a blocker for it — a guest
   checking the room manually is a reasonable v1, matching this project's own repeated pattern of
   shipping the security/access mechanism first and layering UX polish after (see migration 152's own
   staged alert-wiring history for precedent). Needs its own small design pass: a per-user
   `channel_message_reads` (or similar) table tracking last-read timestamp per channel, `@name` mention
   parsing on message send, and a badge/highlight in the channel list — not designed further here.

## 6. What remains genuinely open (not decided here, flagging rather than guessing)

- **Can one guest be invited to more than one channel over time** (e.g., the same subcontractor works
  two different projects for you)? The schema in §4 supports it naturally (one `channel_guests` row per
  channel, same `user_id` can have several) — flagging only because the invite/accept UX needs to
  decide whether accepting a second invite reuses their existing login or creates confusion.
- **What a guest sees on revoke/expiry**: their past messages/files stay in the room (matching Google
  Docs' own behavior — revoking someone doesn't delete their edits) — this is assumed, not confirmed.

## 7. Smallest useful first release

A PM/admin can invite an outside person (email + display name + optional expiration) to one specific
`project`/`client`/`group` channel via a link; that person sets up guest access via the link (no
password-based account needed, session-based like a share link, but persistent/named); they can read
and post messages and upload any file type in that one room; an admin/PM can revoke them at any time;
access lapses automatically past its expiration; a room admin/PM can copy an uploaded file into the
project's real document store. No cross-guest features (a guest inviting another guest), no
notification wiring, no email-based re-invite flow beyond the first link — those are later phases, not
part of this smallest release.
