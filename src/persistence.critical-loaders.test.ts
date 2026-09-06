import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadInventoryMovements, loadProjectDocuments } from "./persistence";

// E, via an audit request: "loadInventoryMovements currently returns []
// when the REST request fails, which makes a database or permission
// error look like an honest empty ledger." These tests exist to lock
// in the fix (throw on failure) and guard against it silently
// regressing back to swallowing errors -- covering the three states
// that actually matter: a real result, a genuinely empty result, and a
// failed request, which must never look like the empty case.

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("loadInventoryMovements", () => {
  // The "not configured" half of this same guard clause (env vars
  // missing) is exercised for real in production whenever Supabase
  // isn't set up yet -- not re-tested per-loader here since it would
  // need per-test env overrides that don't reliably reach a dynamic
  // `import.meta.env` lookup in this test setup (see vitest.config.ts).
  // This covers the other half of the same `||` guard.
  it("returns [] when there's no access token, without calling fetch", async () => {
    const rows = await loadInventoryMovements(undefined);
    expect(rows).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a successful response with real rows", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      {
        legacy_id: "m1",
        movement_type: "receipt",
        quantity: 5,
        balance_before: 0,
        balance_after: 5,
        reference_number: "PO-1",
        notes: "",
        created_at: "2026-01-01T00:00:00Z",
        performed_by_email: "e@x.com",
        inventory_item: { sku: "SKU1", item_name: "Widget" },
        project: null,
        build_transaction: null,
      },
    ]);
    const rows = await loadInventoryMovements("token");
    expect(rows).toHaveLength(1);
    expect(rows[0].sku).toBe("SKU1");
    expect(rows[0].type).toBe("receive");
  });

  it("returns [] for a genuinely empty successful result -- the real empty state", async () => {
    globalThis.fetch = mockFetchOnce(200, []);
    const rows = await loadInventoryMovements("token");
    expect(rows).toEqual([]);
  });

  it("throws (does not silently return []) when the request fails -- the real bug this was fixed for", async () => {
    globalThis.fetch = mockFetchOnce(400, {
      code: "42703",
      message: "column inventory_movements.performed_by_email does not exist",
    });
    await expect(loadInventoryMovements("token")).rejects.toThrow(/performed_by_email/);
  });
});

describe("loadProjectDocuments", () => {
  it("maps a successful response with real rows", async () => {
    globalThis.fetch = mockFetchOnce(200, [
      {
        id: "d1",
        project_name: "Project A",
        file_name: "quote.pdf",
        file_size_bytes: 1000,
        status: "Uploaded",
        document_type: "Sales Quote",
        storage_status: "Backed up",
        uploaded_at: "2026-01-01T00:00:00Z",
        uploaded_by_email: "e@x.com",
        file_url: "https://example.com/f.pdf",
        purchase_order_id: null,
        purchase_request_id: null,
      },
    ]);
    const rows = await loadProjectDocuments("token");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("quote.pdf");
  });

  it("returns [] for a genuinely empty successful result", async () => {
    globalThis.fetch = mockFetchOnce(200, []);
    const rows = await loadProjectDocuments("token");
    expect(rows).toEqual([]);
  });

  it("self-heals on a 400 (missing column) by retrying without it, not by silently returning []", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ code: "42703", message: "uploaded_by_email does not exist" }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "d1",
            project_name: "Project A",
            file_name: "quote.pdf",
            file_size_bytes: 1000,
            status: "Uploaded",
            document_type: "Sales Quote",
            storage_status: "Backed up",
            uploaded_at: "2026-01-01T00:00:00Z",
            file_url: "https://example.com/f.pdf",
          },
        ],
      });
    globalThis.fetch = fetchMock;
    const rows = await loadProjectDocuments("token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].uploadedByEmail).toBeFalsy();
  });

  it("throws when BOTH the primary request and the 400 fallback fail -- must not look like an empty document list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: "uploaded_by_email does not exist" }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: "internal error" }) });
    globalThis.fetch = fetchMock;
    await expect(loadProjectDocuments("token")).rejects.toThrow();
  });

  it("throws on a non-400 failure (e.g. a permissions error), not a silent []", async () => {
    globalThis.fetch = mockFetchOnce(403, { message: "permission denied" });
    await expect(loadProjectDocuments("token")).rejects.toThrow(/permission denied/);
  });
});
