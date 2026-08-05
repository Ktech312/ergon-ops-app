-- Part 1: gate Product Catalog writes to Admin + Manager only.
--
-- Migration 023 (Phase 9 role-based RLS) explicitly left product_catalog
-- open to any authenticated user because no "sales" role existed in
-- app_user_roles' check constraint. E asked for the catalog to be an
-- admin/manager-maintained information section (datasheets + actively sold
-- products), so this reuses the existing 'manager' role_key rather than
-- inventing a new one -- same has_role()/is_app_admin() pattern as every
-- other Phase 9 policy.

drop policy if exists "authenticated write product_catalog" on product_catalog;
create policy "manager and admin write product_catalog"
  on product_catalog for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('manager'))
  with check (is_app_admin(auth.uid()) or has_role('manager'));

-- Part 2: Sales Quote Builder. A quote starts with a client/site and a
-- count of garages and parking lots; those counts generate one location
-- line item per garage/lot for the sales person to name and detail
-- (FLI/LPR/people counting, entries/exits, levels) and attach a photo
-- (captured on the spot) or an uploaded image/drawing. The hardware rules
-- engine that will size cameras/signs per location from these answers is
-- intentionally NOT built here -- E asked for a placeholder now, engine
-- logic later -- so there's no rules/output table yet, just the inputs it
-- will eventually read.
--
-- Left open to any authenticated user (not manager/admin-gated) since
-- sales reps themselves need to create and edit their own quotes, matching
-- how migration 023 left product_documents and tasks ungated for the same
-- reason (no single role owns this workflow).

create table if not exists sales_quotes (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  site_name text not null,
  city text,
  created_by_email text,
  created_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_sales_quotes_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sales_quotes_set_updated_at on sales_quotes;
create trigger sales_quotes_set_updated_at
  before update on sales_quotes
  for each row execute function set_sales_quotes_updated_at();

alter table sales_quotes enable row level security;

create policy "authenticated read sales_quotes"
  on sales_quotes for select to authenticated using (true);

create policy "authenticated write sales_quotes"
  on sales_quotes for all to authenticated using (true) with check (true);

create table if not exists sales_quote_locations (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references sales_quotes(id) on delete cascade,
  location_type text not null check (location_type in ('garage', 'lot')),
  name text not null default '',
  line_sort integer not null default 0,
  fli boolean not null default false,
  lpr boolean not null default false,
  people_counting boolean not null default false,
  entries_count integer not null default 0,
  exits_count integer not null default 0,
  levels_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_quote_locations_quote on sales_quote_locations(quote_id, line_sort);

create or replace function set_sales_quote_locations_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sales_quote_locations_set_updated_at on sales_quote_locations;
create trigger sales_quote_locations_set_updated_at
  before update on sales_quote_locations
  for each row execute function set_sales_quote_locations_updated_at();

alter table sales_quote_locations enable row level security;

create policy "authenticated read sales_quote_locations"
  on sales_quote_locations for select to authenticated using (true);

create policy "authenticated write sales_quote_locations"
  on sales_quote_locations for all to authenticated using (true) with check (true);

create table if not exists sales_quote_location_images (
  id uuid primary key default gen_random_uuid(),
  quote_location_id uuid not null references sales_quote_locations(id) on delete cascade,
  image_type text not null check (image_type in ('photo', 'drawing')),
  storage_path text not null,
  file_name text,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_sales_quote_location_images_location on sales_quote_location_images(quote_location_id);

alter table sales_quote_location_images enable row level security;

create policy "authenticated read sales_quote_location_images"
  on sales_quote_location_images for select to authenticated using (true);

create policy "authenticated write sales_quote_location_images"
  on sales_quote_location_images for all to authenticated using (true) with check (true);

-- Storage bucket for the photos/drawings above, same private-bucket +
-- authenticated-RLS pattern as migration 031's project-documents bucket.
insert into storage.buckets (id, name, public)
values ('sales-quote-images', 'sales-quote-images', false)
on conflict (id) do nothing;

drop policy if exists "authenticated read sales-quote-images objects" on storage.objects;
create policy "authenticated read sales-quote-images objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'sales-quote-images');

drop policy if exists "authenticated write sales-quote-images objects" on storage.objects;
create policy "authenticated write sales-quote-images objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'sales-quote-images');

drop policy if exists "authenticated update sales-quote-images objects" on storage.objects;
create policy "authenticated update sales-quote-images objects"
  on storage.objects for update to authenticated
  using (bucket_id = 'sales-quote-images')
  with check (bucket_id = 'sales-quote-images');

drop policy if exists "authenticated delete sales-quote-images objects" on storage.objects;
create policy "authenticated delete sales-quote-images objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'sales-quote-images');
