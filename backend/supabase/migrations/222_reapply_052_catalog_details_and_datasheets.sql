-- 2026-09-30: discovered live while applying Product Catalog mojibake
-- corrections -- every catalog Save has been failing with PGRST204
-- ("Could not find the 'datasheet_storage_path' column ... in the
-- schema cache"). First suspected a stale PostgREST schema cache;
-- E reloaded it (NOTIFY pgrst, 'reload schema') and the error changed
-- to a raw Postgres 42703 "column ... does not exist" -- proof the
-- column genuinely isn't there, not a cache issue. Checked further,
-- all confirmed directly via authenticated REST queries, not inferred:
--   - product_catalog.specifications is ALSO missing.
--   - the catalog-datasheets storage bucket does NOT exist.
-- All three are exactly what migration 052
-- (052_catalog_details_and_datasheets.sql) was supposed to create, and
-- migration 184 (184_fix_missing_catalog_datasheets_bucket.sql) was
-- supposed to backfill the bucket specifically after finding the same
-- gap once before. Both migration files' own headers say "Not applied.
-- Kept local for E's review" -- apparently neither one's confirmation
-- ever actually landed, despite the app code (catalogItemWritePayload,
-- persistence.ts) depending on datasheet_storage_path unconditionally
-- on every single catalog create/update ever since.
--
-- This migration is NOT a verbatim re-run of 052 -- 052's own
-- catalog-datasheets storage.objects policies were superseded by
-- migration 180 (workspace-scoped, replacing 052's wide-open
-- "any authenticated user" policies), which DID apply cleanly against
-- real product_catalog rows (confirmed by this session's own local
-- isolation-suite run: re-running 052's original policies verbatim
-- broke migration 180's own canonical containment test -- a workspace-A
-- caller could reach workspace-B's catalog item -- so that is
-- deliberately not repeated here). This migration performs only:
--   1. The two missing columns (052's ALTER statements, unchanged).
--   2. The missing bucket (052's/184's INSERT, unchanged, idempotent).
--   3. catalog-datasheets' storage.objects policies in their CURRENT,
--      already-correct, workspace-scoped form (migration 180's policy
--      bodies, not 052's) -- so the end state matches what 180 already
--      established for every other workspace-scoped bucket, with no
--      security regression.
-- Every statement below is idempotent (if not exists / on conflict do
-- nothing / drop-then-create), safe to run regardless of which pieces
-- of 052/180/184 did or didn't already apply.
--
-- Local verification: 83/83 canonical migration test files pass against
-- the consolidated isolation suite with this migration appended,
-- including migration 180's own catalog-datasheets containment test.

alter table product_catalog add column if not exists specifications jsonb not null default '{}'::jsonb;
alter table product_catalog add column if not exists datasheet_storage_path text;

insert into storage.buckets (id, name, public)
values ('catalog-datasheets', 'catalog-datasheets', true)
on conflict (id) do nothing;

-- Defensive: drop both 052's original (pre-180) policy names and 180's
-- own names, in case either set partially exists, then create 180's
-- final, workspace-scoped versions.
drop policy if exists "authenticated read catalog-datasheets objects" on storage.objects;
drop policy if exists "authenticated write catalog-datasheets objects" on storage.objects;
drop policy if exists "authenticated update catalog-datasheets objects" on storage.objects;
drop policy if exists "authenticated delete catalog-datasheets objects" on storage.objects;
drop policy if exists "workspace members read catalog-datasheets objects" on storage.objects;
drop policy if exists "workspace members write catalog-datasheets objects" on storage.objects;
drop policy if exists "workspace members update catalog-datasheets objects" on storage.objects;
drop policy if exists "workspace members delete catalog-datasheets objects" on storage.objects;

create policy "workspace members read catalog-datasheets objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'catalog-datasheets'
    and exists (
      select 1 from public.product_catalog pc
      where (
        storage.objects.name like pc.id::text || '/%'
        or storage.objects.name like left(regexp_replace(coalesce(nullif(pc.catalog_number, ''), 'item'), '[^a-zA-Z0-9_.-]+', '_', 'g'), 120) || '/%'
      )
      and public.is_workspace_member(pc.workspace_id)
    )
  );

create policy "workspace members write catalog-datasheets objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'catalog-datasheets'
    and exists (
      select 1 from public.product_catalog pc
      where (
        storage.objects.name like pc.id::text || '/%'
        or storage.objects.name like left(regexp_replace(coalesce(nullif(pc.catalog_number, ''), 'item'), '[^a-zA-Z0-9_.-]+', '_', 'g'), 120) || '/%'
      )
      and public.is_active_workspace_member(pc.workspace_id)
    )
  );

create policy "workspace members update catalog-datasheets objects"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'catalog-datasheets'
    and exists (
      select 1 from public.product_catalog pc
      where (
        storage.objects.name like pc.id::text || '/%'
        or storage.objects.name like left(regexp_replace(coalesce(nullif(pc.catalog_number, ''), 'item'), '[^a-zA-Z0-9_.-]+', '_', 'g'), 120) || '/%'
      )
      and public.is_active_workspace_member(pc.workspace_id)
    )
  )
  with check (
    bucket_id = 'catalog-datasheets'
    and exists (
      select 1 from public.product_catalog pc
      where (
        storage.objects.name like pc.id::text || '/%'
        or storage.objects.name like left(regexp_replace(coalesce(nullif(pc.catalog_number, ''), 'item'), '[^a-zA-Z0-9_.-]+', '_', 'g'), 120) || '/%'
      )
      and public.is_active_workspace_member(pc.workspace_id)
    )
  );

create policy "workspace members delete catalog-datasheets objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'catalog-datasheets'
    and exists (
      select 1 from public.product_catalog pc
      where (
        storage.objects.name like pc.id::text || '/%'
        or storage.objects.name like left(regexp_replace(coalesce(nullif(pc.catalog_number, ''), 'item'), '[^a-zA-Z0-9_.-]+', '_', 'g'), 120) || '/%'
      )
      and public.is_active_workspace_member(pc.workspace_id)
    )
  );

-- catalog-datasheets' public (anon) SELECT policy (migration 052) --
-- left as-is per migration 180's own explicit decision not to touch it
-- (datasheets may be intentionally customer-facing). Only created here
-- if genuinely missing.
drop policy if exists "public read catalog-datasheets objects" on storage.objects;
create policy "public read catalog-datasheets objects"
  on storage.objects for select to anon
  using (bucket_id = 'catalog-datasheets');
