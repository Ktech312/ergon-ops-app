# Supabase Production Handoff - Ergon Ops

This file exists so the next developer can pick up backend setup without relying on chat history.

## Current status

- App repo: `Ktech312/ergon-ops-app`
- Production app: `https://ergon-ops-app.vercel.app/`
- Intended Supabase project id: `hnjxvsxsxoowhegcqurf`
- Migration folder: `backend/supabase/migrations`
- Current migration range in repo: `001_initial_ops_schema.sql` through `068_project_document_upload_provenance.sql`
- Recent migrations confirmed by the root handoff as applied: `066_sales_quote_ref_and_closed_at.sql` and `067_project_ref_auto_assign.sql`
- New pending migration: `068_project_document_upload_provenance.sql` adds `project_documents.uploaded_by_email` so general project files follow the same who/when rule as garage/lot media.

## Critical warning

Do not run Ergon migrations in the `VLTD` Supabase project. VLTD is a different app.

If Supabase Studio shows `VLTD` in the top project selector, switch to the Ergon project before running SQL. If Ergon is not listed, stop and confirm the correct Supabase project/account before continuing.

## What Vercel does and does not do

GitHub/Vercel deployment pushes the frontend and serverless function code live.

It does not automatically apply Supabase SQL migrations in this repo. Until a real migration pipeline is added, database changes must be applied manually in Supabase Studio or with the Supabase CLI against the correct Ergon project.

## Required Vercel environment variables

Production cloud persistence needs:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

AI quote extraction additionally needs:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` optional

After changing environment variables, redeploy Vercel production.

## Manual migration process

Use this only after confirming the selected Supabase project is Ergon, not VLTD.

1. Open Supabase Studio for the Ergon project.
2. Open SQL Editor.
3. Run any missing migration files from `backend/supabase/migrations` in numeric order.
4. Stop on the first SQL error and capture the full error text before continuing.
5. After migrations are applied, verify the app can sign in and changes survive refresh in a normal browser.

## Verification checklist

- [ ] Supabase project shown in Studio is Ergon, not VLTD.
- [ ] Migrations through the latest file in `backend/supabase/migrations` are applied.
- [ ] Vercel production env vars are present.
- [ ] Vercel production has been redeployed after env changes.
- [ ] A real user can sign in.
- [ ] A test inventory edit survives browser refresh.
- [ ] A test project edit survives browser refresh.
- [ ] RLS policies are reviewed for the current security stage.

## Next backend improvement

Add an actual migration runner/pipeline so future schema changes are not manual. Until then, every PR or push that adds a migration must explicitly say which migration needs to be run in Supabase.

## Upload Provenance Rule

Every uploaded image or file must have:

- Timestamp (`uploaded_at` / `uploadedAt`)
- Uploader identity (`uploaded_by_email` / `uploadedByEmail`)
- Clear separation between image galleries and document/file sections

Photo galleries should accept image files only. PDF, Word, Excel/CSV, CAD, and other reference documents stay in Files or Project Documents.
