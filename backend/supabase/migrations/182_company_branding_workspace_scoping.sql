-- Phase 3 final scoping pass -- E's explicit decision: `company_branding`
-- (migration 039) is a literal Postgres singleton today, re-confirmed
-- directly from source: `id boolean primary key default true` plus
-- `constraint company_branding_singleton check (id)` -- exactly one row
-- can ever exist, globally, for the entire app (`company_name` default
-- 'Ergon', `logo_storage_path`, `updated_at`). RLS (039:21-27): any
-- authenticated user can `select`; only `is_app_admin(auth.uid())` can
-- write. Storage: bucket `company-branding` (public, 039:46-48), upload
-- path built client-side (`src/persistence.ts:2385`) as
-- `logo-${Date.now().toString(36)}-${sanitizeStoragePathSegment(file.name)}`
-- -- flat, no per-company prefix at all, so two companies' logos would
-- collide in the same flat namespace once a second workspace exists.
--
-- E: "each company should have its own separate copies" applies here too
-- -- convert this to one branding row PER WORKSPACE, with each newly
-- created workspace getting a copy of today's Ergon defaults as its
-- starting point, and the storage path prefixed by workspace so two
-- companies' logos can never collide.
--
-- Load-bearing facts this design depends on, each re-confirmed directly:
--
--   1. company_branding has exactly one row today (the singleton
--      constraint physically prevents more than one), so the backfill
--      below is a plain UPDATE of that one existing row's new
--      workspace_id column -- it never touches company_name/
--      logo_storage_path/updated_at, so the real production values
--      (whatever an admin has actually configured) are carried forward
--      automatically, never hardcoded or reconstructed from a literal.
--   2. `public.workspaces` has no other `after insert` trigger today
--      (grepped `create trigger.*on public.workspaces` across every
--      migration -- only `workspaces_set_updated_at`, a `before update`
--      trigger from migration 115, exists). The new
--      `workspaces_seed_default_branding` trigger added here is the
--      first `after insert` trigger on this table and does not need to
--      coordinate ordering with anything else.
--   3. New-workspace default `company_name` is set to the placeholder
--      'New Company' -- JUDGMENT CALL, flagged for E: no existing
--      product convention dictates this string; anything more specific
--      (e.g. the workspace's own `name` column) was deliberately not
--      used here since `workspaces.name` is often a slug-like internal
--      label (see migration 116's own rename of the first workspace),
--      not necessarily what an admin wants displayed as a company name
--      in the top nav. `logo_storage_path` is left null (falls back to
--      the app's own default icon, same as today's empty-string case).
--   4. RLS: read becomes `is_workspace_member(workspace_id)`, write
--      becomes `is_active_workspace_member(workspace_id) and
--      is_app_admin(auth.uid())` -- the existing admin-only-write gate
--      is preserved exactly (ANDed, never replaced or loosened), same
--      conservative principle used for `user_invites` in the
--      concurrently-drafted migration 181.
--   5. Storage: the bucket stays PUBLIC for reads, unchanged (verified
--      directly from 039:50-53 -- the existing "public read
--      company-branding objects" policy has no admin/auth gate at all
--      today, and this migration does not touch it). Only the WRITE-side
--      policies (insert/update/delete, 039:55-69) gain a workspace check,
--      matching the new `<workspace_id>/logo-...` path convention --
--      same "add correctness to the write side only" pattern migration
--      179 used for `avatars`. The leading path segment IS the real
--      workspace_id itself here (no parent-table lookup needed, unlike
--      179's `avatars`/`project-location-images` cases) -- compared as
--      text against `workspace_members.workspace_id::text`, never cast
--      from the path segment to uuid, so a malformed/foreign path
--      segment fails the `exists` check cleanly instead of raising a
--      cast error inside a policy shared by every bucket.
--
-- Frontend companion (`src/persistence.ts`, same commit staged, NOT
-- pushed until this migration is confirmed live -- this repo's standing
-- rule after a real incident): `loadCompanyBranding` now also selects
-- and returns `workspace_id` (RLS already restricts the read to the
-- caller's own row, so no explicit filter is needed on the query itself
-- -- mirrors `loadSalesApprovalSettings`/`saveSalesApprovalSettings`'s
-- own existing load-returns-workspace-id / save-takes-workspace-id-param
-- shape, migration 147, `src/persistence.ts:13087-13133` -- reused
-- verbatim, no new "get caller's workspace_id" helper needed).
-- `saveCompanyBranding`/`uploadCompanyLogo` now take that `workspaceId`
-- and use it both as the PATCH filter (replacing `id=eq.true`) and as
-- the upload path prefix (replacing the flat `logo-...` path).
--
-- Confirm 182 is still the next free migration number at execution
-- time (180/181 are being drafted concurrently by other agents for
-- unrelated fixes -- if either lands first, renumber this file, this
-- comment says so on purpose). Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- Schema: nullable for now, backfilled below, then locked
-- down NOT NULL, then the old boolean PK is dropped and workspace_id
-- becomes the real primary key -- same three-step shape as every other
-- Stage 1-5 workspace_id rollout, plus the PK swap this table uniquely
-- needs since its old PK (`id boolean`) is being retired entirely, not
-- just supplemented.
-- ============================================================

alter table public.company_branding
  add column if not exists workspace_id uuid references public.workspaces(id);

-- ============================================================
-- Section 2 -- Backfill. company_branding has no anchor of its own (it
-- is the root of its own domain, same as team_members/
-- one_off_reconciliations) -- falls back directly to this database's one
-- existing workspace, same pattern as every other Stage 1-5 backfill
-- with no better anchor available. This is a plain UPDATE of the one
-- existing singleton row -- company_name/logo_storage_path/updated_at
-- are never touched, so real production data is carried forward
-- untouched, not reconstructed.
-- ============================================================

update public.company_branding
set workspace_id = (select id from public.workspaces where slug = 'ergon-test')
where workspace_id is null;

do $$
begin
  if exists (select 1 from public.company_branding where workspace_id is null) then
    raise exception 'backfill incomplete: company_branding.workspace_id still has nulls';
  end if;
end $$;

alter table public.company_branding alter column workspace_id set not null;

-- ============================================================
-- Section 3 -- Retire the old boolean singleton PK. The singleton CHECK
-- constraint and its backing `id` column are dropped only after the new
-- column is populated and locked NOT NULL above, so there is never a
-- moment where a row exists with neither a valid `id` nor a valid
-- `workspace_id`.
-- ============================================================

alter table public.company_branding drop constraint if exists company_branding_singleton;
alter table public.company_branding drop constraint if exists company_branding_pkey;
alter table public.company_branding drop column if exists id;
alter table public.company_branding add constraint company_branding_pkey primary key (workspace_id);

-- ============================================================
-- Section 4 -- Ownership trigger. DELIBERATELY NOT
-- guard_workspace_id_mutation() (migration 117) verbatim -- caught live
-- by this migration's own PGlite verification (see test run notes):
-- that shared function derives workspace_id on INSERT from the CALLING
-- user's own currently-active workspace (resolve_caller_workspace_id()),
-- which is the right rule for a table an ordinary member inserts into
-- directly (team_members, one_off_reconciliations, etc.), but is the
-- WRONG rule here. company_branding's only legitimate INSERT path is
-- Section 5's own trusted `workspaces_seed_default_branding` trigger,
-- which must stamp the row with the WORKSPACE JUST CREATED
-- (`new.id` on `workspaces`), not with whoever happens to be creating
-- it -- reusing guard_workspace_id_mutation() here would silently
-- clobber that with resolve_caller_workspace_id()'s result and fail
-- outright for any workspace-creation path where the caller has no
-- active membership yet (confirmed empirically: it raised "no workspace
-- membership found for current user" the moment a second workspace was
-- inserted). Same "table needs its own dedicated trigger instead of the
-- shared one" call migration 173 made for
-- project_schedule_template_phases (there, because a real anchor
-- existed to derive from instead of the caller; here, because the
-- trusted inserter -- not the caller -- already knows the right value).
-- UPDATE immutability is still enforced, identically to
-- guard_workspace_id_mutation()'s own UPDATE branch -- an ordinary write
-- can never reassign a branding row to a different workspace. INSERT is
-- deliberately left untouched by this trigger (no derivation, no
-- override): the trusted security-definer seed trigger sets the correct
-- value directly, and any other INSERT attempt (e.g. a direct
-- authenticated PostgREST call) is still independently constrained by
-- this table's own RLS WITH CHECK (Section 6) requiring the caller to be
-- an active member AND admin of whatever workspace_id they name.
-- ============================================================

create or replace function public.guard_company_branding_workspace_id_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'workspace_id is immutable through ordinary writes -- reassignment requires a separately reviewed privileged procedure';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_company_branding_workspace_id_mutation() from public;

drop trigger if exists company_branding_guard_workspace_id on public.company_branding;
create trigger company_branding_guard_workspace_id
  before update on public.company_branding
  for each row execute function public.guard_company_branding_workspace_id_mutation();

-- ============================================================
-- Section 5 -- New-workspace default: an `after insert` trigger on
-- `public.workspaces` that seeds a default `company_branding` row for
-- every newly created workspace, carrying over today's Ergon defaults
-- (company_name placeholder 'New Company' -- see header note 3;
-- logo_storage_path left null). security definer + set search_path = ''
-- so it writes under the owner's privileges regardless of who is
-- allowed to create a workspace, and `on conflict (workspace_id) do
-- nothing` so it can never clash with the one-time backfilled row above
-- if this trigger is ever re-run against an existing workspace_id (it
-- won't be, since it only fires on INSERT, but the guard costs nothing).
-- Named distinctly from `workspaces_set_updated_at` (migration 115,
-- `before update`) -- confirmed no other `after insert` trigger exists
-- on this table to coordinate ordering with (header note 2).
-- ============================================================

create or replace function public.seed_default_company_branding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company_branding (workspace_id, company_name, logo_storage_path)
  values (new.id, 'New Company', null)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_default_company_branding() from public;

drop trigger if exists workspaces_seed_default_branding on public.workspaces;
create trigger workspaces_seed_default_branding
  after insert on public.workspaces
  for each row execute function public.seed_default_company_branding();

-- ============================================================
-- Section 6 -- RLS: workspace-scoped, write ANDed with the existing
-- admin gate (never replaced -- the admin check stays meaningful, just
-- not sufficient alone once a second workspace exists), same
-- conservative pattern as `user_invites` in the concurrently-drafted
-- migration 181.
-- ============================================================

drop policy if exists "authenticated read company_branding" on public.company_branding;
drop policy if exists "admin write company_branding" on public.company_branding;

create policy "workspace members read company_branding"
  on public.company_branding for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members: admin write company_branding"
  on public.company_branding for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and public.is_app_admin(auth.uid())
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and public.is_app_admin(auth.uid())
  );

-- ============================================================
-- Section 7 -- Storage: `company-branding` bucket objects. Public READ
-- policy (039:50-53) is left completely untouched -- verified unchanged
-- posture, a product decision beyond this migration's scope to revisit.
-- Only the WRITE-side policies (insert/update/delete) gain a workspace
-- check, matching the new `<workspace_id>/logo-...` path convention.
-- The leading path segment IS the real workspace_id -- matched as TEXT
-- against workspace_members.workspace_id::text, never cast from the
-- path segment to uuid (a malformed/foreign segment fails the `exists`
-- check cleanly instead of raising inside a policy shared by every
-- bucket in this table).
-- ============================================================

drop policy if exists "admin write company-branding objects" on storage.objects;
drop policy if exists "admin update company-branding objects" on storage.objects;
drop policy if exists "admin delete company-branding objects" on storage.objects;

create policy "workspace admins write company-branding objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-branding'
    and exists (
      select 1
      from public.workspace_members wm
      join public.workspaces w on w.id = wm.workspace_id
      where wm.user_id = auth.uid()
        and w.status = 'active'
        and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
    )
    and public.is_app_admin(auth.uid())
  );

create policy "workspace admins update company-branding objects"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'company-branding'
    and exists (
      select 1
      from public.workspace_members wm
      join public.workspaces w on w.id = wm.workspace_id
      where wm.user_id = auth.uid()
        and w.status = 'active'
        and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
    )
    and public.is_app_admin(auth.uid())
  )
  with check (
    bucket_id = 'company-branding'
    and exists (
      select 1
      from public.workspace_members wm
      join public.workspaces w on w.id = wm.workspace_id
      where wm.user_id = auth.uid()
        and w.status = 'active'
        and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
    )
    and public.is_app_admin(auth.uid())
  );

create policy "workspace admins delete company-branding objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'company-branding'
    and exists (
      select 1
      from public.workspace_members wm
      join public.workspaces w on w.id = wm.workspace_id
      where wm.user_id = auth.uid()
        and w.status = 'active'
        and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
    )
    and public.is_app_admin(auth.uid())
  );

commit;
