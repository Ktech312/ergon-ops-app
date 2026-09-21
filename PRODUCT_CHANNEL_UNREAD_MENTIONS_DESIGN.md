# Slack-style Unread/Highlight + @Mention Indicators — First Design (NOT IMPLEMENTED)

Status: **DESIGN ONLY. No production code, no migration.** Written from E's own direct answers,
2026-09-21 (verbatim decisions below, not inferred). First flagged (not designed) in
`PRODUCT_EXTERNAL_GUEST_CHANNELS_DESIGN.md` §5 item 3: "a general highlight of a channel if there is a
new message in there, then once that channel is viewed it un-highlights... **This does not exist
anywhere in this app's channel system today**," scoped there as its own Phase 2 design pass. This is
that pass. More purely additive/mechanical than the file-forwarding design written alongside it (no
permission-gating complexity — a user only ever reads/writes their own read-state) — confident and
short by design.

## 1. E's decisions, verbatim/paraphrased, 2026-09-21 — do not re-ask

- **Visual highlight only, no email/push on @mention right now**: a general unread highlight on any
  channel/DM with a new message since the caller last viewed it, clearing once viewed — plus a visually
  *distinct, stronger* marker specifically when the caller's own name was @mentioned, matching Slack's
  own convention (a plain unread indicator for "new activity," a colored/count badge for "you were
  mentioned"). No new notification-channel wiring (email/push) for this pass — the existing `mentioned`
  in-app/push notification event (migration 108) already covers alerting; this design is purely about
  the sidebar-level highlight/badge, which is new.
- **Applies to both channels and DMs**: "Both channels and DMs" — one mechanism, not two, covering
  `channels` (via `channel_messages`) and `conversations` (via `direct_messages`) alike.

## 2. What already exists (do not re-build)

### 2a. No read-state or mention-tracking table exists today — re-confirmed directly

Grepped the full migration history (`backend/supabase/migrations/`, through migration 189, the latest on
disk) for `last_read`, `_reads`, `read_state`, `unread` — the only hits are `push_subscriptions`
(migration 095) and a push-rule fix (migration 110), both unrelated to message read-state. `channel_
messages`/`direct_messages` themselves carry no per-user read marker except `direct_messages.read_at`
(migration 094) — a single nullable timestamp on the message row itself, which only works for a genuine
1:1 (one row can't record "read by" for more than one recipient) and has no equivalent at all on
`channel_messages`. This confirms the guest-channels design's own earlier finding still holds: nothing
here to build on, a new table is the right shape.

### 2b. How @mentions are authored and resolved today — reused, not reinvented

Directly traced the existing mechanism end to end rather than assuming:

- **Authoring/autocomplete** (`src/main.tsx`, `mentionCandidates`/`mentionState`, ~15799-16178): typing
  `@` in a channel-message or canvas composer shows an autocomplete dropdown built from real people
  (`ChannelDiscussion`'s own `mentionCandidates` array, ~16803, built from team members with
  avatar/online status) and role groups. Picking a candidate inserts **plain text** — `@FirstName` or
  `@RoleLabel` — into the message body. There is **no structured mention data stored anywhere** — no
  embedded user id, no separate mentions table, no markup beyond the literal `@token` substring in
  `channel_messages.body`/`direct_messages.body`/`channel_canvas.content`.
- **Resolution, at notification time, server-side** (`api/_lib/notificationEvents.js`, `resolveMentions()`,
  line 132): when a `mentioned` notification event fires (triggered client-side by
  `triggerNotification("mentioned", relatedEntityId, {...})`, `src/main.tsx` ~5113, itself called from
  `notifyMentions()` — see the security-review comment at ~5009-5028: this whole path was rewritten so
  the *client* only ever sends an entity id, never a recipient list, and the server re-derives everything
  from the real stored row), the handler **re-fetches the actual message/task/canvas row by id and
  re-parses `@token` occurrences out of its stored text with a plain regex**
  (`/@([A-Za-z][A-Za-z0-9_]*)/g`), then resolves each token against `team_members.full_name`'s first
  word (case-insensitive) or a role-label lookup (`@Sales` → every `team_members` row with that role),
  producing a list of recipient emails.
- **The load-bearing fact for this design**: mentions are **plain text, re-parsed on demand**, not
  resolvable data stored on the message. There is no `user_id` embedded anywhere. Detecting "was I
  (the current viewer) mentioned in this message" therefore means running the *same* token-matching logic
  client-side (or in a lightweight server function), checking whether the CALLER's own first name or any
  role they hold appears as a `@token` in the message body — not inventing a second mention-authoring
  mechanism, and not requiring `channel_messages`/`direct_messages` to change shape at all. This reuses
  `resolveMentions()`'s exact matching rule rather than re-deriving a different one.

## 3. Read-state schema (illustrative — not a migration)

One table, not two — channels and DMs are both "a conversation-shaped thing with messages," so one
`(user_id, conversation_kind, conversation_id)` shape covers both, matching this design's "one mechanism,
not two" framing above, rather than a `channel_message_reads` table plus a separate `direct_message_reads`
table.

```sql
-- Confirm the next free migration number at execution time (190 as of this
-- writing, per the last migration on disk, 189).

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
-- workspace-visibility branch needed here at all (unlike almost every
-- other table in this schema): "have I read this" is inherently private
-- to the reader, never something another employee needs to see about
-- someone else. Read access to the underlying channel/conversation itself
-- is still governed entirely by that table's own existing RLS (a guest,
-- for instance, could in principle get a read-state row for their own one
-- guest channel -- harmless, since it only ever reflects their OWN read
-- position, same isolation guarantee as everything else in the guest
-- design).
drop policy if exists "users manage their own message_read_state" on public.message_read_state;
create policy "users manage their own message_read_state"
  on public.message_read_state for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

**Why one row per (user, conversation) rather than one row per (user, message)**: matches Slack's own
actual model (a single "last read" cursor per channel, not a read receipt per message) and is exactly
what E asked for ("once that channel is viewed it un-highlights" — a whole-channel state, not a
per-message one). A single `upsert` on `last_read_at = now()` when the caller opens/views a channel or
DM is the only write this table ever needs.

**Why not reuse `direct_messages.read_at`**: that column is a per-message, single-timestamp field that
already only works for exactly two participants (migration 094's own conversations are strictly 1:1 —
see migration 162's header, "conversations... stay cross-workspace, personal messaging"). It also has no
`channel_messages` equivalent at all, and repurposing/extending it to cover channels (multiple readers
per message) would mean a read-receipt-per-message-per-reader shape, a much heavier table than the
single-cursor design above needs for what E actually described. `read_at` is left exactly as-is,
untouched by this design — it can stay serving whatever narrower "has the other DM participant seen
this specific message" purpose it already serves, if any UI still reads it; this new table is additive,
not a replacement.

## 4. Computing "unread" and "was I mentioned" from this data

Both are pure client-side (or a light read-only RPC) computations over already-visible data — no new
server-side fan-out, no new notification wiring:

- **Is this channel/DM unread?** — `exists (select 1 from channel_messages where channel_id = X and
  created_at > coalesce(<caller's last_read_at for this channel>, '-infinity'))` (equivalently for
  `direct_messages`/`conversation_id`). A caller with no `message_read_state` row yet for a given channel
  treats it as "everything is unread" (`coalesce(..., '-infinity')`) — matching the natural behavior of a
  channel the caller has genuinely never opened.
- **Was I specifically mentioned since I last read it?** — of the messages matched above (created after
  the caller's `last_read_at`), does ANY of them contain a `@token` (same regex as `resolveMentions()`,
  §2b) matching the caller's own first name (`team_members.full_name`'s first word) or a role label for
  any role the caller holds? This is the same matching rule already live in
  `api/_lib/notificationEvents.js`, evaluated for one specific viewer instead of enumerating all
  recipients — no new parsing logic invented, just the existing rule run client-side (or server-side in a
  small helper RPC/function, if computing it per-channel-list-row is cheaper done in SQL than by fetching
  every candidate message body to the client) against messages the caller can already read.
- **Practically**: the channel/DM list view needs, per row, one small aggregate query (or a single RPC
  returning `{conversation_id, unread_count, mentioned}` for every channel/DM the caller can see in one
  round trip, rather than N+1 per-row queries) — a `get_message_read_summary()` RPC is the natural shape,
  mirroring this schema's existing preference for one summarizing RPC over a client-side N-query loop
  (e.g. `channel_guest_manage_authorized()`-style single-purpose helper functions elsewhere in this
  schema).

## 5. RLS approach

Already stated in §3: `message_read_state` gets exactly one policy, `user_id = auth.uid()`, for all
operations (select/insert/update — a user only ever touches their own rows, there is no cross-user read
of someone else's read-state anywhere in this feature). No workspace-scoping branch, no admin-override
branch, no guest-specific branch — this is the simplest RLS shape of any table in this schema, and
deliberately so: read position is inherently private and single-owner, unlike almost everything else
here.

The "was I mentioned" computation itself needs no new RLS at all — it only ever reads message bodies the
caller's EXISTING `channel_messages`/`direct_messages` RLS already lets them read; a mention-check RPC
should be `security definer` purely so it can read `team_members`/role data efficiently in one place
(mirroring `resolveMentions()`'s own server-side pattern), not because it needs to bypass any access
control the caller doesn't already have.

## 6. Frontend behavior (not a schema question, brief for completeness)

- **Unread highlight**: any channel/DM row in the sidebar/list with `unread_count > 0` gets a visual
  marker (bold text / dot, matching Slack's own lighter-weight "new activity" treatment) — clears the
  moment the caller opens that channel/DM (an `upsert` into `message_read_state` on open, `last_read_at =
  now()`).
- **Mention marker**: a channel/DM row where the unread messages include one that mentions the caller
  gets the stronger, distinct marker E asked for (Slack's own convention: a colored badge, optionally
  with a count) — layered on top of, not instead of, the plain unread highlight.
- **Guest sessions**: a guest's own single-room view gets the same treatment for their one channel — no
  special-casing needed, `message_read_state` rows work identically for a guest's `auth.uid()` as for any
  employee's, and RLS already isolates them to their own row regardless.

## 7. Smallest useful first release

`message_read_state` table + RLS (§3), an `upsert`-on-open write path, and a `get_message_read_summary()`
RPC (or equivalent client-side aggregate query) driving two visual states per channel/DM row: plain
unread and "you were mentioned." No read-receipts-per-message, no "who else has read this" visibility, no
new email/push wiring (the existing `mentioned` notification event already covers alerting — this design
only adds the sidebar-level visual state). This is essentially the whole feature — there isn't a smaller
meaningfully-useful slice than "highlight it, clear it on view, mark it stronger when I'm named."
