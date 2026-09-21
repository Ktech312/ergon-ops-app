# Forward a File/Attachment to Another Channel, Chat Group, or Project — First Design (NOT IMPLEMENTED)

Status: **DESIGN ONLY. No production code, no migration.** Written from E's own direct answers,
2026-09-21 (verbatim decisions below, not inferred). This grew out of
`PRODUCT_EXTERNAL_GUEST_CHANNELS_DESIGN.md` §3 item 6/§4's original, narrower "file promotion" idea (a
guest-room owner moving a guest-uploaded file into the project's real document store) — E's actual
answer below describes something much more general: a real "forward this file anywhere I have access"
action on any file/attachment in any channel or chat message, not guest-room-specific. That earlier
design doc's own §6 flagged file promotion as deliberately out of migration 188's scope, tracked as a
follow-up — this is that follow-up, expanded to its real, larger shape, so it gets its own design pass
before any migration, same discipline as every other security/data-model-sensitive feature in this repo.

## 1. The problem, in E's own words

> "add a Forward arrow of some sort next to the file or item, that when you click it, it give you
> options, Download, Forward - transfer will show a drop down of places it can be added - Options:
> 'Channels' 'Chats Group' 'Projects' - then each one will have its subcategory that fits with those
> Categories. Channels = Channels show that the user has access to. Chat Groups = Chats show that the
> user has access to. Projects = Shows all Projects - then Project Folders - like Images and Files"

A file or attachment posted in any channel message or DM gets a "Forward" action next to its existing
"Download" action. Clicking it opens a destination picker with three top-level categories — Channels,
Chat Groups, Projects — each showing only what the caller already has access to, plus (for Projects) a
second-level pick of which folder inside that project (Images or Files) the copy lands in.

## 2. E's decisions, verbatim/paraphrased, 2026-09-21 — do not re-ask

1. **Copy, not move**: "Copy — stays in both places." The original attachment/message stays exactly
   where it was; a copy lands at the destination too. Mirrors the existing "file promotion" design's own
   copy semantics (guest-channels doc §4: "This is a copy, not a move — the original room message/
   attachment stays exactly where it was for the room's own history").
2. **Permission — gated only when the source channel has (or had) a guest**: "Restricted only when the
   source has a guest." In an ordinary internal channel or chat between employees, ANY regular member
   can forward a file freely — no creator/admin gate. The creator-or-admin restriction from the guest-
   channels design (§5 item 1: "Owner of the channel is the person who created it or a site Admin") only
   applies when forwarding OUT of a channel that has (or ever had) an external guest in it — that's the
   one place content needs a gatekeeper, since a guest's own content shouldn't be freely redistributable
   by just any employee without oversight. A plain project/client/group channel between employees, or a
   DM, has no such restriction.
3. **Chat Groups destination includes both group channels and DMs**: "Group channels and DMs both" — the
   "Chat Groups" picker in the Forward dialog lists both `channels` rows of `type = 'group'` the caller
   can see AND `conversations` (1:1 DMs) the caller is a participant in, as one combined list (or two
   clearly labeled sub-sections of one list — a frontend layout detail, not a schema question).
4. **A guest never sees Forward at all** — not explicitly asked, but a natural, obvious extension of
   "guests are boxed into their one room" (the guest-channels design's whole premise). Stated here as a
   design decision, not an open question: the Forward action is simply never rendered for a guest
   session, and (belt-and-suspenders) the RPC below requires `is_active_workspace_member()` on the
   caller, which a guest never satisfies (same mechanism the guest-channels design already relies on to
   guarantee "a guest never invites another guest" — see that doc §5, migration 188 §3 header).

## 3. What already exists (do not re-build)

### 3a. Project "Images" vs "Files" — a real, existing distinction, not a new one

Directly read both candidate tables rather than guessing:

- **`project_documents`** (migration 002, workspace-scoped by migration 170) — `id`, `project_id`,
  `document_number`, `document_type` (`check` enum: `sales_quote`, `sow`, `bom`, `purchase_order`,
  `invoice`, `field_photo`, `other`), `file_name`, `file_url`, `storage_provider`, `status`,
  `uploaded_by`, `uploaded_at`, `notes`, `workspace_id` (migration 170). This is a flat document list —
  one row per uploaded file, one bucket-agnostic `storage_provider`/`file_url` pair. The frontend already
  groups this same table into named sub-categories for display (`GENERAL_DOCUMENT_TYPES`, `src/main.tsx`:
  `["Project", "Drawings", "SOW", "BOM", "Procurement", "Sales Quote"]`, plus a separate
  `CLOSEOUT_DOCUMENT_TYPES` set for the Closeout Vault) — this is the real "Files" folder, already
  sub-divided by type in the UI today.
- **`project_location_images`** (migration 064) — a genuinely separate table: `id`,
  `project_location_id` (FK to `project_locations`, not directly to `projects`), `image_type` (`check`:
  `photo`/`drawing`), `storage_path`, `file_name`, `description`, `uploaded_at`, `uploaded_by_user_id`,
  `uploaded_by_email`, `photo_lat`/`photo_lng`. Its own dedicated private bucket
  (`project-location-images`, not `message-attachments` or `project_documents`' storage). This is the
  real "Images" folder — confirmed by its own frontend gallery UI (`src/main.tsx` ~22440-24380:
  `LocationImageGallery`-shaped components with their own Download/Delete, entirely separate from the
  `UploadedDoc`/"Files" list components).
- **The broader "images vs. files" convention, checked across the app rather than assumed**:
  `sales_quote_location_images` (referenced by migration 064's own retrofit, the Sales-side twin of
  `project_location_images`, same `photo`/`drawing`/`uploaded_by`/`lat`/`lng` shape) and
  `catalog-datasheets` (migration 052, a Catalog-item-scoped document bucket, unrelated to a project) both
  reinforce the same pattern already visible in `project_documents`/`project_location_images`: this app
  keeps **structured photo/drawing galleries in their own dedicated table + bucket per entity**, separate
  from a flat "documents" list. Nothing new needs inventing — Project's two "Project Folders" map exactly
  onto real, already-existing structures:
  - **"Images"** → `project_location_images` (one row per photo/drawing, scoped through
    `project_location_id` → `project_locations.project_id`).
  - **"Files"** → `project_documents` (one row per document, scoped directly through `project_id`,
    already sub-divided into `GENERAL_DOCUMENT_TYPES` in the UI).

  One overlap worth flagging plainly rather than glossing over: `project_documents.document_type` already
  has a `field_photo` value — i.e. a photo *can* already land in the "Files" table today, not only in
  `project_location_images`. This forwarding feature doesn't need to resolve that pre-existing overlap;
  it only needs to pick ONE destination table per forward (see §5), and defaults a forwarded file to
  `project_documents` ("Files") unless the caller explicitly picks the Images folder, matching the
  picker's own two-folder framing in E's words above.

### 3b. The message/attachment shape being forwarded

- **`channel_messages`** (migration 101, extended by 105/108/162) — `id`, `channel_id`, `sender_id`,
  `body`, `created_at`, `attachment_storage_path`, `attachment_file_name`, `attachment_mime_type`,
  `attachment_size_bytes`. One message row optionally carries one attachment (not a separate
  attachments-table — matches `direct_messages`' own shape below).
- **`direct_messages`** (migration 094, attachments added by migration 100) — same attachment column
  shape (`attachment_storage_path`/`attachment_file_name`/`attachment_mime_type`/`attachment_size_bytes`)
  on `conversation_id`/`sender_id`/`body` rows.
- **`message-attachments` storage bucket** (migration 100, extended by 101/105/162/188) — private bucket,
  objects keyed `<channel_id or conversation_id>/<stamp>-<filename>`. Access is entirely path-prefix-
  gated: a policy checks `name like <id>::text || '/%'` against whichever parent (`channels` or
  `conversations`) the caller can see. Forwarding a file therefore means **copying the underlying storage
  object into a new path under the destination's own id prefix**, then inserting a new message/document
  row pointing at that new path — not re-pointing a single stored object at two parents, since every
  existing RLS policy on this bucket is written around "the object's path prefix IS the parent id," and
  a shared object living under the SOURCE's prefix would never satisfy a DESTINATION channel's own
  read policy.

### 3c. Detecting "this channel has/had a guest"

- **`channel_guests`** (migration 188) is the real table. A channel "has a guest" (per the gating rule
  in §2 item 2) via `exists (select 1 from channel_guests where channel_id = X)` — **with no `revoked_at`
  or `expires_at` filter**, deliberately. See the open question below — this is E's own rule ("has a
  guest," not "has an ACTIVE guest"), interpreted here as "ever had," and flagged for confirmation rather
  than silently assumed.

## 4. Open question — flagging, not guessing

**Does "has a guest" mean *currently has an active guest*, or *has ever had a guest, even after revoke/
expiry*?** E's own wording ("Restricted only when the source has a guest") doesn't specify. This design
defaults to **"ever had a guest, active or not"** — `exists (select 1 from channel_guests where
channel_id = X)`, ignoring `revoked_at`/`expires_at` entirely — because the content itself (files/
messages posted while the guest had access) was already exposed to that outsider, and revoking the
guest's own access doesn't retroactively un-expose what they already saw or uploaded; a channel that
once had outside content in it seems like it should stay gated going forward, not silently reopen to
unrestricted forwarding the moment the guest's access lapses. **This is a judgment call, not a confirmed
decision — flagged for E to confirm before implementation.** If E instead wants "currently active guest
only," the predicate changes to add `and revoked_at is null and (expires_at is null or expires_at > now())`
— a one-line change to the same helper function, no schema impact either way.

## 5. Proposed schema (illustrative — not a migration)

```sql
-- Confirm the next free migration number at execution time (190 as of this
-- writing, per the last migration on disk, 189).

-- Lineage column on the two existing attachment-bearing tables, so a
-- forwarded message/document can point back at where it came from --
-- purely informational (e.g. "Forwarded from #parking-garage"), never
-- consulted by RLS (RLS for the copy is governed entirely by the copy's
-- OWN parent, same as any other message/document row).
alter table channel_messages add column if not exists forwarded_from_message_id uuid;
alter table direct_messages add column if not exists forwarded_from_message_id uuid;
alter table project_documents add column if not exists forwarded_from_message_id uuid;
alter table project_location_images add column if not exists forwarded_from_message_id uuid;
-- Deliberately NOT a foreign key -- the source row can live in any of four
-- different tables (channel_messages/direct_messages/project_documents/
-- project_location_images) depending on where the ORIGINAL file was
-- posted, and Postgres has no polymorphic FK. A companion
-- forwarded_from_kind text column (values matching the four source
-- tables) makes the lineage resolvable in the frontend without a guess.
alter table channel_messages add column if not exists forwarded_from_kind text
  check (forwarded_from_kind is null or forwarded_from_kind in ('channel_message', 'direct_message', 'project_document', 'project_location_image'));
alter table direct_messages add column if not exists forwarded_from_kind text
  check (forwarded_from_kind is null or forwarded_from_kind in ('channel_message', 'direct_message', 'project_document', 'project_location_image'));
alter table project_documents add column if not exists forwarded_from_kind text
  check (forwarded_from_kind is null or forwarded_from_kind in ('channel_message', 'direct_message', 'project_document', 'project_location_image'));
alter table project_location_images add column if not exists forwarded_from_kind text
  check (forwarded_from_kind is null or forwarded_from_kind in ('channel_message', 'direct_message', 'project_document', 'project_location_image'));

-- The permission gate itself: does the SOURCE channel have (or ever have
-- had) an external guest? Only meaningful for channel_messages sources --
-- direct_messages/project_documents/project_location_images have no guest
-- concept at all, so forwarding FROM those is never gated by this rule.
-- Judgment call on "ever had" vs "currently has" -- see §4.
create or replace function public.channel_has_or_had_guest(check_channel_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (select 1 from public.channel_guests where channel_id = check_channel_id);
$$;

revoke all on function public.channel_has_or_had_guest(uuid) from public;
grant execute on function public.channel_has_or_had_guest(uuid) to authenticated;
```

**Why a lineage column and not a new `file_forwards` join table**: this app's own established
convention (mirrored across `project_locations.source_quote_location_id`, `projects.source_sales_quote_id`,
`product_requests.source_project_id` in the Engineering module design) is a plain nullable FK-shaped
"where this came from" column on the child row itself, not a separate audit/join table, for a one-time
copy relationship. A `file_forwards` audit table (who forwarded what, when, from where, to where) is a
reasonable Phase 2 addition if E wants a forwarding history view, but isn't required for the core
feature and isn't proposed here — flagged as a possible later addition, not part of this design.

## 6. The forward action itself — RPC shape

A single `security definer` RPC, `forward_attachment`, is the one path that performs a forward — never a
plain client-side storage copy + plain insert, so the guest-gating rule (§2 item 2) and both source/
destination access checks are enforced server-side, not trusted to the frontend.

```sql
create or replace function public.forward_attachment(
  p_source_kind text,          -- 'channel_message' | 'direct_message' | 'project_document' | 'project_location_image'
  p_source_id uuid,
  p_destination_kind text,     -- 'channel' | 'conversation' | 'project_files' | 'project_images'
  p_destination_id uuid,       -- channel_id, conversation_id, or project_id depending on p_destination_kind
  p_message_body text default null  -- optional caption when forwarding into a channel/DM
)
returns table (outcome text, new_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  -- source row fields resolved by kind: storage_path, file_name, mime_type,
  -- size_bytes, and (channel_message only) the source channel_id
  v_storage_path text;
  v_file_name text;
  v_mime_type text;
  v_size_bytes bigint;
  v_source_channel_id uuid;
  v_new_path text;
  v_new_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Must be signed in to forward a file';
  end if;

  -- 1. Resolve the source row by kind, relying on the SOURCE table's own
  --    existing RLS SELECT policy to enforce "the caller can already see
  --    this file" -- no separate re-check needed, a plain select against
  --    an RLS-protected table already fails closed for a caller who
  --    can't read it.
  --    (branch per p_source_kind -- omitted here for brevity, mirrors the
  --    existing per-kind fetchOne() pattern already used server-side in
  --    api/_lib/notificationEvents.js for the same four-way message-kind
  --    dispatch idea)

  -- 2. Guest-gating check (§2 item 2 / §4): only applies when
  --    p_source_kind = 'channel_message'. Uses the SAME authorization
  --    shape as channel_guest_manage_authorized() (migration 188) when
  --    gated, but a plain is_active_workspace_member() check (any regular
  --    member, not owner-only) when the source channel has never had a
  --    guest.
  if p_source_kind = 'channel_message' then
    if public.channel_has_or_had_guest(v_source_channel_id) then
      if not public.channel_guest_manage_authorized(v_source_channel_id) then
        raise exception 'This channel has (or had) an external guest -- only the channel creator, an admin, or a PM may forward files out of it.' using errcode = 'EC001';
      end if;
    else
      if not public.is_active_workspace_member(public.channel_owner_workspace_id(v_source_channel_id)) then
        raise exception 'Not authorized to forward from this channel';
      end if;
    end if;
  end if;
  -- direct_message / project_document / project_location_image sources
  -- have no guest concept -- gated only by the source table's own RLS
  -- (step 1), same as any other read.

  -- 3. Destination access check -- the caller must be able to WRITE to
  --    the destination (send a channel_messages/direct_messages row, or
  --    insert a project_documents/project_location_images row) --
  --    delegated to that destination table's own existing INSERT policy
  --    the same way step 1 delegates read access, not re-implemented
  --    here.

  -- 4. Copy the storage object into the destination's own path prefix
  --    (via storage.objects, or the storage API from the calling edge
  --    function/RPC context -- exact mechanism depends on whether this
  --    is a plain SQL RPC or a thin API route wrapping one; a pure-SQL
  --    RPC cannot itself call the Storage API, so this step most likely
  --    needs a thin api/forward-attachment.js route that calls this RPC
  --    for the permission checks THEN performs the actual storage copy
  --    via the Supabase Storage API, mirroring how project_location_images'
  --    own "copy from quote's bucket into project's own bucket" already
  --    works in application code, migration 064's own header: "the copy
  --    itself... happens in application code").

  -- 5. Insert the new message/document row at the destination, with
  --    forwarded_from_message_id/forwarded_from_kind set to the source.

  return query select 'forwarded'::text, v_new_id;
end;
$$;
```

**Where the actual byte-copy happens**: per migration 064's own precedent (the Sales→Project location-
image copy is explicitly application code, not a pure-SQL operation, "so deleting a photo on one side
never touches the other's copy"), the storage-object copy itself cannot happen inside a plain SQL RPC —
Postgres has no access to the Storage API. The real implementation shape is a thin `api/forward-
attachment.js` route (mirroring `api/create-notification.js`'s existing "caller's own token, re-derive
everything server-side" posture) that: (a) calls a permission-check-only RPC (the guest-gating +
source/destination-access logic above, returning `allowed`/`denied` rather than doing the copy itself),
(b) if allowed, copies the storage object via the Storage API using the destination's own path prefix,
(c) inserts the new message/document row referencing the new path. This keeps the authorization logic
in one server-side place (the RPC, testable in isolation) while keeping the actual byte-copy in
application code (consistent with the one existing precedent for this exact kind of operation in this
schema).

## 7. The three destination pickers — data sources

- **Channels**: every `channels` row the caller can currently see, per the channel's own existing RLS
  (`type in ('section','project','client')`, or `type = 'group' and private = false`, or a private group
  the caller is a `channel_members` row on) — i.e. exactly the same query the channel list/sidebar
  already runs today, no new query shape needed.
- **Chat Groups**: `channels` rows with `type = 'group'` (both private and unlocked, since being a
  member of a private group already means the caller can see it) UNION `conversations` rows where the
  caller is `participant_a_id` or `participant_b_id` — two existing, already-RLS-scoped queries, combined
  client-side into one picker list (E's own words: "Group channels and DMs both").
- **Projects → Project Folders**: every `projects` row the caller can see (existing project list query),
  then, once a project is picked, a fixed two-item folder choice — "Images" (destination kind
  `project_images`, writes to `project_location_images` under that project's own default/only
  `project_location`, or prompts for which location if the project has more than one — a frontend UX
  detail, not resolved here) and "Files" (destination kind `project_files`, writes to `project_documents`
  with `document_type` defaulting to `'other'` unless the picker lets the caller choose a
  `GENERAL_DOCUMENT_TYPES` sub-category at forward time).

  **Flagged, not resolved here**: `project_location_images` is keyed to a `project_location_id`, not
  directly to a `project_id` — a project with more than one `project_locations` row (e.g. multiple
  garages/lots) has no single obvious "Images" destination. The smallest useful first release (§8) can
  sidestep this by only offering the Images folder for projects with exactly one location, or by adding a
  location sub-picker when there's more than one — a frontend decision, not a schema blocker.

## 8. Smallest useful first release

Forward a channel-message attachment to another channel or a DM the caller is a participant in (the
"Chats Group" half, both branches), inserting a new message row with `forwarded_from_message_id`/
`forwarded_from_kind` set, gated by the guest-aware permission rule in §2 item 2 / §6. No Project
destination yet (that needs the location-picking UX flagged in §7, and touches two different tables
depending on folder), no forwarding FROM a project document/image (only channel/DM messages as sources),
no forwarding history view. This is deliberately smaller than the full three-destination picker E
described — additive later, since the lineage columns (§5) and the RPC's kind-dispatch shape (§6) already
accommodate the other source/destination kinds without a redesign.
