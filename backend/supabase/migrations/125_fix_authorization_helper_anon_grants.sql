-- Follow-up to migration 124, as actually applied. Every other function
-- hardened in that migration got the full three-line grant pattern
-- (revoke all from public; revoke execute from anon; grant execute to
-- authenticated) -- is_app_admin(uuid) alone shipped with only two of
-- the three lines:
--
--   revoke all on function public.is_app_admin(uuid) from public;
--   grant execute on function public.is_app_admin(uuid) to authenticated;
--
-- (Confirmed by re-reading migration 124's own file, which is left
-- exactly as applied and NOT retroactively edited to add the missing
-- line -- that correction belongs here, in this new migration, per this
-- project's standing rule against editing an already-applied migration.)
--
-- `revoke all ... from public` does NOT touch a grant made separately to
-- `anon` -- this project has `alter default privileges in schema public
-- grant execute on functions to anon, authenticated, service_role` set
-- at the project level (documented once already by migration 118, which
-- found and fixed the identical gap for a different function pair,
-- resolve_caller_workspace_id()/guard_workspace_id_mutation()).
-- is_app_admin() was originally created in migration 012 with no grant
-- statements at all, so it inherited that default EXECUTE grant to
-- `anon` at creation, and nothing between then and migration 124 ever
-- revoked it.
--
-- What this means, precisely: the missing anon-revoke STRONGLY SUGGESTS
-- is_app_admin() is currently callable by anon in production, given the
-- documented default-privilege behavior above -- but this has not been
-- directly confirmed against live grants. The read-only inspection query
-- below must be run BEFORE this migration, and its result treated as the
-- actual answer, not the inference above. If that query already shows
-- zero anon grants (e.g. because something else closed it, or the
-- default-privilege behavior doesn't apply here the way migration 118
-- documented it), this migration is still safe to run (every statement
-- below is idempotent -- revoking a grant that doesn't exist is a safe
-- no-op) but would then be confirming/tidying rather than closing an
-- active exposure.
--
-- If confirmed open: any fully unauthenticated caller could call
-- `POST /rest/v1/rpc/is_app_admin` with an arbitrary user id and learn
-- whether that specific user is a global admin -- a real, narrow
-- information-disclosure gap (a boolean, requires already knowing/
-- guessing a real user id -- not a way to gain admin access itself, but
-- a real defect on the app's single most-relied-on authorization check).
--
-- Also closes the same class of gap on the six migration-115 workspace
-- helper functions (is_platform_admin, is_workspace_admin,
-- is_workspace_member, is_workspace_member_owner,
-- can_manage_workspace_member, current_user_workspace_ids), which an
-- overnight audit found have the identical missing anon-revoke.
-- Practical exploitability is lower for these six specifically, since
-- every one of them evaluates auth.uid() internally (null for an
-- unauthenticated caller, never matching any real row), so an anon
-- caller calling them only ever learns `false` -- but it's the same
-- unremediated gap class, closed here at the same time for consistency,
-- matching the migration-118 precedent.
--
-- Pure grant correction -- no function body, logic, or signature changes
-- anywhere in this file. Every statement is idempotent: revoking a grant
-- that doesn't exist is a safe no-op.
--
-- Numbering note: this is migration 125. The "migration 125" referenced
-- in PRODUCT_SHARE_LINK_EXPIRATION_REVOCATION_DECISION.md's Part 12 (the
-- future direct-write policy-closure plan) was always design-only and
-- has never existed as a real file or run -- it is renumbered to
-- migration 126 to make room for this real, more urgent fix taking the
-- next available slot, per standard migration-numbering discipline
-- (never reuse a number, never skip one retroactively).

begin;

revoke execute on function public.is_app_admin(uuid) from anon;

revoke execute on function public.is_platform_admin() from anon;
revoke execute on function public.is_workspace_admin(uuid) from anon;
revoke execute on function public.is_workspace_member(uuid) from anon;
revoke execute on function public.is_workspace_member_owner(uuid) from anon;
revoke execute on function public.can_manage_workspace_member(uuid) from anon;
revoke execute on function public.current_user_workspace_ids() from anon;

commit;
