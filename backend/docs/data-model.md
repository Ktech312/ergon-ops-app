# Data Model

This backend starts with the operational records that matter most for purchasing,
inventory, and project reporting.

## Company Structure

`departments`

Stores configurable company sections such as Leadership, Engineering, Product
Management, Sales, Projects / Implementation, and Support Services.

`profiles`

Stores app users linked to Supabase Auth users.

## Projects

`projects`

Stores project names, customer names, dates, status, owner, budget fields, and
Google Drive folder links. `project_number` is the internal reference used on
screens, uploads, purchasing requests, and reports.

The project name is the reporting anchor for inventory transfers.

`project_documents`

Stores uploaded or linked files for a project, including sales quotes, SOWs,
BOMs, purchase orders, invoices, field photos, and other reference documents.
Production records can point to Google Drive folders or Supabase Storage paths.
Current app-side document records also track the local/browser document id,
project name, file size, storage status, and future Drive or Supabase storage
paths.

`sales_quote_extractions`

Stores the parsed result from a sales quote PDF. The raw file stays in
`project_documents`; this table keeps the extracted project fields, SOW, BOM,
confidence, parser mode, and review status so PM or Purchasing can correct it
before it becomes live purchasing data.

## Purchasing

`vendors`

Stores supplier information.

`purchase_orders`

Stores purchasing documents, status, vendor, requested-by user, approved-by user,
expected date, total cost, and external document links.

`purchase_order_lines`

Stores each item being purchased, quantity ordered, quantity received, unit cost,
and destination location.

## Inventory

`inventory_items`

Stores item/SKU master data.

`locations`

Stores warehouses, vans, job sites, staging areas, and project-specific locations.

`inventory_balances`

Stores current quantity by item and location.

`inventory_movements`

Append-only inventory ledger. Every receipt, adjustment, reservation, transfer,
project issue, or return should create a row here.

`inventory_transactions`

Groups related ledger rows into one business event such as a receiving event,
project transfer, manufactured build, stock adjustment, retirement, or undo.

`equipment_types`

Stores manufactured equipment definitions such as Enterprise VPU Server, VPU
Edge Box, and VPU Edge Box with Solar. Equipment types can be retired so past
build history remains intact without showing them as active choices.

`equipment_bom_components`

Stores the bill of materials for each manufactured equipment type.

`build_transactions`

Tracks finished equipment builds. A build consumes component SKU rows and creates
a finished manufactured equipment SKU. Build transactions can be marked undone
with reversal ledger rows.

`app_state_snapshots`

Legacy migration fallback used to read early app state. New production writes
use `app_records`.

`app_records`

Authenticated production persistence table. Each major app collection is stored
as its own record key, so inventory, projects, equipment recipes, movements,
purchase requests, project documents, and role mode can be audited and migrated
separately.

`app_user_roles`

Stores each signed-in user's active operational role view: Warehouse,
Purchasing, PM, or Manager. This keeps role selection user-specific instead of
sharing one global selector across the whole company.

`app_sync_events`

Auditable sync event log for imports, exports, and normalized production writes.

`app_transaction_locks`

Short-lived lock records for future multi-user stock actions. Use this before
posting receives, transfers, build consumption, adjustments, or retire/reactivate
actions so two users cannot modify the same SKU or build at the same time.

## Transfers To Project

`project_inventory_allocations`

Tracks inventory moved or allocated to a specific project. This supports reports
like "what materials went to Project A?" and "what projects used this item?"

`project_allocation_history`

Append-only history of project material actions. It stores SKU, item name,
project, movement, and action snapshots so reports remain readable even if
master records change later.

## Reporting Views

`report_inventory_on_hand`

Current inventory quantities by item and location.

`report_project_inventory_usage`

Inventory transferred or issued to each project.

`report_purchase_order_status`

Purchase order progress and received-vs-ordered quantities.

## Design Rule

The app should never directly overwrite inventory history. Current quantities can
be updated for fast reads, but the movement ledger is the source of truth for what
happened and why.
