# Ergon Ops Production Roadmap

This roadmap is a developer handoff document for the Ergon Ops app. It captures
the intended product direction, what exists today, what is partial, and what
should be built next so another developer can continue without relying on chat
history.

## Product Goal

Ergon Ops is a lightweight operations platform for a company that purchases,
stores, manufactures, allocates, and ships equipment for parking garages and
parking lots.

The app should eventually combine:

- Purchasing
- Inventory
- Manufactured equipment builds
- Project BOM and SOW handling
- Sales quote support
- Project management tasks
- Warehouse receiving and shipping proof
- Reporting
- Role-based views
- Document and image storage

The current build should stay focused on production-grade foundations. Do not
add fake workflows that users will later need to relearn. If a feature is not
fully connected yet, make that clear in the UI or keep it behind a review step.

## Core Users

Primary user groups:

- Warehouse staff: receive items, adjust counts, transfer stock, build equipment,
  capture shipping/receiving proof.
- Purchasing staff: review purchase requests, compare vendor costs, update PO
  status, receive against orders.
- Project Managers: create projects, upload signed sales quotes, review extracted
  SOW/BOM, request allocations, track project readiness.
- Managers: review dashboards, cost trends, project allocation history,
  manufacturing progress, and purchasing exposure.
- Sales staff, future: create quotes, use hardware recommendation tools, capture
  site photos, and hand off closed projects to PM.
- External clients, future: view safe project progress without internal costs or
  inventory details.

## Current Technical Reality

Frontend:

- Vite
- React
- TypeScript
- `src/main.tsx` currently contains most app UI and state logic.
- `src/styles.css` contains the current app styling.

Backend / persistence:

- Supabase is the intended durable backend.
- Current production persistence uses authenticated `app_records` rows when
  Vercel environment variables are configured.
- Browser/local storage exists only as a usability fallback and offline safety
  cache, not as the long-term production data model.
- Existing Vercel serverless API:
  - `api/sales-quote-extract.js`

Important: many pasted examples from planning discussions referenced Next.js.
This app is not currently a Next.js app. Translate any future API/component
examples into the existing Vite + React + Vercel Function structure unless the
team intentionally migrates frameworks.

## Current Production URL

Production app:

`https://ergon-ops-app.vercel.app/`

Deployment expectation:

- Build locally for private verification.
- Push changes to GitHub.
- Verify Vercel production after push.
- Report the production result, not local-only status.

## Naming And Terms

Use these terms consistently:

- SKU: internal item identifier for parts and stocked items.
- Project ref: internal project number, for example `PRJ-2026-0001`.
- BOM: Bill of Material.
- SOW: Scope of Work.
- Manufactured Equipment: complete equipment built in-house from inventory
  components.
- Equipment BOM: recipe of parts required to build one manufactured equipment
  unit.
- Movement Ledger: historical source of truth for inventory changes.
- Purchase Request: request for Purchasing to quote/order needed material.
- Direct-to-project purchase: item bought for one project that may bypass
  standard warehouse stock.
- Retired: no longer selectable for normal use but kept for historical records.

Avoid using `INV` as the item identifier because it can be confused with
invoice. Use `SKU`.

## What Exists Today

### Dashboard

Current status:

- Operational dashboard exists.
- Shows role-focused summaries and activity.
- Pulls from inventory, purchasing, build, and project movement state.

Needs improvement:

- Needs clearer manager-level KPI layout.
- Needs more drilldowns from metrics to records.
- Needs role-based filtering backed by real permissions.

### Purchasing

Current status:

- Imported purchase queue exists from recent order PDFs.
- Manual purchase requests exist.
- Purchase requests include quantities, vendor/order details, status, receiving
  flow, and project/build context.
- Reports include purchasing spend and open purchase requests.

Needs improvement:

- Direct-to-project purchasing needs to become a first-class workflow.
- Purchase orders should eventually be normalized into relational Supabase
  tables rather than app-record JSON.
- Receiving should support attached packing slip photos and shipment proof.
- Vendor lead time and inbound quality notes are not fully modeled in the UI.

### Inventory

Current status:

- Parts Inventory exists.
- Finished Manufactured Equipment tab exists.
- SKU terminology is used in the visible table and item editor.
- Inventory item editor supports:
  - SKU
  - Barcode / scan code
  - Item name
  - Description
  - Category
  - Manufacturer
  - Unit cost
  - Current stock
  - Reorder point
  - Inventory tags
  - Uploaded item image
  - Purchase URLs
  - Purchase price history
  - Retire / reactivate
- Inventory table supports filters.
- Image thumbnails can be clicked/enlarged.
- Receive, adjust, edit, and transfer actions exist.
- SKU scan/search entry exists.
- Inventory Movement Ledger exists.

Needs improvement:

- Mobile layout needs real-device testing.
- Barcode scanning should use camera/scanner integration, not only typed search.
- Inventory location/bin/aisle tracking is in the backend plan but needs stronger
  UI coverage.
- Per-location balances should become visible and editable.
- Item image storage should move from browser/base64 records to Supabase Storage
  or Google Drive integration.

### Manufactured Equipment

Current status:

- Section title is `Manufactured Equipment`.
- Equipment type selector exists.
- Finished manufactured inventory list exists with:
  - complete count
  - can-build count
- Equipment BOM editor opens in a pop-up.
- Equipment editor supports:
  - equipment image upload
  - equipment title
  - description
  - retire/reactivate equipment type
  - delete equipment type
  - line-item parts selected from inventory
  - quantities required
  - shortage indicators
  - add new part to BOM
- Build flow supports:
  - plan build
  - work order
  - kitting / assembled / tested / complete stages
  - review before build
  - consume component stock
  - create finished equipment stock
  - undo posted build
  - cancel planned build
- Enterprise VPU Server parts were added as inventory items and equipment BOM
  components.

Needs improvement:

- Build actions should be harder to misuse. The current review step helps, but
  the workflow should eventually separate planning, kitting, assembly, testing,
  and final stock posting more clearly.
- Equipment BOM list should stay compact and mobile-friendly.
- Finished equipment should eventually have serial numbers or asset IDs for
  traceability.
- Build output should support project assignment directly when a unit is built
  for a specific project.

### Projects

Current status:

- Project list exists.
- Add new project exists.
- Project detail page exists.
- Project details are editable:
  - project name
  - client/property
  - site type
  - owner
  - shipping address
  - status
  - target date
  - solution/package
  - site notes
- Internal project ref is shown as a locked reference.
- Build Sales BOM and Scope section exists inside a project.
- Sales quote PDF can be dragged/uploaded.
- Uploaded quote can fill editable project details, SOW, and BOM.
- Project documents section exists.
- SOW section exists and is editable.
- BOM section exists and is editable.
- BOM modal supports:
  - add/edit line item
  - quantity
  - request speed
  - pull from inventory
  - request to order
  - notes
- Project transfers section exists.

Needs improvement:

- Project list page should stay list-focused and not become bloated.
- Project detail should eventually use sub-tabs:
  - Overview
  - Site Info
  - Documents
  - SOW
  - BOM
  - Allocations
  - Tasks
  - Shipments
- BOM lines need direct SKU matching instead of free-text-only matching.
- Project allocations should have a cleaner approval/request state before stock
  is pulled.
- Direct-to-project purchasing should be selectable per BOM line.
- Project media/photo capture is not yet production-built.

### Reports

Current status:

- Reports page exists with tabs:
  - Purchasing
  - Inventory
  - Manufacturing
  - Projects
  - Documents
- Reports include:
  - project spend
  - vendor spend
  - purchase category mix
  - open purchase requests
  - reorder watch
  - inventory cost history
  - purchase sources
  - manufacturing history
  - planned build shortages
  - project allocation history
  - project documents
- CSV export exists.

Needs improvement:

- Reports need better filtering by date, project, vendor, SKU, and status.
- Reports should support manager-ready export packets.
- Cost history should show trend charts over time.
- Movement ledger should be searchable and filterable.

### Authentication / Roles

Current status:

- Supabase auth helpers exist.
- Sign-in/create-user UI exists.
- Google sign-in exists via Supabase OAuth redirect (`signInWithGoogleRedirect` /
  `consumeOAuthRedirectSession` in `src/persistence.ts`). Requires a Google Cloud
  OAuth client (published to Production, not Testing) and the Google provider
  enabled in Supabase with that client ID/secret.
- The app now hard-gates behind sign-in: if Supabase env vars are configured and
  no session exists, the user sees a dedicated sign-in screen (`requiresSignIn`
  in `src/main.tsx`) instead of the full app shell. No inventory/project/
  purchasing data renders before authentication.
- An Admin page exists (`AdminPage` in `src/main.tsx`, nav item only shown to
  admins) backed by three new tables from migration `012`:
  - `app_admins`: explicit admin allowlist.
  - `app_known_users`: directory of every user who has signed in (id + email),
    since `auth.users` is not exposed through the REST API. Each user upserts
    their own row on sign-in.
  - RLS additions on `app_user_roles` so admins can read/write everyone's role,
    not just their own.
  - An admin can assign warehouse/purchasing/pm/manager roles to any known user
    and grant/revoke admin access to other users.
- Role view selector exists for:
  - Warehouse
  - Purchasing
  - PM
  - Manager
- Per-user role mode persistence exists when signed in.
- Role chips and summaries exist.

- Pending-approval + per-tab permissions (migration `014`):
  - New sign-ins (any method) are "pending" until a Manager or Admin approves
    them. Pending/denied/expired users see a blocking screen instead of the
    app (`requiresSignIn` / the `!isApproved` branch in `src/main.tsx`).
    Admins always bypass this (never blocked).
  - Approval can include an optional expiration date; once past, the user is
    blocked again automatically (no cron job needed — checked client-side on
    every load against `expires_at`).
  - Role assignment (`app_user_roles.role_key`) is now admin-only. Migration
    `014` drops the old self-service write policies from migration `010`.
    Regular users can no longer pick their own role; it must be assigned by an
    Admin (typically as part of approving them).
  - Admins can override exactly which tabs (Dashboard/Purchasing/Inventory/
    Projects/Sales/Reports) an individual user sees via
    `app_user_roles.allowed_views` (nullable `text[]`; null = use the role's
    default set in `DEFAULT_TABS_BY_ROLE` in `src/main.tsx`). Manager defaults
    to all tabs per E's instruction; other defaults are a first guess and can
    be freely overridden per user from the Admin page regardless.
  - This is enforced in the nav/view routing (UI layer) — see the honest
    caveat below, it is not yet enforced in Supabase RLS for the underlying
    operational tables.

Needs improvement:

- IMPORTANT CAVEAT: hiding a tab in the UI does not yet stop someone from
  reading/writing that data directly against the Supabase REST API. Most
  operational tables (inventory_items, purchase_requests, projects, etc.) still
  use blanket "any authenticated user can read/write" RLS policies from
  migrations 001/003/005. The new tab permissions and role system control what
  the app *shows*, not yet what the database *allows*. Closing that gap is
  Phase 9 (real per-role RLS enforcement) and has not been done.
- There is no bootstrap UI for the very first admin. After creating the first
  real account, run this once in Supabase SQL Editor to seed the first admin:
  `insert into app_admins (user_id) select id from auth.users where email = '<first admin email>';`
- External public/client access is not built.
- Email invites are NOT built yet. E asked for "send invites from the Admin
  page" — doing this properly requires a new Vercel serverless function using
  `SUPABASE_SERVICE_ROLE_KEY` (Supabase's Admin API `POST /auth/v1/admin/invite`
  cannot be called from the browser with just the anon key). This is a new,
  highly sensitive secret (full bypass of all RLS) and should not be added
  without E explicitly confirming it, and it should only ever live in a
  server-side Vercel env var, never in client code. Flagged as its own item
  below — do this next time E is available to walk through creating that key.

## Database Foundation Already Added

Existing Supabase migrations include:

- `001_initial_ops_schema.sql`
- `002_project_documents_and_quote_extractions.sql`
- `003_manufacturing_inventory_controls.sql`
- `004_planned_builds_and_scan_fields.sql`
- `005_purchase_requests.sql`
- `006_purchase_request_receipts.sql`
- `007_purchase_request_order_fields.sql`
- `008_persistence_documents_and_transaction_safety.sql`
- `009_production_auth_records_and_rls.sql`
- `010_user_role_assignments.sql`
- `011_direct_project_purchase_requests.sql`
- `012_admin_roles_and_user_directory.sql`
- `013_product_catalog.sql`
- `014_user_approval_and_tab_permissions.sql`
- `015_tasks.sql`

Important concepts already represented:

- Departments
- Profiles
- Projects
- Project documents
- Sales quote extractions
- Vendors
- Purchase orders
- Purchase order lines
- Inventory items
- Locations
- Inventory balances
- Inventory movements
- Inventory transactions
- Equipment types
- Equipment BOM components
- Build transactions
- Project allocation history
- App records
- User role assignments
- Transaction locks

## High-Priority Roadmap

### Phase 1 - Stabilize The Current Operational Core

Goal:

Make existing Purchasing, Inventory, Projects, Manufactured Equipment, and
Reports harder to misuse and easier to review.

Tasks:

- Audit all stock-changing actions and ensure each creates ledger history.
- Add clear confirmation/review screens for:
  - receive stock
  - adjust count
  - transfer to project
  - consume parts into build
  - undo build
  - retire/reactivate item
- Add project/SKU/date filters to movement ledger and project allocation reports.
- Tighten mobile layouts for:
  - inventory table
  - item editor
  - equipment BOM modal
  - project BOM modal
  - receiving modal
- Improve empty states so they tell the user what action to take next.
- Keep actions scoped to the current page after refresh using hash and scroll
  restoration.

Acceptance criteria:

- User can receive, adjust, transfer, build, undo, and report without losing
  context after refresh.
- Every stock-changing action leaves visible history.
- No “loaded gun” action posts stock changes without review or clear intent.

### Phase 2 - Direct-To-Project Purchasing

Goal:

Support items ordered specifically for a project that do not need to become
general warehouse stock.

Data model:

- Add or expose a procurement track on project BOM/purchase request records:
  - `warehouse_stock`
  - `direct_to_project`
- Store:
  - project ref
  - SKU
  - requested quantity
  - ordered quantity
  - received quantity
  - vendor
  - PO/order number
  - expected date
  - receiving status
  - receiving photos/documents
  - cost

UI:

- In Project BOM modal, allow a sourcing choice:
  - Pull from inventory
  - Request standard stock order
  - Request direct-to-project order
- Purchasing page should show direct-to-project requests separately or with a
  clear tag.
- Receiving should ask whether received goods go to:
  - warehouse stock
  - project staging
  - direct shipment / client site

Acceptance criteria:

- PM can request material for a project without manually transferring from stock.
- Purchasing can see exactly which project the order belongs to.
- Receiving can mark it received without inflating available warehouse stock.
- Reports show direct project cost and project material status.

### Phase 3 - Warehouse Receiving And Shipment Proof

Goal:

Give warehouse users a mobile-first flow for receiving inbound items and logging
outbound project shipments.

Features:

- Receiving screen optimized for phones/tablets.
- Select PO, purchase request, SKU, or project.
- Receive full or partial quantities.
- Capture packing slip photo using mobile camera.
- Capture item/photo proof.
- Add notes and condition/quality status.
- Store document/image metadata against the project or PO.
- Show received-vs-ordered progress.

Future storage:

- Short term: Supabase Storage or app-record metadata.
- Longer term: Google Drive folder integration for project backups.

Acceptance criteria:

- Warehouse user can receive a delivery from a phone.
- Photos/documents are tied to PO/project.
- Purchasing and PM can see proof of received/shipped material.

### Phase 4 - Product Catalog / Sold Item Catalog

Status: initial version built.

- Migration `013_product_catalog.sql` adds a `product_catalog` table, separate
  from `inventory_items`.
- New "Sales" nav item and `SalesCatalog` component in `src/main.tsx`: add/edit
  modal, retire/reactivate, show-retired filter, catalog list table.
- Fields implemented: catalog number (auto-generated), product name, sales
  description, technical description, category, manufacturer, default sell
  price, cost source, datasheet URL, image URL, retired status.
- `linked_reference` is a free-text field ("SKU-1234" or a recipe name) rather
  than a real foreign key to inventory/equipment. The table also has
  `inventory_item_id` / `equipment_type_id` uuid columns reserved for later,
  but today's Inventory and Manufactured Equipment data lives in the
  `app_records` JSON blob, not in the relational `inventory_items` /
  `equipment_types` tables, so a strict FK link would not reliably resolve yet.
  Wire up real linking once Phase 10 (relational CRUD) covers those two areas.
- Not yet built: image upload (image field is a URL only), datasheet file
  upload (link only), and connecting catalog items into the sales quote
  builder (Phase 5).

Original goal:

Separate products Ergon sells/specifies from physical inventory stock.

Why:

Inventory tracks physical stock. Sales catalog tracks sellable offerings,
descriptions, datasheets, default pricing, and quote content. These should not be
the same table long-term.

Product catalog fields:

- Catalog item ID
- SKU or linked inventory SKU
- Product name
- Sales description
- Technical description
- Category
- Manufacturer
- Default sell price
- Cost source
- Datasheet file/link
- Product image
- Active/retired status
- Related BOM template or equipment type

UI:

- New Sales/Catalog area.
- Compact list of sold items.
- Add/edit item modal.
- Datasheet link/file field.
- Connect catalog items to inventory SKUs or manufactured equipment types.

Acceptance criteria:

- Sales can quote a product without confusing it with on-hand stock.
- A product can point to a datasheet.
- Retired sold items remain in old quotes and reports.

### Phase 5 - Sales Quote Builder And Hardware Recommendation Tool

Goal:

Create the future Sales tool that helps scope parking garage/lot jobs and
generate quote-ready BOMs from current pricing.

Features:

- Start new quote.
- Select client/project/site.
- Questionnaire for parking environment:
  - parking garage or surface lot
  - number of entrances/exits
  - number of lanes
  - camera count estimate
  - power available
  - Wi-Fi/network available
  - cellular required
  - solar required
  - signage required
  - VPU/server required
  - expected install date
  - shipping location
- Recommendation rules generate a draft hardware list.
- Hardware list pulls current SKU/catalog pricing.
- Sales can edit quantities and descriptions.
- Quote can later become a project after signed acceptance.

Rules engine:

- Keep rules editable by non-developers later.
- Store rules in Supabase when stable.
- Initial rules can be simple:
  - if no power, add solar power package
  - if no Wi-Fi, add cellular modem/antenna
  - if camera count exceeds threshold, add VPU/server
  - if signage required, add signs/controllers/mounts

Acceptance criteria:

- Sales can generate a draft BOM from questions.
- Output can be reviewed and edited.
- Closed quote can become a project with SOW/BOM/documents.

### Phase 6 - Project Task Management

Goal:

Build a lightweight ClickUp-style project system connected to inventory,
purchasing, manufacturing, and field work.

Task fields:

- Task ID
- Project
- Title
- Description
- Status
- Priority
- Department/team
- Assigned user
- Start date
- Due date
- Completed date
- Dependencies
- Custom fields
- Public visibility flag
- Linked SKU / BOM line / PO / build / document

Views:

- List
- Board
- Calendar
- Gantt/timeline

Automation ideas:

- If BOM line is short, create Purchasing task.
- If material received, unlock install/prep task.
- If equipment build is complete, update project readiness.
- If project shipment is logged, update field task status.

Acceptance criteria:

- PM can create and assign tasks.
- Tasks can be tied to project material readiness.
- Managers can view schedules and blockers.

Scoping note (Aug 2026): Gantt is the one view in this list still unbuilt.
Phase 11's schedule generation already computes a due date per phase
(cumulative standard-hours / 8, per phase in template order) but doesn't
persist a start date, so there's nothing to draw a bar from yet. Fix: have
`generateScheduleTasks` also write the start of that cumulative window (add
a `start_date` column to `tasks`), then add a "Gantt" tab alongside the
existing List/Board/Calendar tabs on the Tasks view and each project's
embedded task panel, rendering `start_date -> due_date` as a horizontal bar
per task, grouped by project or by phase. No new tables, no new backend --
same `tasks` rows the other views already read.

### Phase 7 - Field Media Capture And Offline Mode

Goal:

Allow Sales, PM, or field teams to capture site photos with descriptions in
parking garages where connectivity may be poor.

Features:

- Add image to project from mobile camera.
- Required description field.
- Optional location/area label.
- Save immediately to offline queue if connection is weak or absent.
- Sync when online.
- Use duplicate-safe local sync IDs.
- Show pending sync count.
- Attach synced media to project documents/media tab.
- Video is future only, not active now.

Implementation notes:

- Use IndexedDB for real offline image queue. Avoid large base64 payloads in
  localStorage for production.
- Add service-worker/background sync later if the app becomes a PWA.
- Store final media in Supabase Storage or Google Drive.

Acceptance criteria:

- User can capture a photo and description with no connection.
- Photo does not disappear on refresh.
- Photo syncs when online.
- PM can see the photo under the correct project.

### Phase 8 - Public Client Progress View

Goal:

Allow outside users to view project progress safely.

Requirements:

- Public link per project.
- No internal costs.
- No warehouse counts.
- No private task notes.
- No supplier/vendor details unless explicitly public.
- Show high-level status, milestones, and visible tasks.
- Optional Gantt view.

Security:

- Use a public token or share key, not wide-open project SELECT policies.
- Public query should return only sanitized fields.
- Keep public data separate or expose through a controlled server function.

Acceptance criteria:

- Client can view progress without logging in.
- Internal purchasing/inventory information remains hidden.

Scoping update (Aug 2026): this phase's public-token infrastructure is now
also the delivery mechanism for Phase 11's Submittals approval flow (a
client needs to view and approve/reject a submittal without logging in,
which is the same problem this phase already solves). Build the public-token
system once, use it for both progress viewing and submittal approval.

### Phase 9 - Real Role-Based Security

Goal:

Turn role views into enforceable permissions.

Roles:

- Warehouse
- Purchasing
- PM
- Manager
- Admin/Owner
- External viewer

Examples:

- Warehouse can receive, adjust, transfer, and upload shipment proof.
- Purchasing can manage purchase requests and POs.
- PM can manage projects, SOW/BOM, allocations, and tasks.
- Manager can read reports and approve larger actions.
- External viewer can only read public project status.

Acceptance criteria:

- Permissions are enforced server-side or in Supabase RLS, not only hidden in UI.
- User role is assigned by admin/owner.
- Sensitive actions are blocked for unauthorized users.

Scoping note (Aug 2026): no new secret/credential is needed to start Phase 9 —
unlike email invites, this is pure SQL + RLS policy work using role data that
already exists (`app_user_roles.role_key`, `is_app_admin()`, `is_app_manager()`).
What's actually needed is E's sign-off on the specific permission matrix, since
that's a business decision, not a technical one. A starter matrix already
exists, seeded in migration `003` into `app_role_modes.permissions` and never
enforced:
  - warehouse: inventory write, projects read
  - purchasing: purchasing write, inventory read
  - pm: projects write, inventory read
  - manager: reports/inventory/projects read
This is coarse (whole-area read/write, not per-action rules like "can adjust
stock but not retire an item"). Two honest options:
1. Enforce this coarse matrix now as real RLS policies. Fast, no dependencies,
   meaningfully better than UI-only hiding.
2. Wait and pair it with Phase 10. Real fine-grained enforcement (per-project,
   per-action) isn't fully possible yet regardless, because Projects/
   Inventory/Purchasing still live in one JSON blob per collection
   (`app_records`) — RLS can only gate at the whole-collection level against
   that table (e.g. "can this role write to the `projectSites` blob row at
   all"), not at the level of an individual project or BOM line. True
   row/action-level rules need Phase 10's relational tables to exist first.
Needs a decision from E: go coarse now, or bundle with Phase 10.

### Phase 10 - Move From JSON App Records To Relational CRUD

Goal:

Use relational Supabase tables as the primary production data model instead
of `app_records` (one JSON array per collection, whole-array replace on every
save).

Major finding when scoping this (Aug 2026): **a full relational schema
already exists in the database and is currently unused.** Migrations `001`
through `008` built out `projects`, `inventory_items`, `inventory_balances`,
`inventory_movements`, `inventory_transactions`, `equipment_types`,
`equipment_bom_components`, `build_transactions`, `project_allocation_history`,
`purchase_requests`, `purchase_order_lines`, `project_documents`,
`sales_quote_extractions`, `vendors`, `locations`, `app_role_modes`, and more
— then migration `009` pivoted the live app to write everything into the
`app_records` JSON blob instead, as a fast bridge to get persistence working.
That relational schema was never removed; it just sits idle. **Phase 10 is
therefore mostly "finish wiring the app to tables that already exist," plus
gap-filling ALTERs and one net-new table pair (project SOW + BOM lines),
rather than designing a schema from zero.**

How exactly the current schema exists is documented per-entity below.

Current state (how `app_records` actually works):

- One row per collection, not per business record: `app_records(workspace_key,
  record_key, data jsonb)` with `record_key` one of `inventoryItems`,
  `projectSites`, `deviceRecipes`, `inventoryMovements`, `buildTransactions`,
  `projectAllocations`, `purchaseRequests`, `projectDocuments`, `roleMode`.
- `persistence.ts` (`saveRemoteAppState`) upserts all 9 rows on every save,
  each containing the ENTIRE array for that collection as one JSON value.
  Editing a single inventory item's stock count re-serializes and re-uploads
  every inventory item, every project, every recipe, etc.
- The save fires from one `useEffect` in `main.tsx` (~line 1054) whenever any
  of the 9 top-level React state arrays changes, debounced 650ms. No partial
  saves, no per-record concurrency control, no audit trail beyond the blob's
  single `updated_at`.
- Single global workspace (`workspace_key = "default"`) — not per-tenant, not
  per-user. This is fine for Ergon today (one company) but worth naming as a
  design choice, not an oversight.

Per-entity readiness (existing table vs. what the app's TypeScript types need):

- **Purchase requests — closest to ready.** `purchase_requests` (migration
  `005`, extended in `006`/`007`/`011`) already has nearly every field the
  app's `PurchaseRequest` type needs: `inventory_item_id`, snapshots, quantity,
  reason, source, project link, vendor, cost, status, `po_number`,
  `expected_date`, `procurement_track`, `project_name`. Gap: the `reason`
  check constraint doesn't yet include `'project_bom'` (the app added that
  reason later) — one small ALTER. Best candidate to cut over first: lowest
  schema risk, good test of the whole migration pattern.
- **Project documents — also close.** `project_documents` (migration `002`,
  extended in `008`) has `document_type`, `storage_provider`/`storage_status`,
  `local_document_id`, `project_name`, `file_size_bytes`. Naming differs
  slightly from the app's `UploadedDoc.type`/`.storage` values — needs a
  mapping table/enum reconciliation, not new columns.
- **Inventory items — solid, small gaps.** `inventory_items` (migration `001`,
  extended in `004`) already has `sku`, `item_name`, `category`,
  `default_unit_cost`, `reorder_point`, `barcode_value`, `image_url`,
  `manufacturer`, `purchase_sources` (jsonb, matches `Part.purchaseUrls`),
  `inventory_tags`, `retired_at`. Two real gaps: (1) no price-history table
  yet (`Part.priceHistory` needs a new `inventory_item_price_history` child
  table); (2) stock is modeled via `inventory_balances(item, location)` rather
  than a flat number — the app's UI has no location/bin concept yet (that's
  the still-open "Inventory location/bin UI" item). Plan: create one default
  "Main Warehouse" location row and always read/write balances against it, so
  the app keeps working as a single flat stock number today while the schema
  is already ready for real bin/location UI later without another migration.
- **Equipment recipes — solid, needs a stable ID.** `equipment_types` +
  `equipment_bom_components` (migration `003`) map cleanly to the app's
  `BuildRecipe`/`BuildComponent`, except the app's `BuildRecipe` has **no id
  field at all** — it uses `name` as its de facto primary key everywhere.
  Migration needs to assign each recipe a real `id`, backfill
  `equipment_number`, and rewrite every `equipmentName`/`itemName` string
  lookup in `main.tsx` to use the id instead (this touches many call sites —
  flagged as the fiddliest part of this entity).
- **Movements / build transactions / allocations — schema is already ahead of
  the app.** `inventory_transactions`, `inventory_movements`,
  `build_transactions`, `project_allocation_history` (migration `003`/`004`)
  already support things the app's flat types don't track yet (from/to
  location, unit cost, balance before/after, undo linkage, workflow stages
  matching the app's planned/kitting/assembled/tested/complete exactly). Good
  foundation; mostly straightforward mapping, some new columns just stay null
  until location UI exists.
- **Projects — the biggest lift.** `projects` (migration `001`, extended in
  `002`) has `project_name` (unique), `customer_name`, a `status` enum
  (planning/active/on_hold/completed/cancelled — doesn't match the app's
  Draft/Planning/Purchasing/Staging/Install Ready), `department_id`/
  `owner_id` (FKs to an unused `profiles`/`departments` concept the app
  doesn't have), `start_date`/`target_date`/`completed_date`, `budget_amount`,
  `google_drive_url`, `notes`, `project_number` (nullable, not in the app's
  `PRJ-2026-####` ref format). Missing entirely and needing new columns/
  tables: `type` (Parking Garage/Surface Lot/etc), `package`, `cameras`,
  `allocated`, site `address`, `sales_quote_file`, and — the two real net-new
  pieces — a **Scope of Work** (currently 8 embedded text fields, needs a 1:1
  `project_scope_of_work` table) and **BOM lines** (currently an embedded
  array, needs a new `project_bom_lines` table with `project_id` FK and a
  nullable `inventory_item_id` FK, since BOM line item names are free text
  today and won't all resolve cleanly to a real inventory row on day one).
- **Legacy/dead schema to formally retire, not resurrect:** `departments`,
  `profiles`, `vendors` (unused — `Part.vendorUrl` is just a text field, not a
  vendor relationship), `locations` beyond one default row, `purchase_orders`/
  `purchase_order_lines` (the app's model is request-based, not full PO/line
  based), `activity_log`, `app_state_snapshots` (superseded by `app_records`
  itself), `app_role_modes` (superseded by `app_user_roles`/`app_admins`/
  `app_user_status` from migrations `010`/`012`/`014`, though its seeded
  `permissions` jsonb is a reasonable starting point for Phase 9's matrix).

Known messy data to reconcile during migration (not blockers, just need a
one-time cleanup pass, likely with a "review unmatched rows" step rather than
a silent auto-migration):

- BOM line item names (`BomLine.item`) are matched to inventory by exact name
  string at read time today — some won't match any real `Part.name` and will
  need manual reconciliation or will migrate as unlinked (`inventory_item_id
  = null`) rows.
- At least one known name mismatch: a document's default project field
  ("Straud Medical") doesn't match the actual seed project name ("Straub
  Medical HI") — a pre-existing typo/data-quality bug, not something this
  migration introduces.
- Legacy record IDs (`makeId("...")` strings like `build-1690000000-ab12cd`)
  are not UUIDs — plan to keep them as a `legacy_id` column on the new tables
  for traceability rather than discarding them.

Target (unchanged from original scope, now grounded in what already exists):

- Inventory items use `inventory_items` + `inventory_balances`.
- Movements use `inventory_movements` / `inventory_transactions`.
- Projects use `projects` + new `project_scope_of_work` + new
  `project_bom_lines`.
- Documents use `project_documents`.
- Equipment definitions use `equipment_types` and `equipment_bom_components`.
- Builds use `build_transactions`.
- Purchase requests use `purchase_requests`.

Recommended cutover order (lowest risk first, each step keeps `app_records` as
a read fallback until confirmed solid, then drops that collection's key from
the blob):

1. Purchase requests (schema nearly ready, well-isolated feature).
2. Project documents (schema nearly ready).
3. Inventory items + one default location/balance row.
4. Equipment recipes (needs the surrogate-id rewrite).
5. Movements / build transactions / allocations (depend on inventory items +
   recipes already being cut over).
6. Projects, including new SOW + BOM line tables (biggest lift, do last so the
   pattern is proven on lower-risk entities first).

Each step also requires rewriting `persistence.ts` from "upsert the whole
array" to real per-record CRUD functions (following the pattern already used
for `product_catalog`/`tasks`), and a one-time data-migration script per
entity to copy existing blob rows into the new tables before cutting the app
over to read/write them directly.

Acceptance criteria:

- Major records can be queried, filtered, audited, and secured at table level.
- No important production workflow depends only on a single JSON state blob.
- Legacy/unused tables from the original schema pass (`departments`,
  `profiles`, `purchase_orders`, etc.) are either formally adopted or dropped,
  not left in an ambiguous half-used state.

### Phase 11 - AI-Assisted Scheduling, Project Templates, and Submittals

Goal (per E, Aug 2026 -- this was originally raised at project kickoff):
generate a draft project schedule automatically from a project's BOM and a
library of standard install times, using a reusable Template, adjustable
by the PM afterward -- plus a formal Submittals package the client signs off
on before final purchasing happens.

This phase has three connected parts. It depends on Phase 10's BOM lines
having a real table (`project_bom_lines`) and, ideally, on Phase 12's BOM
categories/standard-time library, so build after those, or in parallel with
Phase 10f specifically.

**1. Standard Time Library**

- New table `standard_install_times`: maps an inventory category (or a
  specific `inventory_item_id`) to a standard install duration (hours per
  unit) and an optional crew-size factor. Admin-managed (a simple table in
  the Admin page: category/item, hours per unit, notes).
- Seed data has to come from E/the PM team -- there is no way to infer
  "how long does one camera install take" without input from the business.
  This is the first real open item: someone needs to supply initial
  standard times per category before scheduling can produce anything
  useful.

**2. Project Schedule Templates**

- New table `project_schedule_templates` (id, name, description,
  is_active) and `project_schedule_template_phases` (id, template_id,
  phase_name, sequence_order, depends_on_phase_id nullable, duration_mode
  `fixed_hours` | `per_bom_unit`, fixed_hours numeric nullable,
  bom_category_filter text nullable, default_role text nullable e.g.
  "Installer"/"PM"/"Warehouse"). A template is an ordered phase list like
  "Site Prep -> Infrastructure -> Camera Install -> Signage -> Commissioning
  -> Fine-Tuning -> Go-Live," matching the existing SOW section shape
  already in `ProjectSite.sow`.
- Admin/PM page to create and edit templates (add/reorder/remove phases,
  set duration mode per phase).
- A project can have one template applied. Applying a template + a project
  start date computes each phase's duration (fixed, or standard-time x BOM
  quantity in that phase's category) and generates real rows in the `tasks`
  table (`section: "projects"`, `project_ref` set, one task per phase,
  sequenced due dates based on cumulative duration from the start date).
  These are ordinary tasks after generation -- the PM can drag due dates,
  reassign, or edit them exactly like any manually-created task, using the
  task system already built. Re-applying a template to a project that
  already has generated tasks should update rather than duplicate (match
  by a `generated_from_template_phase_id` marker column on `tasks`).

**3. AI vs. deterministic calculation -- an open decision**

The actual duration math (standard time x BOM quantity, summed per phase)
is a deterministic calculation, not something that needs an LLM -- it's
more reliable, cheaper, and easier to debug as a straightforward formula
than as a generative AI call, and a PM can trust a number they can audit
back to "12 cameras x 2 hours." Two ways to still deliver on "AI-driven":

- (a) **Deterministic core + AI fallback/narrative.** Use the formula above
  for the actual date math. Use the AI provider already anticipated in this
  codebase (`OPENAI_API_KEY`/`OPENAI_MODEL`, referenced for future sales-quote
  extraction but not yet turned on) only for softer jobs: writing a
  human-readable schedule summary, suggesting a reasonable standard time
  when a BOM category has none on file yet, or flagging an unusual BOM mix
  that doesn't match a template well.
- (b) **Full generative scheduling.** Send the BOM + template + standard
  times to an LLM and let it produce the whole draft schedule, including
  sequencing decisions.

**Decided (Aug 2026, per E): option (a), deterministic core.** The formula
does the actual date math; AI is used only to fill gaps (no standard time on
file yet) and write human-readable summaries. Still needs the
`OPENAI_API_KEY`/`OPENAI_MODEL` Vercel secrets actually configured (not yet
done -- flagged as "not yet configured" in the Production Setup Checklist
since this roadmap's first draft) before the AI-fallback part can work; the
deterministic scheduling itself does not depend on those secrets at all and
can be built and used without AI configured.

**4. Submittals**

- New table `project_submittals` (id, project_id, version integer, status
  `draft`|`sent`|`approved`|`rejected`|`revision_requested`, a content
  snapshot -- BOM summary, spec sheets/datasheet links pulled from
  `product_catalog`, proposed schedule from the phases above -- captured as
  of send time so a later BOM edit doesn't retroactively change what the
  client already saw, client contact name/email, sent_at, responded_at,
  response_notes).
- Reuses Phase 8's public-token link mechanism: PM sends a submittal, client
  opens a token link (no login), reviews BOM/spec sheets/schedule, and
  clicks Approve or Request Revision with a name/notes field.
- **Decided (Aug 2026, per E): audit-trailed click-to-approve**, not a true
  e-signature, unless a specific contractual reason surfaces later that
  requires cryptographic signing. Capture IP, timestamp, typed name, and a
  content hash of what was shown at approval time, so there is still a solid
  audit trail even without a third-party e-signature vendor.
- Purchasing gate: once Purchase Requests move to a real table (Phase 10a),
  add a rule (enforced in the UI first, in RLS once Phase 9 lands) that a
  project's BOM-sourced purchase requests can't move past "Ready to Order"
  until that project has at least one `approved` submittal -- this is the
  actual "sign off before final purchasing" behavior E asked for.

Acceptance criteria:

- A PM can apply a template to a project and get a real, adjustable draft
  schedule instead of building one task-by-task.
- Standard times are editable by an admin, not hardcoded.
- A client can review and approve/reject a submittal without an account.
- Purchase requests tied to a project's BOM cannot be finalized without an
  approved submittal for that project.

### Phase 12 - BOM Revision History

Goal: track changes to a project's Bill of Materials over time instead of
silently overwriting lines, since BOM management is the single most-cited
differentiator of manufacturing-specific PM tools in the research pass.

- Depends on Phase 10f (`project_bom_lines` as a real table).
- Add `project_bom_line_revisions` (id, project_bom_line_id, changed_by,
  changed_at, previous_qty, previous_status, previous_notes, change_reason
  nullable). A trigger or application-level write logs the prior state
  before every update, rather than requiring a separate manual "save
  revision" step.
- UI: a small "History" expandable row or modal per BOM line showing who
  changed what and when. Not a full diff/redline view initially -- that's a
  reasonable v2 if it turns out to matter.
- Ties into Phase 11's Submittals: a submittal's BOM snapshot is naturally
  just "the current revision at send time," so this phase and Phase 11 share
  the same underlying revisioning concept.

Acceptance criteria:

- Every BOM line change is attributable to a person and a timestamp.
- A PM can see what a BOM line looked like before the last change without
  digging through unrelated activity logs.

### Phase 13 - Quality Checkpoints In The Build Workflow

Goal: add a real QA gate to manufacturing builds instead of "tested" being
just a label a person sets with no enforced check behind it.

- Extends the existing build stages (`planned -> kitting -> assembled ->
  tested -> complete`, already in `build_transactions.stage`).
- Add `build_inspection_checklists` (id, build_transaction_id,
  checklist_item, is_required boolean, is_checked boolean, checked_by,
  checked_at, notes) -- a simple required-checklist model, not a generic
  form builder. Checklist items can come from a per-equipment-type template
  (extends `equipment_types`) so "VPU Server" builds always get the same
  checklist, for example.
- Add `build_defects` (id, build_transaction_id, description, severity,
  status `open`|`corrected`|`wont_fix`, logged_by, logged_at, corrected_at,
  corrective_action) for defect/non-conformance logging.
- UI rule: a build cannot move from `tested` to `complete` while any
  required checklist item is unchecked or any defect is still `open`.

Acceptance criteria:

- A build's "tested" stage requires actually completing a checklist, not
  just clicking a status dropdown.
- Defects are logged against a specific build with a corrective-action
  trail, not lost in free-text notes.

### Phase 14 - Job Costing (Actual vs. Estimate)

Goal: track real cost against the original estimate per project, not just
the flat `allocated` dollar figure that exists today.

- Depends on Phase 10 (real inventory/movement/purchase-request tables) for
  accurate actual-cost roll-ups; can be scoped now, built once Phase 10
  lands for the entities it needs.
- Add an `estimated_budget` (already have `allocated`, which is closer to
  "committed," not "estimated at signing" -- needs a distinct field) and a
  computed/materialized "actual cost" view per project: sum of received
  purchase request costs (`estimated_unit_cost x quantity_received`) +
  allocated inventory pulls at their unit cost, tagged to that project.
- Surface as a simple budget-vs-actual bar/number on the Project Progress
  card already built, plus a project-level margin line in Reports.

Acceptance criteria:

- A PM can see committed budget vs. actual spend per project without
  manually adding up purchase requests and inventory pulls.

### Phase 15 - Automation & Notification Rules Engine

Goal (per E, Aug 2026): every alert type -- overdue tasks, and more broadly
any event worth flagging -- should be able to fire through email, Slack/
Teams, an in-app bell, or any combination, and which channel(s) fire for
which event should be **admin-configurable ("programmable")**, not
hardcoded per feature. This merges what was originally scoped as a narrow
"overdue-task email" phase with the broader "automation rules engine" idea
from the PM-tools research pass (idea #1: "if stock < reorder point, create
a purchase request"; "if task done, notify next assignee"; "if due date
passes, alert the lead") -- one system now covers both.

**Core data model**

- `notification_rules` (id, event_type, conditions jsonb e.g. `{"priority":
  ["high","urgent"]}`, recipient_mode `assignee`|`project_pm`|`role`|
  `specific_person`, recipient_value text nullable, channels text[] subset
  of `in_app`/`email`/`slack`/`teams`, is_active, created_by). Admin-managed
  list, editable in the Admin page -- this is the "programmable" part.
  event_type values to start: `task_overdue`, `task_assigned`,
  `task_status_changed`, `purchase_request_status_changed`,
  `build_stage_changed`, `submittal_responded`, `low_stock_reached`.
- `notifications` (id, user_id nullable, team_member_id nullable, rule_id,
  event_type, title, body, related_entity_type, related_entity_id, is_read,
  created_at) -- the actual generated alerts. This table feeds the in-app
  bell regardless of which other channels also fired for that event.
- `notification_deliveries` (id, notification_id, channel, status
  `sent`|`failed`|`skipped`, error_message nullable, sent_at) -- a delivery
  log per channel per notification, so a failed Slack post or bounced email
  is visible and debuggable, not silent.

**Channels, in increasing order of setup complexity**

1. **In-app bell** (build first): a bell icon in the top-right of the nav
   bar (next to the account menu) with an unread count badge and a
   dropdown list of recent notifications, marking read on open/click.
   Needs only the tables above -- no new secret, works immediately for
   anyone signed into the app.
2. **Email**: needs one new transactional-email-provider secret (Resend,
   Postmark, or SendGrid) -- new sensitive credential, needs E's explicit
   sign-off before adding, same category as the deferred invite feature.
   Reaches roster members even if they're not currently signed in.
3. **Slack/Teams, channel-level (simpler)**: a single incoming webhook URL
   posts to one shared channel (e.g. "#purchasing-alerts"). Good fit for
   team-wide events (a build needs QA, a submittal was rejected) but posts
   to a channel, not a specific person's DMs.
4. **Slack/Teams, per-person DM (meaningfully bigger lift)**: actually
   pinging "Sunil" directly (not just a channel) requires a real Slack App
   /Teams app registration with a bot token and email-to-user-ID mapping --
   its own small sub-project, not just a webhook URL. Scope as an explicit
   follow-up once channel-level webhooks are proven useful, rather than
   building it as part of this phase's first cut.

**Trigger mechanism**

- Time-based rules (`task_overdue`) need a scheduled check (daily, via a
  Supabase scheduled function or external cron hitting a small serverless
  endpoint) that scans for tasks past `due_date` and not `done`/`cancelled`.
- Event-based rules (`task_assigned`, `purchase_request_status_changed`,
  etc.) fire at the moment of the write itself -- the existing
  `handleUpdateTask`/`handleCreateTask`/purchase-request handlers (and their
  Phase 10 successors) call into a shared "evaluate rules for this event"
  function after a successful write.

Acceptance criteria:

- An admin can see and edit which channel(s) fire for which event type,
  without a code change.
- The in-app bell works with zero new secrets; email and Slack/Teams are
  additive, sign-off-gated channels on top of it.
- A failed delivery (bad webhook, bounced email) is visible in
  `notification_deliveries`, not silently dropped.

### Phase 16 - Workload/Capacity Dashboard

Goal: a "who's overloaded" view, extending the "group by individual" view
already built in the Tasks tab.

- No new tables needed -- this is a read/aggregation view over the existing
  `tasks` and `team_members` tables.
- New compact dashboard (could live on the Dashboard tab or as a 4th Tasks
  view alongside List/Board/Calendar): per roster member, show open task
  count, overdue count, and a simple load indicator (e.g., color banding at
  a configurable "too many open tasks" threshold).
- Natural extension: click a person to filter the Tasks tab to just their
  work (the "group by individual" board already supports this at the
  column level).

Acceptance criteria:

- A manager can see at a glance who has too much on their plate without
  opening every person's task list individually.

### Phase 17 - Document Version Control With Approval History

Goal: give project documents (SOW, BOM sheets, spec drawings, sales quotes)
a real change history and sign-off trail instead of a single status
dropdown (Uploaded/Ready to review/Backed up/Archived) that just gets
overwritten.

- Depends on Phase 10b (`project_documents` as a real table).
- Add `project_document_revisions` (id, project_document_id, version,
  file_url/storage_path at that version, uploaded_by, uploaded_at, notes) --
  uploading a new version of an existing document creates a new revision
  row rather than overwriting the file reference.
- Add lightweight approval fields already partially possible via
  `project_documents.status` -- extend with `approved_by`, `approved_at`,
  `approval_notes` so a status change to "approved" carries who/when/why.
- Comment/markup-on-PDF (mentioned in the research) is a materially bigger
  feature (needs a PDF annotation UI/library) -- scope as an explicit v2,
  not part of this phase's first cut.

Acceptance criteria:

- Uploading a new version of a document doesn't lose the previous version.
- A document's approval (or rejection) is attributable to a person and
  timestamp, not just a label.

### Phase 18 - Fluid Admin-Configurable Forms Engine + After-Sales Hardware Handover

Context (Aug 2026): E asked for an after-sales hardware handover form
(project ref, site requirements, hardware BOM, attachments) and was explicit
that the question list can't be hardcoded -- a PM should be able to add,
remove, reorder, or re-require a question from Admin without asking for a
code change every time. A generic AI tool sketched this out with its own
parallel schema (`project_tasks`, `hardware_allocations`,
`inventory_catalog`, an Express backend with multer/exceljs, a Deno Edge
Function). None of that gets reused here -- it invents tables that
duplicate `tasks`/`project_bom_lines`/`inventory_items`, and assumes a
server this app doesn't have. This phase gets the same "fluid form"
capability using only what's already in this database and this app.

Goal: a reusable, admin-configurable form schema engine, applied first to
the After-Sales Handover form, that requires zero code changes to add,
remove, reorder, or re-require a field.

Data model (new migration):

- `form_schemas` (id, form_key text unique, name, description, is_active,
  created_at, updated_at). `form_key` is a stable string like
  `after_sales_handover` -- this table is generic on purpose so a second
  admin-configurable form later (if one comes up) doesn't need new tables,
  just a new row here.
- `form_schema_fields` (id, form_schema_id fk, section text, field_key
  text, label, field_type text check in ('text','textarea','number',
  'select','checkbox','date'), placeholder, is_required boolean,
  options jsonb default '[]' -- for selects --, sequence_order int,
  created_at). Unique on (form_schema_id, field_key).
- RLS: authenticated read; pm/admin write, same `has_role()` pattern as
  `project_schedule_templates` (migration 023).
- Seed one `form_schemas` row (`after_sales_handover`) with a starter field
  set (mounting environment, power spec, network dependency, special
  instructions) so the form isn't empty on first use -- an admin edits
  from there, nothing is hardcoded in the app after that.
- `project_handovers` (id, project_id fk `projects(id)` via the same
  `resolveProjectId` bridge Submittals uses, form_schema_id fk, status
  text check('draft','submitted'), responses jsonb default '{}' --
  field_key -> value, exactly the fluid pattern that was proposed, just
  tied to a real project instead of a made-up one --, submitted_by_email,
  submitted_at, created_at, updated_at).

Explicitly reused, not reinvented:

- Hardware BOM lines entered on the handover write straight into the
  existing `project_bom_lines` table (Phase 10f) -- no `hardware_allocations`
  table. A line added here shows up immediately in the project's existing
  BOM panel, because it's the same rows.
- The stock-vs-direct-PO decision the proposal wanted as a new state
  machine and Edge Function already exists as the Purchasing
  `procurement_track` / `queueProjectBomPurchaseRequest` flow -- the
  handover's BOM submission calls that, it doesn't need new logic.
- Attachments (signed quote PDF, site photos) go through Phase 7's offline
  media queue into `project_documents` (`document_type = 'handover'`) --
  no new attachment table or upload endpoint.
- Notifying the PM on submission reuses the Phase 15 rules engine (`notify()`
  + `notification_rules`) -- add `handover_submitted` to that table's
  `event_type` check constraint, nothing else new.

Admin UI: a "Form Builder" section in Admin (same interaction pattern as
Schedule Templates -- add/edit/delete a field row, up/down reorder buttons,
required toggle, comma-separated options for selects). Generic over
`form_key` so it isn't hand-tied to this one form.

Handover UI: a screen (reachable from a project's detail page) that loads
the active schema's fields and renders them in a loop (text/select/textarea/
number/date/checkbox), plus the existing BOM add-row UI and Phase 7's
attachment slot, both already built rather than rebuilt here.

Explicitly not needed for this: a Node/Express server, a new Edge Function,
a service-role key, or any table named after "taskboard" or "inventory
catalog" -- everything routes through tables and RLS that already exist.

Acceptance criteria:

- An admin can add, edit, reorder, or delete a handover question from
  Admin, and it appears (or disappears) on the next handover opened, with
  no deploy.
- Submitting a handover updates the same `project_bom_lines` and
  `project_documents` rows the rest of the app already reads.
- Zero new tables duplicate data that already lives in `tasks`,
  `project_bom_lines`, `inventory_items`, or `project_documents`.

### Phase 19 - In-Browser Spreadsheet BOM Import

Goal: let a PM drop an `.xlsx`/`.csv` of hardware line items and bulk-fill a
project's BOM instead of typing each row by hand -- without adding a
backend server.

Design:

- Add a client-side parsing library (SheetJS `xlsx` covers both `.xlsx`
  and `.csv`) and parse the dropped file entirely in the browser via the
  File API. No upload endpoint, no multer, no server round-trip --
  consistent with this app having no backend beyond Supabase.
- Case-insensitive header matching for Item/Model, Category, Qty, and
  Procurement Track columns, same flexible-header idea the research
  suggested, just done client-side instead of in an Express handler.
- Preview the parsed rows in a table before committing anything (matches
  the "probe before you build" caution used elsewhere this session) --
  PM reviews, then confirms.
- Confirming calls the same persistence functions the manual "Add
  Material" BOM row already uses to insert into `project_bom_lines` --
  existing status values (Need Quote/Not started/Ordered/etc.) and
  request-speed values (ASAP/Standard/Future), no new enum values.

Acceptance criteria:

- Dropping a correctly-headed spreadsheet shows a preview grid before any
  database write happens.
- Confirming writes rows into the project's real BOM table, visible
  immediately in the existing BOM panel.
- No file or row data leaves the browser except to Supabase directly.

Addendum (Aug 2026): should a successful import also auto-trigger schedule
generation (Phase 11) instead of waiting for the PM to click "Generate
Schedule" separately? Decided: keep it an explicit second click. Auto-firing
task creation the instant a spreadsheet lands felt more likely to surprise a
PM than help them -- the button already exists and takes one click once the
BOM is in place.

### Phase 20 - Pre-Sales Hardware Rules Engine

Context (Aug 2026): distinct from Phase 18's after-sales handover -- this is
upstream, at the sales-questionnaire stage, before a project even has a firm
BOM. Goal: derive a baseline hardware list automatically from a few
high-level answers (site/environment type, node count, connectivity),
so a sales engineer isn't starting every quote's BOM from a blank page.

Data model (new migration):

- `presales_hardware_rules` (id, tier text -- e.g. "Commercial Office",
  "Industrial Plant", "Marine/Outdoor" --, base_item_name text matching an
  `inventory_items.item_name` where possible, quantity_mode text check in
  ('fixed', 'per_node_ceil') -- fixed uses `fixed_qty`, per_node_ceil
  computes `CEIL(node_count / per_node_divisor)` --, fixed_qty numeric,
  per_node_divisor numeric, requires_cloud_sync boolean default null (null
  = applies regardless), sequence_order, is_active, created_at, updated_at).
  RLS: authenticated read, pm/admin write (same `has_role()` pattern as
  everything else added tonight).
- No new table for the questionnaire itself -- the three inputs (tier
  select, node count number, cloud-sync checkbox) are just local component
  state on a new "Quick Hardware Estimate" panel; there's nothing to
  persist about the questionnaire itself, only its output.

UI: a small panel on the Sales/Catalog view (or a project's detail page,
for a project that's still in Draft/Planning) with the three inputs and a
"Generate Baseline BOM" button. Evaluates the active `presales_hardware_rules`
rows against the answers and inserts the resulting rows straight into
`project_bom_lines` -- same table Phase 18 and Phase 19 write to, same table
the existing manual "Add Material" button writes to. A sales engineer or PM
can edit/remove any auto-generated line afterward exactly like a manually
typed one; nothing is locked.

Admin UI: a "Pre-Sales Rules" section (same add/edit/delete/reorder pattern
as Schedule Templates and the Phase 18 Form Builder) so a PM can adjust
tiers, quantities, and the node-count formula without a code change.

Acceptance criteria:

- Filling in tier + node count + cloud-sync and clicking Generate creates
  BOM lines on the target project, visible immediately in the existing BOM
  panel.
- An admin can add, edit, or remove a rule without a deploy.
- Generated lines are ordinary `project_bom_lines` rows -- no separate
  "derived" table or locked state.

### Phase 21 - Task-Linked Inventory Automation

Context (Aug 2026): the pasted proposal's version of this wanted a Supabase
Edge Function that fires when a task's kanban column changes, checking
stock and reserving or queuing a PO with a full audit ledger. The Edge
Function part of that isn't actually necessary here -- this app already
does every multi-step write as sequential client-side calls (schedule
generation, Submittal creation, etc.), the same pattern this can follow
without deploying anything new to Supabase. What's actually missing is the
data model: today a task has no concept of which BOM line/inventory item it
depends on or how many units.

Data model (new migration):

- `task_hardware_dependencies` (id, task_id fk `tasks(id)` on delete
  cascade, project_bom_line_id fk `project_bom_lines(id)`, inventory_item_id
  fk `inventory_items(id)` nullable -- resolved by item name where possible,
  same best-effort match Phase 10's backfills already use --, quantity_required
  numeric, fulfillment_status text check in ('pending', 'allocated',
  'procurement_queued') default 'pending', created_at). RLS matches `tasks`
  (currently deliberately unrestricted per migration 023's comments).

Client-side logic: extend `handleUpdateTask` -- when a task's status
changes to `in_progress` and it has one or more
`task_hardware_dependencies` rows still `pending`, check each dependency's
inventory balance (reusing the same balance-lookup already used by the
Inventory tab), and either (a) write an inventory movement/allocation
reserving the stock and mark the dependency `allocated`, using the same
functions the existing "Pull from Inventory" action already calls, or (b)
if short, queue a purchase request via the existing
`queueProjectBomPurchaseRequest` and mark the dependency
`procurement_queued`. No new backend, no service-role key -- same
authenticated client calls every other write in this app already makes.

UI: a small "Linked Hardware" list inside `TaskEditorModal` to attach one or
more BOM lines (with quantity) to a task -- optional, defaults to none.

Acceptance criteria:

- A task with linked hardware, when moved to In Progress, either reserves
  available stock or creates a purchase request automatically -- one or
  the other, never silently doing nothing.
- A task with no linked hardware behaves exactly as it does today.
- The fulfillment_status per dependency is visible on the task.

### Phase 22 - Inventory Automation Regression Test Suite

Goal: a repeatable test script that seeds controlled inventory/task data,
exercises Phase 21's allocate-or-queue logic, and asserts the resulting
balances and statuses are correct -- so this can be checked before/after
future changes rather than by hand every time.

Important constraint: this cannot be run from inside this session. The
sandbox this app is developed in cannot resolve Supabase's hostnames at all
(confirmed earlier this session -- not just the Postgres pooler, the main
REST/API domain too), and a test run needs a service-role key, which should
never be pasted into this sandbox in the first place (it bypasses every RLS
policy in the database). This script gets written for you to run from your
own machine or a CI runner, the same way you run migrations today.

Design:

- Node/ts-node script using `@supabase/supabase-js` with the service-role
  key read from a local environment variable, never hardcoded.
- Seeds two `inventory_items` rows (one with plenty of stock, one scarce),
  two `taskboard`-equivalent `tasks` rows, and matching
  `task_hardware_dependencies`.
- Triggers the same status-change path Phase 21 uses (calls the same
  persistence functions, or issues the equivalent REST calls directly).
- Asserts: the well-stocked task's dependency ends up `allocated` and
  `inventory_balances` decremented by the right amount; the scarce task's
  dependency ends up `procurement_queued` and a `purchase_requests` row
  exists; nothing else in the database was touched.
- Cleans up its own seeded rows on both success and failure.

Acceptance criteria:

- Running the script against a real (ideally staging, not production)
  Supabase project prints a clear pass/fail per assertion.
- The service-role key only ever lives in the runner's own environment
  variable, never committed, never pasted into this sandbox.

## Suggested Next Development Sprint

If continuing immediately, build in this order:

1. [x] Direct-to-project purchasing workflow.
   - Completed in commit after roadmap creation:
     - Project BOM can request warehouse-stock purchase or direct-to-project
       purchase.
     - Purchasing manual requests can be tied to a project and marked
       direct-to-project.
     - Direct-to-project receipt does not increase warehouse stock.
     - Direct-to-project receipt creates movement history and project allocation
       history.
     - Project BOM inventory pulls now create movement history and project
       allocation history.
     - Added migration
       `backend/supabase/migrations/011_direct_project_purchase_requests.sql`.
2. [ ] Receiving proof/photo flow for purchase requests.
3. [ ] Project document/media model cleanup.
4. [ ] Inventory location/bin UI.
5. [x] Reports filters for SKU/project/vendor/date.
   - Completed in commit after roadmap creation:
     - Reports now have a compact filter bar for search/SKU, project, vendor,
       from date, and to date.
     - Purchasing, inventory, manufacturing, project allocation, and document
       report sections use filtered datasets.
     - CSV exports use the same filtered datasets so exported files match what
       the user is reviewing.
6. [x] Google sign-in.
   - Added in `src/persistence.ts` (`signInWithGoogleRedirect`,
     `consumeOAuthRedirectSession`) and wired into the sign-in screen in
     `src/main.tsx`.
   - Requires a Google Cloud OAuth client (Production publishing status, not
     Testing) with redirect URI `https://hnjxvsxsxoowhegcqurf.supabase.co/auth/v1/callback`,
     and the Google provider enabled in Supabase with that client ID/secret.
7. [x] Real sign-in gate (no data visible while signed out).
   - `requiresSignIn` in `src/main.tsx` now renders a dedicated sign-in screen
     instead of the app shell whenever Supabase is configured and there is no
     session. Previously the full app rendered regardless of auth state.
8. [x] Admin page for role assignment.
   - New migration `012_admin_roles_and_user_directory.sql` adds `app_admins`
     and `app_known_users`, plus RLS letting admins read/write everyone's role
     in `app_user_roles`.
   - `AdminPage` component in `src/main.tsx`, nav item only visible to admins.
   - First admin must be bootstrapped manually via SQL (see Authentication/
     Roles section above) since there is no admin yet on a fresh database.
9. [x] Product catalog table and UI (initial version; see Phase 4 above for
   what's still missing: real image/datasheet uploads, and linking into a
   quote builder).
10. [ ] Sales quote builder shell.
11. [ ] Field photo offline queue.
12. [ ] Taskboard data model.
13. [ ] Basic PM task list view.
14. [ ] Real per-role permission enforcement (Phase 9) beyond the admin/
    non-admin split now in place.
15. [x] Nav redesign: top bar with dropdowns instead of a left sidebar
    (desktop and mobile).
16. [x] Real Ergon logo/favicon wired in; Admin moved out of the main tab row
    into the account dropdown menu.
17. [x] Pending-approval workflow, optional account expiration, and per-user
    tab permission overrides (migration `014`). See Authentication/Roles above
    for the full breakdown and the RLS caveat.
18. [ ] Email invite from the Admin page. Needs a new Vercel secret
    (`SUPABASE_SERVICE_ROLE_KEY`) and a serverless function — get E's
    explicit sign-off before adding this secret; it bypasses all RLS.
19a. [x] Task management (migration `015_tasks.sql`).
   - New "Tasks" nav tab, `TasksBoard` component in `src/main.tsx`, grouped by
     status (To Do / In Progress / Ready for Review / Done / Blocked) similar
     in spirit to a ClickUp task list, scoped down to what Ergon needed rather
     than a full clone.
   - Each task has a section (warehouse/purchasing/inventory/projects/sales/
     engineering/general), can be marked internal or tied to a specific
     project (`project_ref`, free-text pointer for the same reason
     `product_catalog.linked_reference` is free text — projects live in
     `app_records`, not a relational table, so a strict FK isn't reliable yet),
     priority, category, assignee email, due date, and optional "impact areas"
     tags (Inventory/Purchasing/Sales/Projects/Reports/Other).
   - Honest caveat: completing a task does NOT automatically trigger changes
     elsewhere in the app yet (e.g., marking a "reorder" task done does not
     create a purchase request). E asked for completions to "affect multiple
     aspects of the business" — the impact-area tags capture *intent* today,
     not automation. Real automation needs specific rules defined per impact
     type (what exactly should happen when an Inventory-tagged task is marked
     done?) before it can be built safely.
19. [ ] Receiving proof/photo flow for purchase requests.
20. [ ] Project document/media model cleanup (real Supabase Storage instead of
    browser-only references).
21. [ ] Inventory location/bin UI.

## Embedded Task/PM System (Aug 2026)

Built out the Tasks feature from a single global list into a lighter
ClickUp-style system, per E's request after seeing ClickUp's task board:

- New migration `019_team_roster.sql` adds a `team_members` table (full name,
  email, role title, active flag) so tasks can be assigned to anyone on a
  roster the Admin/Manager maintains directly -- no login required first.
  This is separate from the deferred email-invite feature (that's about app
  *access*; this is about naming someone as a task owner). **This migration
  still needs to be run in the Supabase SQL editor** -- it has NOT been
  applied yet.
- Task panels are now embedded directly in Purchasing, Inventory, Sales, and
  each individual project's detail page, each filtered to that section (or
  that project's ref) -- all reading/writing the same `tasks` table as the
  global Tasks tab, so nothing is duplicated and everything stays in sync.
- The Tasks tab itself gained List / Board (kanban) / Calendar views, plus a
  "group by" toggle (Status / Individual / Section) so work can be sliced by
  person or by group, not just status.
- The assignee field is now a real picker sourced from the roster instead of
  a free-text email box.

Not built yet (intentionally deferred, flagged as follow-up):
- Gantt view.
- Real task-to-task dependencies (task A blocks task B) -- today's
  `impact_areas` tags are informational only, same caveat as before.
- Automations tied to task completion.

### Ideas From Manufacturing/Procurement PM Research (Aug 2026)

Researched what standard manufacturing/procurement PM tools consider
must-have, to inform what to build next. Cross-referenced against what
Ergon Ops already has. Ranked roughly by how directly useful each is to this
business, not by how common it is in the source material.

1. **Automation rules engine** ("if stock < reorder point, auto-create
   purchase request"; "if task marked done, notify next assignee"; "if due
   date passes, alert the project lead"). This generalizes the
   already-built-but-manual reorder queue and gives real teeth to the
   existing (informational-only) task impact-area tags.
2. **BOM revision/version history.** BOM management is called out repeatedly
   as the #1 differentiator of manufacturing-specific tools. Today's project
   BOM lines are free text with no revision history -- worth a version log
   once Phase 10 gives BOM lines a real table.
3. **Quality/inspection checkpoints in the build workflow.** The existing
   build stages (planned/kitting/assembled/tested/complete) are a natural
   fit for adding a required QA sign-off gate plus defect/non-conformance
   logging at the "tested" stage.
4. **Client-facing status portal.** A read-only link for a property manager
   or GC to check their install's progress without full app access -- this
   is already Phase 8 in this roadmap ("Public Client Progress View"),
   unbuilt; the research confirms it's a standard, valuable feature.
5. **Job costing: actual vs. estimate.** Projects track an `allocated`
   dollar figure but not a true budget-vs-actual reconciliation (material +
   labor + overhead against the original estimate) surfaced as margin.
6. **Overdue-task notifications.** Due dates exist but are silent today --
   no email/reminder when a task or purchase request passes its due date.
7. **Workload/capacity dashboard.** A "who's overloaded" view (open task
   count and overdue count per roster member) -- a natural extension of the
   "group by individual" view just built, fits the "very task driven by
   individuals and by groups" goal directly.
8. **Document version control with approval history** for project documents
   (SOW, BOM sheets, spec drawings) -- richer than today's simple status
   dropdown, with a real change history and sign-off trail.
9. **Field/job-site capture for on-site installs** (photos, notes, logs from
   the actual garage/lot site, not just the shop). This is already Phase 7
   in this roadmap ("Field Media Capture And Offline Mode"), unbuilt.
10. **Real per-role, server-enforced permissions.** Already scoped as Phase 9
    in this roadmap -- the research reinforces that UI-only role hiding is
    considered insufficient by standard PM-tool practice, not just an
    Ergon-specific gap.

Explicitly not recommended for this business's scale/type (noted so it isn't
re-suggested later): AI-driven predictive scheduling, digital twin process
simulation, CAD/PLM integration, ecommerce order intake, sustainability/
emissions tracking, full MES shop-floor IoT monitoring. These target larger
or different manufacturing contexts than Ergon's parking equipment
purchasing/build/install operation.

## Overnight Session Recap (Aug 2026) -- Start Here In The Morning

E asked me to burn through as much of the roadmap as possible overnight,
skip anything needing a decision, and recap in the morning. Here's exactly
what is and isn't actually working yet.

**What you need to do first: run migrations 016-025 in the Supabase SQL
editor, in numeric order.** None of tonight's SQL has been applied to the
database -- I have no way to execute SQL from this sandbox (confirmed: it
can't even resolve Supabase's hostname, network is allowlisted to a couple
of domains only). Every file was written, but paste-and-run is still a
manual step on your end, same as every migration before it. Run them in
order (016 through 025); several depend on earlier ones in that range.

**Fully built and working once those migrations are run:**
- Phase 15: in-app notification bell (top-right, next to account menu).
  Fires on task assignment and daily-deduped overdue tasks. Admin ->
  Notification Rules lets you toggle in-app on/off per event type right
  now; email/Slack columns are visible but disabled (greyed out) since
  those need a provider secret you haven't signed off on yet.
- Phase 16: workload strip at the top of the Tasks tab -- shows each
  active roster member's open/overdue count, click one to filter the board
  to just their work.
- Phase 11 (scheduling half): Admin -> Standard Install Times and Admin ->
  Project Schedule Templates are real, editable now. On a project's detail
  page, a "Generate Schedule" dropdown lets a PM pick a template and
  auto-create tasks, with due dates computed from BOM quantity x standard
  time per phase -- deterministic, no AI call, matches your decision.
  **This needs real standard-time numbers entered in Admin before it's
  useful** -- there's no way for me to know how long a camera install
  actually takes; that has to come from you or the PM team.

**Schema is ready, but the feature isn't usable yet (no UI built):**
- Phase 11 (Submittals half): the `project_submittals` table and the two
  public RPC functions (`get_submittal_by_token`, `respond_to_submittal`)
  exist so a client can review/approve without logging in, but there is no
  screen yet to create a submittal, send it, or for a client to actually
  open and respond to one. This is the biggest real gap from tonight --
  worth prioritizing next given it was your top request.

**Schema is ready, app still reads/writes the old JSON blob (Phase 10
a-f):** migrations 016-022 create/backfill real tables for purchase
requests, project documents, inventory items, equipment recipes,
movements/builds/allocations, and projects+BOM+SOW. Running them copies
today's data into those tables. But `persistence.ts` and `main.tsx` have
NOT been rewired to actually read/write those tables instead of
`app_records` -- the live app's behavior is unchanged tonight. Re-run the
relevant migration again right before doing the actual code cutover for
each entity, so the copy is fresh (blob data keeps changing as the app is
used in the meantime).

**Phase 9 (role RLS):** migration 023 writes real per-role policies
(warehouse/purchasing/pm write-gated on their tables, admin bypasses all).
Since the Phase 10 app-code cutover hasn't happened, these policies mostly
affect tables the live app doesn't touch yet -- they'll start mattering as
each Phase 10 entity gets cut over.

**Not touched tonight (would need a decision or a new secret first):**
email invites, email/Slack notification delivery, Gantt view, real task
dependencies, job costing, document version control, QA build checkpoints,
BOM revision history, and the actual Phase 10 app-code cutover.

## Next Session Priorities (start here)

In order:

1. Run migration `014_user_approval_and_tab_permissions.sql` in Supabase SQL
   Editor (it was written and pushed but not yet applied as of this session).
   Until it runs, every non-admin sign-in will see "Waiting for approval"
   indefinitely (fails closed, which is safe, but nobody except the bootstrapped
   admin can get in until the migration is applied).
2. Test the pending-approval flow end to end with a second account: sign up,
   confirm it lands on "Waiting for approval," then approve it from the Admin
   page as the admin account and confirm it gets in with the assigned role's
   default tabs.
3. Visually check the tightened pills/dropzones (`.action-status`,
   `.sales-dropzone`, `.upload-drop`) on both desktop and phone — sizing was
   adjusted based on a screenshot, not a live re-check, since this session
   cannot open a browser. Confirm they look right and are not now too cramped.
4. Decide on the email-invite feature (needs `SUPABASE_SERVICE_ROLE_KEY`) —
   see item 18 above.
5. Continue down the unchecked items above in whatever order matters most for
   the business (photo proof, document storage, bin UI, sales quote builder).

## Developer Guardrails

- Do not import or reuse anything from VLTD. This is a separate project.
- Do not globally repaint the UI without matching Ergon's current look.
- Keep screens compact and workflow-focused.
- Avoid huge cards and bloated pages.
- Put detailed workflows inside modals or project subviews instead of stacking
  everything on one page.
- Do not create destructive stock actions without a review/confirm step.
- Do not silently fake production behavior. If a backend/env dependency is
  missing, show a clear setup status.
- Keep mobile usability in mind for warehouse, receiving, and field capture.
- Retire records instead of renaming or deleting when history matters.
- Use ledger-first inventory logic: current stock can be a fast read, but history
  explains what happened.

## Production Setup Checklist

Before calling this production-ready for team use:

- [x] Supabase migrations `001` through `012` applied (Ergon project
      `hnjxvsxsxoowhegcqurf`).
- [x] Vercel env vars configured:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `OPENAI_API_KEY` if AI quote extraction is enabled (not yet configured)
  - `OPENAI_MODEL` optional
- [x] Supabase Auth enabled (email/password + Google OAuth).
- [ ] At least one owner/admin user created. Create the first real account
      through the app, then run the bootstrap SQL in the Authentication/Roles
      section above to make that account an admin.
- [ ] RLS reviewed for the current security stage. Role views (warehouse/
      purchasing/pm/manager) are still UI-only; only the admin/non-admin split
      is enforced at the database level so far.
- [x] Vercel production deployment verified.
- Mobile browser checks completed for:
  - Inventory
  - Equipment BOM modal
  - Project BOM modal
  - Receiving
  - Project document upload

## UI Design Rule (locked in per E, Aug 2026)

Pills, status banners, empty-state boxes, and notice bars must be sized to
their content, not stretched to fill the available row/column width. Several
existing panels (project "opened" banner, empty-state notices, upload
dropzones) are oversized and waste vertical/horizontal space. When doing UI
passes, tighten these down: padding should feel intentional, not like filler.
This applies sitewide, not just to the examples above.

## Deferred Idea: Change Order Uploads (Aug 2026)

The "Build Sales BOM and Scope" upload on a project's detail page was
intentionally shrunk (Aug 3 session) since it's realistically a one-time
setup step per project. E raised the idea of adding a separate upload path
for change orders after the initial quote, which would need its own flow
(so it doesn't overwrite the original scope/BOM). Not built yet — scope it
as its own feature when picked up.

## Known Risks

- Navigation moved from a left sidebar to a top bar with a horizontally
  scrollable tab row and a right-side account dropdown (`.top-nav` /
  `.nav-list` / `.account-menu*` in `src/styles.css`, header markup in
  `src/main.tsx`). This has not been checked on a real phone yet, only browser
  responsive mode. Verify the tab row scrolls cleanly and the account dropdown
  doesn't get clipped at very narrow widths.
- `src/main.tsx` is too large. Future work should gradually extract components
  without changing behavior.
- `app_records` is useful now but should not be the final long-term data layer.
- Image/file uploads need final storage decisions.
- Offline image capture needs IndexedDB or similar; localStorage is not enough
  for production media.
- Public project views must not use broad anonymous database access.
- Build/transfer actions need server-side transaction enforcement before heavy
  multi-user use.

## Good First Refactors

Refactor only when actively touching a feature:

- Move inventory components into `src/features/inventory/`.
- Move project components into `src/features/projects/`.
- Move reports into `src/features/reports/`.
- Move manufacturing/equipment builder into `src/features/manufacturing/`.
- Move shared modal/button/table helpers into `src/components/`.
- Keep behavior identical during extraction, then improve workflow after tests.

## Definition Of Done For Future Features

A feature is done only when:

- It has a real data path or a clearly labeled setup requirement.
- It persists through refresh.
- It has an obvious edit path.
- It has a visible history/audit path when it changes stock, cost, or project
  state.
- It works on desktop and mobile.
- It is pushed to GitHub.
- Vercel production deployment is verified.
