import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  updateSalesQuoteInfo,
  updateFormSchemaField,
  updateSiteHardwareRule,
  updateVendor,
  updateSalesQuoteBomLineCatalogLink,
  updateSalesQuoteBomLine,
  deleteSalesQuoteBomLinesByLocationSource,
  ensureTeamMemberForSelf,
} from "./persistence";

// Overnight autonomous pass, task 2 (2026-09-11): a fresh re-read of the
// remaining PRODUCT_ERROR_VISIBILITY_AUDIT.md §A2.2a findings confirmed
// these seven were safe to fix mechanically tonight -- each already has
// (or was given, in the exact same pass, matching an existing sibling
// pattern already used elsewhere in the same file) a caller with a real,
// visible error channel, and none needed an optimistic-array-rollback or
// delete-and-reinsert redesign to get there. Deliberately NOT covered
// here (left as documented, undecided findings per the audit doc):
// updateProjectLedgerInfo, updateTaskHardwareDependencyStatus,
// updateSalesQuoteLocation/Item, updateProjectLocation/Item,
// markNotificationRead/markAllNotificationsRead, and the four message-
// reaction toggles -- every one of those either has no safe caller path
// yet or would need a caller-side design decision this pass's boundaries
// explicitly ruled out attempting overnight.

function respond(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("updateSalesQuoteInfo", () => {
  it("throws a plain message and logs detail when the PATCH fails outright", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateSalesQuoteInfo("quote-1", { clientName: "Acme" }, "token")).rejects.toThrow("Could not save this change.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateSalesQuoteInfo failed for quote quote-1 (500)"));
  });

  it("throws when the PATCH returns 200 OK but affects zero rows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(updateSalesQuoteInfo("quote-1", { clientName: "Acme" }, "token")).rejects.toThrow("Could not save this change.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("affected 0 rows for quote quote-1"));
  });

  it("does not throw when a row is genuinely affected", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ id: "quote-1" }]));
    await expect(updateSalesQuoteInfo("quote-1", { clientName: "Acme" }, "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("updateFormSchemaField", () => {
  it("throws a plain message and logs detail when the PATCH fails outright", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateFormSchemaField("field-1", { label: "New label" }, "token")).rejects.toThrow("Could not save this change.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateFormSchemaField failed for field field-1 (500)"));
  });

  it("throws when the PATCH returns 200 OK but affects zero rows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(updateFormSchemaField("field-1", { label: "New label" }, "token")).rejects.toThrow("Could not save this change.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("affected 0 rows for field field-1"));
  });

  it("does not throw when a row is genuinely affected", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ id: "field-1" }]));
    await expect(updateFormSchemaField("field-1", { label: "New label" }, "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("updateSiteHardwareRule", () => {
  it("throws a plain message and logs detail when the PATCH fails outright", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateSiteHardwareRule("rule-1", { notes: "updated" }, "token")).rejects.toThrow("Could not save this change.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateSiteHardwareRule failed for rule rule-1 (500)"));
  });

  it("throws when the PATCH returns 200 OK but affects zero rows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(updateSiteHardwareRule("rule-1", { notes: "updated" }, "token")).rejects.toThrow("Could not save this change.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("affected 0 rows for rule rule-1"));
  });

  it("does not throw when a row is genuinely affected", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ id: "rule-1" }]));
    await expect(updateSiteHardwareRule("rule-1", { notes: "updated" }, "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("updateVendor", () => {
  it("throws a plain message and logs detail when the PATCH fails outright", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateVendor("vendor-1", { name: "New Name" }, "token")).rejects.toThrow("Could not save this change.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateVendor failed for vendor vendor-1 (500)"));
  });

  it("throws when the PATCH returns 200 OK but affects zero rows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(updateVendor("vendor-1", { name: "New Name" }, "token")).rejects.toThrow("Could not save this change.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("affected 0 rows for vendor vendor-1"));
  });

  it("does not throw when a row is genuinely affected", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ id: "vendor-1" }]));
    await expect(updateVendor("vendor-1", { name: "New Name" }, "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("updateSalesQuoteBomLineCatalogLink", () => {
  it("throws a plain message and logs detail when the PATCH fails outright", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateSalesQuoteBomLineCatalogLink("line-1", "item-1", "token")).rejects.toThrow("Could not save this change.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateSalesQuoteBomLineCatalogLink failed for line line-1 (500)"));
  });

  it("throws when the PATCH returns 200 OK but affects zero rows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(updateSalesQuoteBomLineCatalogLink("line-1", "item-1", "token")).rejects.toThrow("Could not save this change.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("affected 0 rows for line line-1"));
  });

  it("does not throw when a row is genuinely affected, including clearing the link (null)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ id: "line-1" }]));
    await expect(updateSalesQuoteBomLineCatalogLink("line-1", null, "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("updateSalesQuoteBomLine", () => {
  it("updates item, quantity, notes, and catalog link in one checked write", async () => {
    const savedRow = {
      id: "line-1",
      quote_id: "quote-1",
      item_name: "Camera",
      qty: 3,
      notes: "North entrance",
      line_sort: 0,
      catalog_item_id: "item-1",
      source_location_id: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, [savedRow]));
    globalThis.fetch = fetchMock;

    await expect(updateSalesQuoteBomLine("line-1", { item: " Camera ", qty: 3, notes: " North entrance ", catalogItemId: "item-1" }, "token"))
      .resolves.toMatchObject({ id: "line-1", item: "Camera", qty: 3, notes: "North entrance", catalogItemId: "item-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      item_name: "Camera",
      qty: 3,
      notes: "North entrance",
      catalog_item_id: "item-1",
    });
  });

  it("rejects invalid input before making a request", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(updateSalesQuoteBomLine("line-1", { item: " ", qty: 0, notes: "", catalogItemId: null }, "token"))
      .rejects.toThrow("Enter an item name and a quantity greater than zero.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs technical detail and throws plain text when the write fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "constraint detail" }));
    await expect(updateSalesQuoteBomLine("line-1", { item: "Camera", qty: 1, notes: "", catalogItemId: null }, "token"))
      .rejects.toThrow("Could not save this BOM line.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateSalesQuoteBomLine failed for line line-1 (500)"));
  });

  it("rejects a successful response that did not update exactly one row", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(updateSalesQuoteBomLine("line-1", { item: "Camera", qty: 1, notes: "", catalogItemId: null }, "token"))
      .rejects.toThrow("Could not save this BOM line.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("affected 0 rows for line line-1; expected exactly 1"));
  });
});

describe("deleteSalesQuoteBomLinesByLocationSource", () => {
  it("throws a plain message and logs detail when the DELETE fails outright", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(deleteSalesQuoteBomLinesByLocationSource("quote-1", "token")).rejects.toThrow("Could not update the Quote BOM.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("deleteSalesQuoteBomLinesByLocationSource failed for quote quote-1 (500)"));
  });

  it("does not throw on a successful delete", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    await expect(deleteSalesQuoteBomLinesByLocationSource("quote-1", "token")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("ensureTeamMemberForSelf -- logging only, stays best-effort", () => {
  it("does not throw when the lookup fails (stays best-effort)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, {}));
    await expect(ensureTeamMemberForSelf("e@x.com", "E X", "token")).resolves.toBeUndefined();
  });

  it("logs when the lookup fails, makes exactly one request, and never attempts the insert", async () => {
    // Correction (2026-09-11, review): a failed lookup used to fall through
    // to the INSERT anyway -- once the lookup itself failed, the function
    // has no idea whether the member already exists, so proceeding risked
    // a duplicate row. This locks in the fix: exactly one request, no
    // second (insert) request ever made.
    const fetchMock = vi.fn().mockResolvedValue(respond(false, 500, {}));
    globalThis.fetch = fetchMock;
    await ensureTeamMemberForSelf("e@x.com", "E X", "token");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("team_members lookup failed for e@x.com (500)"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs when the insert fails instead of vanishing silently", async () => {
    let call = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      call += 1;
      return call === 1 ? respond(true, 200, []) : respond(false, 500, {});
    });
    await ensureTeamMemberForSelf("e@x.com", "E X", "token");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("team_members insert failed for e@x.com (500)"));
  });

  it("does not log anything when the person already exists (no insert attempted)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ id: "member-1" }]));
    await ensureTeamMemberForSelf("e@x.com", "E X", "token");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not throw on a network failure and still logs it", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(ensureTeamMemberForSelf("e@x.com", "E X", "token")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("ensureTeamMemberForSelf network error for e@x.com:"), expect.any(Error));
  });
});
