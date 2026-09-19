-- URGENT same-effort follow-up, found while scoping the (unrelated)
-- sales-quote-images storage bucket gap. LIVE INCIDENT: migration 161's
-- `purchase-order-files` storage.objects INSERT/UPDATE policies
-- (161:371-399) require a matching `public.purchase_order_files` row to
-- ALREADY EXIST, keyed by an EXACT match on `storage_path`:
--
--   with check (
--     bucket_id = 'purchase-order-files'
--     and exists (
--       select 1 from public.purchase_order_files pof
--       where pof.storage_path = storage.objects.name
--         and public.is_active_workspace_member(...)
--     )
--   );
--
-- But the real upload flow (`addPurchaseOrderFile()`,
-- src/persistence.ts:9931-9960) uploads the file BYTES to Storage first
-- (`uploadPurchaseOrderFile()`, line 9943, a real authenticated-token
-- POST to the Storage REST API, genuinely subject to this RLS policy --
-- confirmed by reading `uploadStorageObjectFile()`, lines 11140-11167,
-- which sends the caller's own access token, not a service-role
-- bypass), and only inserts the matching `purchase_order_files` row
-- AFTER that upload succeeds (line 9947 onward). At the moment the
-- Storage API's own internal `insert into storage.objects` runs, no
-- `purchase_order_files` row with that `storage_path` exists yet --
-- the WITH CHECK can never be satisfied for a genuinely new upload.
--
-- Confirmed empirically (not just by reading code): reproduced the
-- exact same-shaped policy against a minimal local Postgres (PGlite)
-- and confirmed a plain `insert into storage.objects` with no
-- pre-existing matching row is rejected with "new row violates
-- row-level security policy for table objects" -- exactly what would
-- happen to a real upload attempt in production today.
--
-- Practical impact: every purchase order file upload attempted since
-- migration 161 went live (2026-09-17) has almost certainly failed --
-- `uploadStorageObjectFile()` logs the rejection to the browser console
-- and the calling code returns null/false silently (existing,
-- unrelated error-handling behavior, not changed here), so this could
-- easily have gone unnoticed rather than being reported as an obvious
-- crash. UPDATE has the identical structural bug (161:382-399, same
-- exists() shape in both its USING and WITH CHECK). SELECT and DELETE
-- (161:360-369, 401-410) are NOT affected the same way -- by the time
-- anyone reads or deletes an object, its row (if the upload ever
-- succeeded) already exists, so the exists() check is satisfiable
-- there. Read/delete of any file uploaded successfully BEFORE migration
-- 161 (which had no such check) are also unaffected.
--
-- Fix: switch all four policies to the SAME pattern migration 162
-- already used correctly for channel message-attachments (162:413-445)
-- -- match the `purchase_order_id` leading path segment directly
-- against `public.purchase_orders`, never through the per-file
-- `purchase_order_files` metadata row at all. This has no
-- chicken-and-egg problem (a purchase order obviously exists before
-- any file is ever uploaded to it) and is simpler than the row it
-- replaces. Per this repo's standing rule, migration 161 itself is NOT
-- edited or rerun -- these are the same four policy names, replaced
-- again via DROP POLICY IF EXISTS + CREATE POLICY, exactly mirroring
-- migration 161's own idempotent-reapplication style.
--
-- Confirm 168 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review -- URGENT, live
-- incident, same severity class as the migration 164/165 incident.

begin;

drop policy if exists "workspace members read purchase-order-files objects" on storage.objects;
drop policy if exists "workspace members write purchase-order-files objects" on storage.objects;
drop policy if exists "workspace members update purchase-order-files objects" on storage.objects;
drop policy if exists "workspace members delete purchase-order-files objects" on storage.objects;

create policy "workspace members read purchase-order-files objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'purchase-order-files'
    and exists (
      select 1 from public.purchase_orders po
      where storage.objects.name like po.id::text || '/%'
        and public.is_workspace_member(public.purchase_order_owner_workspace_id(po.id))
    )
  );

create policy "workspace members write purchase-order-files objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'purchase-order-files'
    and exists (
      select 1 from public.purchase_orders po
      where storage.objects.name like po.id::text || '/%'
        and public.is_active_workspace_member(public.purchase_order_owner_workspace_id(po.id))
    )
  );

create policy "workspace members update purchase-order-files objects"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'purchase-order-files'
    and exists (
      select 1 from public.purchase_orders po
      where storage.objects.name like po.id::text || '/%'
        and public.is_active_workspace_member(public.purchase_order_owner_workspace_id(po.id))
    )
  )
  with check (
    bucket_id = 'purchase-order-files'
    and exists (
      select 1 from public.purchase_orders po
      where storage.objects.name like po.id::text || '/%'
        and public.is_active_workspace_member(public.purchase_order_owner_workspace_id(po.id))
    )
  );

create policy "workspace members delete purchase-order-files objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'purchase-order-files'
    and exists (
      select 1 from public.purchase_orders po
      where storage.objects.name like po.id::text || '/%'
        and public.is_active_workspace_member(public.purchase_order_owner_workspace_id(po.id))
    )
  );

commit;
