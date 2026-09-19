-- Phase 3 final scoping pass (overnight, 2026-09-19). Closes the 3 of 6
-- remaining open storage buckets whose object path already uses a
-- real, non-colliding UUID (never a natural key like a project name or
-- catalog number) as its leading segment, and whose real anchor is
-- already workspace-scoped with a resolver ready to reuse -- the exact
-- same, already-proven-safe pattern as migrations 161/162/169.
-- `project-documents`, `catalog-datasheets`, and `company-branding`
-- are DELIBERATELY NOT included here -- all three use a natural-key or
-- flat path convention that could genuinely collide between two
-- workspaces (a sanitized project name, a catalog number, or no
-- per-row key at all), which is a real path-scheme redesign, not a
-- policy-only fix -- see the session log / morning summary for detail,
-- not repeated here to avoid drifting out of sync with the real design
-- discussion.
--
-- `project-location-images` (migration 064) -- path is
-- `<project_locations.id>/<stamp>-<filename>`; bytes uploaded before
-- the per-file `project_location_images` metadata row (confirmed from
-- source), so the policy is matched against the PARENT
-- (`project_locations`, already workspace-scoped since migration 157)
-- via the existing `project_location_owner_workspace_id()` resolver --
-- no chicken-and-egg risk, since a location must already exist before
-- any photo is uploaded to it.
--
-- `project-shipment-photos` (migration 072) -- path is
-- `<project_shipments.id>/<stamp>-<filename>`; same bytes-before-
-- metadata order, same parent-anchor reasoning, via the existing
-- `project_shipment_owner_workspace_id()` resolver (`project_shipments`
-- already workspace-scoped since migration 161).
--
-- `avatars` (migrations 109/111) -- path is
-- `<team_members.id>/<stamp><ext>`; anchor is `team_members`, which
-- migration 175 (this same overnight batch) just gave a real
-- `workspace_id`. The pre-existing PUBLIC (unauthenticated) read policy
-- is left completely unchanged -- a profile picture is not sensitive
-- business data the way project files are, and locking it down would
-- be a product change beyond this migration's scope, not a security
-- fix. Only the WRITE-side policies (admin write, self-service write/
-- update by email match) gain a workspace check, so a user in workspace
-- B cannot upload an avatar for workspace A's roster member. There is
-- still no DELETE policy for this bucket at all, confirmed unchanged
-- from today (nobody can delete an avatar via RLS, admin or otherwise --
-- not this migration's concern to add).
--
-- Confirm 179 is still the next free migration number at execution
-- time. Not applied. Kept local for E's review. Depends on migration
-- 175 (team_members.workspace_id) already being applied first.

begin;

-- ============================================================
-- Section 1 -- project-location-images
-- ============================================================

drop policy if exists "authenticated read project-location-images objects" on storage.objects;
drop policy if exists "authenticated write project-location-images objects" on storage.objects;
drop policy if exists "authenticated update project-location-images objects" on storage.objects;
drop policy if exists "authenticated delete project-location-images objects" on storage.objects;

create policy "workspace members read project-location-images objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-location-images'
    and exists (
      select 1 from public.project_locations pl
      where storage.objects.name like pl.id::text || '/%'
        and public.is_workspace_member(public.project_location_owner_workspace_id(pl.id))
    )
  );

create policy "workspace members write project-location-images objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-location-images'
    and exists (
      select 1 from public.project_locations pl
      where storage.objects.name like pl.id::text || '/%'
        and public.is_active_workspace_member(public.project_location_owner_workspace_id(pl.id))
    )
  );

create policy "workspace members update project-location-images objects"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'project-location-images'
    and exists (
      select 1 from public.project_locations pl
      where storage.objects.name like pl.id::text || '/%'
        and public.is_active_workspace_member(public.project_location_owner_workspace_id(pl.id))
    )
  )
  with check (
    bucket_id = 'project-location-images'
    and exists (
      select 1 from public.project_locations pl
      where storage.objects.name like pl.id::text || '/%'
        and public.is_active_workspace_member(public.project_location_owner_workspace_id(pl.id))
    )
  );

create policy "workspace members delete project-location-images objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-location-images'
    and exists (
      select 1 from public.project_locations pl
      where storage.objects.name like pl.id::text || '/%'
        and public.is_active_workspace_member(public.project_location_owner_workspace_id(pl.id))
    )
  );

-- ============================================================
-- Section 2 -- project-shipment-photos
-- ============================================================

drop policy if exists "authenticated read project-shipment-photos objects" on storage.objects;
drop policy if exists "authenticated write project-shipment-photos objects" on storage.objects;
drop policy if exists "authenticated update project-shipment-photos objects" on storage.objects;
drop policy if exists "authenticated delete project-shipment-photos objects" on storage.objects;

create policy "workspace members read project-shipment-photos objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-shipment-photos'
    and exists (
      select 1 from public.project_shipments ps
      where storage.objects.name like ps.id::text || '/%'
        and public.is_workspace_member(public.project_shipment_owner_workspace_id(ps.id))
    )
  );

create policy "workspace members write project-shipment-photos objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-shipment-photos'
    and exists (
      select 1 from public.project_shipments ps
      where storage.objects.name like ps.id::text || '/%'
        and public.is_active_workspace_member(public.project_shipment_owner_workspace_id(ps.id))
    )
  );

create policy "workspace members update project-shipment-photos objects"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'project-shipment-photos'
    and exists (
      select 1 from public.project_shipments ps
      where storage.objects.name like ps.id::text || '/%'
        and public.is_active_workspace_member(public.project_shipment_owner_workspace_id(ps.id))
    )
  )
  with check (
    bucket_id = 'project-shipment-photos'
    and exists (
      select 1 from public.project_shipments ps
      where storage.objects.name like ps.id::text || '/%'
        and public.is_active_workspace_member(public.project_shipment_owner_workspace_id(ps.id))
    )
  );

create policy "workspace members delete project-shipment-photos objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-shipment-photos'
    and exists (
      select 1 from public.project_shipments ps
      where storage.objects.name like ps.id::text || '/%'
        and public.is_active_workspace_member(public.project_shipment_owner_workspace_id(ps.id))
    )
  );

-- ============================================================
-- Section 3 -- avatars: only the WRITE-side policies gain a workspace
-- check; the pre-existing public read policy is untouched (not
-- sensitive business data, a product decision beyond this migration's
-- scope to change). No DELETE policy exists for this bucket, confirmed
-- unchanged -- none added here.
-- ============================================================

drop policy if exists "admins write avatars" on storage.objects;
drop policy if exists "users write their own avatar" on storage.objects;
drop policy if exists "admins update avatars" on storage.objects;
drop policy if exists "users update their own avatar" on storage.objects;

create policy "workspace admins write avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.team_members tm
      where tm.id::text = split_part(storage.objects.name, '/', 1)
        and public.is_active_workspace_member(tm.workspace_id)
        and public.is_app_admin(auth.uid())
    )
  );

create policy "workspace members write their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.team_members tm
      where tm.id::text = split_part(storage.objects.name, '/', 1)
        and public.is_active_workspace_member(tm.workspace_id)
        and lower(tm.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

create policy "workspace admins update avatars"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.team_members tm
      where tm.id::text = split_part(storage.objects.name, '/', 1)
        and public.is_active_workspace_member(tm.workspace_id)
        and public.is_app_admin(auth.uid())
    )
  )
  with check (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.team_members tm
      where tm.id::text = split_part(storage.objects.name, '/', 1)
        and public.is_active_workspace_member(tm.workspace_id)
        and public.is_app_admin(auth.uid())
    )
  );

create policy "workspace members update their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.team_members tm
      where tm.id::text = split_part(storage.objects.name, '/', 1)
        and public.is_active_workspace_member(tm.workspace_id)
        and lower(tm.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
  with check (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.team_members tm
      where tm.id::text = split_part(storage.objects.name, '/', 1)
        and public.is_active_workspace_member(tm.workspace_id)
        and lower(tm.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

commit;
