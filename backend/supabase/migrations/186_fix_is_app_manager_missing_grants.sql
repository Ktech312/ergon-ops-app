-- Found during an autonomous audit (2026-09-19, no business decision
-- involved -- pure security-grant correction, same class of fix as
-- migrations 125/171): `is_app_manager(check_user_id uuid)` (migration
-- 014) has NEVER had any grant/revoke statement applied to it, in 014 or
-- any later migration -- confirmed by grepping every occurrence of the
-- name across all 185 migrations. Migration 124's own header explicitly
-- flagged this as a known, deferred twin of `is_app_admin()`/`has_role()`
-- ("has_role() and is_app_manager() have the same latent... issue...
-- NOT hardened here, out of scope for this round, not silently
-- overlooked"). Migration 125 later closed the identical gap for
-- `is_app_admin()` and six migration-115 workspace helper functions --
-- the equivalent follow-up for `is_app_manager()` was never written and
-- fell through.
--
-- `is_app_manager()` is `security definer`, `language sql`, takes an
-- ARBITRARY CALLER-SUPPLIED user_id (not `auth.uid()`), and is used only
-- inside RLS policies (migrations 019/024/014/173/175). It is a plain SQL
-- function (`returns boolean`), not a trigger, so it is directly
-- reachable via `POST /rest/v1/rpc/is_app_manager` by any `anon` or
-- `authenticated` caller today -- it has inherited Postgres' implicit
-- default EXECUTE-to-PUBLIC grant since the moment it was created, and
-- (per this project's own default-privilege behavior, first documented
-- by migration 118 and confirmed again by migration 125's own header) an
-- EXECUTE-to-anon grant too. Never called from any frontend code in this
-- repo (grepped) -- purely an RLS-internal helper.
--
-- Practical severity: LOW, same class as migration 125's is_app_admin()
-- finding. Any fully unauthenticated caller could pass an arbitrary
-- user id and learn whether that specific user holds the `manager` role
-- -- a real, narrow information-disclosure gap (a boolean role-membership
-- probe, requires already knowing/guessing a real user id, not a way to
-- gain manager access itself), not a write path or data leak of business
-- records.
--
-- Pure grant correction -- no function body, logic, or signature change.
-- Every statement below is idempotent: revoking a grant that doesn't
-- exist, or granting one that already exists, is a safe no-op. Mirrors
-- migration 125's exact three-line pattern for is_app_admin(uuid).
--
-- Confirm 186 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

revoke all on function public.is_app_manager(uuid) from public;
revoke execute on function public.is_app_manager(uuid) from anon;
grant execute on function public.is_app_manager(uuid) to authenticated;

commit;
