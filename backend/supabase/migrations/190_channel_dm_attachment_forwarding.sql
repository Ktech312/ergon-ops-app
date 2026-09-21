-- Migration 190: forward a channel-message/DM attachment to another
-- channel or DM. Implements PRODUCT_CHANNEL_FILE_FORWARDING_DESIGN.md's
-- own "smallest useful first release" (that doc's §8): channel/DM
-- sources, channel/DM destinations only -- no Project destination yet
-- (that needs the location-picking UX the design doc's own §7 flags as
-- unresolved), no forwarding FROM a project document/image.
--
-- ============================================================
-- Permission model -- E's own corrected 2026-09-21 decision (design doc
-- §2 item 2, verbatim): "Anyone internal can move it to any place that
-- they have Access to... The ONLY gate is the destination's own already-
-- existing RLS: can this caller write to that channel/DM/project?" i.e.
-- forwarding needs no new authorization CONCEPT -- only a correctly-
-- scoped destination write, plus (unchanged from any other read) the
-- caller must actually be able to see the source message to begin with.
-- No guest-gating branch is needed here at all (design doc §3c) -- see
-- the belt-and-suspenders note below on how a guest is excluded anyway.
--
-- ============================================================
-- Schema (design doc §5, adapted to this pass's actual scope)
-- ============================================================
-- The design doc's own illustrative SQL adds lineage columns to FOUR
-- tables (channel_messages/direct_messages/project_documents/
-- project_location_images) and a four-way forwarded_from_kind enum,
-- since its full picker supports Project destinations too. This pass's
-- own scope (§8, channel/DM only) only needs two of those tables --
-- project_documents/project_location_images are deliberately NOT touched
-- here, tracked as the Project-destination follow-up's own job. The
-- forwarded_from_kind check constraint is narrowed to the two kinds
-- actually reachable in THIS pass ('channel_message', 'direct_message')
-- -- still forward-compatible: a later migration widening it to add
-- 'project_document'/'project_location_image' is a pure ADD, no data
-- migration, since every existing row's value already lies inside the
-- widened set.
--
-- Deliberately NOT a foreign key, matching the design doc's own §5
-- reasoning verbatim: the source row can live in either of two different
-- tables depending on where the original file was posted, and Postgres
-- has no polymorphic FK.
--
-- ============================================================
-- forward_attachment() -- IMPORTANT DEVIATION from the design doc's
-- literal §6 text, flagged here rather than silently "simplified away"
-- ============================================================
-- The design doc's own §6 describes step 1 (resolve the source) and
-- step 3/5 (insert at the destination) as needing "no separate check" --
-- a plain `select` against the source table "already fails to find
-- anything if the caller's own RLS SELECT policy... doesn't grant read
-- access," and the destination insert's "success/failure is entirely
-- governed by the destination table's existing RLS INSERT policy... not
-- re-implemented here." That framing is only true for a caller-privilege
-- (SECURITY INVOKER) function, where every statement really does run
-- under the calling role's own RLS.
--
-- This RPC is required to be SECURITY DEFINER (this task's own explicit
-- instruction, matching every other write-path RPC in this schema). A
-- SECURITY DEFINER function's statements run as the function's OWNER
-- (the migration-applying role, effectively a table-owner/superuser-like
-- role in this schema) -- and per Postgres' own row-security semantics, a
-- table's owner bypasses that table's RLS entirely unless FORCE ROW
-- LEVEL SECURITY was applied (it never is, anywhere in this schema).
-- This is not a new discovery specific to this migration -- it is the
-- EXACT, already-documented reason every other SECURITY DEFINER helper
-- in this schema manually re-derives its access predicate from auth.uid()
-- instead of trusting the underlying table's own RLS to still apply:
-- migration 187's shares_workspace_with() header spells this out
-- directly ("a plain (non-admin) caller's inline query would only ever
-- see their OWN workspace_members row... making the join always fail --
-- found and fixed during this session's own PGlite verification, not
-- assumed"), and migration 189's get_channel_message_sender_names()
-- reproduces channel_messages' own real SELECT predicate inline (its own
-- `authorized_channel` CTE) rather than relying on a bare `select`
-- against channel_messages to self-enforce anything.
--
-- So: a bare `select` or `insert` inside THIS function would bypass RLS
-- entirely, silently turning "gated only by the destination's own RLS"
-- into "gated by nothing at all" -- any authenticated caller could read
-- any message in any workspace as the source, and write into any
-- channel/conversation in any workspace as the destination, defeating
-- the entire feature's stated security model. To actually deliver what
-- the design doc describes (destination-write-gated, source-read-gated,
-- no NEW authorization concept), this function manually mirrors the
-- REAL, current SELECT policies on channel_messages/direct_messages (for
-- step 1) and the REAL, current INSERT policies on the same two tables
-- (for the destination check), each re-read directly from their live
-- source immediately before writing this file (channel_messages/
-- direct_messages SELECT+INSERT, migrations 162/187/188's cumulative
-- current shape) rather than invented fresh. The USER-VISIBLE behavior
-- is unchanged from the design doc's intent (a caller who cannot already
-- read the source, or cannot already write the destination, is rejected,
-- exactly as if raw RLS had done it) -- only the mechanism differs,
-- because SECURITY DEFINER was mandated over SECURITY INVOKER.
--
-- The source-read mirror below deliberately omits channel_messages'
-- guest OR-branch (is_active_channel_guest()) -- see the next section for
-- why that is provably dead code here, not an oversight.
--
-- ============================================================
-- Guest exclusion (design doc §2 item 4 / §3c's "belt-and-suspenders")
-- ============================================================
-- A guest session must never be able to reach this RPC at all, not even
-- to forward within their own one channel. resolve_caller_workspace_id()
-- (migration 117) already raises a hard exception for any caller with
-- ZERO workspace_members rows -- exactly what a channel guest always has
-- (migration 188's whole design: a guest is a real auth.users row but
-- NEVER a workspace_members row). Calling it as the very first statement
-- both (a) hard-fails for a guest before any source/destination logic
-- runs, matching the design doc's own framing of this exact mechanism
-- ("the RPC below requires is_active_workspace_member() on the caller,
-- which a guest never satisfies"), and (b) makes the omitted guest
-- OR-branch in the source-read mirror above provably unreachable: by the
-- time that check runs, the caller has already been proven to hold at
-- least one real workspace_members row.
--
-- ============================================================
-- The storage object itself -- NOT copied by this migration
-- ============================================================
-- Per the design doc's own §3b/§6 "Where the actual byte-copy happens":
-- the message-attachments bucket's RLS is entirely path-prefix-gated to
-- the parent (channel or conversation) id, so a forwarded file needs a
-- NEW object physically copied into the destination's own prefix -- and
-- Postgres/PL/pgSQL has no access to the Storage API, so this cannot be
-- done in SQL at all, from any function, DEFINER or not. This RPC is
-- metadata-only: it inserts the new destination row with the SAME
-- file_name/mime_type/size_bytes/storage-path VALUES copied from the
-- source, referencing a storage path that does not yet physically exist
-- under the destination's own id prefix. The actual byte-copy is a
-- SEPARATE, subsequent step performed by application code (api/forward-
-- attachment.js) calling the Supabase Storage API with a service-role
-- key AFTER this RPC succeeds -- see that route's own header for the
-- failure-cleanup story if the copy fails after this RPC's insert
-- already landed.
--
-- ============================================================
-- Incidental fix, found by this migration's own PGlite verification, not
-- assumed: bump_conversation_last_message_at()
-- ============================================================
-- direct_messages' own AFTER INSERT trigger (migration 094,
-- direct_messages_bump_conversation) calls bump_conversation_last_message_at(),
-- whose body is `update conversations set last_message_at = ... where id =
-- new.conversation_id` -- bare, unqualified, and with no `set search_path`
-- of its own, written years before this schema's now-standard
-- `security definer` + `set search_path = ''` + schema-qualified-everything
-- hardening convention existed. This was invisible until now because every
-- previous caller inserted into direct_messages as a plain client-side
-- REST call, under the normal session search_path (which includes
-- `public`) -- this migration's own forward_attachment() is the first
-- caller to insert into direct_messages from INSIDE a `set search_path =
-- ''`-scoped function. Postgres' per-function `SET` GUC override stays in
-- effect for anything executed while that function is still running,
-- INCLUDING a trigger fired by one of its own statements -- so
-- bump_conversation_last_message_at() inherits search_path='' when fired
-- from inside forward_attachment(), and its bare `conversations` reference
-- fails with "relation conversations does not exist". Confirmed live by
-- this migration's own canonical test (Section (a2), forwarding into a
-- DM) before this fix was added -- not a hypothetical. Fixed here via
-- `create or replace function`, matching this schema's own established
-- practice of fixing an old function through a later migration rather
-- than editing an already-applied file (e.g. migration 165's
-- fix_ref_assign_trigger_grants): schema-qualified, `set search_path =
-- ''` added, behavior otherwise byte-for-byte identical.
--
-- ============================================================
-- Revision, same session, BEFORE this file was ever applied to
-- production -- destination storage path was wrong in the first draft
-- ============================================================
-- The first draft of this RPC copied the SOURCE row's own
-- attachment_storage_path VALUE, unchanged, into the destination row.
-- That is wrong: the message-attachments bucket's read policy checks
-- `name like <parent id>::text || '/%'` against the DESTINATION
-- channel/conversation (see this file's "storage object itself" section
-- above) -- a destination row whose stored path still carries the
-- SOURCE's id prefix would never satisfy the DESTINATION's own read
-- policy, so the destination's members could never actually view the
-- forwarded file (getMessageAttachmentUrl's signed-URL request would be
-- rejected by storage.objects RLS forever, not just until the app-code
-- copy step runs). Caught by re-reading this file's own header against
-- the design doc's §6 wording ("referencing a storage path that does
-- not yet physically exist under the destination's own id prefix") --
-- that phrase means the STORED value must already look like a
-- destination-prefixed path, not a source-prefixed one, before this
-- migration was ever applied anywhere. Fixed in place (not a follow-up
-- migration) because this file had not yet been run against production
-- at the time this was found -- this revision is the version actually
-- meant to ship.
--
-- Fix: the RPC now computes a NEW destination-prefixed path itself
-- (`<destination id>/<stamp>-<sanitized file name>`, mirroring
-- buildMessageAttachmentStoragePath's own shape, src/persistence.ts) and
-- inserts THAT as attachment_storage_path, never the source's raw path.
-- The RETURNS TABLE is widened to also hand back BOTH the original
-- source_storage_path and the new destination_storage_path -- the
-- calling application code (api/forward-attachment.js) needs both to
-- perform the actual Storage-API byte-copy (source -> destination) this
-- migration's own header already says SQL cannot do itself.
--
-- Confirm 190 is still the next free migration number at execution time
-- (189 was the last one on disk as of this session's own start,
-- re-checked directly against backend/supabase/migrations/ immediately
-- before writing this file). Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- Schema: lineage columns on the two in-scope tables only.
-- ============================================================

alter table public.channel_messages add column if not exists forwarded_from_message_id uuid;
alter table public.channel_messages add column if not exists forwarded_from_kind text
  check (forwarded_from_kind is null or forwarded_from_kind in ('channel_message', 'direct_message'));

alter table public.direct_messages add column if not exists forwarded_from_message_id uuid;
alter table public.direct_messages add column if not exists forwarded_from_kind text
  check (forwarded_from_kind is null or forwarded_from_kind in ('channel_message', 'direct_message'));

-- ============================================================
-- Section 2 -- forward_attachment() RPC.
-- ============================================================

drop function if exists public.forward_attachment(text, uuid, text, uuid, text);

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
  v_source_parent_id uuid;    -- channel_id or conversation_id of the source row
  v_storage_path text;        -- the SOURCE's real, existing storage path
  v_new_storage_path text;    -- the new, destination-prefixed path the copy lands at
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

  -- Guest exclusion, belt-and-suspenders (see this file's header) --
  -- raises outright for a caller with no workspace_members row at all.
  perform public.resolve_caller_workspace_id();

  -- 1. Resolve the source row, gated by a manual mirror of that table's
  --    own REAL, current SELECT policy (see header for why this can't be
  --    "just a plain select" under SECURITY DEFINER). Zero rows covers
  --    both "doesn't exist" and "exists but caller can't read it" --
  --    same safe-empty posture direct RLS already gives this caller.
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
      and (conv.participant_a_id = v_actor_id or conv.participant_b_id = v_actor_id);
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

  -- New, destination-prefixed storage path -- see this file's "Revision"
  -- header note above for why this cannot be the source's own raw path.
  -- Shape mirrors buildMessageAttachmentStoragePath (src/persistence.ts):
  -- <parent id>/<stamp>-<sanitized file name>. The object at this path
  -- does not exist yet -- application code (api/forward-attachment.js)
  -- copies the real bytes there after this RPC returns successfully.
  v_new_storage_path := p_destination_id::text || '/' ||
    (extract(epoch from clock_timestamp()) * 1000)::bigint::text || '-' ||
    substring(regexp_replace(coalesce(nullif(btrim(v_file_name), ''), 'file'), '[^a-zA-Z0-9_.-]+', '_', 'g') from 1 for 120);

  -- 2. No source-side gating beyond step 1's read check (design doc
  --    §3c) -- any caller who can already see the source message may
  --    forward it, full stop.

  -- 3. Destination access check, gated by a manual mirror of that
  --    table's own REAL, current INSERT policy (see header). A rejection
  --    here surfaces as a normal Postgres exception, matching how a raw
  --    RLS-denied insert would behave for this same caller.
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

    -- 4/5. Insert the new message row at the destination. The storage
    -- object itself is NOT copied here -- see this file's header,
    -- "The storage object itself."
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
        and (conv.participant_a_id = v_actor_id or conv.participant_b_id = v_actor_id)
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
-- Section 3 -- incidental fix: bump_conversation_last_message_at(), see
-- header. Trigger-invoked only (direct_messages_bump_conversation,
-- migration 094, untouched) -- no grant needed, matching this schema's
-- own established posture for trigger functions (migration 187's header,
-- re: create_client_channel()).
-- ============================================================

create or replace function public.bump_conversation_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

revoke all on function public.bump_conversation_last_message_at() from public;

commit;

-- ============================================================
-- Deliberately NOT done by this migration -- see this file's header for
-- full reasoning on each:
--   - project_documents/project_location_images lineage columns, and any
--     project-folder destination support -- out of this pass's scope
--     (design doc §8), tracked as a follow-up.
--   - The actual storage-object byte-copy -- cannot be done in SQL;
--     performed by api/forward-attachment.js after this RPC succeeds.
--   - A file_forwards audit/history table -- design doc §5's own
--     "possible later addition, not part of this design."
-- ============================================================
