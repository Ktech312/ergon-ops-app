-- Live-discovered follow-up to migration 122. respond_to_submittal() sets
-- search_path='' (correct hardening) and calls public.get_users_by_role()/
-- public.get_admin_emails() to resolve pm+admin notification recipients.
-- Those two functions (migrations 042/049) predate the search_path=''
-- discipline and have no SET clause of their own -- in Postgres, a called
-- function with no SET clause runs under whatever search_path is already
-- active in its caller's execution scope. Since respond_to_submittal's
-- scope has search_path='', get_users_by_role's own unqualified
-- `from app_user_roles r` / `left join app_known_users k` failed to
-- resolve ("relation app_user_roles does not exist"), confirmed live
-- during migration 122's own test script run.
--
-- The proposal-response fix (migrations 119/121) never hit this: it
-- notifies via the quote's own created_by_email column directly and
-- never calls either of these two functions. This is specific to the
-- submittal fix's different (role-lookup) recipient model.
--
-- Pure hardening, no business-logic change: same tables, same join, same
-- filter, same recipients, same signature (create or replace, no DROP
-- needed). Brings both functions in line with the search_path=''
-- + full-qualification discipline already used everywhere else tonight.

begin;

create or replace function public.get_users_by_role(target_role text)
returns table (user_id uuid, email text)
language sql
security definer
stable
set search_path = ''
as $$
  select distinct r.user_id, k.email
  from public.app_user_roles r
  left join public.app_known_users k on k.user_id = r.user_id
  where r.role_key = target_role
    and k.email is not null;
$$;

revoke all on function public.get_users_by_role(text) from public;
revoke execute on function public.get_users_by_role(text) from anon;
grant execute on function public.get_users_by_role(text) to authenticated;

create or replace function public.get_admin_emails()
returns table (user_id uuid, email text)
language sql
security definer
stable
set search_path = ''
as $$
  select distinct a.user_id, k.email
  from public.app_admins a
  left join public.app_known_users k on k.user_id = a.user_id
  where k.email is not null;
$$;

revoke all on function public.get_admin_emails() from public;
revoke execute on function public.get_admin_emails() from anon;
grant execute on function public.get_admin_emails() to authenticated;

commit;
