-- Partial receipt tracking for purchase requests.

alter table purchase_requests
  add column if not exists quantity_received numeric(12,2) not null default 0 check (quantity_received >= 0);

create index if not exists idx_purchase_requests_open_receipts
  on purchase_requests(status, quantity_requested, quantity_received)
  where status not in ('received', 'cancelled');
