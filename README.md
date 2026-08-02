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
`005_purchase_requests.sql`, before enabling cloud sync.

The current Supabase bridge uses `app_state_snapshots` while the UI is being
moved toward fully normalized table writes.
