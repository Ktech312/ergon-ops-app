-- Phase 21: link a task to the BOM line(s)/inventory it depends on, so
-- moving a task to "in_progress" can auto-reserve stock or queue a purchase
-- request. Deliberately points at the real `project_bom_lines` and
-- `inventory_items` tables (Phase 10f/10c) rather than inventing a parallel
-- "hardware_allocations" table. All the actual reserve-or-queue logic is
-- client-side (see persistence.ts/main.tsx) -- no Edge Function, no
-- service-role key, same authenticated-write pattern as every other action
-- in this app.

create table if not exists task_hardware_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  project_bom_line_id uuid references project_bom_lines(id) on delete set null,
  inventory_item_id uuid references inventory_items(id),
  quantity_required numeric(10,2) not null default 1,
  fulfillment_status text not null default 'pending'
    check (fulfillment_status in ('pending', 'allocated', 'procurement_queued')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_task_hardware_deps_task on task_hardware_dependencies(task_id);

drop trigger if exists task_hardware_dependencies_set_updated_at on task_hardware_dependencies;
create trigger task_hardware_dependencies_set_updated_at
  before update on task_hardware_dependencies
  for each row execute function set_updated_at_generic();

alter table task_hardware_dependencies enable row level security;

-- Matches `tasks`' own policy: deliberately unrestricted across
-- authenticated users (migration 023's comments call this out explicitly
-- for the tasks table itself; dependencies follow the same rule).
create policy "authenticated read task_hardware_dependencies"
  on task_hardware_dependencies for select to authenticated using (true);

create policy "authenticated write task_hardware_dependencies"
  on task_hardware_dependencies for all to authenticated using (true) with check (true);
