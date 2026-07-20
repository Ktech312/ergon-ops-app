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
The first MVP can store Google Drive URLs here; later Supabase Storage can hold
private file copies.

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

## Transfers To Project

`project_inventory_allocations`

Tracks inventory moved or allocated to a specific project. This supports reports
like "what materials went to Project A?" and "what projects used this item?"

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
