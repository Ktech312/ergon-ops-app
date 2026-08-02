# Ergon Ops App

Lightweight operations app for purchasing, inventory, project transfers, and reporting.

Initial build focus:

- Purchasing
- Inventory items and locations
- Receiving stock
- Transfers to project names
- Project inventory reports
- Google Drive document links later

Real company data, API keys, Supabase keys, and environment variables should stay out of this repository.

## Persistence

The app keeps a local browser cache to prevent accidental data loss while the
page is open. Production persistence uses Supabase Auth plus normalized
`app_records` rows when these Vercel environment variables are set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Apply Supabase migrations in `backend/supabase/migrations`, including
`003_manufacturing_inventory_controls.sql` and
`004_planned_builds_and_scan_fields.sql`, and
`005_purchase_requests.sql`, and
`006_purchase_request_receipts.sql`, and
`007_purchase_request_order_fields.sql`, and
`008_persistence_documents_and_transaction_safety.sql`,
`009_production_auth_records_and_rls.sql`, and
`010_user_role_assignments.sql`, before enabling cloud sync.

Older `app_state_snapshots` rows are read only as a migration fallback. New
production writes use authenticated `app_records` rows and audit entries in
`app_sync_events`.

Project document records are included in browser backup/restore and production
Supabase persistence. Files are tracked with metadata now; the storage target
can later be switched to Google Drive folders or Supabase Storage.
