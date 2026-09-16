import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadInventoryItemsPage, type InventoryItemsPageFilters } from "./persistence";

// Inventory pagination (2026-09-16, PRODUCT_INVENTORY_PAGINATION_DESIGN.md,
// Queue R1 item 2): loadInventoryItemsPage is a SECOND, independent data
// source used only by the Inventory page's own table -- these tests lock
// in the query-construction contract (field-by-field filters matching the
// real filter bar, the tab->category mapping, cursor encode/decode) since
// there's no live database to verify PostgREST's actual query semantics
// against in this environment.

function makeRow(overrides: Partial<{ id: string; item_name: string; sku: string }> = {}) {
  return {
    id: "row-1",
    sku: "SKU-1",
    item_name: "Item",
    description: null,
    manufacturer: null,
    category: "Base",
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

function respond(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const baseFilters: InventoryItemsPageFilters = {
  ref: "",
  part: "",
  manufacturer: "",
  category: "All",
  tag: "All",
  tab: "parts",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("loadInventoryItemsPage", () => {
  it("returns an empty page with no fetch when no access token is available", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const result = await loadInventoryItemsPage(baseFilters, null, 50, undefined);
    expect(result).toEqual({ items: [], nextCursor: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps rows and returns null nextCursor when fewer rows than pageSize come back", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, [makeRow({ id: "a", item_name: "Alpha" })]));
    globalThis.fetch = fetchMock;
    const result = await loadInventoryItemsPage(baseFilters, null, 50, "token");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ ref: "SKU-1", name: "Alpha" });
    expect(result.nextCursor).toBeNull();
  });

  it("returns a non-null nextCursor when exactly pageSize rows come back", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, [makeRow({ id: "a", item_name: "Alpha" }), makeRow({ id: "b", item_name: "Bravo" })]));
    globalThis.fetch = fetchMock;
    const result = await loadInventoryItemsPage(baseFilters, null, 2, "token");
    expect(result.nextCursor).not.toBeNull();
  });

  it("throws on a failed request (never silently returns an empty page)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    globalThis.fetch = fetchMock;
    await expect(loadInventoryItemsPage(baseFilters, null, 50, "token")).rejects.toThrow();
  });

  it("maps the tab to the correct category constraint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, []));
    globalThis.fetch = fetchMock;

    await loadInventoryItemsPage({ ...baseFilters, tab: "parts" }, null, 50, "token");
    expect(String(fetchMock.mock.calls[0][0])).toContain("category=neq.Build");

    await loadInventoryItemsPage({ ...baseFilters, tab: "finished" }, null, 50, "token");
    expect(String(fetchMock.mock.calls[1][0])).toContain("category=eq.Build");
  });

  it("adds ilike filters for ref/part/manufacturer only when non-empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, []));
    globalThis.fetch = fetchMock;

    await loadInventoryItemsPage({ ...baseFilters, ref: "sku-123" }, null, 50, "token");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("sku=ilike.");
    expect(url).not.toContain("or=(item_name.ilike");

    await loadInventoryItemsPage({ ...baseFilters, part: "widget" }, null, 50, "token");
    const url2 = String(fetchMock.mock.calls[1][0]);
    expect(url2).toContain("or=(item_name.ilike");
    expect(url2).toContain("description.ilike");
  });

  it("adds an exact category filter and a tag array-contains filter when set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, []));
    globalThis.fetch = fetchMock;
    await loadInventoryItemsPage({ ...baseFilters, category: "Power", tag: "critical" }, null, 50, "token");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("category=eq.Power");
    expect(url).toContain("inventory_tags=cs.");
  });

  it("round-trips a cursor: the next page's request carries the previous page's last row", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(true, 200, [makeRow({ id: "a", item_name: "Alpha" }), makeRow({ id: "b", item_name: "Bravo" })]));
    globalThis.fetch = fetchMock;
    const page1 = await loadInventoryItemsPage(baseFilters, null, 2, "token");
    expect(page1.nextCursor).not.toBeNull();

    fetchMock.mockResolvedValueOnce(respond(true, 200, [makeRow({ id: "c", item_name: "Charlie" })]));
    await loadInventoryItemsPage(baseFilters, page1.nextCursor, 2, "token");
    const url = String(fetchMock.mock.calls[1][0]);
    // Encodes the (item_name, id) of the last row on page 1 ("Bravo"/"b").
    expect(url).toContain("and=(item_name.gt.");
    expect(decodeURIComponent(url)).toContain("Bravo");
  });
});
