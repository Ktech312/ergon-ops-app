# Ergon Ops — Handoff Doc

Last updated: 2026-08-12

Purpose: carry context between chat sessions. Read this first in any new session before making changes.

## Current setup truth
- Do not use, import from, migrate against, or reference VLTD. VLTD is a separate project. If Supabase Studio or Vercel shows VLTD selected, switch away before touching anything for Ergon.
- The live user-facing target is Vercel production: `https://ergon-ops-app.vercel.app/`.
- The intended Ergon Supabase project id is `hnjxvsxsxoowhegcqurf`.
- Repo migrations currently exist from `001_initial_ops_schema.sql` through `067_project_ref_auto_assign.sql`.
- GitHub/Vercel deploys app code. It does not automatically apply Supabase SQL migrations. Supabase setup remains separate unless a migration pipeline is added.
- Current handoff says migrations `066` and `067` were run successfully, but any future developer should verify the actual Ergon Supabase project before claiming database setup is complete.
- Dedicated setup handoff: `backend/docs/supabase-production-handoff.md`.

## Standing rules (always in force)
- Build things completely and correctly. Flag genuinely ambiguous requests instead of guessing.
- Fix small/quick issues immediately instead of deferring them.
- Before every commit/push: `npx tsc -b` (clean), `npx vite build` (clean), and check CSS brace balance if `styles.css` was touched.
- No local dev environment exists for the user — everything happens in this sandbox. Git push needs a credential helper pointed at the PAT stored in `.git-credentials-ergon` in the project root:
  `git config credential.helper "store --file='$(pwd)/.git-credentials-ergon'"` (must single-quote the path — it contains a space).

## App-wide layout convention (confirmed standard, 2026-08-11)
Every page follows: **Header (title/subtitle) → Stats/metric-grid row → Tasks mini-panel for that tab → everything else.**
Reference/confirmed-correct example: Sales page (`SalesHome`).

Status per page as of this handoff:
- Sales — correct (metric-grid → Sales Tasks → Product Catalog → Site Builder).
- Purchasing/Procurement — correct (metric-grid → Procurement Tasks → rest).
- Projects (list mode) — fixed: metric-grid now before Projects Tasks.
- Projects (detail mode) — fixed: project-top-row (Build Sales BOM/Project Documents/Project Progress cards) → Project Tasks → Locations (now edge-to-edge, `panel wide`) → Submittals/Handover/etc.
- Inventory — fixed: added a metric-grid (Total SKUs, Low Stock, Inventory Value, Planned Builds) before Inventory Tasks (previously had no stats row at all).
- Dashboard, Reports, Admin, Library, Tasks board — no tasks/metrics concept applies (self-contained pages); left as-is, no deviation.

Project detail page header: the App-level `<h1>`/`<p>` now shows `Project: <Name>` / `Ref <ref>` when a specific project is open, instead of the generic "Projects" title+subtitle. Wired via `Projects`'s `onDetailContextChange` prop → App-level `projectDetailContext` state.

## Recent work log (most recent first)
- **d88f373** — Standardized Header→Stats→Tasks→Content order: swapped Projects list order (metric-grid before Tasks), added Inventory metric-grid.
- **38791cc** — Project detail page: contextual "Project: Name" header, Tasks moved to render right after header (before Locations), Locations panel made edge-to-edge (`panel wide`).
- **a11e3a5** and prior — Sales metric row (Quotes/Open/Closed This Year/Win Rate/Avg Deal Size/Est. Profit YTD) with quote ref numbers (`SQ-YYYY-####`, migration 066); Project ref auto-assignment via DB trigger (`PRJ-YYYY-####`, migration 067) fixing the blank-ref-on-Sales-conversion bug; removed the "Request" task button from the general Project list; per-page subtitle text (`pageSubtitle`) instead of one hardcoded string for every page; Sales Quote Builder and Project Locations tables: removed "Details" button (rows are clickable), added hover-reveal delete button with confirm dialog; Site Builder list shows sales person's name (not email) via `assigneeLabel`, and Site Builder rows/quotes are deletable with confirmation.
- Server-side atomic ref-number pattern established: per-year counter table + `before insert` trigger, used for both `sales_quotes.quote_ref` (066) and `projects.project_number` (067). Both migrations have been run successfully in Supabase.

## Data model / architecture notes
- Persistence: raw `fetch()` calls against Supabase REST in `src/persistence.ts` (no Supabase JS client).
- Any new table needs `enable row level security` **plus** at least one policy, even if fully permissive (`using (true) with check (true)`) — otherwise triggers running as the calling user get blocked. Learned this the hard way on migration 066; applied proactively to 067.
- Ref-number pattern to reuse for any future entity needing a stable sequential reference: create a `<entity>_ref_counters (year int primary key, next_seq int default 1)` table with RLS + policies, a `before insert` trigger doing `insert ... on conflict (year) do update set next_seq = next_seq + 1 returning next_seq - 1 into seq`, format as `'PREFIX-' || year || '-' || lpad(seq::text, 4, '0')`, and a backfill `do $$ ... $$` block for existing null rows.

## Open / pending items
- **#61 — OpenAI API key for sales quote extraction.** Deferred indefinitely; costs money. Needs the user to supply a key and confirm they want the recurring cost before this is wired up.
- No other known open questions as of this handoff. If the next session inherits mid-task work, check the task list in the app (TaskList tool) for the most current in-progress item.

## How to verify before shipping (checklist)
1. `npx tsc -b` — must be clean.
2. `npx vite build` — must be clean.
3. If `styles.css` changed, confirm brace balance (`grep -c '{' vs '}'` or careful read).
4. Commit with a descriptive message, push, and tell the user which migration(s) (if any) still need to be run manually in Supabase Studio — don't assume they've run automatically.
