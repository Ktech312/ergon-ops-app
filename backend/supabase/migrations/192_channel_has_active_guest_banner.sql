-- Migration 192: channel_has_active_guest -- a narrowly-scoped boolean RPC
-- so EVERY employee in a channel (not just guest-management-authorized
-- people) can be shown a "this channel has an external guest" banner.
-- Built alongside a small frontend addition tonight (confirm-before-add
-- dialogs, this migration's own banner) per E's direct Slack-reference
-- request 2026-09-21: "There should probably be a small message on top of
-- the chat that tells/warns employees that there are 'Guests from outside
-- the company are in this channel'".
--
-- ============================================================
-- The gap this closes
-- ============================================================
-- Migration 188's own RLS on `channel_guests` ("authorized managers and
-- self read channel_guests", 188_external_channel_guest_access.sql:
-- 403-406) is `using (channel_guest_manage_authorized(channel_id) or
-- user_id = auth.uid())` -- i.e. only an app admin, workspace admin, PM, or
-- the channel's own creator (or the guest themselves) can read whether a
-- channel has a guest at all. An ORDINARY employee sitting in that same
-- channel -- neither admin/PM nor the channel's creator -- has no way to
-- know a guest is present today. That is a real gap for E's own request:
-- a warning banner only the people who already manage guests can see
-- warns no one.
--
-- ============================================================
-- Why this is a new, narrowly-scoped RPC and not a wider grant on
-- channel_guests itself
-- ============================================================
-- Widening channel_guests' own SELECT policy to "any workspace member of
-- the owning workspace" would let every employee read the guest's name,
-- inviting email, and expiration for a channel they're not otherwise
-- authorized to manage guests in -- more than the banner needs and more
-- than migration 188 intended to expose. Matches this schema's already-
-- established "narrow, least-exposure" pattern (channel_guest_manage_
-- authorized() vs. the plain-boolean is_active_channel_guest(), and
-- migration 189's get_channel_message_sender_names(), which resolves
-- names only, never guest identity/expiration) -- this migration adds
-- exactly one new SECURITY DEFINER function, channel_has_active_guest(),
-- that answers ONLY the yes/no question "does this channel currently have
-- an active guest," never who, never their email, never their expiration.
--
-- Authorization: the caller must be public.is_workspace_member() of the
-- channel's own workspace -- i.e. any real employee of the owning company,
-- deliberately NOT gated by channel_guest_manage_authorized() (that would
-- just reproduce the exact gap this migration exists to close). A guest
-- themselves is never a workspace_members row (migration 188's entire
-- design), so is_workspace_member() is always false for them -- they don't
-- need telling their own channel has a guest, that's them; the frontend
-- also skips the call entirely in guestMode as a UX nicety, this is the
-- real server-side backstop.
--
-- Deliberately returns `false` (never raises, never leaks via error) both
-- for an unauthorized caller/unknown channel and for a channel with no
-- active guest -- an outsider probing this RPC learns nothing beyond a
-- boolean that is already false for the overwhelming majority of
-- channels, matching the same safe-empty posture as every other RPC in
-- this pair (188/189).
--
-- "Active guest" mirrors is_active_channel_guest()'s own exact predicate
-- (188_external_channel_guest_access.sql:369-384): not revoked, and
-- either no expiration or not yet expired.
--
-- Confirm 192 is still the next free migration number at execution time
-- (191 was the last one drafted; re-checked directly against
-- backend/supabase/migrations/ immediately before writing this file, and
-- 191 is the real highest number on disk -- note 190/191 are not yet
-- confirmed applied in production as of this session's start, but this
-- migration's own RPC has no dependency on either one, it only reads
-- channels/channel_guests, both already live since migration 188). Not
-- applied. Kept local for E's review.

begin;

create or replace function public.channel_has_active_guest(check_channel_id uuid)
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
      and public.is_workspace_member(c.workspace_id)
  )
  and exists (
    select 1
    from public.channel_guests g
    where g.channel_id = check_channel_id
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
  );
$$;

revoke all on function public.channel_has_active_guest(uuid) from public;
revoke execute on function public.channel_has_active_guest(uuid) from anon;
grant execute on function public.channel_has_active_guest(uuid) to authenticated;

commit;
