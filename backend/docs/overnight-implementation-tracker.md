# Overnight Implementation Tracker

## Live In The App

- Browser cache protects active work, and production persistence now writes
  authenticated `app_records` rows when Supabase Auth/env vars are configured.
- Legacy `app_state_snapshots` rows remain readable only as migration fallback.
- Project document records now persist with browser backup/restore and cloud
  production persistence. They are ready to point at Google Drive or Supabase
  Storage.
- Parts Inventory and Finished Manufactured Equipment are split into tabs.
- Inventory Movement Ledger is visible on the Inventory page.
- Build History is visible on the Inventory page. Builds can be planned first,
  moved through kitting/assembled/tested/complete stages, completed into stock,
  cancelled, or undone after posting. Direct equipment consumption now requires
  a review acknowledgement before posting.
- Project Allocation History is visible in Reports.
- Role View selector is scaffolded for Warehouse, Purchasing, PM, and Manager,
  including role-focused dashboard summaries, inventory workbench summaries, and
  visible permission chips. Signed-in users can persist their role assignment.
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
- `app_records`
- `app_user_roles`
- `004_planned_builds_and_scan_fields.sql` extends build status/stage support
  and adds scan/image/tag/source fields to inventory items.
- `008_persistence_documents_and_transaction_safety.sql` adds document metadata,
  sync event logging, and lock scaffolding for future multi-user safety.
- `009_production_auth_records_and_rls.sql` adds authenticated app records and
  removes anonymous testing policies.
- `010_user_role_assignments.sql` adds per-user production role assignments.

## Production Follow-Up Queue

- Move from JSON app records into fully relational CRUD endpoints when the data
  model stabilizes.
- Move lock enforcement into server-side functions for stricter concurrent
  multi-user posting.
- Add barcode label printing and scanner-device testing.
- Run real-device mobile testing for receiving, transfer, and planned-build
  flows.
