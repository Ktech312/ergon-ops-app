// Phase 22: inventory automation regression test suite.
//
// IMPORTANT -- this cannot be run from the Cowork/agent sandbox this app is
// developed in. That sandbox cannot resolve Supabase's hostnames at all
// (confirmed: not just the Postgres pooler, the main REST/API domain too),
// and a run needs a service-role key, which should never be pasted into
// that sandbox in the first place (it bypasses every RLS policy in the
// database). Run this from your own machine or a CI runner instead, the
// same way you run migrations today.
//
// Setup:
//   npm install @supabase/supabase-js typescript ts-node @types/node --save-dev
//   export SUPABASE_URL="https://<your-project>.supabase.co"
//   export SUPABASE_SERVICE_ROLE_KEY="<service-role secret, from Supabase
//     project settings -- never commit this, never paste it into a chat or
//     agent sandbox>"
//   npx ts-node backend/tests/inventory-automation.test.ts
//
// What it checks: seeds one well-stocked and one scarce inventory item,
// creates a task with a hardware dependency on each, exercises the same
// allocate-or-queue decision Phase 21's `runTaskHardwareAutomation` makes
// client-side (well-stocked -> reserved, scarce -> a purchase request is
// queued), then asserts the resulting rows and cleans up everything it
// created -- on both success and failure.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment before running this script.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const TEST_SKU_STOCKED = "TEST-SKU-STOCKED";
const TEST_SKU_SCARCE = "TEST-SKU-SCARCE";

type Cleanup = () => Promise<void>;

async function main() {
  console.log("Phase 22: inventory automation regression test");
  const cleanups: Cleanup[] = [];
  let passed = 0;
  let failed = 0;

  function assertEqual(label: string, actual: unknown, expected: unknown) {
    if (actual === expected) {
      console.log(`  PASS: ${label}`);
      passed += 1;
    } else {
      console.error(`  FAIL: ${label} -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      failed += 1;
    }
  }

  try {
    // --- Seed inventory items -------------------------------------------
    const { data: stockedItem, error: stockedErr } = await supabase
      .from("inventory_items")
      .upsert({ sku: TEST_SKU_STOCKED, item_name: "Test Stocked Item", unit_of_measure: "each" }, { onConflict: "sku" })
      .select()
      .single();
    if (stockedErr) throw stockedErr;
    cleanups.push(async () => {
      await supabase.from("inventory_items").delete().eq("id", stockedItem.id);
    });

    const { data: scarceItem, error: scarceErr } = await supabase
      .from("inventory_items")
      .upsert({ sku: TEST_SKU_SCARCE, item_name: "Test Scarce Item", unit_of_measure: "each" }, { onConflict: "sku" })
      .select()
      .single();
    if (scarceErr) throw scarceErr;
    cleanups.push(async () => {
      await supabase.from("inventory_items").delete().eq("id", scarceItem.id);
    });

    const { data: location } = await supabase.from("locations").select("id").eq("name", "Main Warehouse").limit(1).single();
    if (!location) {
      throw new Error("Expected a 'Main Warehouse' location row (created by migration 018) -- run migrations first.");
    }

    await supabase.from("inventory_balances").upsert(
      [
        { inventory_item_id: stockedItem.id, location_id: location.id, quantity_on_hand: 50 },
        { inventory_item_id: scarceItem.id, location_id: location.id, quantity_on_hand: 1 },
      ],
      { onConflict: "inventory_item_id,location_id" },
    );

    // --- Seed tasks + dependencies ---------------------------------------
    const { data: taskStocked, error: taskStockedErr } = await supabase
      .from("tasks")
      .insert({ task_number: `TEST-${Date.now()}-A`, title: "Test task (stocked path)", section: "warehouse", status: "to_do" })
      .select()
      .single();
    if (taskStockedErr) throw taskStockedErr;
    cleanups.push(async () => {
      await supabase.from("tasks").delete().eq("id", taskStocked.id);
    });

    const { data: taskScarce, error: taskScarceErr } = await supabase
      .from("tasks")
      .insert({ task_number: `TEST-${Date.now()}-B`, title: "Test task (scarce path)", section: "warehouse", status: "to_do" })
      .select()
      .single();
    if (taskScarceErr) throw taskScarceErr;
    cleanups.push(async () => {
      await supabase.from("tasks").delete().eq("id", taskScarce.id);
    });

    await supabase.from("task_hardware_dependencies").insert([
      { task_id: taskStocked.id, inventory_item_id: stockedItem.id, quantity_required: 10 },
      { task_id: taskScarce.id, inventory_item_id: scarceItem.id, quantity_required: 10 },
    ]);
    cleanups.push(async () => {
      await supabase.from("task_hardware_dependencies").delete().in("task_id", [taskStocked.id, taskScarce.id]);
    });

    // --- Exercise the same decision Phase 21's client-side logic makes ---
    // (This script re-implements the decision directly against REST rather
    // than importing src/main.tsx's App-scoped closures, since those aren't
    // exported as standalone functions. Keep this in sync with
    // runTaskHardwareAutomation in src/main.tsx if that logic changes.)
    async function simulateAutomation(taskId: string, inventoryItemId: string, qtyRequired: number) {
      const { data: balances } = await supabase.from("inventory_balances").select("quantity_on_hand").eq("inventory_item_id", inventoryItemId);
      const onHand = (balances ?? []).reduce((sum, row) => sum + Number(row.quantity_on_hand), 0);
      const { data: dep } = await supabase.from("task_hardware_dependencies").select("id").eq("task_id", taskId).eq("inventory_item_id", inventoryItemId).single();
      if (!dep) return;
      if (onHand >= qtyRequired) {
        await supabase.from("inventory_balances").update({ quantity_on_hand: onHand - qtyRequired }).eq("inventory_item_id", inventoryItemId);
        await supabase.from("task_hardware_dependencies").update({ fulfillment_status: "allocated" }).eq("id", dep.id);
      } else {
        await supabase.from("purchase_requests").insert({
          request_number: `TEST-PR-${Date.now()}`,
          inventory_item_id: inventoryItemId,
          quantity_requested: qtyRequired,
          reason: "manual",
          source_type: "manual",
          procurement_track: "warehouse_stock",
          status: "draft",
        });
        await supabase.from("task_hardware_dependencies").update({ fulfillment_status: "procurement_queued" }).eq("id", dep.id);
      }
    }

    await simulateAutomation(taskStocked.id, stockedItem.id, 10);
    await simulateAutomation(taskScarce.id, scarceItem.id, 10);

    // --- Assertions --------------------------------------------------------
    const { data: stockedBalance } = await supabase.from("inventory_balances").select("quantity_on_hand").eq("inventory_item_id", stockedItem.id).single();
    assertEqual("stocked item balance decremented by 10", Number(stockedBalance?.quantity_on_hand), 40);

    const { data: stockedDep } = await supabase.from("task_hardware_dependencies").select("fulfillment_status").eq("task_id", taskStocked.id).single();
    assertEqual("stocked task dependency allocated", stockedDep?.fulfillment_status, "allocated");

    const { data: scarceDep } = await supabase.from("task_hardware_dependencies").select("fulfillment_status").eq("task_id", taskScarce.id).single();
    assertEqual("scarce task dependency procurement_queued", scarceDep?.fulfillment_status, "procurement_queued");

    const { data: createdPr } = await supabase.from("purchase_requests").select("id").eq("inventory_item_id", scarceItem.id).eq("quantity_requested", 10);
    assertEqual("purchase request created for scarce item", (createdPr ?? []).length > 0, true);
    if (createdPr) {
      cleanups.push(async () => {
        await supabase.from("purchase_requests").delete().in("id", createdPr.map((row) => row.id));
      });
    }
  } catch (error) {
    console.error("Test run threw an error:", error);
    failed += 1;
  } finally {
    console.log("Cleaning up seeded rows...");
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => {});
    }
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
