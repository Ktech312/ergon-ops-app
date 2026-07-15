insert into departments (name, description)
values
  ('Leadership', 'Executive planning, approvals, and company priorities'),
  ('Engineering', 'Technical design, review, and delivery work'),
  ('Product Management', 'Product planning, roadmap, and requirements'),
  ('Sales', 'Sales pipeline, customer handoff, and account coordination'),
  ('Projects / Implementation', 'Customer project setup, scheduling, and delivery'),
  ('Support Services', 'Post-launch support, customer issues, and service requests')
on conflict (name) do nothing;

insert into vendors (name, contact_name, email, phone, website)
values
  ('Demo Supply Co.', 'Jamie Rivera', 'orders@demosupply.example', '555-0100', 'https://example.com'),
  ('Northwind Industrial', 'Morgan Chen', 'sales@northwind.example', '555-0125', 'https://example.com')
on conflict (name) do nothing;

insert into projects (project_name, customer_name, status, department_id, start_date, target_date, google_drive_url, notes)
select
  'Project Alpha',
  'Acme Customer',
  'active',
  d.id,
  current_date,
  current_date + interval '45 days',
  'https://drive.google.com/',
  'Seed project for inventory transfer reporting.'
from departments d
where d.name = 'Projects / Implementation'
on conflict (project_name) do nothing;

insert into locations (name, code, location_type, address)
values
  ('Main Warehouse', 'WH-001', 'warehouse', 'Main warehouse'),
  ('Staging Area', 'STAGE', 'staging', 'Implementation staging area')
on conflict (name) do nothing;

insert into locations (name, code, location_type, project_id)
select
  'Project Alpha Site',
  'PA-SITE',
  'project_site',
  p.id
from projects p
where p.project_name = 'Project Alpha'
on conflict (name) do nothing;

insert into inventory_items (sku, item_name, description, category, unit_of_measure, reorder_point, target_stock_level, default_unit_cost, preferred_vendor_id)
select
  'CAB-001',
  'Control Cable',
  'Demo cable used by implementation projects.',
  'Electrical',
  'ft',
  250,
  1000,
  1.75,
  v.id
from vendors v
where v.name = 'Demo Supply Co.'
on conflict (sku) do nothing;

insert into inventory_items (sku, item_name, description, category, unit_of_measure, reorder_point, target_stock_level, default_unit_cost, preferred_vendor_id)
select
  'KIT-100',
  'Installation Kit',
  'Standard field installation kit.',
  'Kits',
  'each',
  10,
  50,
  125.00,
  v.id
from vendors v
where v.name = 'Northwind Industrial'
on conflict (sku) do nothing;

insert into inventory_balances (inventory_item_id, location_id, quantity_on_hand, quantity_reserved)
select i.id, l.id, 750, 0
from inventory_items i
cross join locations l
where i.sku = 'CAB-001'
  and l.name = 'Main Warehouse'
on conflict (inventory_item_id, location_id) do update
set quantity_on_hand = excluded.quantity_on_hand,
    quantity_reserved = excluded.quantity_reserved;

insert into inventory_balances (inventory_item_id, location_id, quantity_on_hand, quantity_reserved)
select i.id, l.id, 24, 0
from inventory_items i
cross join locations l
where i.sku = 'KIT-100'
  and l.name = 'Main Warehouse'
on conflict (inventory_item_id, location_id) do update
set quantity_on_hand = excluded.quantity_on_hand,
    quantity_reserved = excluded.quantity_reserved;

insert into purchase_orders (po_number, vendor_id, status, requested_date, expected_date, document_url, notes, subtotal, tax_amount, shipping_amount)
select
  'PO-1001',
  v.id,
  'ordered',
  current_date - interval '5 days',
  current_date + interval '7 days',
  'https://drive.google.com/',
  'Seed purchase order for demo reporting.',
  875.00,
  70.00,
  25.00
from vendors v
where v.name = 'Demo Supply Co.'
on conflict (po_number) do nothing;

insert into purchase_order_lines (purchase_order_id, inventory_item_id, destination_location_id, quantity_ordered, quantity_received, unit_cost, notes)
select po.id, i.id, l.id, 500, 0, 1.75, 'Control cable replenishment'
from purchase_orders po
join inventory_items i on i.sku = 'CAB-001'
join locations l on l.name = 'Main Warehouse'
where po.po_number = 'PO-1001';

insert into inventory_movements (movement_type, inventory_item_id, quantity, from_location_id, to_location_id, project_id, reference_number, notes)
select
  'project_issue',
  i.id,
  100,
  wh.id,
  site.id,
  p.id,
  'XFER-1001',
  'Initial material transfer to Project Alpha.'
from inventory_items i
join locations wh on wh.name = 'Main Warehouse'
join locations site on site.name = 'Project Alpha Site'
join projects p on p.project_name = 'Project Alpha'
where i.sku = 'CAB-001';

insert into project_inventory_allocations (project_id, inventory_item_id, source_location_id, quantity_allocated, allocation_status, notes)
select
  p.id,
  i.id,
  wh.id,
  100,
  'issued',
  'Seed allocation for Project Alpha report.'
from projects p
join inventory_items i on i.sku = 'CAB-001'
join locations wh on wh.name = 'Main Warehouse'
where p.project_name = 'Project Alpha';
