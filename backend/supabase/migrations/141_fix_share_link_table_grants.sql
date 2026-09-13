-- Follow-up to migration 137, which is already applied in production.
--
-- Migration 137 correctly enabled RLS and created no anon policies on its
-- three new tables, so anonymous callers could not read or mutate rows.
-- However, this Supabase project grants table privileges to anon and
-- authenticated through project-level default privileges. Merely omitting an
-- explicit GRANT in migration 137 therefore did not produce the minimum ACL
-- that migration and its canonical test require.
--
-- This migration makes the intended ACL explicit:
--   * anon and PUBLIC: no direct privilege on any of the three tables;
--   * authenticated: SELECT-only on the two append-only audit tables;
--   * authenticated: SELECT/INSERT/UPDATE/DELETE on workspace settings, with
--     migration 137's RLS policy still limiting writes to admins.
--
-- No row, policy, token, expiration setting, or link behavior is changed.
-- The statements are idempotent.

begin;

revoke all on table
  public.share_link_views,
  public.share_link_actions,
  public.workspace_share_link_settings
from public, anon, authenticated;

grant select on table
  public.share_link_views,
  public.share_link_actions
to authenticated;

grant select, insert, update, delete on table
  public.workspace_share_link_settings
to authenticated;

commit;
