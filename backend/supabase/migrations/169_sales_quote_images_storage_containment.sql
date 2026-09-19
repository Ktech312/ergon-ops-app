-- Phase 3, Stage 5 (workspace-scoped uniqueness, reports, aggregates,
-- functions, triggers, and remaining indirect access paths) -- fifth
-- migration of this stage, same 2026-09-16 standing authorization as
-- migrations 155-168. Closes the one genuine remaining storage-bucket
-- gap found during this stage's storage-bucket scoping pass: the
-- `sales-quote-images` bucket's four `storage.objects` policies
-- (migration 033, never touched since) are bare `bucket_id =
-- 'sales-quote-images'` with no further predicate at all -- any
-- authenticated user in any workspace can currently read, insert,
-- update, or delete any object in this bucket.
--
-- (The other two buckets originally flagged alongside this one,
-- `purchase-order-files` and the `message-attachments` channel-specific
-- policies, turned out on direct re-check to already be correctly
-- workspace-scoped by migrations 161 and 162 respectively -- not this
-- migration's concern. Re-checking `purchase-order-files` did surface a
-- real, separate, already-live incident, closed by migration 168.)
--
-- Fix pattern, and the one deliberate design choice this migration
-- makes differently from `purchase-order-files`' ORIGINAL (buggy)
-- design: match the storage path's leading segment against
-- `sales_quote_locations` (the PARENT entity that already exists before
-- any image is ever uploaded to it) via `sales_quote_location_owner_
-- workspace_id()` (migration 155), NOT against the per-file
-- `sales_quote_location_images` metadata row. Migration 168's own
-- incident (see its header for the full account) confirmed empirically
-- that joining a storage.objects INSERT policy against a per-file
-- metadata row is only safe if that row is created BEFORE the file
-- bytes are uploaded -- the real upload flow here (`src/persistence.ts:
-- 11244-1274`) uploads the file bytes FIRST (`buildQuoteImageStoragePath()`
-- + `uploadStorageObjectFile()`, lines 11257-11258) and only inserts the
-- `sales_quote_location_images` row AFTER that upload succeeds (line
-- 11262 onward) -- the exact same order that broke `purchase-order-files`.
-- Matching against the PARENT (`sales_quote_locations`, which obviously
-- already exists before any photo/drawing is uploaded to it) instead of
-- the per-file row avoids this chicken-and-egg problem entirely, same
-- pattern already proven correct in migration 162 for channel
-- message-attachments.
--
-- Confirm 169 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review.

begin;

drop policy if exists "authenticated read sales-quote-images objects" on storage.objects;
drop policy if exists "authenticated write sales-quote-images objects" on storage.objects;
drop policy if exists "authenticated update sales-quote-images objects" on storage.objects;
drop policy if exists "authenticated delete sales-quote-images objects" on storage.objects;

create policy "workspace members read sales-quote-images objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sales-quote-images'
    and exists (
      select 1 from public.sales_quote_locations qloc
      where storage.objects.name like qloc.id::text || '/%'
        and public.is_workspace_member(public.sales_quote_location_owner_workspace_id(qloc.id))
    )
  );

create policy "workspace members write sales-quote-images objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sales-quote-images'
    and exists (
      select 1 from public.sales_quote_locations qloc
      where storage.objects.name like qloc.id::text || '/%'
        and public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(qloc.id))
    )
  );

create policy "workspace members update sales-quote-images objects"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'sales-quote-images'
    and exists (
      select 1 from public.sales_quote_locations qloc
      where storage.objects.name like qloc.id::text || '/%'
        and public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(qloc.id))
    )
  )
  with check (
    bucket_id = 'sales-quote-images'
    and exists (
      select 1 from public.sales_quote_locations qloc
      where storage.objects.name like qloc.id::text || '/%'
        and public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(qloc.id))
    )
  );

create policy "workspace members delete sales-quote-images objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sales-quote-images'
    and exists (
      select 1 from public.sales_quote_locations qloc
      where storage.objects.name like qloc.id::text || '/%'
        and public.is_active_workspace_member(public.sales_quote_location_owner_workspace_id(qloc.id))
    )
  );

commit;
