-- Migration 070: Track who performed each inventory movement.
--
-- inventory_movements already had a `performed_by uuid references
-- profiles(id)` column from the original schema (migration 001), but
-- the `profiles` table has never actually been populated by this app --
-- auth/user tracking moved to the simpler known_users/team_members
-- tables and an email string, the same pattern already used successfully
-- on tasks (created_by_email). Reusing `performed_by` would mean either
-- populating profiles for real, or risking FK failures. Adding a plain
-- text column instead, matching tasks.created_by_email.

alter table inventory_movements
  add column if not exists performed_by_email text;
