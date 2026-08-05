-- Purchase Orders was the last major "decorative" feature in the app: the
-- Purchasing page's Imported Purchase Queue / Order Line Items / Spend By
-- Project sections all read from a hardcoded, unchangeable JS array of 7
-- real historical vendor orders. There was no way to add a new order,
-- change a status, or persist anything -- it just replayed the same fixed
-- numbers every time the app loaded.
--
-- purchase_orders/purchase_order_lines/vendors already existed (migration
-- 001) but were never used by the app. Two real mismatches needed fixing
-- before they could be:
--
-- 1. purchase_order_lines.inventory_item_id was NOT NULL. Real vendor order
--    lines here are one-off hardware line items (a specific motherboard SKU
--    bought once from Newegg, packs of screws from Amazon) that don't
--    correspond to anything in inventory_items. Made nullable and added a
--    free-text item_name + category, mirroring the project_bom_lines /
--    equipment_bom_components pattern from Phase 10.
-- 2. purchase_orders.status is a fixed enum (draft/submitted/approved/
--    ordered/partially_received/received/cancelled) that doesn't have a
--    slot for "On Hold" and doesn't match the app's 3-state model
--    (Imported/In Processing/On Hold). Rather than risk an unsafe enum
--    change, added app_status (checked text) as the column the app
--    actually reads/writes, same approach as projects.app_status in
--    migration 022. The legacy `status` enum column is still populated
--    (best-effort mapping) so report_purchase_order_status keeps working,
--    but the app itself only looks at app_status.
--
-- Also added project_name/ship_to/payment_note/source_file as plain columns
-- since this app has no per-order location/shipment concept beyond what the
-- vendor PDF said.
--
-- Then seeds the 7 real historical orders (previously hardcoded in
-- src/main.tsx) into the real tables so nothing is lost in the cutover.
-- Safe to re-run: vendors/purchase_orders upsert by natural key, and lines
-- are cleared and reinserted per order (no natural per-line key), same
-- idempotency approach as migration 022's BOM lines.

alter table purchase_order_lines
  alter column inventory_item_id drop not null;

alter table purchase_order_lines
  add column if not exists item_name text,
  add column if not exists category text,
  add column if not exists line_sort integer not null default 0;

update purchase_order_lines set item_name = '' where item_name is null;
alter table purchase_order_lines alter column item_name set not null;
alter table purchase_order_lines alter column item_name set default '';

alter table purchase_orders
  add column if not exists app_status text
    check (app_status in ('Imported', 'In Processing', 'On Hold')),
  add column if not exists project_name text,
  add column if not exists ship_to text,
  add column if not exists payment_note text,
  add column if not exists source_file text;

update purchase_orders set app_status = 'Imported' where app_status is null;
alter table purchase_orders alter column app_status set not null;
alter table purchase_orders alter column app_status set default 'Imported';

-- 1. Vendors
insert into vendors (name)
values ('Amazon'), ('NeweggBusiness')
on conflict (name) do nothing;

-- 2. Purchase orders (upsert by po_number so re-running this file is safe)
insert into purchase_orders (
  po_number, vendor_id, app_status, status, requested_date, subtotal, tax_amount, shipping_amount,
  project_name, ship_to, payment_note, source_file
)
select
  data.po_number,
  v.id,
  data.app_status,
  data.pg_status::purchase_order_status,
  data.requested_date,
  data.subtotal,
  data.tax_amount,
  data.shipping_amount,
  data.project_name,
  data.ship_to,
  data.payment_note,
  data.source_file
from (
  values
    ('1304622160', 'NeweggBusiness', '2026-07-15'::date, 'Straud Medical', 'In Processing', 'ordered', 22436.95, 1738.87, 0, 'EnSight Technologies, Santee CA', 'Visa ending 0950, payment verification pending', '$24,175.82 NeweggBusiness.pdf'),
    ('1304622180', 'NeweggBusiness', '2026-07-15'::date, 'Straud Medical', 'In Processing', 'ordered', 3112.72, 241.24, 0, 'EnSight Technologies, Santee CA', 'Visa ending 0950, payment verification pending', '3,353.96 NeweggBusiness.pdf'),
    ('1304622200', 'NeweggBusiness', '2026-07-15'::date, 'Straud Medical', 'On Hold', 'submitted', 1040, 80.6, 0, 'EnSight Technologies, Santee CA', 'Visa ending 0950, order hold', '1,120.60 NeweggBusiness.pdf'),
    ('112-0918552-2711412', 'Amazon', '2026-07-13'::date, 'Newport News', 'Imported', 'received', 3178.84, 246.35, 0, '10225 Prospect Ave, Santee CA', 'Visa ending 0950 split transactions', 'AMZ $3,286.24 and 138.pdf'),
    ('112-5785858-5127443', 'Amazon', '2026-06-04'::date, 'Newport News 37th St.', 'Imported', 'received', 1298.51, 107.13, 0, '971 Laguna Ave, El Cajon CA', 'Visa ending 0950 split transactions', 'AMZ $790.20 and 615.pdf'),
    ('112-4648611-7664246', 'Amazon', '2026-07-14'::date, 'Newport News', 'Imported', 'received', 918, 55.08, 0, '10225 Prospect Ave, Santee CA', 'Visa ending 0950', 'amz 973.08.pdf'),
    ('112-8691883-8231436', 'Amazon', '2026-07-08'::date, 'Newport News', 'Imported', 'received', 73.49, 6.06, 0, '10225 Prospect Ave, Santee CA', 'Visa ending 0950', 'AMZ 79.55.pdf')
) as data(po_number, vendor_name, requested_date, project_name, app_status, pg_status, subtotal, tax_amount, shipping_amount, ship_to, payment_note, source_file)
join vendors v on v.name = data.vendor_name
on conflict (po_number) do update set
  vendor_id = excluded.vendor_id,
  app_status = excluded.app_status,
  status = excluded.status,
  requested_date = excluded.requested_date,
  subtotal = excluded.subtotal,
  tax_amount = excluded.tax_amount,
  shipping_amount = excluded.shipping_amount,
  project_name = excluded.project_name,
  ship_to = excluded.ship_to,
  payment_note = excluded.payment_note,
  source_file = excluded.source_file;

-- 3. Lines. No natural unique key per line, so clear and reinsert for the
-- 7 seeded orders each time this file runs.
delete from purchase_order_lines
where purchase_order_id in (
  select id from purchase_orders where po_number in (
    '1304622160', '1304622180', '1304622200',
    '112-0918552-2711412', '112-5785858-5127443', '112-4648611-7664246', '112-8691883-8231436'
  )
);

insert into purchase_order_lines (purchase_order_id, item_name, category, quantity_ordered, unit_cost, line_sort)
select po.id, l.item_name, l.category, l.qty, l.unit_cost, l.line_sort
from (
  values
    ('1304622160', 'ASRock Z890 Taichi motherboard', 'Compute', 13, 199.99, 0),
    ('1304622160', 'Intel Core Ultra 7 270K Plus processor', 'Compute', 17, 311.5, 1),
    ('1304622160', 'CORSAIR RM1000x ATX power supply', 'Power', 14, 217.99, 2),
    ('1304622160', 'Rosewill 2U rackmount server chassis', 'Rack', 13, 149.99, 3),
    ('1304622160', 'GIGABYTE WindForce RTX 5070 graphics card', 'Compute', 15, 635.99, 4),
    ('1304622180', 'Samsung 990 PRO SSD 1TB M.2 drive', 'Storage', 13, 239.44, 0),
    ('1304622200', 'Seagate Desktop HDD 2TB SATA internal drive', 'Storage', 13, 80, 0),
    ('112-0918552-2711412', 'AC Infinity AXIAL 8038 cooling fan', 'Enclosure', 7, 18.42, 0),
    ('112-0918552-2711412', 'Bud Industries IPV-1116 air vent', 'Enclosure', 20, 11.99, 1),
    ('112-0918552-2711412', 'VEVOR NEMA 4X steel electrical enclosure', 'Enclosure', 19, 147.9, 2),
    ('112-5785858-5127443', 'Self-drilling screw assortment kit', 'Hardware', 1, 7.59, 0),
    ('112-5785858-5127443', 'OM4 LC to LC fiber patch cable', 'Network', 1, 6.83, 1),
    ('112-5785858-5127443', 'ICC CAT6 wall mount patch panel', 'Network', 1, 53.1, 2),
    ('112-5785858-5127443', 'Outdoor electrical box with fan and thermostat', 'Enclosure', 1, 169.99, 3),
    ('112-5785858-5127443', 'Aluminum DIN rails, 30 piece pack', 'Hardware', 1, 18.99, 4),
    ('112-5785858-5127443', '10GBase-LR SFP+ transceiver pack', 'Network', 1, 94.89, 5),
    ('112-5785858-5127443', 'Self tapping screw kit', 'Hardware', 1, 7.98, 6),
    ('112-5785858-5127443', 'Goldenmate lithium UPS battery backup', 'Power', 1, 175.99, 7),
    ('112-5785858-5127443', 'Cat6/Cat6a 1ft patch cables, 24 pack', 'Network', 1, 19.94, 8),
    ('112-5785858-5127443', 'Screw mount zip tie anchors', 'Hardware', 1, 14.23, 9),
    ('112-5785858-5127443', 'TRENDnet 240W DIN-rail power supply', 'Power', 1, 168.99, 10),
    ('112-5785858-5127443', 'TRENDnet 26-port industrial PoE switch', 'Network', 1, 559.99, 11),
    ('112-4648611-7664246', 'Tecmojo 42U server rack network cabinet', 'Rack', 1, 918, 0),
    ('112-8691883-8231436', '19-inch rack mount for UCG-Fiber and UXG-Fiber', 'Rack', 1, 73.49, 0)
) as l(po_number, item_name, category, qty, unit_cost, line_sort)
join purchase_orders po on po.po_number = l.po_number;
