-- Migration 069: Fix transaction locks that get stuck forever after their
-- first use.
--
-- app_transaction_locks has `unique (workspace_key, lock_key, lock_type)`
-- (migration 008). acquireTransactionLock() does a plain INSERT and
-- releaseTransactionLock() only ever sets released_at -- it never deletes
-- the row. So the very first successful Adjust/Receive/Transfer (or
-- project/build/purchase-request save) against a given key inserts a row,
-- releases it, and leaves it in the table forever. Every subsequent
-- attempt to lock that SAME key then fails the unique constraint and
-- acquireTransactionLock() throws "Record is locked for another
-- operation" -- even though the prior lock was released minutes or days
-- ago. The save silently no-ops (the client closes the modal regardless)
-- and nothing is logged, which is exactly the "changes don't save, and
-- there's no log entry" symptom.
--
-- Fix: replace the plain-INSERT client call with an atomic upsert
-- function that reclaims a row when it's released or expired, and only
-- raises when a lock is genuinely still held.

create or replace function acquire_transaction_lock(
  p_workspace_key text,
  p_lock_type text,
  p_lock_key text,
  p_owner_label text,
  p_ttl_seconds integer default 300
) returns app_transaction_locks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row app_transaction_locks;
begin
  insert into app_transaction_locks (workspace_key, lock_type, lock_key, owner_label, expires_at, released_at, created_at)
  values (p_workspace_key, p_lock_type, p_lock_key, p_owner_label, now() + make_interval(secs => p_ttl_seconds), null, now())
  on conflict (workspace_key, lock_key, lock_type) do update set
    owner_label = excluded.owner_label,
    expires_at = excluded.expires_at,
    released_at = null,
    created_at = now()
  where app_transaction_locks.released_at is not null
     or app_transaction_locks.expires_at < now()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Record is locked for another operation: %', p_lock_key;
  end if;

  return v_row;
end;
$$;

grant execute on function acquire_transaction_lock(text, text, text, text, integer) to authenticated, anon;

-- One-time cleanup: existing released rows are what's currently blocking
-- everything. Delete them so already-stuck keys work immediately after
-- this migration runs, instead of waiting for the app's next deploy.
delete from app_transaction_locks where released_at is not null;
