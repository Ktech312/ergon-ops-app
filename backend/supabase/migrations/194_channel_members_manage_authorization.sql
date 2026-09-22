-- Migration 194: channel_members' missing "who may add/remove a member"
-- gate, flagged since migration 162 itself ("channel_members is fully open
-- on all three operations (anyone can add/remove anyone from any
-- channel)") and re-confirmed unresolved by PRODUCT_MASTER_COMPLETION_PLAN.md's
-- own Stage 4 write-up, then investigated directly against the live
-- migration files and frontend during a 2026-09-22 doc-accuracy audit --
-- E approved this fix explicitly before it was drafted.
--
-- ============================================================
-- The gap
-- ============================================================
-- channel_members' INSERT/DELETE policies (105, workspace-scoped by 162)
-- only ever checked "is this caller an active member of the channel's own
-- workspace" -- true for every employee, with no further gate at all.
-- Net effect: any workspace member could add or remove any OTHER member
-- from any group channel, including a private one they may not even be a
-- member of themselves -- a real privilege gap, distinct from (and
-- unaffected by) 162's own cross-workspace containment fix.
--
-- ============================================================
-- The fix -- reuse the already-decided guest-management gate, not a new
-- permission model
-- ============================================================
-- Migration 188 already answered the closely related question "who may
-- manage a channel's external-guest access" via channel_guest_manage_
-- authorized(check_channel_id): admin OR workspace-admin OR PM role OR
-- the channel's own creator (188's own header: "no existing 'channel
-- owner' gate found anywhere in this schema to mirror, so this task's own
-- fallback was applied"). Managing INTERNAL membership is the same class
-- of action on the same entity (who has access to this channel) -- this
-- migration reuses that exact helper directly for channel_members'
-- INSERT/DELETE rather than inventing a second, possibly-inconsistent
-- permission model for a sibling decision. SELECT is left untouched
-- (workspace-scoped, broadly readable) -- "View members" has always been
-- visible to any workspace member and nothing about this fix changes that.
--
-- Verified against the real client code before writing this: createGroupChannel
-- (src/persistence.ts) inserts the channel row first (stamping created_by
-- = the caller), then bulk-inserts channel_members rows for [creator,
-- ...initial members] as a SEPARATE follow-up request -- by the time that
-- second request runs, channels.created_by is already committed, so
-- channel_guest_manage_authorized() correctly authorizes the creator for
-- that call. addChannelMember (the "Add people" flow) is a single-row
-- insert, same predicate, same result. No DELETE call site exists
-- anywhere in the frontend today (no "remove member" UI has ever been
-- built) -- tightening DELETE here is pure defense-in-depth against a
-- direct REST call, not a change to any working feature.

begin;

drop policy if exists "workspace members write channel_members" on public.channel_members;
create policy "workspace members write channel_members" on public.channel_members for insert to authenticated
  with check (public.channel_guest_manage_authorized(channel_id));

drop policy if exists "workspace members delete channel_members" on public.channel_members;
create policy "workspace members delete channel_members" on public.channel_members for delete to authenticated
  using (public.channel_guest_manage_authorized(channel_id));

commit;
