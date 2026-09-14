-- Follow-up to migration 140, which is already applied in production.
--
-- Migration 140's cascade_quote_soft_delete() trigger function only ever
-- did `revoke all on function ... from public`, reasoning (mirroring
-- migration 117's own note about guard_workspace_id_mutation()) that a
-- trigger function needs no grant at all since Postgres refuses to invoke
-- a `returns trigger` function directly via SQL ("trigger functions can
-- only be called as triggers") regardless of any EXECUTE privilege --
-- true, and still true after this migration; the actual behavior is
-- unaffected.
--
-- What that reasoning missed: like migration 137's tables (fixed by
-- migration 141), this Supabase project's project-level default
-- privileges ALSO apply to newly created FUNCTIONS, not just tables --
-- every new function in the public schema is automatically granted
-- EXECUTE to anon and authenticated unless explicitly revoked, the same
-- gap 141 closed for share_link_views/share_link_actions/
-- workspace_share_link_settings. Migration 140's own canonical test
-- caught this the moment it ran for real: `has_function_privilege('anon',
-- 'public.cascade_quote_soft_delete()', 'execute')` returned true.
--
-- This is functionally inert (the grant can never actually be exercised,
-- per the Postgres restriction above) but is closed anyway for the same
-- explicit minimum-ACL discipline every other function in this schema
-- follows, and so migration 140's own canonical test passes as written.
--
-- No row, policy, token, expiration setting, or link behavior is changed.
-- The statements are idempotent.

begin;

revoke all on function public.cascade_quote_soft_delete() from public, anon, authenticated;

commit;
