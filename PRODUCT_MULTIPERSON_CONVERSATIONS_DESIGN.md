# Multi-person direct conversations — design (DRAFT, not yet approved or sent to E)

Status: **design + migration drafted, 2026-09-23. Not sent to E. One decision below genuinely needs
E before this ships.** Written in response to E's own long-standing ask (recorded in migration 162's
header, 2026-09-17: "E also asked for direct_messages/conversations to support more than two
participants, Slack/Teams-style... a real, separate feature... tracked as a new item") and this
session's explicit instruction to do the design/source pass now.

## 0. A real overlap this design must address first

This app already has Slack-style **group channels** (migration 105, `channels.type = 'group'`):
private by default, a "New Channel" button (name + a checkbox list of everyone known to Ergon),
unlockable, Add People at any time, its own Discussion/Tasks/Files/Canvas tabs. Functionally this
already covers most of what "group DM" means in Slack/Teams.

What it does **not** cover, and what a literal reading of "multi-person direct conversations" asks
for: an **unnamed, ad-hoc thread** started the same way a 1:1 DM starts today — pick 2+ people from
the existing People Picker, no channel name, no "New Channel" ceremony, appears in the DM list
(sorted by `last_message_at`) rather than the Channels list. That is what this design builds:
`conversations` gains real N-person membership, `direct_messages` stays exactly as-is, and starting
a DM with 2+ people uses the same picker and the same `MessageThread` rendering already used for
every 1:1 DM today.

**Decision that needs E (flagged per this session's own instruction, not guessed):** is an unnamed
ad-hoc group DM actually wanted as a *separate* surface from the existing named group-channel
feature, or would better discoverability of "New Channel" (e.g. a friendlier "start a group" entry
point from the same People Picker used for 1:1 DMs) satisfy the same need with zero new schema? The
design and migration below are written so they can ship either way — nothing here is wasted if E
prefers the second answer, since `conversation_members` is also the correct fix for the parts of this
schema (read-state and workspace containment) that were already written generically enough to expect
this. But the frontend entry point (a real "New Direct Message" flow that accepts 2+ recipients)
should not be built until this is answered, to avoid shipping a UI surface that duplicates "New
Channel" and confuses which one to use for what.

## 1. Current shape (fixed two-participant, confirmed from source before designing)

- `conversations` (migration 094): `participant_a_id`/`participant_b_id` (both `not null`,
  `check (participant_a_id < participant_b_id)`, `unique (participant_a_id, participant_b_id)`) —
  canonical ordering is how `getOrCreateConversation()` (`persistence.ts:2261`) dedupes a 1:1 thread
  regardless of who starts it, via a PostgREST `on_conflict=participant_a_id,participant_b_id` upsert.
- `direct_messages` (migration 094): plain `conversation_id`/`sender_id`/`body`, no participant
  concept of its own — inherits containment through `conversation_id`.
- `conversations.workspace_id` (migration 187): resolved at creation by a trigger that requires
  *both* participants share an active workspace, stamped once, immutable after. Every RLS
  policy/RPC predicate that scopes a conversation or its messages is the same shape, repeated 11
  times across 4 migrations (094, 113, 187, 190, 191): `participant_a_id = X or participant_b_id = X`.
- `message_read_state` (migration 191) is **already** a generic per-`(user_id, conversation_kind,
  conversation_id)` table covering both `'channel'` and `'conversation'` kinds — **this table needs
  zero changes**. It was already built to answer "is this specific user caught up on this specific
  thread," which is exactly the question an N-person thread asks too; migration 191 just never had a
  reason to exercise the N>2 case until now.
- Frontend: `Conversation` type (`persistence.ts:2157`) carries `participantAId`/`participantBId`
  directly (no membership list); `loadConversations()` filters client-side via
  `or=(participant_a_id.eq.X,participant_b_id.eq.X)`; the DM list's display name is derived by
  looking up "the other participant" — assumes exactly one.

## 2. Design: additive, not a rewrite

Same philosophy this schema already uses everywhere widening containment (e.g. migration 185's
admin-gate ORs, migration 187 itself): **add a membership table, OR it into every existing predicate,
change nothing about how an existing 1:1 conversation is created, stored, or queried.**

- **New table `conversation_members`** (`backend/supabase/migrations/203_multiperson_direct_conversations.sql`),
  identical shape to `channel_members` (migration 105) — `conversation_id`, `user_id`, `added_at`,
  primary key `(conversation_id, user_id)`.
- **`conversations` gains `is_group boolean not null default false` and `title text` (nullable)** —
  `title` is only meaningful (and only shown) for `is_group = true`; a 1:1 conversation keeps deriving
  its display name client-side from the other participant, exactly as today.
- **Existing 1:1 conversations are completely untouched**: `participant_a_id`/`participant_b_id` stay
  `not null` on every row created before this migration and every future 1:1 conversation —
  `getOrCreateConversation()` needs zero changes, the canonical-pair upsert trick keeps working
  exactly as-is. A one-time backfill inserts two `conversation_members` rows per existing 1:1
  conversation (from its `participant_a_id`/`participant_b_id`), so read-state and any future
  membership-based query work uniformly across old and new rows without a special case.
- **A new group conversation** (`is_group = true`) leaves `participant_a_id`/`participant_b_id`
  **null** (the two columns become nullable) and expresses membership entirely through
  `conversation_members` — 3 or more rows, no upper bound imposed by the schema (a sane UI cap, e.g.
  20, is a frontend concern, not a migration concern).
- **Every one of the 11 existing `participant_a_id = X or participant_b_id = X` predicates gets one
  more OR'd branch**: `or exists (select 1 from conversation_members cm where cm.conversation_id = c.id
  and cm.user_id = X)`. Additive only — an existing 1:1 conversation's access check still passes
  through the original two columns unchanged; nothing about who could already read/write a 1:1
  thread changes.
- **Workspace containment for a group**: `guard_conversation_workspace_id_mutation()` (migration 187)
  currently intersects *two* participants' active workspaces. For a group conversation, there's no
  fixed "other participant" to intersect against at INSERT time (membership is added afterward, one
  row at a time, same as `channel_members`) — so a new group conversation instead stamps
  `workspace_id` from the **creator's own** active workspace (`resolve_caller_workspace_id()`,
  already used everywhere else in this schema for exactly this "no second anchor" situation), and a
  new `guard_conversation_member_workspace_id()` trigger on `conversation_members` INSERT rejects
  adding anyone who isn't an active member of that same workspace — mirrors how `channel_members`
  implicitly relies on `channels.workspace_id` (migration 162) plus the UI's own People Picker only
  ever listing same-workspace people; made an explicit, server-enforced check here since a group DM
  has no existing equivalent gate to inherit.
- **`direct_messages` needs zero schema changes** — containment already flows through
  `conversation_id`, and a group conversation's messages are exactly as contained as a 1:1's once the
  RLS predicate above is in place.
- **`direct_message_reactions` (migration 113)** needs the same one-line OR addition as
  `direct_messages` itself, nothing else.
- **Attachment forwarding (migration 190)** and **read-state (migration 191)**: both already resolve
  "am I a participant" via the same `participant_a_id/participant_b_id` EXISTS shape inside a
  `conversations` subquery — same one-line OR addition, no structural change. Read-state itself
  (`message_read_state`) needs literally nothing, as noted above.

## 3. Frontend compatibility plan (not built this pass — design + schema only, per the task's own scope)

- `Conversation` type gains `isGroup: boolean`, `title: string | null`, and a new
  `participantIds: string[]` populated from `conversation_members` (for a 1:1 row, this is just
  `[participantAId, participantBId]` — computed client-side, no extra request) — `participantAId`/
  `participantBId` stay on the type as `string | null` (only ever set for 1:1 rows) rather than being
  removed, so every existing call site that reads them for a 1:1 conversation keeps compiling
  unchanged.
- `loadConversations()` changes from the current `or=(participant_a_id.eq.X,participant_b_id.eq.X)`
  client-side filter to a plain `select=*` (RLS alone scopes the rows now, same pattern
  `loadChannels()` already uses) plus one more request loading this user's own `conversation_members`
  rows to know which group conversations they're in — or, more simply, a single RPC
  (`list_my_conversations()`) that already joins and returns the combined, correctly-scoped set in one
  round trip, avoiding the two-request shape. Worth deciding at implementation time, not a schema
  question.
- DM list display name: `isGroup ? (title || "Group (" + memberCount + ")") : <existing other-participant lookup, unchanged>`.
- Starting a group DM: reuse the exact same People Picker component `getOrCreateConversation()`'s
  call site already uses for 1:1s, allow selecting 2+ people instead of exactly 1, call a new
  `createGroupConversation(memberUserIds, title?)` RPC instead of `getOrCreateConversation()` once 2+
  are selected. No new picker UI needed.
- `MessageThread` (already the single shared component for DM threads and channel messages, per
  `HANDOFF.md`'s own architecture note) needs no changes — it already renders sender name/avatar per
  message, which is all a group thread needs on top of a 1:1 thread visually.

## 4. Tests (drafted, not run)

`backend/supabase/migration_203_multiperson_direct_conversations_tests.sql` — canonical isolation
test, sections: (a) existing 1:1 conversation creation/read/write is byte-for-byte unaffected
(regression guard — the whole point of the additive design); (b) a 3-person group conversation can be
created by a workspace member, all 3 members can read/send, a 4th non-member cannot; (c) a
cross-workspace add attempt to `conversation_members` is rejected; (d) `message_read_state` correctly
tracks per-person unread across all 3 group members independently (proving migration 191 really does
need zero changes, not just asserting it by inspection); (e) reactions/attachments on a group
message follow the same membership check.

## 5. What this migration deliberately does not do

- No group size cap enforced server-side (frontend concern).
- No "leave group" / remove-member-by-non-admin semantics designed yet — `channel_members` has no
  precedent for this either (any workspace member can currently add/remove any other member of a
  group channel, migration 194 only gated this for *private* group channels specifically) — worth
  deciding alongside whichever UI ships, not blocking the schema.
- No change to 1:1 conversations' cross-workspace-by-design exception (migration 187 already made DMs
  workspace-scoped; this design doesn't reopen that).
