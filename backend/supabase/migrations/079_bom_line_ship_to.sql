-- Migration 079: Ship To on individual BOM lines. E: "signs, we ship
-- direct sometimes to the project and sometimes to the office but always
-- for a project" -- each material line needs its own ship-to destination,
-- not just a project-level default. Plain text snapshot, same convention
-- as purchase_orders.ship_to and project_shipments.address_snapshot -- not
-- an FK, so it survives even if the saved address it was picked from is
-- later edited or removed.

alter table project_bom_lines add column if not exists ship_to text;
