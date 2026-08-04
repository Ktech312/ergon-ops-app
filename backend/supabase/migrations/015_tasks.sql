-- Task management, grouped by status like a ClickUp-style task list, but
-- scoped to Ergon's own sections (warehouse, purchasing, inventory, projects,
-- sales, engineering, general/internal work not tied to any client project).
--
-- project_ref is a free-text pointer to a project (by ref or name) rather than
-- a strict foreign key, for the same reason product_catalog.linked_reference
-- is free text: projects currently live in the app_records JSON blob, not in
-- the relational `projects` table, so a real FK would not reliably resolve.
--
-- impact_areas lets a task note which parts of the business it touches when
-- completed (Inventory, Purchasing, Sales, Projects, Reports, Other). This is
-- informational only for now -- completing a task does not yet automatically
-- trigger changes in those other areas. That kind of automation needs specific
-- rules per impact type and should be scoped as its own follow-up once it's
-- clear which completions should trigger which effects.

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  task_number text not null unique,
  title text not null,
  description text,
  section text not null default 'general'
    check (section in ('warehouse', 'purchasing', 'inventory', 'projects', 'sales', 'engineering', 'general')),
  project_ref text,
  is_internal boolean not null default true,
  status text not null default 'to_do'
    check (status in ('to_do', 'in_progress', 'ready_for_review', 'done', 'blocked')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  category text,
  impact_areas text[] not null default '{}'::text[],
  assignee_user_id uuid references auth.users(id),
  assignee_email text,
  due_date date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_tasks_status on tasks(status, due_date);
create index if not exists idx_tasks_section on tasks(section);
create index if not exists idx_tasks_project_ref on tasks(project_ref);
create index if not exists idx_tasks_assignee on tasks(assignee_user_id);

create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at();

alter table tasks enable row level security;

create policy "authenticated read tasks"
  on tasks for select to authenticated using (true);

create policy "authenticated write tasks"
  on tasks for all to authenticated using (true) with check (true);
