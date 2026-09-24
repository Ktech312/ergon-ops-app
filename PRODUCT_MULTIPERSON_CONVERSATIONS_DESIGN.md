# Multi-person direct conversations — design

Status: **APPROVED by E, 2026-09-23/24. Migration 203 corrected per E's own review and sent as the
next single Supabase action.** Written in response to E's own long-standing ask (recorded in
migration 162's header, 2026-09-17: "E also asked for direct_messages/conversations to support more
than two participants, Slack/Teams-style... a real, separate feature... tracked as a new item").

## 0. Approved shape (E, 2026-09-23)

- "New message" allows selecting one or more recipients.
- One recipient uses the existing deduplicated 1:1 conversation (`getOrCreateConversation()`,
  unchanged).
- Two or more recipients creates an ad-hoc group DM.
- No name is required. Display participant names and avatars by default.
- It appears under Direct Messages, not Channels.
- It has ordinary messages, reactions, attachments, unread state, and notifications.
- It does **not** gain Channel features: Tasks, Files, Canvas, public/private controls, or guest
  access. Those stay features of `channels.type = 'group'` (migration 105) specifically — the
  separate, already-existing "named group channel" surface this design doesn't touch or duplicate.
- Every existing 1:1 conversation and its behavior is preserved exactly.
- Migration 187's workspace containment is preserved exactly — **not** the older, since-reversed
  "conversations stay cross-workspace" text in migration 162's own original header. A group DM is
  workspace-scoped the same way a 1:1 DM already is.

## 0b. Corrected by E's own review before sending, 2026-09-24: membership is fixed for this release

The first draft included an "add people to an existing group" path (a member-add RLS policy plus an
`add_conversation_member()` RPC). **E flagged the real risk directly**: adding a new participant to
an existing group would expose that new participant to the group's entire prior message history —
`direct_messages` carries no per-message "who could see this when it was sent" boundary; every read
policy is "are you a member *now*," never "were you a member *then*." Until real membership-history
semantics are designed, allowing mid-conversation membership changes is a real information-disclosure
risk, not just an unfinished feature.

**Fix applied to migration 203 before sending**: `conversation_members` has no insert or delete RLS
policy beyond SELECT. The only way a row is ever created is `create_group_conversation()`'s own
atomic, `SECURITY DEFINER` insert of every starting member, in the same transaction as the
conversation row itself. **Add People and Leave Group are not built this release.** To change who's
in a group, a user starts a new group DM. The migration's own canonical test (section c) proves this
directly: a real, current group member cannot INSERT a new member row (RLS rejects it, since no
policy authorizes the action) and cannot DELETE even their own row (RLS silently admits zero rows,
same "no policy = no visibility" pattern this schema's migration 200/201 tests already established).

## 1. Current shape (fixed two-participant, confirmed from source before designing)

- `conversations` (migration 094): `participant_a_id`/`participant_b_id` (both `not null`,
  `check (participant_a_id < participant_b_id)`, `unique (participant_a_id, participant_b_id)`) —
  canonical ordering is how `getOrCreateConversation()` (`persistence.ts:2261`) dedupes a 1:1 thread
  regardless of who starts it, via a PostgREST `on_conflict=participant_a_id,participant_b_id` upsert.
- `direct_messages` (migration 094): plain `conversation_id`/`sender_id`/`body`, no participant
  concept of its own — inherits containment through `conversation_id`.
- `conversations.workspace_id` (migration 187, E's 2026-09-17 reversal of migration 162's original
  cross-workspace decision): resolved at creation by a trigger that requires *both* participants
  share an active workspace, stamped once, immutable after. Every RLS policy/RPC predicate that
  scopes a conversation or its messages is the same shape, repeated across 5 migrations (094, 100,
  113, 187, 190, 191): `participant_a_id = X or participant_b_id = X`.
- `message_read_state` (migration 191) is **already** a generic per-`(user_id, conversation_kind,
  conversation_id)` table covering both `'channel'` and `'conversation'` kinds — **this table needs
  zero changes**. It was already built to answer "is this specific user caught up on this specific
  thread," which is exactly the question an N-person thread asks too; migration 191 just never had a
  reason to exercise the N>2 case until now.
- Frontend: `Conversation` type (`persistence.ts:2157`) carries `participantAId`/`participantBId`
  directly (no membership list); `loadConversations()` filters client-side via
  `or=(participant_a_id.eq.X,participant_b_id.eq.X)`; the DM list's display name is derived by
  looking up "the other participant" — assumes exactly one.
- `api/_lib/directMessage.js`'s `resolveDirectMessage()` (used by both `api/send-push.js` and
  `api/create-notification.js`) derives a single `recipientId` as "whichever of
  `participant_a_id`/`participant_b_id` isn't the sender" — **this breaks for a group message**
  (both columns are null on a group conversation, so today's code would silently resolve `recipientId
  = null` and notify nobody). Fixed alongside the frontend work — see §3.

## 2. Design: additive, not a rewrite

Same philosophy this schema already uses everywhere widening containment (e.g. migration 185's
admin-gate ORs, migration 187 itself): **add a membership table, OR it into every existing predicate,
change nothing about how an existing 1:1 conversation is created, stored, or queried.**

- **New table `conversation_members`** (`backend/supabase/migrations/203_multiperson_direct_conversations.sql`),
  same core shape as `channel_members` (migration 105) — `conversation_id`, `user_id`, `added_at`,
  primary key `(conversation_id, user_id)` — **minus** `channel_members`' own insert/delete policies;
  see §0b for why those are deliberately not carried over this release.
- **`conversations` gains `is_group boolean not null default false`, `title text` (nullable), and
  `created_by uuid`** — `title` is optional; the first-release UI never requires or prompts for one,
  the DM list derives a display label from participant names by default (same as it already derives a
  1:1 conversation's label from "the other participant" today).
- **Existing 1:1 conversations are completely untouched**: `participant_a_id`/`participant_b_id` stay
  set on every row created before this migration and every future 1:1 conversation —
  `getOrCreateConversation()` needs zero changes, the canonical-pair upsert trick keeps working
  exactly as-is. A one-time backfill inserts two `conversation_members` rows per existing 1:1
  conversation, so read-state and any future membership-based query work uniformly across old and new
  rows without a special case. A `conversations_group_shape_check` constraint keeps the two shapes
  (1:1 vs. group) from ever being ambiguously mixed.
- **A new group conversation** (`is_group = true`) leaves `participant_a_id`/`participant_b_id`
  **null** and expresses membership entirely through `conversation_members`, fixed at creation (§0b)
  — 3 or more rows, no upper bound imposed by the schema (a sane UI cap is a frontend concern).
- **Every existing `participant_a_id = X or participant_b_id = X` predicate gets one more OR'd
  branch**: `or exists (select 1 from conversation_members cm where cm.conversation_id = c.id and
  cm.user_id = X)`. Additive only — an existing 1:1 conversation's access check still passes through
  the original two columns unchanged. Covers, confirmed by reading each one directly from its real,
  current migration file before drafting: `conversations` SELECT/INSERT (187), `direct_messages`
  SELECT/INSERT/UPDATE (187), `direct_message_reactions` SELECT/INSERT (113), `forward_attachment()`
  (190), and — found during the pre-send review pass E asked for — the `message-attachments`
  `storage.objects` SELECT/INSERT policies (migration 100), which migration 187's own header had
  correctly left untouched for the fixed two-participant world but which a real group member needs
  the same OR'd branch for, or they could never upload/view their own group's attachments.
- **Workspace containment for a group**: `guard_conversation_workspace_id_mutation()` (migration 187)
  currently intersects *two* participants' active workspaces. A group conversation instead stamps
  `workspace_id` from the **creator's own** active workspace (`resolve_caller_workspace_id()`,
  already used everywhere else in this schema for a no-fixed-second-anchor situation), validated
  against every starting member inside `create_group_conversation()` itself (rejecting the whole
  creation if any proposed member doesn't share that workspace), plus a
  `guard_conversation_member_workspace_id()` trigger on `conversation_members` INSERT as a second,
  defense-in-depth layer — now exercised only by that one RPC's own insert, since no other insert path
  into this table exists this release.
- **`direct_messages` needs zero schema changes** — containment already flows through
  `conversation_id`.
- **`message_read_state`**: needs literally nothing, as noted above.

## 3. Frontend + backend compatibility plan (next: build this while migration 203 is pending)

- `Conversation` type gains `isGroup: boolean`, `title: string | null`, and a new
  `memberUserIds: string[]` populated from `conversation_members` (for a 1:1 row, this is just
  `[participantAId, participantBId]`, computed client-side, no extra request) — `participantAId`/
  `participantBId` stay on the type as `string | null` (only ever set for 1:1 rows) so every existing
  call site that reads them for a 1:1 conversation keeps compiling unchanged.
- `loadConversations()` changes from the current `or=(participant_a_id.eq.X,participant_b_id.eq.X)`
  client-side filter to a plain `select=*` (RLS alone scopes the rows now, same pattern
  `loadChannels()` already uses) plus a second request loading this user's own `conversation_members`
  rows to know which group conversations they're in.
- DM list display name: `isGroup ? (title || derivedNameFromMembers(memberUserIds)) : <existing
  other-participant lookup, unchanged>`. `derivedNameFromMembers` joins each member's known display
  name (same lookup the People Picker/@mention dropdown already use), truncated with "+N more" past a
  few names — a small new pure-display helper, not a new data source.
- **"New message" flow**: the existing People Picker becomes multi-select. Exactly 1 person selected
  → `getOrCreateConversation()`, unchanged. 2+ selected → `createGroupConversation(memberUserIds)`
  (new `persistence.ts` function wrapping the `create_group_conversation` RPC). One entry point, one
  picker, branching only on count — exactly as E specified, not a second "New Group" button.
- `MessageThread` (already the single shared component for DM threads and channel messages) needs no
  structural changes — it already renders sender name/avatar per message.
- **`api/_lib/directMessage.js`**: `resolveDirectMessage()` changes from returning one `recipientId`
  to a `recipientIds: string[]` (every `conversation_members` row except the sender — for a 1:1 row,
  computed from `participant_a_id`/`participant_b_id` exactly as today, so the 1:1 notification path
  is unaffected). `api/send-push.js` and `api/create-notification.js` (both consumers) loop over
  `recipientIds` instead of assuming exactly one.

## 4. Tests

`backend/supabase/migration_203_multiperson_direct_conversations_tests.sql` — canonical isolation
test, sections: (a) existing 1:1 conversation creation/read/write is byte-for-byte unaffected
(regression guard — the whole point of the additive design); (b) a 3-person group conversation can be
created by a workspace member, all 3 members can read/send, a same-workspace 4th non-member cannot;
(c) `create_group_conversation()` rejects a cross-workspace member at creation time, and fixed
membership is actually enforced — a real member can neither directly INSERT a new
`conversation_members` row nor DELETE their own; (d) `message_read_state` correctly tracks per-person
unread across all 3 group members independently (proving migration 191 really does need zero changes,
not just asserting it by inspection); (e) reactions on a group message follow the same membership
check. Frontend regression tests (persistence.ts additions, the notification resolver's multi-
recipient change) are written alongside the frontend implementation, per this repo's own established
convention.

## 5. What this migration deliberately does not do

- **Add People / Leave Group** — see §0b. Real, tracked follow-up work, gated on designing real
  per-message visibility semantics first (a new member must never see history from before they
  joined).
- No group size cap enforced server-side (frontend concern).
- No change to 1:1 conversations' workspace-scoped-by-design behavior (migration 187) — this design
  builds on top of it, never reopens or reverts it.
