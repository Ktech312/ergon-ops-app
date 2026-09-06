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

## Development

```
npm install
npm run dev          # local dev server
npm run build         # tsc -b + production build (what Vercel runs)
npm run lint           # eslint . -- 0 errors is the baseline; warnings are
                        # tracked but non-blocking (see eslint.config.js)
npm test               # vitest -- unit tests for critical data loaders
npm run test:smoke     # playwright -- browser smoke suite (auth gating,
                        # navigation, mobile shell); starts its own dev
                        # servers on ports 5190/5191, see playwright.config.ts
```

`npm test` uses `.env.test` (dummy Supabase values, safe to commit) so
`persistence.ts`'s critical loaders exercise their real fetch path instead
of the "not configured" early return -- see the comment in that file if
you add more tests that need it.

See `HANDOFF.md` for the actual migration status, known issues, and open
product/permission questions -- the migration list below this section is
historical and not authoritative for what's applied in production.

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
`010_user_role_assignments.sql`, and
`011_direct_project_purchase_requests.sql`, before enabling cloud sync.

Older `app_state_snapshots` rows are read only as a migration fallback. New
production writes use authenticated `app_records` rows and audit entries in
`app_sync_events`.

Project document records are included in browser backup/restore and production
Supabase persistence. Files are tracked with metadata now; the storage target
can later be switched to Google Drive folders or Supabase Storage.
