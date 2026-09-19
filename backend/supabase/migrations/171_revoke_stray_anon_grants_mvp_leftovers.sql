-- Phase 3, Stage 5 hygiene item (not workspace containment -- these two
-- tables are pre-`workspaces`-feature MVP leftovers, flagged separately
-- in PRODUCT_MASTER_COMPLETION_PLAN.md §11 as low-risk cleanup, not
-- part of the containment work). Closes a real, unintentional gap
-- found while confirming `app_sync_events` was safe to leave alone
-- (it turned out NOT to be dead code -- see below -- so the original
-- "confirm before dropping" question resolved to "do not drop," but
-- re-reading its actual grants surfaced this instead):
--
-- Migration 008 gave BOTH `app_sync_events` and `app_transaction_locks`
-- a full-access `anon` policy pair each, explicitly labeled "during
-- no-login MVP" (008:61-71) -- from before this app had real
-- authentication at all. Both tables have had real, working
-- authenticated-only write paths for a long time since (`acquireTransaction
-- Lock()`/`releaseTransactionLock()`/`saveRemoteAppState()`, all in
-- `src/persistence.ts`, every one of them bails out immediately with no
-- network call at all if `accessToken` is falsy) -- these anon policies
-- have had no legitimate caller for just as long, and let any
-- unauthenticated caller read, insert, update, or delete arbitrary rows
-- in both tables today. Migration 069 separately grants `anon` EXECUTE
-- on `acquire_transaction_lock()` itself (069:54) -- same leftover, same
-- fix. Revoking from `anon` alone is not sufficient for that function,
-- confirmed empirically (a PGlite run of an earlier draft of this
-- migration still let `anon` call it): Postgres grants EXECUTE to the
-- `PUBLIC` pseudo-role automatically on function creation, and
-- migration 069 never revoked that default -- every role, `anon`
-- included, is implicitly a member of `PUBLIC`, so the function
-- remained callable via that grant regardless of the anon-specific
-- revoke. Revoked from `PUBLIC` outright below, then `authenticated`'s
-- own explicit grant restored.
--
-- `app_sync_events` re-confirmed NOT dead while scoping this: it is
-- still written on every `roleMode` change (`saveRemoteAppState()`,
-- `src/main.tsx:1577`) -- but the `PersistedAppState` it now carries is
-- just `{ roleMode }`, a single UI preference; all real business data
-- moved to normalized tables per the "Phase 10f" comment at that same
-- call site. Not dropped here -- still receiving real, if trivial,
-- authenticated writes. `app_transaction_locks` is also still live
-- (migration 069's own fix for it is actively relied on by every
-- Adjust/Receive/Transfer and project/build/purchase-request save).
-- Neither table's core design (`workspace_key text`, not a real
-- `workspace_id uuid`) is touched here -- that's tracked separately as
-- its own cleanup item, not this migration's job.
--
-- Confirm 171 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

drop policy if exists "anon read app_sync_events during no-login MVP" on public.app_sync_events;
drop policy if exists "anon write app_sync_events during no-login MVP" on public.app_sync_events;
drop policy if exists "anon read app_transaction_locks during no-login MVP" on public.app_transaction_locks;
drop policy if exists "anon write app_transaction_locks during no-login MVP" on public.app_transaction_locks;

-- Postgres grants EXECUTE to the PUBLIC pseudo-role automatically on
-- function creation, unless explicitly revoked -- migration 069 never
-- revoked from PUBLIC (only explicitly granted to authenticated, anon,
-- which was actually redundant with that default). Revoking from anon
-- alone would leave it callable via the PUBLIC grant, since every role
-- is implicitly a member of PUBLIC. Revoke from PUBLIC outright, then
-- restore authenticated's own explicit grant (unaffected either way,
-- but stated for clarity).
revoke all on function public.acquire_transaction_lock(text, text, text, text, integer) from public;
revoke execute on function public.acquire_transaction_lock(text, text, text, text, integer) from anon;
grant execute on function public.acquire_transaction_lock(text, text, text, text, integer) to authenticated;

commit;
