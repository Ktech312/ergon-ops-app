-- Migration 106: fix "new row violates row-level security policy for
-- table channels" when creating a group channel -- found live,
-- immediately, by actually testing the create flow after 105 ran.
--
-- Root cause: creating a group channel is two requests -- POST channels
-- (private=true, with `Prefer: return=representation` so the client gets
-- the new row back), then a separate POST channel_members for the
-- creator + invitees. Postgres RLS requires a freshly INSERTed row to
-- also satisfy the table's SELECT policy for RETURNING to succeed. At
-- the moment the first request tries to return the new row, the creator
-- isn't in channel_members yet (that's the second request) -- so a brand
-- new private group channel matches neither "read open channels" (it's
-- private) nor "read private group channels" (no membership row exists
-- yet), and Postgres raises exactly this error.
--
-- Fix: the creator can always see a group channel they created,
-- regardless of whether their own membership row has landed yet.

drop policy if exists "authenticated read private group channels" on channels;
create policy "authenticated read private group channels" on channels for select to authenticated
  using (
    type = 'group'
    and private = true
    and (
      created_by = auth.uid()
      or exists (select 1 from public.channel_members m where m.channel_id = channels.id and m.user_id = auth.uid())
    )
  );
