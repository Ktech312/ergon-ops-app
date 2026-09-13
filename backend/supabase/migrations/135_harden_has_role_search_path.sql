-- Queue A14 (2026-09-12): hardens has_role() (migration 023) to match the
-- search_path='' / fully-qualified / minimum-grants discipline every
-- function since migration 124 has followed. Confirm 135 is still the
-- next free migration number at execution time -- do not assume it if
-- other migrations have landed since this was drafted.
--
-- Why this matters: has_role() is SECURITY DEFINER but has never pinned
-- its own search_path, and its one internal reference (`app_user_roles`)
-- is unqualified. Every real call site is an RLS policy's own using()/
-- with check() clause (migrations 023/025/026/028/033/045/046/053 --
-- confirmed by a full grep across every migration file, not assumed),
-- always on a policy scoped `for all to authenticated`. Because the
-- function is SECURITY DEFINER, Postgres locks its EFFECTIVE ROLE to the
-- function's owner, but does NOT reset search_path unless the function
-- itself sets one -- so a caller can still influence which schema an
-- unqualified name inside the function body resolves to by SET search_path
-- in their own session before the policy check runs. If that caller can
-- also create an object named `app_user_roles` in some schema earlier in
-- their own search_path, the unqualified reference inside has_role()'s
-- body could resolve to that shadow object instead of the real
-- public.app_user_roles -- the exact class of risk migration 124's own
-- header describes and that this migration closes for the one helper
-- 124 deliberately left alone.
--
-- Logic, signature, and return value are byte-for-byte unchanged --
-- this is a search_path/qualification hardening pass only, never a
-- behavior change:
create or replace function public.has_role(check_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_user_roles where user_id = auth.uid() and role_key = check_role
  );
$$;

-- Minimum grants, matching every hardened function since migration 124.
-- Reasoned, not assumed: has_role() never had an explicit grant/revoke
-- statement before this migration (confirmed by grep -- migration 023
-- relied entirely on Postgres' implicit default EXECUTE-to-PUBLIC), so
-- both `anon` and `authenticated` could technically call it directly
-- today. In practice this was already inert for `anon` -- every real
-- caller is an RLS policy scoped `for all to authenticated`, so an anon
-- session invoking has_role() directly outside a policy context still
-- only ever sees auth.uid() as null, meaning every check_role comparison
-- already returns false for anon regardless of this grant. Revoking the
-- unused anon/public path is a pure tightening with zero change to any
-- real authorization result for any real caller -- not a new decision,
-- just closing a grant nothing legitimate ever used.
revoke all on function public.has_role(text) from public;
revoke execute on function public.has_role(text) from anon;
grant execute on function public.has_role(text) to authenticated;

-- No policy, role vocabulary, or RLS behavior changes anywhere in this
-- file -- every existing policy that calls has_role('warehouse'|'pm'|
-- 'purchasing'|'manager') keeps calling the exact same function name
-- with the exact same signature; only what happens inside the function
-- body and who may invoke it directly (not through a policy) changed.
