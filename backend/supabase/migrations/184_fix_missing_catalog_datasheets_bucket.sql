-- URGENT-adjacent fix, discovered while E was applying migration 180.
-- Migration 052 (`052_catalog_details_and_datasheets.sql:23-25`) already
-- contains the statement to create the `catalog-datasheets` Storage
-- bucket:
--
--   insert into storage.buckets (id, name, public)
--   values ('catalog-datasheets', 'catalog-datasheets', true)
--   on conflict (id) do nothing;
--
-- but that bucket does not actually exist in production storage.buckets
-- -- confirmed directly, not inferred: applying migration 180's real
-- catalog-datasheets storage.objects RLS and then running its own
-- canonical test failed with:
--
--   ERROR: 23503: insert or update on table "objects" violates foreign
--   key constraint "objects_bucketId_fkey"
--   DETAIL: Key is not present in table "buckets".
--
-- This means the catalog-datasheet-upload feature (`uploadCatalogDatasheetFile`
-- / `handleUploadCatalogDatasheet`, src/persistence.ts / src/main.tsx) has
-- likely never actually worked in production -- any real attempt to
-- upload a datasheet PDF would have hit this same foreign key violation,
-- independent of and unrelated to migration 180's RLS logic (which is
-- otherwise correct -- migration 180's own catalog-datasheets policies
-- passed cleanly for E's already-existing product_catalog rows before
-- this bucket-creation gap was found). Migration 052 is not edited or
-- rerun -- this migration simply performs the one statement it was
-- always supposed to have taken effect, exactly as written there, using
-- the same idempotent `on conflict (id) do nothing` so it is safe to run
-- regardless of why the bucket is currently missing.
--
-- Confirm 184 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review. Run this BEFORE
-- re-running migration_180's canonical test file (Section 3/4, the
-- catalog-datasheets sections, will otherwise keep failing on this same
-- foreign key violation).

begin;

insert into storage.buckets (id, name, public)
values ('catalog-datasheets', 'catalog-datasheets', true)
on conflict (id) do nothing;

commit;
