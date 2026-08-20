-- Migration 081: merge Purchase Request + Purchase Order creation into one
-- "Create Purchase" flow, with a real link between the two, and per-order
-- paperwork instead of the migration-080 generic bucket.
--
-- E, after walking the Purchasing page live: Purchase Requests and Purchase
-- Orders were two disconnected lists a person had to keep in sync by hand
-- (mark a request "Ordered" and nothing touches the Orders table; place an
-- order and nothing touches the originating request). The agreed fix: a
-- Request Queue row gets a "Create Purchase" button that opens the same
-- unified creation form pre-filled from the request, creates a real linked
-- Purchase Order, and notifies the PM -- while the original request stays
-- in place as the log/audit trail rather than being replaced.
--
-- purchase_orders.source_request_id: which request (if any) this order was
-- created from.
-- purchase_requests.linked_purchase_order_id: reciprocal -- which order (if
-- any) this request became.
-- purchase_order_files: paperwork attached directly to one exact order --
-- the order confirmation at creation time, and receiving photos/packing
-- slips once it arrives. Same shape as project_shipment_photos (migration
-- 072), just keyed to purchase_order_id and not restricted to images.

alter table purchase_orders add column if not exists source_request_id uuid references purchase_requests(id) on delete set null;
alter table purchase_requests add column if not exists linked_purchase_order_id uuid references purchase_orders(id) on delete set null;

create table if not exists purchase_order_files (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  storage_path text not null,
  file_name text,
  description text,
  uploaded_at timestamptz not null default now(),
  uploaded_by_email text
);

create index if not exists idx_purchase_order_files_order on purchase_order_files(purchase_order_id);

alter table purchase_order_files enable row level security;

create policy "authenticated read purchase_order_files"
  on purchase_order_files for select to authenticated using (true);

create policy "authenticated write purchase_order_files"
  on purchase_order_files for all to authenticated using (true) with check (true);

-- Own private bucket, same pattern as project-shipment-photos.
insert into storage.buckets (id, name, public)
values ('purchase-order-files', 'purchase-order-files', false)
on conflict (id) do nothing;

drop policy if exists "authenticated read purchase-order-files objects" on storage.objects;
create policy "authenticated read purchase-order-files objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'purchase-order-files');

drop policy if exists "authenticated write purchase-order-files objects" on storage.objects;
create policy "authenticated write purchase-order-files objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-order-files');

drop policy if exists "authenticated update purchase-order-files objects" on storage.objects;
create policy "authenticated update purchase-order-files objects"
  on storage.objects for update to authenticated
  using (bucket_id = 'purchase-order-files')
  with check (bucket_id = 'purchase-order-files');

drop policy if exists "authenticated delete purchase-order-files objects" on storage.objects;
create policy "authenticated delete purchase-order-files objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'purchase-order-files');
