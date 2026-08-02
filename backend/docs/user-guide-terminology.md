# Ergon User Guide Terminology

Use these labels consistently across the app, reports, and future user guide.

## Core Reference Numbers

| Label | Meaning | Use it for | Example |
| --- | --- | --- | --- |
| SKU | Stock Keeping Unit | Inventory item master records: parts, components, stocked materials, and standard purchasable items. | SKU-0001 |
| PO | Purchase Order | Vendor orders and purchasing documents. | PO-0001 |
| PRJ | Project | Customer/site project records. | PRJ-2026-0001 |
| BLD | Build | Internal device builds or finished assemblies created from component inventory. | BLD-0001 |
| TXN | Transaction | Inventory movement/history records, transfers, receives, adjustments, and build consumption. | TXN-0001 |
| LOT | Lot | Received batches of the same SKU, when batch tracking is needed. | LOT-0001 |
| SERIAL | Serial Number | Individual serialized devices, servers, VPUs, cameras, or other assets that need unit-level tracking. | SERIAL-0001 |

## Decisions Locked In

- Use `SKU`, not `INV`, for inventory items because `INV` can read as invoice.
- Use `BLD` for the internal build record, not the component part number.
- Use `TXN` for inventory movement history once movement tracking is expanded.
- Keep `PRJ-2026-0001` style project numbers for now.
- Purchase documents should use `PO`.

## Practical Examples

- A `Z890 Motherboard` is a SKU because it is a stocked purchasable part.
- An `Enterprise VPU Server` build can have a BLD number because it is assembled internally.
- Moving one motherboard from inventory into a VPU build should create a TXN record later.
- Receiving ten motherboards from a PO can create a LOT record later if batch tracking matters.
- A finished VPU that needs individual lifecycle tracking can also receive a SERIAL number.
