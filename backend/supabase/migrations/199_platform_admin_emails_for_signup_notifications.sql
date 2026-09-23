-- Migration 199: get_platform_admin_emails(), the one new piece of schema
-- Stage 7's login-page redesign batch needs (E's own spec, 2026-09-22,
-- item 7): "Create a durable in-app notification for platform admins...
-- Send the request notification to the configured Ergon platform-admin
-- email... Do not notify ordinary company admins."
--
-- Mirrors get_admin_emails() (migration 123) exactly -- same shape, same
-- join-through-app_known_users pattern (this schema's established way to
-- get a real email from a *_admins.user_id without querying auth.users
-- directly), same security posture -- but resolves public.platform_admins
-- (migration 115), never public.app_admins. Conflating those two was
-- exactly this session's earlier, already-corrected security mistake
-- (migration 196) -- get_admin_emails() must never be reused here, a
-- genuinely separate function is the only way "do not notify ordinary
-- company admins" is actually enforced rather than just intended.
--
-- Deliberately NOT granted to `authenticated` or `anon` at all -- unlike
-- get_admin_emails() (grantable to authenticated, since any signed-in
-- Ergon employee can already see the admin roster elsewhere), platform
-- admin emails are the whole platform's contact list and have no reason
-- to be resolvable by an ordinary signed-in user. The only caller is
-- api/request-company-signup.js's service-role connection (Postgres
-- superuser/service-role bypasses grants entirely), matching
-- submit_company_signup_request()'s own grantless posture (migration 195).

begin;

create or replace function public.get_platform_admin_emails()
returns table (user_id uuid, email text)
language sql
security definer
stable
set search_path = ''
as $$
  select distinct p.user_id, k.email
  from public.platform_admins p
  left join public.app_known_users k on k.user_id = p.user_id
  where k.email is not null;
$$;

revoke all on function public.get_platform_admin_emails() from public;
revoke execute on function public.get_platform_admin_emails() from anon;
revoke execute on function public.get_platform_admin_emails() from authenticated;

commit;
