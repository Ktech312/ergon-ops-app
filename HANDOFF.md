# Ergon Ops — Handoff Doc

Last updated: 2026-08-14

Purpose: carry context between chat sessions. Read this first in any new session before making changes.

## Current setup truth
- Do not use, import from, migrate against, or reference VLTD. VLTD is a separate project. If Supabase Studio or Vercel shows VLTD selected, switch away before touching anything for Ergon.
- The live user-facing target is Vercel production: `https://ergon-ops-app.vercel.app/`.
- The intended Ergon Supabase project id is `hnjxvsxsxoowhegcqurf`.
- Repo migrations currently exist from `001_initial_ops_schema.sql` through `073_saas_contracts.sql`.
- GitHub/Vercel deploys app code. It does not automatically apply Supabase SQL migrations. Supabase setup remains separate unless a migration pipeline is added.
- **Migrations confirmed run in Supabase by E: 069, 070, 071, 072.** Migration **073 was sent to E but run status is unconfirmed as of this handoff** — verify before assuming the SaaS Calendar feature's columns/constraint exist. If the SaaS tile or SaaS Calendar page errors on load, this is almost certainly why.
- E has repeatedly had trouble pasting SQL from a downloaded file into the Supabase SQL editor (a stray `;` character appeared mid-statement, source unclear — not present in the actual repo file). When handing off a migration, paste the raw SQL directly into the chat message as a code block in addition to (or instead of) sending the file, so E can copy straight from the chat.
- Dedicated setup handoff: `backend/docs/supabase-production-handoff.md`.

## Standing rules (always in force)
- Build things completely and correctly. Flag genuinely ambiguous requests instead of guessing — ask via AskUserQuestion before starting large/ambiguous features, not after.
- Fix small/quick issues immediately instead of deferring them.
- Before every commit/push: `npx tsc -b` (clean), `npx vite build` (clean), and check CSS brace balance if `styles.css` was touched.
- No local dev environment exists for the user — everything happens in this sandbox. Git push needs a credential helper pointed at the PAT stored in `.git-credentials-ergon` in the project root:
  `git config credential.helper "store --file='$(pwd)/.git-credentials-ergon'"` (must single-quote the path — it contains a space).
- **Any new migration that creates a table meant to be re-acquired/reused by key (locks, dedupe-by-key patterns, etc.) must use an atomic upsert-reclaim RPC, not a plain `INSERT`.** See "Transaction lock gotcha" below — this exact mistake caused every second-ever save on a given key to silently fail for an unknown length of time.
- Any function/handler that creates a new row a user will look back on later (inventory movements, audit-style records) should stamp who did it (`authSession.email`) at creation time. See `recordMovements()` in `Inventory` state for the established pattern — don't add a new inventory-movement-creating call site without routing it through that helper.

## App-wide layout convention (confirmed standard, 2026-08-11, Project detail page updated 2026-08-14)
Every page follows: **Header (title/subtitle) → Stats/metric-grid row → Tasks mini-panel for that tab → everything else.**
Reference/confirmed-correct example: Sales page (`SalesHome`).

Status per page as of this handoff:
- Sales — correct (metric-grid → Sales Tasks → Product Catalog → Site Builder).
- Purchasing/Procurement — correct (metric-grid → Procurement Tasks → rest).
- Projects (list mode) — correct (metric-grid before Projects Tasks).
- **Projects (detail mode) — reworked 2026-08-14, layout convention above no longer literally applies here.** New shape, top to bottom:
  1. Top row: **Site Information** card, **Project Snapshot** card, **Project Progress** card (Build Sales BOM and Project Documents used to live in this row — they're tiles now, see below).
  2. Project Tasks mini-panel.
  3. `project-tile-grid` at the **very bottom** of the page (moved there 2026-08-14 per E's request — "page scrolls forever, tighten it up"): 9 clickable stat tiles — Build Sales BOM, Project Documents, SOW, BOM, Shipping, Locations, Submittals, After-Sales Handover, SaaS. Each shows 2-4 quick stats; clicking opens the real section in a modal (`showXModal` state + `{showXModal && (<div className="modal-backdrop">...)}`, unchanged content, just wrapped). New sections needing the same treatment should follow this pattern: tile in the grid + modal wrapper elsewhere in the render (modal position in JSX doesn't matter, they're `position: fixed`).
  4. Between the top row and the tile grid: the "Project Details" editable form (name/client/type/owner/address/status/due/package/notes) is still inline, not tiled — it was in scope for the "convert everything" instruction from E but was overlooked; if E asks why it's not a tile, that's why, not a deliberate exception.
  - **"Project Transfers"** (cards for every OTHER project, shown at the bottom of every single project's detail page) was **removed entirely** 2026-08-14 — it never belonged there; Reports' "Project Allocation History" already covers this properly.
- Inventory — has a metric-grid (Total SKUs, Low Stock, Inventory Value, Planned Builds) before Inventory Tasks.
- Dashboard, Reports, Admin, Library, Tasks board, **SaaS Calendar (new)** — no tasks/metrics concept applies (self-contained pages); left as-is, no deviation.

Project detail page header: the App-level `<h1>`/`<p>` shows `Project: <Name>` / `Ref <ref>` when a specific project is open, instead of the generic "Projects" title+subtitle. Wired via `Projects`'s `onDetailContextChange` prop → App-level `projectDetailContext` state.

## Recent work log (most recent first, this session — 2026-08-13/14)
- **8602110** — SaaS contract tracking: new "Closed" project status (auto-stamps `saasStartDate` the first time a project is set to Closed; renewal defaults to +1yr, stays editable); SaaS Type/Contract Amount/Billing Frequency captured on the Sales Quote (Edit Site modal) and copied to the Project on conversion from a Closed-Won quote; new SaaS tile on the Project detail page; new **SaaS Calendar** nav tab (renewal list sorted soonest-first with overdue/soon highlighting, MRR/Quarterly/ARR, and a straight-line 5-year outlook — explicitly labeled as a flat projection, not a growth/churn model). Migration 073.
- **09acd85** — Two mobile bugs fixed: notification panel was `position: absolute; right:0; width:320px` anchored to the bell, which ran off-screen on narrow viewports (zoom didn't help — real overflow, not a viewport-size issue); now `position: fixed` with viewport-relative insets below 760px. Account menu ("Role view" lives inside it) never closed on tab navigation; `navigateToView` now calls `setAccountMenuOpen(false)`.
- **9ed4f0a** — Collapsed the Project detail page into the tile+modal pattern described above; removed Project Transfers. See the layout section above for full detail.
- **6cc822b** — Added a disabled-state tooltip/inline note to the Shipping tile's "New Shipment" button (it's correctly disabled when the project's BOM is empty — was reported as "looks broken" because it gave no explanation).
- **8da7487** — New Shipping feature: PM requests a shipment (BOM lines + qty, saved per-project address book), Warehouse/Implementation works it Requested → Packed (photos of the box/pallet) → Shipped (carrier + tracking). Inventory actually deducts at **ship** time (not request time), reusing the existing `pullFromInventory` flow so it hits the same movement ledger as Transfer to Project. Migration 072 (`project_shipping_addresses`, `project_shipments`, `project_shipment_lines`, `project_shipment_photos` + storage bucket).
- **cdcd62a** — Location details rework (both Sales quote locations and Project locations): FLI/LPR/People Counting became pure reference checkboxes in the header (no camera-model picker, don't drive anything — E: "this is only for reference"); new **Cameras** line-item section (previously only Signs/Space Sensor/Misc existed); every line (Camera/Sign/Sensor/Misc) gained a free-text Location field and an optional Accessory + qty, the accessory dropdown scoped by catalog **tag** (`Camera accessory` / `Sign accessory` / `Sensor accessory` — **E needs to actually apply these tags to relevant catalog items**, or the accessory dropdowns stay empty). Migration 071.
- **256d385** — Photo Gallery selection checkbox moved from top-left to top-right of each thumbnail (top-left is exactly where the Pinterest browser-extension hover button injects itself, blocking it).
- **504a2bb** — Inventory movements now record `createdByEmail` (who did it), not just `createdAt`. New `performed_by_email` column (migration 070) + `recordMovements()` helper in the `Inventory`/App component that all ~9 movement-creation call sites route through — any new movement-creating code must go through this helper too, not call `setInventoryMovements` directly.
- **2f2d98f** — **Root cause of "Adjust Inventory doesn't save."** `app_transaction_locks` (used by every Inventory/Project/Build/Purchase-Request save via `withProductionLock`) had a plain unique constraint and the client did a plain `INSERT` to acquire a lock; `releaseTransactionLock` only ever set `released_at`, never deleted the row. Result: **the first successful save on any given key locked it forever** — every save after that silently failed the lock-acquire step before ever touching data. Fixed with an `acquire_transaction_lock` upsert-reclaim RPC (migration 069) that only raises when a lock is genuinely still held. This is the "any new lock-by-key table must use upsert-reclaim" rule in Standing Rules above.
- **cc872b8** — Added a root `<RootErrorBoundary>` around the whole app (in `main.tsx`'s render call) — previously any uncaught render error unmounted to a blank white page with zero indication anything broke. Now shows "Something went wrong / Reload" and logs the real error to console.
- **659d2d1** — Product Catalog and Inventory tables: rows are now clickable (open the edit modal) instead of having per-row Edit buttons; Retire moved into the modal (was a one-tap-away destructive action on the row, now needs the item open first — E: "no accidental retirement"). Inventory: Adjust and Transfer merged into one modal (tabs), Adjust's Item field locks to the row's part instead of listing the whole catalog when opened from a row. Receive shows "Receive Pending" in amber + links to Procurement when there's an open PO for that part.
- **afe6879, a25e9b5, 386e071 (part), 8420e1f (part)** — Password reset UI (Team Roster + User Directory admin buttons, self-service, login-gate link) and visible Sent!/Failed feedback on the admin buttons (previously silent — indistinguishable from broken).
- **ed5599f** — `api/_lib/mailer.js`: shared sender for invite/notification/submittal/proposal emails. Tries Gmail SMTP (`GMAIL_USER`/`GMAIL_APP_PASSWORD` env vars) first, falls back to Resend, falls back to an honest "not configured" response. **Root cause found for "invite/reset emails don't work":** the Resend account is in sandbox mode (only verified for `eck1679@gmail.com`, confirmed via a live 403 from Resend's own API) — it can only ever email the account owner until a sending domain is verified. **E declined to set up Gmail SMTP for now** ("I don't want to create new passwords") — this is still unresolved; real invite/notification/submittal/proposal emails to anyone but E will keep silently failing (with the new honest-fallback messaging, not silently) until either Gmail SMTP is configured or a domain is verified in Resend.

### Earlier session (before this handoff's predecessor work), for context
- Ref-number pattern (per-year counter + `before insert` trigger) established for `sales_quotes.quote_ref` (066) and `projects.project_number` (067).
- Project document upload provenance (068).

## Data model / architecture notes
- Persistence: raw `fetch()` calls against Supabase REST in `src/persistence.ts` (no Supabase JS client).
- Any new table needs `enable row level security` **plus** at least one policy, even if fully permissive (`using (true) with check (true)`) — otherwise triggers running as the calling user get blocked.
- Ref-number pattern to reuse for any future entity needing a stable sequential reference: create a `<entity>_ref_counters (year int primary key, next_seq int default 1)` table with RLS + policies, a `before insert` trigger doing `insert ... on conflict (year) do update set next_seq = next_seq + 1 returning next_seq - 1 into seq`, format as `'PREFIX-' || year || '-' || lpad(seq::text, 4, '0')`, and a backfill `do $$ ... $$` block for existing null rows.
- **Key-reuse table pattern** (locks, or anything else identified by a reusable key that gets "released"/soft-closed rather than deleted): never do a plain client-side `INSERT`. Write a `security definer` Postgres function that does `INSERT ... ON CONFLICT (key) DO UPDATE ... WHERE <row is actually free> RETURNING *`, call it via `rpc/<function_name>` from the client, and treat "no row returned" as "still locked." See migration 069 / `acquireTransactionLock` in `persistence.ts`.
- BOM lines (`BomLine` / `project_bom_lines`) have **no stable id** in the app layer — they're identified by `item` (product name) everywhere, including the new Shipping feature's line items (`item_name`, not a FK). Don't introduce a `bom_line_id` FK assuming one exists; it doesn't.
- `ProjectSite.locations` / `.shippingAddresses` / `.shipments` / `.saas*` fields are all **optional** (`?`) on the TS type specifically because a number of hardcoded/demo `ProjectSite` object literals exist elsewhere in `main.tsx` that predate the real backend cutover and don't set them. Any new field added to `ProjectSite` needs to be optional too, or those literals will fail to type-check (found this the hard way three times this session).
- Shared upload/signed-URL helpers (`uploadStorageObjectFile`, `getStorageObjectSignedUrl` in `persistence.ts`) are generic across buckets — new photo/file features should wrap these with a bucket-specific pair of thin functions (see `uploadShipmentPhotoFile` / `getShipmentPhotoDownloadUrl` for the pattern) rather than reimplementing upload logic.
- `.modal-panel-wide` (in `styles.css`) is the pattern for a modal that wraps a whole existing `<section className="panel ...">` (BOM table, Submittals list, etc.) instead of a small form — it neutralizes the inner section's own box styling (`.modal-panel-wide > .panel { border: none; box-shadow: none; padding: 0; }`) so it doesn't double-box. Pair with a `.modal-tile-close-row` for the close button when the wrapped content doesn't have its own `modal-header`.
- `ProjectTile` component (`main.tsx`) is the reusable stat-card-that-opens-a-modal building block established this session — reuse it for any future "collapse this section into an overview tile" work rather than hand-rolling another card pattern.

## Open / pending items
- **Migration 073 run status unconfirmed** — verify before doing further SaaS Calendar work (see top of doc).
- **Mobile bug, unresolved: "fields extended past the background."** E relayed this from a user; no screenshot obtained yet despite asking twice. Two other mobile bugs from the same report (notification panel clipping, account menu not closing) were fixed and confirmed against a screenshot; this third one is still open. Get a screenshot + which specific page before touching anything — last session's guess-based investigation (box-sizing, table overflow) turned up nothing conclusive.
- **A "Sync issue" pill was spotted in a screenshot** (top nav, during the mobile-bug investigation) — never followed up on whether it was a one-off connectivity blip or a persistent problem. Worth asking E if it's still showing.
- **Email delivery still not really working for anyone but E** (see mailer.js entry above) — needs Gmail SMTP creds or a verified Resend domain; E has declined so far. Don't re-raise unprompted, but if E asks about invites/notifications not arriving, this is why.
- **#61 — OpenAI API key for sales quote extraction.** Deferred indefinitely; costs money. Needs the user to supply a key and confirm they want the recurring cost before this is wired up.
- **Accessory catalog tags not yet applied.** The new Camera/Sign/Space Sensor accessory dropdowns (Locations rework) will show empty until E tags actual catalog items with `Camera accessory` / `Sign accessory` / `Sensor accessory`. Not a bug — just unfinished on the data side.
- If the next session inherits mid-task work, check the task list in the app (TaskList tool) for the most current in-progress item.

## How to verify before shipping (checklist)
1. `npx tsc -b` — must be clean.
2. `npx vite build` — must be clean.
3. If `styles.css` changed, confirm brace balance (`grep -c '{' vs '}'` or careful read).
4. Commit with a descriptive message, push, and tell the user which migration(s) (if any) still need to be run manually in Supabase Studio — don't assume they've run automatically. Paste the raw SQL into the chat message itself, not just as a file attachment (see "Current setup truth" above re: paste corruption).
5. For anything E reports as a mobile-only bug, ask for a screenshot before guessing at a fix — two out of three bugs in the 2026-08-14 mobile report were diagnosable from the description alone, but the third genuinely needed visual evidence to confirm even the diagnosis of the first two.
