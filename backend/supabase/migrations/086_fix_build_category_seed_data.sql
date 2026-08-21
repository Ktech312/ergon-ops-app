-- Migration 086: data correction, not a schema change.
--
-- E: "these aren't Manufactured Equipment - the only thing that would
-- fall under manufactured are item[s] in image 2" (Enterprise VPU
-- Server, VPU Edge Box, VPU Edge Box with Solar).
--
-- category = 'Build' is supposed to mark an item as the finished OUTPUT
-- of a build recipe (see main.tsx: the Build system looks up a recipe's
-- own stock via inventoryItems.find(item => item.name === recipe.outputName
-- && item.category === 'Build'), and the "Finished Manufactured
-- Equipment" tab filters on the same field). These 13 SKUs are raw BOM
-- components that go INTO an "Enterprise VPU Server" build -- chassis,
-- motherboard, CPU, RAM, GPU, drives, PSU, cooler, cables, PiKVM -- not
-- finished items themselves. They were seeded with category: 'Build'
-- from the start (see the hardcoded seed array near the top of
-- main.tsx, the likely source of the original Supabase import).
--
-- This never affected the Build system's own math -- component
-- consumption matches by item name, not category -- it only affected
-- which items showed up in the "finished equipment" tab/filter.
--
-- Category picks below are a reasonable default, not load-bearing --
-- nothing else in the app keys off these specific values. Freely
-- re-pick any of them later via that item's Edit Item -> Category
-- dropdown if a different bucket fits better.

update inventory_items set category = 'Base' where sku in (
  'SKU-0020', -- 2U Server Chassis
  'SKU-0021', -- Z890 Motherboard
  'SKU-0022', -- Intel Core Ultra 7 CPU
  'SKU-0023', -- Memory/RAM
  'SKU-0024', -- Nvidia RTX5070 GPU
  'SKU-0025', -- Samsung 990 Pro SSD
  'SKU-0026', -- Seagate 3.5in Drive
  'SKU-0028', -- CPU Cooler
  'SKU-0029', -- PCIe Ribbon Cable
  'SKU-0030', -- Fan Extension Cable
  'SKU-0032'  -- HDMI for PiKVM
);

update inventory_items set category = 'Power' where sku = 'SKU-0027'; -- Corsair RMx Series Power (already tagged "Power Part")
update inventory_items set category = 'Communications' where sku = 'SKU-0031'; -- PiKVM Mini V4 (remote KVM over network)
