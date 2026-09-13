import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadInventoryItems } from "./persistence";

// Queue A12 (2026-09-12): loadInventoryItems used to issue one unbounded
// request, relying on the real inventory count never reaching whatever
// row cap PostgREST is configured with -- if it ever did, the load
// silently returned a truncated catalog with no error anywhere (Queue
// B6's pagination-design finding). Now fetches deterministic,
// non-overlapping 500-row pages until a short/empty final page. These
// tests cover the five cases the task named.

const PAGE_SIZE = 500;

function makeRow(overrides: Partial<{ id: string; item_name: string }> = {}) {
  return {
    id: "row-1",
    sku: "SKU-1",
    item_name: "Item",
    description: null,
    manufacturer: null,
    category: null,
    default_unit_cost: 0,
    reorder_point: 0,
    vendor_url: null,
    image_url: null,
    barcode_value: null,
    purchase_sources: null,
    price_history: null,
    inventory_tags: null,
    is_active: true,
    inventory_balances: [],
    track_reorder: false,
    ...overrides,
  };
}

function makeRows(count: number, startIndex = 0) {
  return Array.from({ length: count }, (_, i) => {
    const n = startIndex + i;
    return makeRow({ id: `row-${n}`, item_name: `Item ${String(n).padStart(5, "0")}` });
  });
}

function respond(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function offsetOf(url: string): number {
  const match = url.match(/offset=(\d+)/);
  return match ? Number(match[1]) : 0;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadInventoryItems -- 1. one short page (fewer than PAGE_SIZE rows)", () => {
  it("returns all rows from a single request and does not fetch a second page", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (input) => {
      calls.push(String(input));
      return respond(true, 200, makeRows(3));
    });
    const result = await loadInventoryItems("token");
    expect(result).toHaveLength(3);
    expect(calls).toHaveLength(1);
  });
});

describe("loadInventoryItems -- 2. multiple full pages plus a short final page", () => {
  it("fetches every page and concatenates all rows in order", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      const offset = offsetOf(url);
      if (offset === 0) return respond(true, 200, makeRows(PAGE_SIZE, 0));
      if (offset === PAGE_SIZE) return respond(true, 200, makeRows(PAGE_SIZE, PAGE_SIZE));
      if (offset === PAGE_SIZE * 2) return respond(true, 200, makeRows(120, PAGE_SIZE * 2));
      throw new Error(`Unexpected offset in test: ${url}`);
    });
    const result = await loadInventoryItems("token");
    expect(calls).toHaveLength(3);
    expect(result).toHaveLength(PAGE_SIZE * 2 + 120);
    expect(result[0].name).toBe("Item 00000");
    expect(result[result.length - 1].name).toBe(`Item ${String(PAGE_SIZE * 2 + 119).padStart(5, "0")}`);
  });
});

describe("loadInventoryItems -- 3. an exact-full-page boundary", () => {
  it("fetches one extra (empty) page rather than assuming a full page is the last one", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      const offset = offsetOf(url);
      if (offset === 0) return respond(true, 200, makeRows(PAGE_SIZE, 0));
      if (offset === PAGE_SIZE) return respond(true, 200, []);
      throw new Error(`Unexpected offset in test: ${url}`);
    });
    const result = await loadInventoryItems("token");
    expect(calls).toHaveLength(2);
    expect(result).toHaveLength(PAGE_SIZE);
  });
});

describe("loadInventoryItems -- 4. duplicate defense", () => {
  it("deduplicates by the row's real id when the same row appears on two pages", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (input) => {
      const url = String(input);
      const offset = offsetOf(url);
      if (offset === 0) {
        // Page 1 is a full page, and its LAST row also reappears as the
        // first row of page 2 -- simulates a row shifting across the
        // boundary between the two requests.
        return respond(true, 200, [...makeRows(PAGE_SIZE - 1, 0), makeRow({ id: "row-499", item_name: "Item 00499" })]);
      }
      if (offset === PAGE_SIZE) {
        return respond(true, 200, [makeRow({ id: "row-499", item_name: "Item 00499" }), makeRow({ id: "row-500", item_name: "Item 00500" })]);
      }
      throw new Error(`Unexpected offset in test: ${url}`);
    });
    const result = await loadInventoryItems("token");
    // 500 unique rows from page 1, plus exactly one NEW row from page 2
    // (row-500) -- row-499's duplicate is dropped, not counted twice.
    expect(result).toHaveLength(PAGE_SIZE + 1);
    expect(result.filter((item) => item.name === "Item 00499")).toHaveLength(1);
  });
});

describe("loadInventoryItems -- 5. a later-page failure", () => {
  it("throws instead of returning a partial catalog when a later page fails", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (input) => {
      const url = String(input);
      const offset = offsetOf(url);
      if (offset === 0) return respond(true, 200, makeRows(PAGE_SIZE, 0));
      if (offset === PAGE_SIZE) return respond(false, 500, { message: "db error" });
      throw new Error(`Unexpected offset in test: ${url}`);
    });
    await expect(loadInventoryItems("token")).rejects.toThrow("Could not load the full inventory catalog");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("loadInventoryItems: page 2 failed (500)"));
  });

  it("throws instead of returning [] when the very first page fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(loadInventoryItems("token")).rejects.toThrow("Could not load the full inventory catalog");
  });
});
