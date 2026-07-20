# AI Extraction Setup

The sales quote upload flow works in two layers:

1. Browser extracts PDF text so large quotes do not hit Vercel upload limits.
2. `/api/sales-quote-extract` maps that text into Project Details, SOW, and BOM.

Without an OpenAI key, the endpoint uses local extraction rules. With an OpenAI
key, it upgrades to AI extraction and falls back to rules if the key is missing.

## Required Vercel Environment Variables

Add these to the Vercel `ergon-ops-app` project for Production, Preview, and
Development:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

`OPENAI_MODEL` is optional. If it is not set, the app uses `gpt-4o-mini`.

## Later Persistence Variables

When Supabase persistence is connected, add:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`

The database tables are already staged in
`backend/supabase/migrations/002_project_documents_and_quote_extractions.sql`.

## Review Rule

AI output should always enter the app as editable `Needs Review` data. It should
not automatically create purchase orders or approve inventory without a human
review step.
