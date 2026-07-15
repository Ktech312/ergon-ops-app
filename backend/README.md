# Operations Backend

Backend foundation for the lightweight company operations app.

Initial focus:

- Purchasing
- Inventory
- Transfers to project names
- Reporting

Later modules can extend this foundation with department task boards, Gantt views,
approvals, support workflows, and document management.

## Recommended $0 Testing Accounts

For a no-cost test build, set up:

1. Supabase Free account
   - Postgres database
   - Authentication
   - Row level security
   - Optional file storage later

2. GitHub account
   - Code backup
   - Optional deployment connection

3. Google account or Google Workspace account
   - Google Drive folder links for project and purchasing documentation
   - Full Google Drive API integration can wait

Optional later:

- Vercel Hobby account for frontend hosting
- Google Cloud project if we want OAuth-based Drive picker/upload integration

## Local Files

- `supabase/migrations/001_initial_ops_schema.sql`
  Creates the first production-shaped database schema.

- `supabase/seed.sql`
  Adds sample departments, projects, locations, vendors, inventory, and purchasing data.

- `docs/data-model.md`
  Explains the main tables and workflow.

## Core Workflow

1. Purchasing creates a purchase order.
2. Received items increase inventory at a location.
3. Inventory can be reserved or transferred to a project.
4. Transfers create history records.
5. Reports show quantities, project usage, PO status, and inventory movement.

## Suggested Build Order

1. Apply the database schema in Supabase.
2. Load seed data.
3. Build admin screens for items, vendors, locations, and projects.
4. Build purchasing screens.
5. Build receive-stock and transfer-to-project workflows.
6. Build reporting dashboards.
