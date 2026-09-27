-- Migration 215: Phase 2C (part 1 of 2) -- workspace_sales_approval_settings.
--
-- Unlike proposal_template_sections (see the separate decision question
-- raised alongside this migration -- that one genuinely needs a product
-- call, not just an RLS fix), this table already has `workspace_id uuid
-- primary key references workspaces(id)` (migration 147) -- it was
-- ALREADY correctly designed as one row per workspace. It just never
-- got its RLS updated to actually enforce that scoping: the SELECT
-- policy was `using (true)` (every company can read every other
-- company's discount-approval threshold) and the write policy was
-- `is_app_admin(auth.uid())` only (a workspace-only admin cannot
-- configure their own company's setting at all) -- the exact same
-- pattern migration 213 already fixed across 19 other tables, just
-- missed there because this table's write policy doesn't reference
-- `workspace_id` in its predicate text the way the others do (the
-- table's OWN primary key IS the workspace scope here, so the fix
-- references it directly rather than via a resolver function).
--
-- Also backfills a settings row for any active workspace missing one --
-- migration 147's own one-time seed only ever covered "today's one real
-- active workspace" (its own words) at the moment it ran, before K-Tech
-- Systems existed. No later migration (approve_company_signup,
-- accept_company_signup) seeds this table for a new company, so without
-- this backfill K-Tech would have no row at all.

begin;

drop policy if exists "authenticated read workspace_sales_approval_settings" on public.workspace_sales_approval_settings;
create policy "authenticated read workspace_sales_approval_settings" on public.workspace_sales_approval_settings for select to authenticated
  using (is_workspace_member(workspace_id));

drop policy if exists "admin write workspace_sales_approval_settings" on public.workspace_sales_approval_settings;
create policy "admin write workspace_sales_approval_settings" on public.workspace_sales_approval_settings for all to authenticated
  using (is_app_admin(auth.uid()) or (is_active_workspace_member(workspace_id) and is_workspace_admin(workspace_id)))
  with check (is_app_admin(auth.uid()) or (is_active_workspace_member(workspace_id) and is_workspace_admin(workspace_id)));

insert into public.workspace_sales_approval_settings (workspace_id)
select id from public.workspaces where status = 'active'
on conflict (workspace_id) do nothing;

commit;

-- Confirm 215 is still the next free migration number in
-- backend/supabase/migrations/ before applying. Not applied. Kept
-- local for E's review.
