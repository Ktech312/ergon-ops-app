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

The app now saves operational state locally in the browser immediately. If these
Vercel environment variables are set, it also syncs the current MVP state to
Supabase:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Apply Supabase migrations in `backend/supabase/migrations`, including
`003_manufacturing_inventory_controls.sql` and
`004_planned_builds_and_scan_fields.sql`, and
`005_purchase_requests.sql`, and
`006_purchase_request_receipts.sql`, and
`007_purchase_request_order_fields.sql`, and
`008_persistence_documents_and_transaction_safety.sql`, before enabling cloud sync.

The current Supabase bridge uses `app_state_snapshots` while the UI is being
moved toward fully normalized table writes.

Project document records are now included in browser backup/restore and the
Supabase snapshot bridge. Files are tracked with metadata now; the storage
target can later be switched to Google Drive folders or Supabase Storage.
