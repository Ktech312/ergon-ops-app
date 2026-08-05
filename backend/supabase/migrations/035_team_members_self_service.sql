-- Lets any authenticated user ensure their own single row exists in
-- team_members, instead of only Admins/Managers being able to write to that
-- table (migration 019). Without this, a signed-in user who is neither an
-- Admin nor a Manager can never appear in their own Assignee dropdown,
-- because the app's self-bootstrap call (ensureTeamMemberForSelf) has
-- nowhere to write to.
--
-- This is additive: Postgres OR's together permissive RLS policies for the
-- same command, so Admins/Managers keep full control over every row
-- (add/edit/deactivate anyone), while a non-admin/non-manager user gains the
-- narrow ability to insert or update only the row matching their own login
-- email. They still cannot touch anyone else's row, and cannot deactivate or
-- rename another person -- this is strictly "make sure I exist on the
-- roster", not general roster management.

create policy "users insert their own team_members row"
  on team_members for insert to authenticated
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "users update their own team_members row"
  on team_members for update to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
