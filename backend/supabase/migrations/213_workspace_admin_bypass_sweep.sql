-- Migration 213: a systemic sweep for the same bug class found four
-- times already today (migrations 209/210/211/212's own headers) --
-- this time found by a direct, comprehensive audit of the REAL, live,
-- fully-migrated schema's pg_policies (not grepping migration file
-- history, which is unreliable once a later migration supersedes an
-- earlier one), rather than waiting for E to hit a fifth instance live.
--
-- The audit found 59 policies checking is_app_admin(auth.uid()) with no
-- is_workspace_admin(...) fallback at all. This migration fixes the 43
-- of those 59 that are unambiguously safe to fix the same way migration
-- 185/212 already did: the policy ALREADY references a real per-row
-- workspace-resolution expression (workspace_id directly, or an
-- existing owner_workspace_id() resolver) alongside is_app_admin, so
-- adding `or is_workspace_admin(<that same expression>)` grants no new
-- cross-workspace access -- it only lets a real workspace admin do for
-- their OWN company's rows what an app_admin could already do for
-- every company's rows.
--
-- Real, previously-invisible day-one impact this closes: a genuine
-- self-serve company's founding admin (no legacy app_admins row, no
-- role assigned yet) could not create or edit a PROJECT, add an
-- INVENTORY ITEM or EQUIPMENT TYPE, log a BUILD TRANSACTION, or create
-- a PURCHASE REQUEST -- the core day-to-day functions of this entire
-- app -- for their own company. This affects every future self-serve
-- company identically, not just K-Tech Systems.
--
-- Deliberately NOT touched here, each for a specific, stated reason --
-- do not "helpfully" broaden these in a later pass without first
-- resolving the reason:
--   - app_admins (both policies): genuinely Ergon-only, global admin-
--     list management. Broadening this would let any company's
--     workspace admin add themselves to ERGON's own global admin list
--     -- a real privilege-escalation bug, not a fix.
--   - app_known_users (both policies): already correctly reachable by
--     a workspace admin via that same policy's own
--     shares_workspace_with(user_id) OR-branch -- nothing to fix.
--   - app_user_roles (both policies): no workspace_id column
--     referenced in either policy at all -- role assignment
--     (pm/manager/warehouse/etc for a company's own team) is a real,
--     separate gap, but fixing it needs a workspace resolution path via
--     the TARGET row's own user_id (there is no workspace_id column on
--     this table to reference directly), not the same one-line
--     mechanical pattern used below. Needs its own migration.
--   - app_user_status ("admins and managers review status"): the
--     has_seen_welcome case is already fixed (migration 210's
--     mark_own_welcome_seen() RPC). Approving a SECOND employee's
--     pending signup request (the non-invite "request access" path)
--     remains genuinely gated to is_app_admin/is_app_manager only --
--     flagged, not fixed here, since this table also has no
--     workspace_id column and the invite path (migration 212, now
--     fixed) already covers the primary onboarding route for adding
--     teammates.
--   - notifications (both policies): is_app_admin here grants
--     visibility into every recipient's notifications app-wide, for
--     Ergon's own debugging/audit use -- not workspace-scoped at all,
--     and not core day-one functionality. Lower priority, flagged for
--     later.
--   - proposal_template_sections: no workspace_id reference at all --
--     unclear whether this is meant to be one shared global template
--     library or genuinely per-workspace content. Needs a real design
--     decision, not a guess baked into RLS.
--   - restore_run_sections, restore_runs, system_health_events,
--     system_health_events_monthly_summary: Ergon's own internal
--     backup/ops-monitoring tooling, correctly global and admin-only.
--   - workspace_sales_approval_settings: no workspace_id check in its
--     policy at all despite the table's own name -- broadening the
--     admin check without first confirming how (or whether) this table
--     is actually scoped per workspace risks making a narrow, existing
--     gap worse, not better. Needs investigation, not a mechanical fix.
--
-- Every policy below is reproduced via `drop policy if exists ...` then
-- `create policy` with the exact same name, command, and existing
-- predicate -- only the is_workspace_admin(...) OR-branch is added,
-- nothing else changes.

begin;

-- ============================================================
-- build_transactions
-- ============================================================

drop policy if exists "workspace members: warehouse and admin delete build_transaction" on public.build_transactions;
create policy "workspace members: warehouse and admin delete build_transaction" on public.build_transactions for delete to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin insert build_transaction" on public.build_transactions;
create policy "workspace members: warehouse and admin insert build_transaction" on public.build_transactions for insert to authenticated
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin update build_transaction" on public.build_transactions;
create policy "workspace members: warehouse and admin update build_transaction" on public.build_transactions for update to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')));

-- ============================================================
-- equipment_bom_components
-- ============================================================

drop policy if exists "workspace members: warehouse and admin delete equipment_bom_com" on public.equipment_bom_components;
create policy "workspace members: warehouse and admin delete equipment_bom_com" on public.equipment_bom_components for delete to authenticated
  using (is_active_workspace_member(equipment_type_owner_workspace_id(equipment_type_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(equipment_type_owner_workspace_id(equipment_type_id)) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin insert equipment_bom_com" on public.equipment_bom_components;
create policy "workspace members: warehouse and admin insert equipment_bom_com" on public.equipment_bom_components for insert to authenticated
  with check (is_active_workspace_member(equipment_type_owner_workspace_id(equipment_type_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(equipment_type_owner_workspace_id(equipment_type_id)) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin update equipment_bom_com" on public.equipment_bom_components;
create policy "workspace members: warehouse and admin update equipment_bom_com" on public.equipment_bom_components for update to authenticated
  using (is_active_workspace_member(equipment_type_owner_workspace_id(equipment_type_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(equipment_type_owner_workspace_id(equipment_type_id)) or has_role('warehouse')))
  with check (is_active_workspace_member(equipment_type_owner_workspace_id(equipment_type_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(equipment_type_owner_workspace_id(equipment_type_id)) or has_role('warehouse')));

-- ============================================================
-- equipment_types
-- ============================================================

drop policy if exists "workspace members: warehouse and admin delete equipment_types" on public.equipment_types;
create policy "workspace members: warehouse and admin delete equipment_types" on public.equipment_types for delete to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin insert equipment_types" on public.equipment_types;
create policy "workspace members: warehouse and admin insert equipment_types" on public.equipment_types for insert to authenticated
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin update equipment_types" on public.equipment_types;
create policy "workspace members: warehouse and admin update equipment_types" on public.equipment_types for update to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')));

-- ============================================================
-- inventory_balances
-- ============================================================

drop policy if exists "workspace members: warehouse and admin delete inventory_balance" on public.inventory_balances;
create policy "workspace members: warehouse and admin delete inventory_balance" on public.inventory_balances for delete to authenticated
  using (is_active_workspace_member(inventory_item_owner_workspace_id(inventory_item_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(inventory_item_owner_workspace_id(inventory_item_id)) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin insert inventory_balance" on public.inventory_balances;
create policy "workspace members: warehouse and admin insert inventory_balance" on public.inventory_balances for insert to authenticated
  with check (is_active_workspace_member(inventory_item_owner_workspace_id(inventory_item_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(inventory_item_owner_workspace_id(inventory_item_id)) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin update inventory_balance" on public.inventory_balances;
create policy "workspace members: warehouse and admin update inventory_balance" on public.inventory_balances for update to authenticated
  using (is_active_workspace_member(inventory_item_owner_workspace_id(inventory_item_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(inventory_item_owner_workspace_id(inventory_item_id)) or has_role('warehouse')))
  with check (is_active_workspace_member(inventory_item_owner_workspace_id(inventory_item_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(inventory_item_owner_workspace_id(inventory_item_id)) or has_role('warehouse')));

-- ============================================================
-- inventory_items
-- ============================================================

drop policy if exists "workspace members: warehouse and admin delete inventory_items" on public.inventory_items;
create policy "workspace members: warehouse and admin delete inventory_items" on public.inventory_items for delete to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin insert inventory_items" on public.inventory_items;
create policy "workspace members: warehouse and admin insert inventory_items" on public.inventory_items for insert to authenticated
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin update inventory_items" on public.inventory_items;
create policy "workspace members: warehouse and admin update inventory_items" on public.inventory_items for update to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('warehouse')));

-- ============================================================
-- inventory_movements
-- ============================================================

drop policy if exists "workspace members: warehouse and admin delete inventory_movemen" on public.inventory_movements;
create policy "workspace members: warehouse and admin delete inventory_movemen" on public.inventory_movements for delete to authenticated
  using (is_active_workspace_member(inventory_item_owner_workspace_id(inventory_item_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(inventory_item_owner_workspace_id(inventory_item_id)) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin insert inventory_movemen" on public.inventory_movements;
create policy "workspace members: warehouse and admin insert inventory_movemen" on public.inventory_movements for insert to authenticated
  with check (is_active_workspace_member(inventory_item_owner_workspace_id(inventory_item_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(inventory_item_owner_workspace_id(inventory_item_id)) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin update inventory_movemen" on public.inventory_movements;
create policy "workspace members: warehouse and admin update inventory_movemen" on public.inventory_movements for update to authenticated
  using (is_active_workspace_member(inventory_item_owner_workspace_id(inventory_item_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(inventory_item_owner_workspace_id(inventory_item_id)) or has_role('warehouse')))
  with check (is_active_workspace_member(inventory_item_owner_workspace_id(inventory_item_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(inventory_item_owner_workspace_id(inventory_item_id)) or has_role('warehouse')));

-- ============================================================
-- inventory_transactions
-- ============================================================

drop policy if exists "workspace members: warehouse and admin delete inventory_transac" on public.inventory_transactions;
create policy "workspace members: warehouse and admin delete inventory_transac" on public.inventory_transactions for delete to authenticated
  using (is_active_workspace_member(coalesce(project_owner_workspace_id(project_id), purchase_order_owner_workspace_id(purchase_order_id), equipment_type_owner_workspace_id(equipment_type_id))) and (is_app_admin(auth.uid()) or is_workspace_admin(coalesce(project_owner_workspace_id(project_id), purchase_order_owner_workspace_id(purchase_order_id), equipment_type_owner_workspace_id(equipment_type_id))) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin insert inventory_transac" on public.inventory_transactions;
create policy "workspace members: warehouse and admin insert inventory_transac" on public.inventory_transactions for insert to authenticated
  with check (is_active_workspace_member(coalesce(project_owner_workspace_id(project_id), purchase_order_owner_workspace_id(purchase_order_id), equipment_type_owner_workspace_id(equipment_type_id))) and (is_app_admin(auth.uid()) or is_workspace_admin(coalesce(project_owner_workspace_id(project_id), purchase_order_owner_workspace_id(purchase_order_id), equipment_type_owner_workspace_id(equipment_type_id))) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin update inventory_transac" on public.inventory_transactions;
create policy "workspace members: warehouse and admin update inventory_transac" on public.inventory_transactions for update to authenticated
  using (is_active_workspace_member(coalesce(project_owner_workspace_id(project_id), purchase_order_owner_workspace_id(purchase_order_id), equipment_type_owner_workspace_id(equipment_type_id))) and (is_app_admin(auth.uid()) or is_workspace_admin(coalesce(project_owner_workspace_id(project_id), purchase_order_owner_workspace_id(purchase_order_id), equipment_type_owner_workspace_id(equipment_type_id))) or has_role('warehouse')))
  with check (is_active_workspace_member(coalesce(project_owner_workspace_id(project_id), purchase_order_owner_workspace_id(purchase_order_id), equipment_type_owner_workspace_id(equipment_type_id))) and (is_app_admin(auth.uid()) or is_workspace_admin(coalesce(project_owner_workspace_id(project_id), purchase_order_owner_workspace_id(purchase_order_id), equipment_type_owner_workspace_id(equipment_type_id))) or has_role('warehouse')));

-- ============================================================
-- notification_rules
-- ============================================================

drop policy if exists "workspace members: admins and managers write notification_rules" on public.notification_rules;
create policy "workspace members: admins and managers write notification_rules" on public.notification_rules for all to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or is_app_manager(auth.uid())))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or is_app_manager(auth.uid())));

-- ============================================================
-- project_allocation_history
-- ============================================================

drop policy if exists "workspace members: warehouse and admin delete project_allocatio" on public.project_allocation_history;
create policy "workspace members: warehouse and admin delete project_allocatio" on public.project_allocation_history for delete to authenticated
  using (is_active_workspace_member(coalesce(project_owner_workspace_id(project_id), inventory_item_owner_workspace_id(inventory_item_id))) and (is_app_admin(auth.uid()) or is_workspace_admin(coalesce(project_owner_workspace_id(project_id), inventory_item_owner_workspace_id(inventory_item_id))) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin insert project_allocatio" on public.project_allocation_history;
create policy "workspace members: warehouse and admin insert project_allocatio" on public.project_allocation_history for insert to authenticated
  with check (is_active_workspace_member(coalesce(project_owner_workspace_id(project_id), inventory_item_owner_workspace_id(inventory_item_id))) and (is_app_admin(auth.uid()) or is_workspace_admin(coalesce(project_owner_workspace_id(project_id), inventory_item_owner_workspace_id(inventory_item_id))) or has_role('warehouse')));

drop policy if exists "workspace members: warehouse and admin update project_allocatio" on public.project_allocation_history;
create policy "workspace members: warehouse and admin update project_allocatio" on public.project_allocation_history for update to authenticated
  using (is_active_workspace_member(coalesce(project_owner_workspace_id(project_id), inventory_item_owner_workspace_id(inventory_item_id))) and (is_app_admin(auth.uid()) or is_workspace_admin(coalesce(project_owner_workspace_id(project_id), inventory_item_owner_workspace_id(inventory_item_id))) or has_role('warehouse')))
  with check (is_active_workspace_member(coalesce(project_owner_workspace_id(project_id), inventory_item_owner_workspace_id(inventory_item_id))) and (is_app_admin(auth.uid()) or is_workspace_admin(coalesce(project_owner_workspace_id(project_id), inventory_item_owner_workspace_id(inventory_item_id))) or has_role('warehouse')));

-- ============================================================
-- project_bom_lines
-- ============================================================

drop policy if exists "workspace members: pm and admin delete project_bom_lines" on public.project_bom_lines;
create policy "workspace members: pm and admin delete project_bom_lines" on public.project_bom_lines for delete to authenticated
  using (is_active_workspace_member(project_owner_workspace_id(project_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(project_owner_workspace_id(project_id)) or has_role('pm')));

drop policy if exists "workspace members: pm and admin insert project_bom_lines" on public.project_bom_lines;
create policy "workspace members: pm and admin insert project_bom_lines" on public.project_bom_lines for insert to authenticated
  with check (is_active_workspace_member(project_owner_workspace_id(project_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(project_owner_workspace_id(project_id)) or has_role('pm')));

drop policy if exists "workspace members: pm and admin update project_bom_lines" on public.project_bom_lines;
create policy "workspace members: pm and admin update project_bom_lines" on public.project_bom_lines for update to authenticated
  using (is_active_workspace_member(project_owner_workspace_id(project_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(project_owner_workspace_id(project_id)) or has_role('pm')))
  with check (is_active_workspace_member(project_owner_workspace_id(project_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(project_owner_workspace_id(project_id)) or has_role('pm')));

-- ============================================================
-- project_schedule_template_phases
-- ============================================================

drop policy if exists "workspace members: pm and admin write project_schedule_template" on public.project_schedule_template_phases;
create policy "workspace members: pm and admin write project_schedule_template" on public.project_schedule_template_phases for all to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('pm')))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('pm')));

-- ============================================================
-- project_schedule_templates
-- ============================================================

drop policy if exists "workspace members: pm and admin write project_schedule_template" on public.project_schedule_templates;
create policy "workspace members: pm and admin write project_schedule_template" on public.project_schedule_templates for all to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('pm')))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('pm')));

-- ============================================================
-- project_scope_of_work
-- ============================================================

drop policy if exists "workspace members: pm and admin delete project_scope_of_work" on public.project_scope_of_work;
create policy "workspace members: pm and admin delete project_scope_of_work" on public.project_scope_of_work for delete to authenticated
  using (is_active_workspace_member(project_owner_workspace_id(project_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(project_owner_workspace_id(project_id)) or has_role('pm')));

drop policy if exists "workspace members: pm and admin insert project_scope_of_work" on public.project_scope_of_work;
create policy "workspace members: pm and admin insert project_scope_of_work" on public.project_scope_of_work for insert to authenticated
  with check (is_active_workspace_member(project_owner_workspace_id(project_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(project_owner_workspace_id(project_id)) or has_role('pm')));

drop policy if exists "workspace members: pm and admin update project_scope_of_work" on public.project_scope_of_work;
create policy "workspace members: pm and admin update project_scope_of_work" on public.project_scope_of_work for update to authenticated
  using (is_active_workspace_member(project_owner_workspace_id(project_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(project_owner_workspace_id(project_id)) or has_role('pm')))
  with check (is_active_workspace_member(project_owner_workspace_id(project_id)) and (is_app_admin(auth.uid()) or is_workspace_admin(project_owner_workspace_id(project_id)) or has_role('pm')));

-- ============================================================
-- projects
-- ============================================================

drop policy if exists "workspace members: pm and admin delete projects" on public.projects;
create policy "workspace members: pm and admin delete projects" on public.projects for delete to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('pm')));

drop policy if exists "workspace members: pm and admin insert projects" on public.projects;
create policy "workspace members: pm and admin insert projects" on public.projects for insert to authenticated
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('pm')));

drop policy if exists "workspace members: pm and admin update projects" on public.projects;
create policy "workspace members: pm and admin update projects" on public.projects for update to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('pm')))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('pm')));

-- ============================================================
-- purchase_requests
-- ============================================================

drop policy if exists "workspace members: purchasing and admin delete purchase_request" on public.purchase_requests;
create policy "workspace members: purchasing and admin delete purchase_request" on public.purchase_requests for delete to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('purchasing')));

drop policy if exists "workspace members: purchasing and admin insert purchase_request" on public.purchase_requests;
create policy "workspace members: purchasing and admin insert purchase_request" on public.purchase_requests for insert to authenticated
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('purchasing')));

drop policy if exists "workspace members: purchasing and admin update purchase_request" on public.purchase_requests;
create policy "workspace members: purchasing and admin update purchase_request" on public.purchase_requests for update to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('purchasing')))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('purchasing')));

-- ============================================================
-- sales_quote_proposal_approval_requests
-- ============================================================

drop policy if exists "workspace members: requester and manager/admin read proposal ap" on public.sales_quote_proposal_approval_requests;
create policy "workspace members: requester and manager/admin read proposal ap" on public.sales_quote_proposal_approval_requests for select to authenticated
  using (is_workspace_member(workspace_id) and (requested_by = auth.uid() or is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('manager')));

-- ============================================================
-- standard_install_times
-- ============================================================

drop policy if exists "workspace members: pm and admin write standard_install_times" on public.standard_install_times;
create policy "workspace members: pm and admin write standard_install_times" on public.standard_install_times for all to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('pm')))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or has_role('pm')));

-- ============================================================
-- team_members
-- ============================================================

drop policy if exists "workspace members: admins and managers write team_members" on public.team_members;
create policy "workspace members: admins and managers write team_members" on public.team_members for all to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or is_app_manager(auth.uid())))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id) or is_app_manager(auth.uid())));

-- ============================================================
-- workspace_share_link_settings
-- ============================================================

drop policy if exists "workspace members: admin write workspace_share_link_settings" on public.workspace_share_link_settings;
create policy "workspace members: admin write workspace_share_link_settings" on public.workspace_share_link_settings for all to authenticated
  using (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id)))
  with check (is_active_workspace_member(workspace_id) and (is_app_admin(auth.uid()) or is_workspace_admin(workspace_id)));

commit;

-- Confirm 213 is still the next free migration number in
-- backend/supabase/migrations/ before applying. Not applied. Kept local
-- for E's review.
