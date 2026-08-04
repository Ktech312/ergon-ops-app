-- Phase 20: pre-sales hardware rules engine. Derives a baseline hardware
-- list from a short questionnaire (environment tier, node count, cloud
-- sync) at the sales stage, before a project has a firm BOM. The
-- questionnaire itself has nothing worth persisting -- only the rules that
-- evaluate it are stored, and the output writes straight into the existing
-- `project_bom_lines` table, same as every other BOM source in this app.

create table if not exists presales_hardware_rules (
  id uuid primary key default gen_random_uuid(),
  tier text not null,
  base_item_name text not null,
  quantity_mode text not null default 'fixed' check (quantity_mode in ('fixed', 'per_node_ceil')),
  fixed_qty numeric(10,2) not null default 1,
  per_node_divisor numeric(10,2),
  requires_cloud_sync boolean,
  sequence_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_presales_rules_tier on presales_hardware_rules(tier, sequence_order);

-- Natural key for idempotent re-seeding -- a given tier shouldn't list the
-- same base item twice.
create unique index if not exists idx_presales_rules_tier_item
  on presales_hardware_rules(tier, base_item_name);

drop trigger if exists presales_hardware_rules_set_updated_at on presales_hardware_rules;
create trigger presales_hardware_rules_set_updated_at
  before update on presales_hardware_rules
  for each row execute function set_updated_at_generic();

alter table presales_hardware_rules enable row level security;

create policy "authenticated read presales_hardware_rules"
  on presales_hardware_rules for select to authenticated using (true);

create policy "pm and admin write presales_hardware_rules"
  on presales_hardware_rules for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('pm'))
  with check (is_app_admin(auth.uid()) or has_role('pm'));

-- Starter rule set so the panel isn't empty on first use -- an admin edits
-- tiers, items, and quantities from Admin -> Pre-Sales Rules from here on.
insert into presales_hardware_rules (tier, base_item_name, quantity_mode, fixed_qty, per_node_divisor, requires_cloud_sync, sequence_order)
values
  ('Commercial Office', 'Sign Controller', 'fixed', 1, null, null, 0),
  ('Commercial Office', 'Single Space Sensor', 'per_node_ceil', 1, 16, null, 1),
  ('Industrial Plant', 'Outdoor PoE Box', 'per_node_ceil', 1, 12, null, 0),
  ('Industrial Plant', 'UPS Unit', 'fixed', 1, null, null, 1),
  ('Marine/Outdoor', 'Outdoor PoE Box', 'per_node_ceil', 1, 8, null, 0),
  ('Marine/Outdoor', 'Solar Kit', 'fixed', 1, null, null, 1),
  ('Commercial Office', 'LTE Modem', 'fixed', 1, null, true, 2),
  ('Industrial Plant', 'LTE Modem', 'fixed', 1, null, true, 2),
  ('Marine/Outdoor', 'LTE Modem', 'fixed', 1, null, true, 2)
on conflict (tier, base_item_name) do nothing;
