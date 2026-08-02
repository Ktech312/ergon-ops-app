-- Purchasing order tracking fields for requests before they become full POs.

alter table purchase_requests
  add column if not exists po_number text,
  add column if not exists expected_date date;

create index if not exists idx_purchase_requests_po_number on purchase_requests(po_number);
create index if not exists idx_purchase_requests_expected_date on purchase_requests(expected_date);
