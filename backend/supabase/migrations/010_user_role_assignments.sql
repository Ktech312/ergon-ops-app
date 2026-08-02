-- Per-user role assignments for production role-based views.

create table if not exists app_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_key text not null check (role_key in ('warehouse', 'purchasing', 'pm', 'manager')),
  updated_at timestamptz not null default now()
);

alter table app_user_roles enable row level security;

create policy "users read their own role"
  on app_user_roles for select to authenticated
  using (auth.uid() = user_id);

create policy "users set their own role during early production"
  on app_user_roles for insert to authenticated
  with check (auth.uid() = user_id);

create policy "users update their own role during early production"
  on app_user_roles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function set_app_user_role_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists app_user_roles_set_updated_at on app_user_roles;
create trigger app_user_roles_set_updated_at
  before update on app_user_roles
  for each row execute function set_app_user_role_updated_at();
