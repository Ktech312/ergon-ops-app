-- Removes the generic placeholder Pre-Sales tier seed data from migration
-- 028 ("Commercial Office"/"Industrial Plant"/"Marine/Outdoor" with made-up
-- items like Solar Kit/UPS Unit) -- it never reflected E's actual hardware
-- and only existed so the panel wasn't empty on first use. Real tiers are
-- now sourced from Product Catalog categories instead (see main.tsx's
-- Pre-Sales Rules editor), so there's nothing to seed in its place here --
-- an admin just picks from whatever categories already exist in the
-- catalog.
delete from presales_hardware_rules
where (tier, base_item_name) in (
  ('Commercial Office', 'Sign Controller'),
  ('Commercial Office', 'Single Space Sensor'),
  ('Industrial Plant', 'Outdoor PoE Box'),
  ('Industrial Plant', 'UPS Unit'),
  ('Marine/Outdoor', 'Outdoor PoE Box'),
  ('Marine/Outdoor', 'Solar Kit'),
  ('Commercial Office', 'LTE Modem'),
  ('Industrial Plant', 'LTE Modem'),
  ('Marine/Outdoor', 'LTE Modem')
);

-- Procurement approval gate: a BOM line no longer fires a purchase request
-- or an inventory pull the moment it's added to a project. It's recorded as
-- a draft with the intended fulfillment track, and only actually
-- pulled/queued once a submittal for that project has been approved by the
-- client and someone clicks "Send to Procurement" (see main.tsx's
-- handleSendBomToPurchasing). purchasing_sent_at marks which lines have
-- already been processed, so a repeat click doesn't double-queue them.
alter table project_bom_lines add column if not exists procurement_track text not null default 'warehouse_stock' check (procurement_track in ('pull', 'warehouse_stock', 'direct_to_project'));
alter table project_bom_lines add column if not exists purchasing_sent_at timestamptz;

-- "Purchasing" -> "Procurement" rename: the nav tab and the rest of the UI
-- now say "Procurement" throughout, so the project lifecycle status needs
-- to match or it'll look inconsistent. Existing rows are updated in place,
-- then the check constraint is swapped to only allow the new spelling.
update projects set app_status = 'Procurement' where app_status = 'Purchasing';
alter table projects drop constraint if exists projects_app_status_check;
alter table projects add constraint projects_app_status_check
  check (app_status in ('Draft', 'Planning', 'Procurement', 'Staging', 'Install Ready'));
