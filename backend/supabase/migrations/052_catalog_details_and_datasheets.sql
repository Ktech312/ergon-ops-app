-- Two additions to Product Catalog, per E:
--   1. Category-specific "Details" section -- Signage keeps its existing
--      typed columns (height_in, width_in, etc. from migration 046), but
--      the other 8 categories (VPUs, Cameras, Camera Accessories, Sign
--      Accessories, Network/Coms., EnSight Kits, Power, Lighting) need
--      their own spec fields. Rather than add a fresh narrow column per
--      spec per category (dozens of mostly-null columns, a new migration
--      every time a field list changes -- E explicitly said "I can give
--      you specifics and we add"), specifications is a flexible jsonb
--      bag keyed by field name. The field list per category lives in
--      app code (CATALOG_CATEGORY_FIELDS in main.tsx), not the DB, so
--      adding/renaming/removing a spec field for a category is a code
--      change, not a migration.
--   2. Real datasheet file storage -- datasheet_url (migration 013) was
--      always just a pasted link. datasheet_storage_path holds the path
--      to an actually-uploaded PDF in the new catalog-datasheets bucket,
--      same pattern as project-documents (migration 031). Both columns
--      are kept: url for an external link, storage_path for an uploaded
--      file -- a product can have either or both.
alter table product_catalog add column if not exists specifications jsonb not null default '{}'::jsonb;
alter table product_catalog add column if not exists datasheet_storage_path text;

insert into storage.buckets (id, name, public)
values ('catalog-datasheets', 'catalog-datasheets', true)
on conflict (id) do nothing;

drop policy if exists "authenticated read catalog-datasheets objects" on storage.objects;
create policy "authenticated read catalog-datasheets objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'catalog-datasheets');

drop policy if exists "authenticated write catalog-datasheets objects" on storage.objects;
create policy "authenticated write catalog-datasheets objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'catalog-datasheets');

drop policy if exists "authenticated update catalog-datasheets objects" on storage.objects;
create policy "authenticated update catalog-datasheets objects"
  on storage.objects for update to authenticated
  using (bucket_id = 'catalog-datasheets')
  with check (bucket_id = 'catalog-datasheets');

drop policy if exists "authenticated delete catalog-datasheets objects" on storage.objects;
create policy "authenticated delete catalog-datasheets objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'catalog-datasheets');

-- Public read policy too, since the bucket is public=true (datasheets need
-- to be linkable from client-facing Quotes/Submittals down the line without
-- a signed-URL round trip).
drop policy if exists "public read catalog-datasheets objects" on storage.objects;
create policy "public read catalog-datasheets objects"
  on storage.objects for select to anon
  using (bucket_id = 'catalog-datasheets');
