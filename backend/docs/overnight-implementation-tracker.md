# Overnight Implementation Tracker

## Live In The App

- Browser persistence is no longer fake in-memory only. The app now restores
  inventory, projects, equipment recipes, movements, builds, allocations, and
  role mode from saved state.
- Supabase sync bridge is ready through `app_state_snapshots` once Vercel has
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Parts Inventory and Finished Manufactured Equipment are split into tabs.
- Inventory Movement Ledger is visible on the Inventory page.
- Build History is visible on the Inventory page and posted builds can be undone.
- Project Allocation History is visible in Reports.
- Role View selector is scaffolded for Warehouse, Purchasing, PM, and Manager.

## Database Foundation Added

- `equipment_types`
- `equipment_bom_components`
- `inventory_transactions`
- `build_transactions`
- `project_allocation_history`
- `app_role_modes`
- `app_state_snapshots`

## Next Hardening Pass

- Replace the snapshot bridge with normalized Supabase reads/writes for each
  table.
- Add transaction locking so two users cannot consume the same stock at once.
- Add formal receiving and adjustment modals instead of relying on item edit.
- Add login and role-based access rules before private company use.
- Add barcode/SKU scan entry fields for warehouse workflows.
- Add build traveler steps: planned, kitting, assembled, tested, complete.
