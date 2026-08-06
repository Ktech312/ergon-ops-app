-- v1 hardware recommendation engine for Site Builder locations. Different
-- shape from Phase 20's presales_hardware_rules (tier + node count, used for
-- Projects) because a Site Builder garage/lot doesn't have a "tier" or node
-- count -- it has FLI/LPR/People Counting checkboxes plus entry/exit/level
-- counts. Each rule says "for this metric, recommend this many of this
-- item," and the app sums matching active rules per location live -- there
-- is nothing to persist per-quote, only the rules that evaluate it (same
-- pattern as Phase 20).
--
-- These starter values are a deliberate first guess, not a validated spec --
-- edit them from Admin -> Site Hardware Rules once real numbers are known.

create table if not exists site_hardware_rules (
  id uuid primary key default gen_random_uuid(),
  metric text not null check (metric in ('fli', 'lpr', 'people_counting', 'per_entry', 'per_exit', 'per_level')),
  item_name text not null,
  qty_per_unit numeric(10,2) not null default 1,
  notes text,
  sequence_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_site_hardware_rules_metric on site_hardware_rules(metric, sequence_order);

-- Natural key for idempotent re-seeding -- a given metric shouldn't list the
-- same item twice.
create unique index if not exists idx_site_hardware_rules_metric_item
  on site_hardware_rules(metric, item_name);

drop trigger if exists site_hardware_rules_set_updated_at on site_hardware_rules;
create trigger site_hardware_rules_set_updated_at
  before update on site_hardware_rules
  for each row execute function set_updated_at_generic();

alter table site_hardware_rules enable row level security;

create policy "authenticated read site_hardware_rules"
  on site_hardware_rules for select to authenticated using (true);

create policy "pm manager and admin write site_hardware_rules"
  on site_hardware_rules for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('pm') or has_role('manager'))
  with check (is_app_admin(auth.uid()) or has_role('pm') or has_role('manager'));

insert into site_hardware_rules (metric, item_name, qty_per_unit, notes, sequence_order)
values
  ('lpr', 'LPR Camera', 1, 'Starter default: one LPR camera total per location with LPR checked -- split into per-entry/per-exit rules once the real spec is known.', 0),
  ('fli', 'Intercom / FLI Panel', 1, 'Starter default: one intercom panel per location with FLI checked.', 1),
  ('people_counting', 'People Counting Sensor', 1, 'Starter default: one sensor per location with People Counting checked.', 2),
  ('per_entry', 'Entry Camera', 1, 'One camera per entry lane.', 3),
  ('per_exit', 'Exit Camera', 1, 'One camera per exit lane.', 4),
  ('per_level', 'Level Camera', 1, 'One camera per parking level.', 5)
on conflict (metric, item_name) do nothing;
