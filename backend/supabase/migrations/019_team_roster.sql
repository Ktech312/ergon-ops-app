-- Admin-maintained team roster for task assignment.
--
-- Tasks (migration 015) already have an `assignee_email` text field, but the
-- only way to pick a person in the UI was a free-text email box. This adds a
-- simple roster of assignable people (name + email) that admins/managers
-- maintain directly -- someone can be added and assigned tasks before they've
-- ever logged into the app, matching how PM tools like ClickUp let you
-- assign a named teammate who may not be a system user yet. This is
-- intentionally NOT tied to auth.users (no login required), and is separate
-- from the deferred email-invite feature (which is about granting app
-- access, not about naming a person as a task owner).

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  role_title text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_team_members_email
  on team_members(lower(email))
  where email is not null and email <> '';

create index if not exists idx_team_members_active on team_members(is_active, full_name);

create or replace function set_team_members_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists team_members_set_updated_at on team_members;
create trigger team_members_set_updated_at
  before update on team_members
  for each row execute function set_team_members_updated_at();

alter table team_members enable row level security;

create policy "authenticated read team_members"
  on team_members for select to authenticated using (true);

create policy "admins and managers write team_members"
  on team_members for all to authenticated
  using (is_app_admin(auth.uid()) or is_app_manager(auth.uid()))
  with check (is_app_admin(auth.uid()) or is_app_manager(auth.uid()));
