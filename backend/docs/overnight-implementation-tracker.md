# Overnight Implementation Tracker

## Live In The App

- Browser persistence is no longer fake in-memory only. The app now restores
  inventory, projects, equipment recipes, movements, builds, allocations, and
  role mode from saved state.
- Supabase sync bridge is ready through `app_state_snapshots` once Vercel has
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Project document records now persist with browser backup/restore and cloud
  snapshot sync. They are ready to point at Google Drive or Supabase Storage.
- Parts Inventory and Finished Manufactured Equipment are split into tabs.
- Inventory Movement Ledger is visible on the Inventory page.
- Build History is visible on the Inventory page. Builds can be planned first,
  moved through kitting/assembled/tested/complete stages, completed into stock,
  cancelled, or undone after posting. Direct equipment consumption now requires
  a review acknowledgement before posting.
- Project Allocation History is visible in Reports.
- Role View selector is scaffolded for Warehouse, Purchasing, PM, and Manager,
  including role-focused dashboard summaries, inventory workbench summaries, and
  visible permission chips.
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
- `app_sync_events`
- `app_transaction_locks`
- `004_planned_builds_and_scan_fields.sql` extends build status/stage support
  and adds scan/image/tag/source fields to inventory items.
- `008_persistence_documents_and_transaction_safety.sql` adds document metadata,
  sync event logging, and lock scaffolding for future multi-user safety.

## Next Hardening Pass

- Replace the snapshot bridge with normalized Supabase reads/writes for each
  table.
- Wire `app_transaction_locks` into live Supabase posting once login/user
  sessions exist.
- Add login and role-based access rules before private company use.
- Add barcode label printing and scanner-device testing.
- Add real-device mobile testing for receiving, transfer, and planned-build
  flows.
