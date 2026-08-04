-- Phase 9: real, server-enforced role permissions (coarse matrix, per E's
-- decision to bundle this with Phase 10 rather than build it standalone).
-- Uses the matrix already seeded in migration 003's app_role_modes, now
-- actually enforced via RLS instead of just being descriptive metadata:
--   warehouse: inventory write, projects read
--   purchasing: purchasing write, inventory read
--   pm: projects write, inventory read
--   manager: reports/inventory/projects read (no write override here)
--   admin: write access everywhere (existing is_app_admin() bypass)
--
-- This only touches WRITE policies (insert/update/delete). Every table's
-- existing "authenticated read X" SELECT policy is untouched -- everyone
-- who's approved and signed in can still see everything, matching how the
-- app already works. Only who can *change* rows gets tightened.
--
-- Depends on the relevant table existing already: run after migrations
-- 018/020/021/022 (Phase 10c-f) so this doesn't fail on a missing table.
-- If a Phase 10 migration for a given table hasn't been run yet, comment
-- out that table's block below and re-run it later.

create or replace function has_role(check_role text)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from app_user_roles where user_id = auth.uid() and role_key = check_role
  );
$$;

-- Inventory-related tables: warehouse + admin write.
drop policy if exists "authenticated write inventory_items" on inventory_items;
create policy "warehouse and admin write inventory_items"
  on inventory_items for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('warehouse'))
  with check (is_app_admin(auth.uid()) or has_role('warehouse'));

drop policy if exists "authenticated write inventory_balances" on inventory_balances;
create policy "warehouse and admin write inventory_balances"
  on inventory_balances for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('warehouse'))
  with check (is_app_admin(auth.uid()) or has_role('warehouse'));

drop policy if exists "authenticated write inventory_movements" on inventory_movements;
create policy "warehouse and admin write inventory_movements"
  on inventory_movements for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('warehouse'))
  with check (is_app_admin(auth.uid()) or has_role('warehouse'));

drop policy if exists "authenticated write inventory_transactions" on inventory_transactions;
create policy "warehouse and admin write inventory_transactions"
  on inventory_transactions for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('warehouse'))
  with check (is_app_admin(auth.uid()) or has_role('warehouse'));

drop policy if exists "authenticated write equipment_types" on equipment_types;
create policy "warehouse and admin write equipment_types"
  on equipment_types for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('warehouse'))
  with check (is_app_admin(auth.uid()) or has_role('warehouse'));

drop policy if exists "authenticated write equipment_bom_components" on equipment_bom_components;
create policy "warehouse and admin write equipment_bom_components"
  on equipment_bom_components for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('warehouse'))
  with check (is_app_admin(auth.uid()) or has_role('warehouse'));

drop policy if exists "authenticated write build_transactions" on build_transactions;
create policy "warehouse and admin write build_transactions"
  on build_transactions for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('warehouse'))
  with check (is_app_admin(auth.uid()) or has_role('warehouse'));

drop policy if exists "authenticated write project_allocation_history" on project_allocation_history;
create policy "warehouse and admin write project_allocation_history"
  on project_allocation_history for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('warehouse'))
  with check (is_app_admin(auth.uid()) or has_role('warehouse'));

-- Purchasing: purchasing role + admin write.
drop policy if exists "authenticated write purchase_requests" on purchase_requests;
create policy "purchasing and admin write purchase_requests"
  on purchase_requests for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('purchasing'))
  with check (is_app_admin(auth.uid()) or has_role('purchasing'));

-- Projects: pm role + admin write.
drop policy if exists "authenticated write projects" on projects;
create policy "pm and admin write projects"
  on projects for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('pm'))
  with check (is_app_admin(auth.uid()) or has_role('pm'));

drop policy if exists "authenticated write project_scope_of_work" on project_scope_of_work;
create policy "pm and admin write project_scope_of_work"
  on project_scope_of_work for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('pm'))
  with check (is_app_admin(auth.uid()) or has_role('pm'));

drop policy if exists "authenticated write project_bom_lines" on project_bom_lines;
create policy "pm and admin write project_bom_lines"
  on project_bom_lines for all to authenticated
  using (is_app_admin(auth.uid()) or has_role('pm'))
  with check (is_app_admin(auth.uid()) or has_role('pm'));

-- Deliberately left untouched (still open to any authenticated, approved
-- user regardless of role): tasks, team_members writes (already
-- admin/manager-gated from migration 019), product_catalog (no "sales"
-- role exists yet in app_user_roles' check constraint -- would need its own
-- migration to add one before this table could be role-gated), and
-- project_documents (uploading/reviewing documents isn't clearly a single
-- role's job across warehouse/purchasing/pm today).
