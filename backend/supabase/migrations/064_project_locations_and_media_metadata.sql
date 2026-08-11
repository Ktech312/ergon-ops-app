-- E's feedback: sales info (site/garage-lot breakdown, photos, drawings)
-- needs to carry over into Projects when a deal closes, so images can be
-- tracked from presale through implementation to final closeout/sign-off --
-- not just the flat BOM list that "Pull BOM from Closed Sales" already
-- copies. This gives Projects their own Locations structure, a mirror of
-- sales_quote_locations/_images/_items, so the same per-garage/lot
-- photo+drawing+hardware breakdown exists on both sides. The copy itself
-- (one-time, same "copy on link" pattern as the BOM pull) happens in
-- application code (persistence.ts's createProjectFromClosedWonQuote),
-- which also copies the underlying storage objects into this table's own
-- bucket so deleting a photo on one side never touches the other's copy.
--
-- Also adds "who uploaded this and from where" metadata (uploaded_by,
-- lat/lng) to both the existing sales_quote_location_images table and the
-- new project_location_images table, so photos can be traced from presale
-- all the way through to closeout. Existing rows get null values -- this
-- metadata is only ever captured going forward, not backfilled.

create table if not exists project_locations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  location_type text not null check (location_type in ('garage', 'lot')),
  name text not null default '',
  line_sort integer not null default 0,
  fli boolean not null default false,
  lpr boolean not null default false,
  people_counting boolean not null default false,
  fli_camera_item_id uuid references product_catalog(id) on delete set null,
  lpr_camera_item_id uuid references product_catalog(id) on delete set null,
  people_counting_camera_item_id uuid references product_catalog(id) on delete set null,
  entries_count integer not null default 0,
  exits_count integer not null default 0,
  levels_count integer not null default 0,
  -- Set when this location was copied over from a Sales Quote location, so
  -- the pair can be traced back to each other if ever needed.
  source_quote_location_id uuid references sales_quote_locations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_locations_project on project_locations(project_id, line_sort);

create or replace function set_project_locations_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists project_locations_set_updated_at on project_locations;
create trigger project_locations_set_updated_at
  before update on project_locations
  for each row execute function set_project_locations_updated_at();

alter table project_locations enable row level security;

create policy "authenticated read project_locations"
  on project_locations for select to authenticated using (true);

create policy "authenticated write project_locations"
  on project_locations for all to authenticated using (true) with check (true);

create table if not exists project_location_images (
  id uuid primary key default gen_random_uuid(),
  project_location_id uuid not null references project_locations(id) on delete cascade,
  image_type text not null check (image_type in ('photo', 'drawing')),
  storage_path text not null,
  file_name text,
  description text,
  uploaded_at timestamptz not null default now(),
  uploaded_by_user_id uuid references auth.users(id),
  uploaded_by_email text,
  photo_lat double precision,
  photo_lng double precision
);

create index if not exists idx_project_location_images_location on project_location_images(project_location_id);

alter table project_location_images enable row level security;

create policy "authenticated read project_location_images"
  on project_location_images for select to authenticated using (true);

create policy "authenticated write project_location_images"
  on project_location_images for all to authenticated using (true) with check (true);

create table if not exists project_location_items (
  id uuid primary key default gen_random_uuid(),
  project_location_id uuid not null references project_locations(id) on delete cascade,
  line_type text not null check (line_type in ('sign', 'sensor', 'misc')),
  catalog_item_id uuid references product_catalog(id) on delete set null,
  qty numeric not null default 1,
  line_sort integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_location_items_location on project_location_items(project_location_id, line_type, line_sort);

alter table project_location_items enable row level security;

create policy "authenticated read project_location_items"
  on project_location_items for select to authenticated using (true);

create policy "authenticated write project_location_items"
  on project_location_items for all to authenticated using (true) with check (true);

-- Own private bucket (not reusing sales-quote-images) so a project's photos
-- are its own storage objects -- copied in from the quote's bucket at
-- conversion time, not referenced in place -- and can be deleted
-- independently without affecting the original sales-side copy.
insert into storage.buckets (id, name, public)
values ('project-location-images', 'project-location-images', false)
on conflict (id) do nothing;

drop policy if exists "authenticated read project-location-images objects" on storage.objects;
create policy "authenticated read project-location-images objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'project-location-images');

drop policy if exists "authenticated write project-location-images objects" on storage.objects;
create policy "authenticated write project-location-images objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'project-location-images');

drop policy if exists "authenticated update project-location-images objects" on storage.objects;
create policy "authenticated update project-location-images objects"
  on storage.objects for update to authenticated
  using (bucket_id = 'project-location-images')
  with check (bucket_id = 'project-location-images');

drop policy if exists "authenticated delete project-location-images objects" on storage.objects;
create policy "authenticated delete project-location-images objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-location-images');

-- Retrofit the same "who/where" metadata onto the existing Sales side so
-- new photos captured there are traceable too (existing rows stay null).
alter table sales_quote_location_images add column if not exists uploaded_by_user_id uuid references auth.users(id);
alter table sales_quote_location_images add column if not exists uploaded_by_email text;
alter table sales_quote_location_images add column if not exists photo_lat double precision;
alter table sales_quote_location_images add column if not exists photo_lng double precision;

-- Trace a converted project back to the quote it came from, and record
-- when/whether that one-time copy happened.
alter table projects add column if not exists source_sales_quote_id uuid references sales_quotes(id) on delete set null;
alter table projects add column if not exists converted_from_quote_at timestamptz;
