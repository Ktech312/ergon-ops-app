-- Migration 107: channels never had an UPDATE policy at all -- migration
-- 101 only ever added SELECT and INSERT. Found live testing Unlock:
-- the PATCH request itself succeeded (200), but returned an empty body
-- and the row never actually changed -- Postgres RLS defaults to deny
-- for any command with no matching policy, so every unlockChannel() call
-- has been a silent no-op since the feature was built.
--
-- Same broad "any authenticated user" posture as the existing INSERT
-- policy on this table (migration 101) and channel_members (105) --
-- consistent with how this whole app treats its small internal team.

drop policy if exists "authenticated update channels" on channels;
create policy "authenticated update channels" on channels for update to authenticated using (true) with check (true);
