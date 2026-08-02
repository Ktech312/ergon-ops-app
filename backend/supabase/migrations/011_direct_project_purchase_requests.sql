-- Adds direct-to-project sourcing fields for purchase requests.
-- Warehouse-stock requests increase inventory when received.
-- Direct-to-project requests are received against a project and should not
-- inflate available warehouse stock.

alter table purchase_requests
  add column if not exists procurement_track text not null default 'warehouse_stock'
    check (procurement_track in ('warehouse_stock', 'direct_to_project')),
  add column if not exists project_name text,
  add column if not exists received_destination text not null default 'warehouse'
    check (received_destination in ('warehouse', 'project', 'client_site'));

alter table purchase_requests
  drop constraint if exists purchase_requests_reason_check;

alter table purchase_requests
  add constraint purchase_requests_reason_check
  check (reason in ('reorder_point', 'planned_build_shortage', 'manual', 'project_bom'));

create index if not exists idx_purchase_requests_project_name
  on purchase_requests(project_name);

create index if not exists idx_purchase_requests_procurement_track
  on purchase_requests(procurement_track);
