-- Real invite flow: an Admin fills out an invite (mandatory email +
-- mandatory primary role + optional secondary roles), the app emails a
-- unique signup link, and the person who clicks it lands on a landing page
-- that already knows their email/role before they ever create an account.
-- Accepting the invite auto-approves the account (skips the
-- Pending-Approvals queue entirely, since the invite itself was the
-- approval) and assigns the roles the admin picked.
--
-- Self-contained: the token lives directly on this table rather than going
-- through the generic public_share_tokens table from migration 025, since
-- that table is designed for entities that already exist and are managed by
-- an authenticated user (submittals); an invite's whole point is to work
-- before the invitee has any account at all.

create extension if not exists pgcrypto;

create table if not exists user_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  email text not null,
  full_name text,
  primary_role text not null,
  secondary_roles text[] not null default '{}',
  invited_by_email text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists idx_user_invites_email on user_invites(email);
create index if not exists idx_user_invites_status on user_invites(status);

alter table user_invites enable row level security;

create policy "admins manage user_invites"
  on user_invites for all to authenticated
  using (is_app_admin(auth.uid()))
  with check (is_app_admin(auth.uid()));

-- Anon-safe lookup by token for the pre-login invite landing page. Returns
-- only the sanitized fields the page needs to render a welcome message and
-- prefill the signup form -- never exposes the raw table (which would leak
-- every invited email + token to anyone who could query user_invites
-- directly, since the token itself is the secret).
create or replace function get_invite_by_token(lookup_token text)
returns table (
  email text,
  full_name text,
  primary_role text,
  secondary_roles text[],
  status text
)
language sql
security definer
stable
as $$
  select i.email, i.full_name, i.primary_role, i.secondary_roles, i.status
  from user_invites i
  where i.token = lookup_token
    and i.expires_at > now();
$$;

grant execute on function get_invite_by_token(text) to anon, authenticated;

-- Called by the invitee's own freshly-created session (their own auth.uid(),
-- never a caller-supplied id -- so an authenticated user can never use this
-- to grant themselves someone else's invited role) right after they finish
-- signup/Google OAuth from the landing page. Assigns the primary + secondary
-- roles the admin chose, using the same delete-then-upsert pattern as
-- setPrimaryUserRole, and marks the account approved so it skips the
-- Pending-Approvals queue.
create or replace function accept_invite(lookup_token text)
returns void
language plpgsql
security definer
as $$
declare
  invite_row user_invites;
  calling_user uuid := auth.uid();
  secondary_role text;
begin
  if calling_user is null then
    raise exception 'Must be signed in to accept an invite';
  end if;

  select * into invite_row
  from user_invites
  where token = lookup_token
    and status = 'pending'
    and expires_at > now()
  for update;

  if invite_row.id is null then
    raise exception 'Invite not found, already used, or expired';
  end if;

  update user_invites
  set status = 'accepted', accepted_at = now(), accepted_user_id = calling_user
  where id = invite_row.id;

  delete from app_user_roles
  where user_id = calling_user and is_primary = true and role_key <> invite_row.primary_role;

  insert into app_user_roles (user_id, role_key, is_primary)
  values (calling_user, invite_row.primary_role, true)
  on conflict (user_id, role_key) do update set is_primary = true;

  foreach secondary_role in array invite_row.secondary_roles loop
    insert into app_user_roles (user_id, role_key, is_primary)
    values (calling_user, secondary_role, false)
    on conflict (user_id, role_key) do nothing;
  end loop;

  insert into app_user_status (user_id, approval_status, approved_at, requested_at)
  values (calling_user, 'approved', now(), now())
  on conflict (user_id) do update set approval_status = 'approved', approved_at = now();
end;
$$;

grant execute on function accept_invite(text) to authenticated;
