-- Pending-approval workflow, optional account expiration, and per-user tab
-- visibility overrides.
--
-- New sign-ups sit "pending" until a Manager or Admin approves them (optionally
-- with an expiration timer). Admins can additionally grant/restrict exactly
-- which tabs an individual user is allowed to see, beyond their role's default
-- tab set. Role assignment itself becomes admin-only from this point on: users
-- no longer self-assign their own role_key, since role now carries real
-- authority (Manager can approve pending users; tab defaults come from role).

create table if not exists app_user_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'denied')),
  expires_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function is_app_manager(check_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from app_user_roles where user_id = check_user_id and role_key = 'manager'
  );
$$;

alter table app_user_status enable row level security;

create policy "users read their own status"
  on app_user_status for select to authenticated
  using (auth.uid() = user_id or is_app_admin(auth.uid()) or is_app_manager(auth.uid()));

create policy "users request their own pending status"
  on app_user_status for insert to authenticated
  with check (auth.uid() = user_id and approval_status = 'pending');

create policy "admins and managers review status"
  on app_user_status for update to authenticated
  using (is_app_admin(auth.uid()) or is_app_manager(auth.uid()))
  with check (is_app_admin(auth.uid()) or is_app_manager(auth.uid()));

create or replace function set_app_user_status_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists app_user_status_set_updated_at on app_user_status;
create trigger app_user_status_set_updated_at
  before update on app_user_status
  for each row execute function set_app_user_status_updated_at();

-- Per-user tab visibility override. Null = use the role's default tab set.
alter table app_user_roles
  add column if not exists allowed_views text[];

-- Role is now assigned by an admin only. Remove the early-production
-- self-service write policies from migration 010; the read-own-role policy
-- and the admin-writes-everyone policy (migration 012) remain in place.
drop policy if exists "users set their own role during early production" on app_user_roles;
drop policy if exists "users update their own role during early production" on app_user_roles;
