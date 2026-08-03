-- Adds a real admin capability so one or more users can manage everyone else's
-- role, plus a lightweight directory of users who have signed in (id + email).
-- auth.users is not exposed through the REST API, so the app cannot otherwise
-- list "who exists" to assign roles to. Each user upserts their own directory
-- row on sign-in; admins can read the full directory.

create table if not exists app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function is_app_admin(check_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from app_admins where user_id = check_user_id);
$$;

alter table app_admins enable row level security;

create policy "admins read admin list"
  on app_admins for select to authenticated
  using (is_app_admin(auth.uid()));

create policy "admins manage admin list"
  on app_admins for all to authenticated
  using (is_app_admin(auth.uid()))
  with check (is_app_admin(auth.uid()));

create table if not exists app_known_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table app_known_users enable row level security;

create policy "users upsert their own directory row"
  on app_known_users for insert to authenticated
  with check (auth.uid() = user_id);

create policy "users update their own directory row"
  on app_known_users for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users and admins read directory"
  on app_known_users for select to authenticated
  using (auth.uid() = user_id or is_app_admin(auth.uid()));

-- Let admins see and manage everyone's operational role, not just their own.
-- These are additive to the existing self-service policies from migration 010.
create policy "admins read all roles"
  on app_user_roles for select to authenticated
  using (is_app_admin(auth.uid()));

create policy "admins manage all roles"
  on app_user_roles for all to authenticated
  using (is_app_admin(auth.uid()))
  with check (is_app_admin(auth.uid()));

create index if not exists idx_app_known_users_email on app_known_users(email);
