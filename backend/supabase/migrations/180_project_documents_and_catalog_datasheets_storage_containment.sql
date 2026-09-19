-- URGENT. Live cross-company data-access gap, same severity class as
-- migrations 165/168/170/174. Confirmed directly from source, not
-- inferred: `storage.objects` RLS for TWO buckets has never been
-- touched since it was first created, and both are wide open to any
-- authenticated user, regardless of workspace:
--
--   - `project-documents` (migration 031, lines 15-34) -- select/
--     insert/update/delete all `using (bucket_id = 'project-documents')`
--     / `with check (bucket_id = 'project-documents')`, no workspace
--     check of any kind. `project_documents` the TABLE got a real
--     `workspace_id` and real RLS in migration 170 -- but that is a
--     completely separate RLS layer from `storage.objects`, and the
--     bucket's own objects were never scoped to match. Any authenticated
--     user, in any workspace, can read/write/overwrite/delete ANY
--     project's uploaded files today.
--   - `catalog-datasheets` (migration 052, lines 27-54) -- identical
--     gap, plus a public (`anon`) SELECT policy on top.
--
-- Fix shape, decided by E after the natural-key collision risk below was
-- flagged explicitly:
--
-- Both buckets' current upload path scheme uses a NATURAL KEY (sanitized
-- project name / sanitized catalog number) as the object's leading path
-- segment, not a real row id (`buildDocumentStoragePath`/
-- `buildCatalogDatasheetStoragePath`, src/persistence.ts). Naively
-- matching that leading segment straight to a table row and trusting
-- that row's workspace_id is unsafe long-term: two different companies
-- could coincidentally have a project with the same name, or (now that
-- migration 176 only enforces catalog_number uniqueness PER workspace)
-- an identical catalog_number -- which would let one company's member
-- resolve straight into another company's file via nothing but a name
-- collision. E's explicit decision: fix NEW uploads to key off the
-- real row id (eliminates the collision risk going forward), but do NOT
-- migrate/rename any EXISTING object already sitting on a natural-key
-- path -- E accepted the residual, currently-DORMANT risk this leaves
-- for legacy-path files (a name/catalog-number collision between two
-- companies could in theory grant cross-company access to an OLD file,
-- but only once a second company actually exists and only for files
-- uploaded before this fix, since today there is exactly one workspace
-- and zero collisions have ever occurred).
--
-- So each bucket gets a DUAL-match policy: the leading path segment is
-- accepted if it resolves EITHER (a) as a real anchor row id (uuid) --
-- what every new upload will produce once src/persistence.ts's path
-- builders are switched to take the real id (separate, not-yet-applied
-- frontend change, held back until this migration is confirmed live --
-- see that file's own comment) -- OR (b) as the anchor row's sanitized
-- name/number, reproducing src/persistence.ts's own
-- `sanitizeStoragePathSegment` (replace any run of characters outside
-- [a-zA-Z0-9_.-] with a single "_", keep case, truncate to 120 chars) --
-- this is the LEGACY branch, kept only so every file uploaded before
-- this fix keeps working, and it is what carries the dormant risk
-- described above. Remove branch (b) entirely once E decides to do a
-- full path migration for existing files -- it should not survive
-- indefinitely.
--
-- Anchors, matching this repo's established "go straight to the real
-- owning table, never through a per-file metadata row" pattern
-- (migrations 161->168, 179):
--   - `project-documents` -> `public.projects` directly (id,
--     project_name, workspace_id) -- NOT `project_documents` (which has
--     its own separate, already-correct RLS from migration 170, and is
--     not needed at all to gate the Storage bucket, same reasoning as
--     purchase-order-files anchoring to purchase_orders instead of
--     purchase_order_files in migration 168).
--   - `catalog-datasheets` -> `public.product_catalog` directly (id,
--     catalog_number, workspace_id, real since migration 176).
-- Read uses `is_workspace_member`; insert/update/delete use
-- `is_active_workspace_member` -- same split as migration 179.
--
-- catalog-datasheets' pre-existing PUBLIC (anon) SELECT policy
-- (migration 052) is DELIBERATELY LEFT COMPLETELY UNCHANGED by this
-- migration. Removing anon read would be a product-visibility change
-- (datasheets may be intentionally customer-facing, linked from
-- Quotes/Submittals without a login, per migration 052's own header),
-- not a pure security fix, and is beyond this migration's scope to
-- decide. Flagging it here, not guessing: E should separately decide
-- whether anonymous datasheet access should also become workspace-aware
-- (today it is fully open, unscoped, to anyone with the object path,
-- authenticated or not) or should stay exactly as-is.
--
-- Confirm 180 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review -- URGENT, live
-- incident, same severity class as migrations 165/168/170/174.

begin;

-- ============================================================
-- Section 1 -- project-documents. Anchored directly to public.projects.
-- ============================================================

drop policy if exists "authenticated read project-documents objects" on storage.objects;
drop policy if exists "authenticated write project-documents objects" on storage.objects;
drop policy if exists "authenticated update project-documents objects" on storage.objects;
drop policy if exists "authenticated delete project-documents objects" on storage.objects;

create policy "workspace members read project-documents objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-documents'
    and exists (
      select 1 from public.projects p
      where (
        storage.objects.name like p.id::text || '/%'
        or storage.objects.name like left(regexp_replace(coalesce(nullif(p.project_name, ''), 'unassigned'), '[^a-zA-Z0-9_.-]+', '_', 'g'), 120) || '/%'
      )
      and public.is_workspace_member(p.workspace_id)
    )
  );

create policy "workspace members write project-documents objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and exists (
      select 1 from public.projects p
      where (
        storage.objects.name like p.id::text || '/%'
        or storage.objects.name like left(regexp_replace(coalesce(nullif(p.project_name, ''), 'unassigned'), '[^a-zA-Z0-9_.-]+', '_', 'g'), 120) || '/%'
      )
      and public.is_active_workspace_member(p.workspace_id)
    )
  );

create policy "workspace members update project-documents objects"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'project-documents'
    and exists (
      select 1 from public.projects p
      where (
        storage.objects.name like p.id::text || '/%'
        or storage.objects.name like left(regexp_replace(coalesce(nullif(p.project_name, ''), 'unassigned'), '[^a-zA-Z0-9_.-]+', '_', 'g'), 120) || '/%'
      )
      and public.is_active_workspace_member(p.workspace_id)
    )
  )
  with check (
    bucket_id = 'project-documents'
    and exists (
      select 1 from public.projects p
      where (
        storage.objects.name like p.id::text || '/%'
        or storage.objects.name like left(regexp_replace(coalesce(nullif(p.project_name, ''), 'unassigned'), '[^a-zA-Z0-9_.-]+', '_', 'g'), 120) || '/%'
      )
      and public.is_active_workspace_member(p.workspace_id)
    )
  );

create policy "workspace members delete project-documents objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-documents'
    and exists (
      select 1 from public.projects p
      where (
        storage.objects.name like p.id::text || '/%'
        or storage.objects.name like left(regexp_replace(coalesce(nullif(p.project_name, ''), 'unassigned'), '[^a-zA-Z0-9_.-]+', '_', 'g'), 120) || '/%'
      )
      and public.is_active_workspace_member(p.workspace_id)
    )
  );

-- ============================================================
-- Section 2 -- catalog-datasheets. Anchored directly to
-- public.product_catalog. The pre-existing anon SELECT policy (migration
-- 052) is untouched -- see header comment.
-- ============================================================

drop policy if exists "authenticated read catalog-datasheets objects" on storage.objects;
drop policy if exists "authenticated write catalog-datasheets objects" on storage.objects;
drop policy if exists "authenticated update catalog-datasheets objects" on storage.objects;
drop policy if exists "authenticated delete catalog-datasheets objects" on storage.objects;

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

commit;
