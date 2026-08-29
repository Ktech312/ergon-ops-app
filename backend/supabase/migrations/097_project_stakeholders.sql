-- Migration 097: Project Stakeholders.
--
-- E: "Good to have a stakeholder section including any addresses." The
-- existing Address Book (migrations 076-078) covers exactly 3 fixed roles
-- -- Client, Billing, Shipping -- with no way to add an arbitrary contact
-- like a property owner, general contractor, or electrician, and no email
-- field on any of those cards. This adds a genuinely open-ended
-- stakeholder list per project instead of widening the fixed 3 cards.
--
-- Same "one-to-many table per project, lazily loaded" shape as
-- installed_assets (migration 089) -- kept out of the big PROJECT_SITE_SELECT
-- query so an un-run migration only affects this one feature, not the
-- whole Projects page.

create table if not exists project_stakeholders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  role text not null,
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  created_by_email text,
  created_at timestamptz not null default now(),
  deleted_by_email text,
  deleted_at timestamptz
);

create index if not exists idx_project_stakeholders_project on project_stakeholders(project_id, created_at);

alter table project_stakeholders enable row level security;

create policy "authenticated read project_stakeholders"
  on project_stakeholders for select to authenticated using (true);

create policy "authenticated write project_stakeholders"
  on project_stakeholders for all to authenticated using (true) with check (true);
