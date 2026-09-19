-- E was alarmed to learn a handful of ADMIN-level actions -- inviting a
-- teammate, changing company branding, some catalog-pricing writes --
-- currently only check the single GLOBAL admin flag
-- (`is_app_admin(auth.uid())`, from `app_admins`, a flat list with no
-- workspace concept at all) rather than a PER-COMPANY admin flag. E's
-- explicit, confirmed decision: each company's own admin should be able
-- to do these things for their own company, without needing to go
-- through E personally.
--
-- Good news, re-confirmed directly from source before writing this: a
-- real per-workspace admin mechanism ALREADY EXISTS and needs no new
-- schema -- `workspace_members.is_workspace_admin` (boolean column,
-- migration 115) plus `public.is_workspace_admin(check_workspace_id uuid)`
-- (backend/supabase/migrations/115_workspaces_foundation.sql:121-134,
-- `security definer`, checks `workspace_members.is_workspace_admin = true`
-- for the calling `auth.uid()` in that specific workspace). Already used
-- correctly elsewhere (`workspace_members`'s own RLS, 115:264-275, and
-- inside several RPC functions in migrations 130/131/132/159/163/164) --
-- it is simply not yet wired into the policies below.
--
-- E's explicit design direction: ADD `is_workspace_admin(workspace_id)` as
-- an ADDITIONAL way to satisfy each policy below -- OR it in alongside
-- whatever already grants access today (`is_app_admin(auth.uid())`, and
-- any existing `has_role(...)` conditions) -- never remove or replace any
-- existing condition. Purely additive: nothing that works today stops
-- working. The `is_active_workspace_member`/`is_workspace_member`
-- containment check already ANDed into every one of these policies stays
-- exactly as-is and already prevents any cross-company effect -- a
-- workspace admin's new qualification only ever applies to rows in their
-- OWN workspace_id, because `is_workspace_admin(workspace_id)` itself
-- checks that specific `workspace_id`, not "is a workspace admin of
-- anything."
--
-- Every policy touched below, with its exact current shape re-confirmed
-- directly from source (not from memory) immediately before writing this:
--
--   1. `user_invites` (backend/supabase/migrations/
--      181_user_invites_workspace_scoping.sql:156-172) -- both the read
--      policy (156-161) and the write policy (163-172) currently gate on
--      `is_app_admin(auth.uid())` ANDed with a workspace-membership check.
--      Admin condition on both becomes
--      `(is_app_admin(auth.uid()) or is_workspace_admin(workspace_id))`.
--   2. `company_branding` TABLE (backend/supabase/migrations/
--      182_company_branding_workspace_scoping.sql:243-252) -- write policy
--      currently `is_active_workspace_member(workspace_id) and
--      is_app_admin(auth.uid())`. Admin part becomes
--      `(is_app_admin(auth.uid()) or is_workspace_admin(workspace_id))`.
--   3. `company-branding` STORAGE bucket policies (same migration,
--      storage.objects insert/update/delete, 182:267-326) -- each
--      currently ANDs `is_app_admin(auth.uid())` onto a workspace-
--      membership-via-path-segment check where the leading path segment
--      IS the workspace_id itself as text (`wm.workspace_id::text =
--      split_part(storage.objects.name, '/', 1)`, deliberately never cast
--      to uuid per 182's own header note 5, so a malformed/foreign path
--      segment fails cleanly instead of raising inside a policy shared by
--      every bucket). `is_workspace_admin()` needs a real uuid argument,
--      so this migration adds one small helper,
--      `safe_workspace_id_from_object_path()`, that performs that same
--      cast but catches `invalid_text_representation` and returns null
--      instead of raising -- preserving 182's "malformed segment fails
--      the check cleanly, never a hard error" property while computing
--      the workspace_id from the path exactly once, reused by both the
--      membership `exists` check (now compared as uuid = uuid instead of
--      text = text -- behaviorally identical: a valid segment parses to
--      the same uuid either way, an invalid one still matches nothing
--      either way, it just now returns null instead of a raw string that
--      coincidentally never equals a real `workspace_id::text`) and the
--      new `is_workspace_admin()` call. JUDGMENT CALL, flagged for E:
--      restructuring the membership check's comparison from text to uuid
--      (rather than leaving it untouched and separately re-deriving a
--      second uuid just for `is_workspace_admin`) was chosen as the
--      cleaner of the two options the task description offered -- it
--      reads as one coherent "resolve the path's workspace once" step
--      instead of two parallel derivations of the same value, and is
--      verified equivalent by this migration's own test (Section 6 in the
--      canonical test file: a workspace-admin-only, non-global-admin user
--      succeeds against their own workspace's path prefix and is still
--      rejected against a different workspace's).
--   4. `product_catalog` (backend/supabase/migrations/
--      176_product_catalog_workspace_scoping.sql:60-69) -- write policy
--      currently `is_active_workspace_member(workspace_id) and
--      (is_app_admin(auth.uid()) or has_role('manager'))`. Adds
--      `or is_workspace_admin(workspace_id)` to the inner OR group.
--   5. `catalog_price_change_requests` (same migration, 176:144-164) --
--      the UPDATE/review policy ("workspace members: admin/manager review
--      price change requests", 155-164) gates on
--      `is_active_workspace_member(workspace_id) and (is_app_admin(...)
--      or has_role('manager'))`, same shape as product_catalog -- same
--      additive OR. JUDGMENT CALL, flagged for E, going one step beyond
--      the literal ask: the SELECT policy immediately above it
--      ("workspace members: requester and admin/manager read price change
--      requests", 144-153) grants read to the requester OR
--      `is_app_admin(...)` OR `has_role('manager')` for the exact same
--      "review" purpose -- a workspace admin who could approve/reject a
--      request via the UPDATE policy but still couldn't SELECT it to see
--      what they're approving would be a functionally broken grant, not a
--      conservative one, so the same OR is added to that read policy too.
--      The INSERT policy ("workspace members create own price change
--      requests", 137-142) is unrelated -- it gates on the requester's own
--      email, not an admin flag -- and is left untouched.
--   6. `presales_hardware_rules`, `site_hardware_rules`, `form_schemas`,
--      `form_schema_fields` (backend/supabase/migrations/
--      177_remaining_global_config_workspace_scoping.sql, write policies
--      at 90-99, 139-148, 187-196, and 260-269 respectively) -- each
--      currently `is_active_workspace_member(workspace_id) and
--      (is_app_admin(auth.uid()) or has_role('pm')[, or
--      has_role('manager') for site_hardware_rules only])`. Same additive
--      `or is_workspace_admin(workspace_id)` to each inner OR group.
--
-- Every policy below is reproduced via `drop policy if exists ...` then
-- `create policy` with the exact same name and shape as its source
-- migration, plus only the one additive OR described above -- nothing
-- else changed. No schema change, no new trigger, no backfill -- this is
-- authorization-only.
--
-- Frontend: CHECKED, and the assumption that no frontend change is
-- needed is WRONG -- flagged clearly here rather than silently assumed.
-- The database side (this migration) is genuinely RLS-only and correct
-- on its own. But `checkIsAdmin()` (src/persistence.ts:1252-1267) --
-- which drives the single client-side `isAdmin` boolean in src/main.tsx
-- (set at :2806 from that call's result) that gates "Invite a teammate"
-- (Team Roster panel, :18910-18913 area), catalog management
-- (`canManageCatalog={isAdmin || isManagerRole}`, :8094), company
-- branding settings, and every other admin-only UI affordance touched by
-- this migration -- queries ONLY `app_admins` (`app_admins?user_id=eq.
-- <id>`), with no awareness of `workspace_members.is_workspace_admin` at
-- all. A real workspace-admin-only user (exactly the person this
-- migration exists to empower) will not see these buttons/panels in the
-- app AT ALL today -- they still have to go through a global admin, not
-- because the database stops them anymore, but because the UI never
-- offers them the option. **This migration alone does not achieve E's
-- stated goal end-to-end** -- it only makes the database side ready for
-- a follow-up frontend change (teach `isAdmin`/a new `isWorkspaceAdmin`
-- state to also check the caller's own `workspace_members` row for their
-- active workspace, then OR it into each of these UI gates). That
-- frontend work is deliberately NOT done in this same pass -- it's a
-- separate, sizable, UI-surface-spanning change or several, not a
-- one-line fix, and mixing it into this authorization-only migration
-- would blur what's actually being reviewed here. Flagged prominently for
-- E rather than silently shipped as "done."
--
-- Confirm 185 is still the next free migration number at execution time.
-- Not applied. Kept local for E's review.

begin;

-- ============================================================
-- Section 1 -- user_invites (migration 181): admin condition on both the
-- read and write policy gains the additive OR. Workspace-membership half
-- of each policy is untouched.
-- ============================================================

drop policy if exists "workspace members: admins read user_invites" on public.user_invites;

create policy "workspace members: admins read user_invites"
  on public.user_invites for select to authenticated
  using (
    (public.is_app_admin(auth.uid()) or public.is_workspace_admin(workspace_id))
    and public.is_workspace_member(workspace_id)
  );

drop policy if exists "workspace members: admins write user_invites" on public.user_invites;

create policy "workspace members: admins write user_invites"
  on public.user_invites for all to authenticated
  using (
    (public.is_app_admin(auth.uid()) or public.is_workspace_admin(workspace_id))
    and public.is_active_workspace_member(workspace_id)
  )
  with check (
    (public.is_app_admin(auth.uid()) or public.is_workspace_admin(workspace_id))
    and public.is_active_workspace_member(workspace_id)
  );

-- ============================================================
-- Section 2 -- company_branding TABLE (migration 182): write policy's
-- admin condition gains the additive OR. Read policy (workspace-member-
-- only, no admin gate at all) is untouched.
-- ============================================================

drop policy if exists "workspace members: admin write company_branding" on public.company_branding;

create policy "workspace members: admin write company_branding"
  on public.company_branding for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.is_workspace_admin(workspace_id))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.is_workspace_admin(workspace_id))
  );

-- ============================================================
-- Section 3 -- company-branding STORAGE bucket (migration 182): see the
-- header comment's point 3 for the full restructuring rationale. This
-- helper computes the workspace_id encoded in an object's own path
-- exactly once, safely -- never raising on a malformed/foreign leading
-- path segment, matching 182's own "fails cleanly, never a hard error"
-- principle for this exact bucket's policies.
-- ============================================================

create or replace function public.safe_workspace_id_from_object_path(object_name text)
returns uuid
language plpgsql
stable
as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

drop policy if exists "workspace admins write company-branding objects" on storage.objects;

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
        and wm.workspace_id = public.safe_workspace_id_from_object_path(storage.objects.name)
    )
    and (
      public.is_app_admin(auth.uid())
      or public.is_workspace_admin(public.safe_workspace_id_from_object_path(storage.objects.name))
    )
  );

drop policy if exists "workspace admins update company-branding objects" on storage.objects;

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
        and wm.workspace_id = public.safe_workspace_id_from_object_path(storage.objects.name)
    )
    and (
      public.is_app_admin(auth.uid())
      or public.is_workspace_admin(public.safe_workspace_id_from_object_path(storage.objects.name))
    )
  )
  with check (
    bucket_id = 'company-branding'
    and exists (
      select 1
      from public.workspace_members wm
      join public.workspaces w on w.id = wm.workspace_id
      where wm.user_id = auth.uid()
        and w.status = 'active'
        and wm.workspace_id = public.safe_workspace_id_from_object_path(storage.objects.name)
    )
    and (
      public.is_app_admin(auth.uid())
      or public.is_workspace_admin(public.safe_workspace_id_from_object_path(storage.objects.name))
    )
  );

drop policy if exists "workspace admins delete company-branding objects" on storage.objects;

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
        and wm.workspace_id = public.safe_workspace_id_from_object_path(storage.objects.name)
    )
    and (
      public.is_app_admin(auth.uid())
      or public.is_workspace_admin(public.safe_workspace_id_from_object_path(storage.objects.name))
    )
  );

-- ============================================================
-- Section 4 -- product_catalog (migration 176): additive OR into the
-- inner admin/manager group.
-- ============================================================

drop policy if exists "workspace members: manager and admin write product_catalog" on public.product_catalog;

create policy "workspace members: manager and admin write product_catalog"
  on public.product_catalog for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('manager') or public.is_workspace_admin(workspace_id))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('manager') or public.is_workspace_admin(workspace_id))
  );

-- ============================================================
-- Section 5 -- catalog_price_change_requests (migration 176, Section 2):
-- additive OR into both the read-for-review and update-for-review
-- policies (see header comment point 5 for why read is also touched).
-- The requester-facing INSERT policy is untouched -- it isn't admin-gated.
-- ============================================================

drop policy if exists "workspace members: requester and admin/manager read price change requests" on public.catalog_price_change_requests;

create policy "workspace members: requester and admin/manager read price change requests"
  on public.catalog_price_change_requests for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (
      lower(requested_by_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      or public.is_app_admin(auth.uid())
      or public.has_role('manager')
      or public.is_workspace_admin(workspace_id)
    )
  );

drop policy if exists "workspace members: admin/manager review price change requests" on public.catalog_price_change_requests;

create policy "workspace members: admin/manager review price change requests"
  on public.catalog_price_change_requests for update to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('manager') or public.is_workspace_admin(workspace_id))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('manager') or public.is_workspace_admin(workspace_id))
  );

-- ============================================================
-- Section 6 -- presales_hardware_rules, site_hardware_rules,
-- form_schemas, form_schema_fields (migration 177): additive OR into
-- each inner admin/role group.
-- ============================================================

drop policy if exists "workspace members: pm and admin write presales_hardware_rules" on public.presales_hardware_rules;

create policy "workspace members: pm and admin write presales_hardware_rules"
  on public.presales_hardware_rules for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm') or public.is_workspace_admin(workspace_id))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm') or public.is_workspace_admin(workspace_id))
  );

drop policy if exists "workspace members: pm manager and admin write site_hardware_rules" on public.site_hardware_rules;

create policy "workspace members: pm manager and admin write site_hardware_rules"
  on public.site_hardware_rules for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm') or public.has_role('manager') or public.is_workspace_admin(workspace_id))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm') or public.has_role('manager') or public.is_workspace_admin(workspace_id))
  );

drop policy if exists "workspace members: pm and admin write form_schemas" on public.form_schemas;

create policy "workspace members: pm and admin write form_schemas"
  on public.form_schemas for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm') or public.is_workspace_admin(workspace_id))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm') or public.is_workspace_admin(workspace_id))
  );

drop policy if exists "workspace members: pm and admin write form_schema_fields" on public.form_schema_fields;

create policy "workspace members: pm and admin write form_schema_fields"
  on public.form_schema_fields for all to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm') or public.is_workspace_admin(workspace_id))
  )
  with check (
    public.is_active_workspace_member(workspace_id)
    and (public.is_app_admin(auth.uid()) or public.has_role('pm') or public.is_workspace_admin(workspace_id))
  );

commit;
