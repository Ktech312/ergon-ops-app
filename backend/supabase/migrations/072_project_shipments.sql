-- Migration 072: PM shipping requests, fulfilled by Warehouse/Implementation.
--
-- project_shipping_addresses: a small saved address book per project (a
-- project can have multiple job-site addresses, e.g. separate garages/
-- lots) -- picked from when creating a shipment, or a new one saved for
-- next time.
--
-- project_shipments: the request/fulfillment header. Requested -> Packed
-- -> Shipped (or Cancelled). address_snapshot freezes the address text at
-- request time so editing/deleting a saved address later doesn't change
-- history. Packed and Shipped are separate stamped actions (who/when),
-- matching Warehouse doing the packing-with-photos step first and the
-- carrier/tracking-number step second.
--
-- project_shipment_lines: which BOM items, by name (this app's BOM lines
-- have no stable id -- see project_bom_lines/BomLine -- so shipments key
-- lines by item_name, same convention as everywhere else that references
-- a BOM line) and how much of each ships in *this* shipment, since one
-- BOM line can ship across multiple shipments over time.
--
-- project_shipment_photos: proof-of-packing photos (box/pallet), same
-- shape as project_location_images.

create table if not exists project_shipping_addresses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label text not null default '',
  street_address text not null default '',
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  attn_name text not null default '',
  phone text not null default '',
  line_sort integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_shipping_addresses_project on project_shipping_addresses(project_id, line_sort);

alter table project_shipping_addresses enable row level security;

create policy "authenticated read project_shipping_addresses"
  on project_shipping_addresses for select to authenticated using (true);

create policy "authenticated write project_shipping_addresses"
  on project_shipping_addresses for all to authenticated using (true) with check (true);

create table if not exists project_shipments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  shipment_number text not null,
  address_id uuid references project_shipping_addresses(id) on delete set null,
  address_snapshot text not null default '',
  status text not null default 'Requested' check (status in ('Requested', 'Packed', 'Shipped', 'Cancelled')),
  requested_by_email text not null default '',
  requested_at timestamptz not null default now(),
  notes text not null default '',
  packed_by_email text,
  packed_at timestamptz,
  carrier text,
  tracking_number text,
  shipped_by_email text,
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, shipment_number)
);

create index if not exists idx_project_shipments_project on project_shipments(project_id, created_at desc);

alter table project_shipments enable row level security;

create policy "authenticated read project_shipments"
  on project_shipments for select to authenticated using (true);

create policy "authenticated write project_shipments"
  on project_shipments for all to authenticated using (true) with check (true);

create table if not exists project_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references project_shipments(id) on delete cascade,
  item_name text not null,
  qty numeric not null default 1,
  line_sort integer not null default 0
);

create index if not exists idx_project_shipment_lines_shipment on project_shipment_lines(shipment_id, line_sort);

alter table project_shipment_lines enable row level security;

create policy "authenticated read project_shipment_lines"
  on project_shipment_lines for select to authenticated using (true);

create policy "authenticated write project_shipment_lines"
  on project_shipment_lines for all to authenticated using (true) with check (true);

create table if not exists project_shipment_photos (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references project_shipments(id) on delete cascade,
  storage_path text not null,
  file_name text,
  description text,
  uploaded_at timestamptz not null default now(),
  uploaded_by_email text
);

create index if not exists idx_project_shipment_photos_shipment on project_shipment_photos(shipment_id);

alter table project_shipment_photos enable row level security;

create policy "authenticated read project_shipment_photos"
  on project_shipment_photos for select to authenticated using (true);

create policy "authenticated write project_shipment_photos"
  on project_shipment_photos for all to authenticated using (true) with check (true);

-- Own private bucket, same pattern as project-location-images.
insert into storage.buckets (id, name, public)
values ('project-shipment-photos', 'project-shipment-photos', false)
on conflict (id) do nothing;

drop policy if exists "authenticated read project-shipment-photos objects" on storage.objects;
create policy "authenticated read project-shipment-photos objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'project-shipment-photos');

drop policy if exists "authenticated write project-shipment-photos objects" on storage.objects;
create policy "authenticated write project-shipment-photos objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'project-shipment-photos');

drop policy if exists "authenticated update project-shipment-photos objects" on storage.objects;
create policy "authenticated update project-shipment-photos objects"
  on storage.objects for update to authenticated
  using (bucket_id = 'project-shipment-photos')
  with check (bucket_id = 'project-shipment-photos');

drop policy if exists "authenticated delete project-shipment-photos objects" on storage.objects;
create policy "authenticated delete project-shipment-photos objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-shipment-photos');
