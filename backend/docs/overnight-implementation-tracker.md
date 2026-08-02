# Overnight Implementation Tracker

## Live In The App

- Browser persistence is no longer fake in-memory only. The app now restores
  inventory, projects, equipment recipes, movements, builds, allocations, and
  role mode from saved state.
- Supabase sync bridge is ready through `app_state_snapshots` once Vercel has
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Parts Inventory and Finished Manufactured Equipment are split into tabs.
- Inventory Movement Ledger is visible on the Inventory page.
- Build History is visible on the Inventory page. Builds can be planned first,
  moved through kitting/assembled/tested/complete stages, completed into stock,
  cancelled, or undone after posting.
- Project Allocation History is visible in Reports.
- Role View selector is scaffolded for Warehouse, Purchasing, PM, and Manager,
  including role-focused dashboard and inventory workbench summaries.
- Receiving and stock-adjustment modals are available from Inventory.
- SKU scan/search entry is available for warehouse-style lookup.

## Database Foundation Added

- `equipment_types`
- `equipment_bom_components`
- `inventory_transactions`
- `build_transactions`
- `project_allocation_history`
- `app_role_modes`
- `app_state_snapshots`
- `004_planned_builds_and_scan_fields.sql` extends build status/stage support
  and adds scan/image/tag/source fields to inventory items.

## Next Hardening Pass

- Replace the snapshot bridge with normalized Supabase reads/writes for each
  table.
- Add transaction locking so two users cannot consume the same stock at once.
- Add login and role-based access rules before private company use.
- Add barcode label printing and scanner-device testing.
- Add deeper mobile testing for receiving, transfer, and planned-build flows.
