import { describe, it, expect, beforeEach, vi } from "vitest";
import { computeProposalTotals, addSalesQuoteBomLines, loadSalesQuotes } from "./persistence";

// Queue C1 (2026-09-13, migration 136): frozen Sales pricing. Covers the
// pieces not already exercised by proposal-version-comparison.test.ts
// (compareProposalSnapshots) or task2-unchecked-write-fixes.test.ts
// (updateSalesQuoteBomLine) -- the shared totals math, addSalesQuoteBomLines'
// price pass-through, and mapSalesQuoteRow/mapSalesQuoteBomLineRow reading
// the new columns back correctly.

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

describe("computeProposalTotals -- rounding and math", () => {
  it("computes line totals, subtotal, discount, tax, and grand total for a simple case", () => {
    const result = computeProposalTotals([{ unitPrice: 100, qty: 2 }, { unitPrice: 50, qty: 1 }], 10, 8);
    expect(result.lineTotals).toEqual([200, 50]);
    expect(result.subtotal).toBe(250);
    expect(result.discountAmount).toBe(25); // 10% of 250
    expect(result.taxAmount).toBe(18); // 8% of (250 - 25) = 18
    expect(result.grandTotal).toBe(243); // 250 - 25 + 18
  });

  it("returns zero totals for an empty line list", () => {
    const result = computeProposalTotals([], 10, 8);
    expect(result.lineTotals).toEqual([]);
    expect(result.subtotal).toBe(0);
    expect(result.discountAmount).toBe(0);
    expect(result.taxAmount).toBe(0);
    expect(result.grandTotal).toBe(0);
  });

  it("applies no discount/tax when both are zero -- grand total equals subtotal exactly", () => {
    const result = computeProposalTotals([{ unitPrice: 33.33, qty: 3 }], 0, 0);
    expect(result.subtotal).toBe(99.99);
    expect(result.discountAmount).toBe(0);
    expect(result.taxAmount).toBe(0);
    expect(result.grandTotal).toBe(99.99);
  });

  it("rounds each stage to the cent so subtotal/discount/tax always sum to the displayed grand total", () => {
    // Chosen to produce a real third-decimal-place value if left unrounded
    // at intermediate stages (0.1 + 0.2-style floating point risk).
    const result = computeProposalTotals([{ unitPrice: 10.005, qty: 1 }], 33.33, 12.5);
    const recomputedTotal = Math.round((result.subtotal - result.discountAmount + result.taxAmount) * 100) / 100;
    expect(result.grandTotal).toBe(recomputedTotal);
  });

  it("never computes or returns anything cost/margin-shaped -- only price-derived fields", () => {
    const result = computeProposalTotals([{ unitPrice: 100, qty: 1 }], 0, 0);
    expect(Object.keys(result).sort()).toEqual(["discountAmount", "grandTotal", "lineTotals", "subtotal", "taxAmount"]);
  });
});

describe("addSalesQuoteBomLines -- price pass-through", () => {
  it("sends unit_price/price_source for each line when the caller provides them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respond(true, 200, [
        { id: "line-1", quote_id: "quote-1", item_name: "Camera", qty: 1, notes: null, line_sort: 0, catalog_item_id: "item-1", source_location_id: null, unit_price: 250, price_source: "catalog_default", price_overridden_by: null, price_overridden_at: null },
      ]),
    );
    globalThis.fetch = fetchMock;
    const result = await addSalesQuoteBomLines("quote-1", [{ item: "Camera", qty: 1, catalogItemId: "item-1", unitPrice: 250, priceSource: "catalog_default" }], 0, "token");
    expect(result[0]).toMatchObject({ unitPrice: 250, priceSource: "catalog_default" });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body[0]).toMatchObject({ unit_price: 250, price_source: "catalog_default" });
  });

  it("defaults to 0/manual_override when the caller omits price entirely (a free-text line with no catalog default)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respond(true, 200, [
        { id: "line-1", quote_id: "quote-1", item_name: "Travel", qty: 1, notes: null, line_sort: 0, catalog_item_id: null, source_location_id: null, unit_price: 0, price_source: "manual_override", price_overridden_by: null, price_overridden_at: null },
      ]),
    );
    globalThis.fetch = fetchMock;
    await addSalesQuoteBomLines("quote-1", [{ item: "Travel", qty: 1 }], 0, "token");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body[0]).toMatchObject({ unit_price: 0, price_source: "manual_override" });
  });
});

describe("loadSalesQuotes -- reads discount_percent/tax_rate and BOM line pricing back", () => {
  it("maps quote-level and line-level pricing fields from the real column names", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, [
        {
          id: "quote-1", quote_ref: "SQ-2026-0001", client_name: "Acme", site_name: "Main St", city: "Chicago",
          created_by_email: "sales@ergon.test", created_at: "2026-01-01T00:00:00.000Z", closed_at: null, status: "open",
          client_email: "", proposal_summary: "", contact_full_name: "", contact_phone: "", preferred_communication: "",
          site_street_address: "", site_state: "", site_zip: "", client_street_address: "", client_city: "", client_state: "", client_zip: "",
          saas_type: "", saas_contract_amount: null, saas_billing_frequency: "", sale_amount: null,
          discount_percent: 15, tax_rate: 7.25,
          sales_quote_locations: [],
          sales_quote_bom_lines: [
            { id: "line-1", quote_id: "quote-1", item_name: "Camera", qty: 2, notes: null, line_sort: 0, catalog_item_id: "item-1", source_location_id: null, unit_price: 199.99, price_source: "catalog_default", price_overridden_by: null, price_overridden_at: null },
          ],
        },
      ]),
    );
    const [quote] = await loadSalesQuotes("token");
    expect(quote.discountPercent).toBe(15);
    expect(quote.taxRate).toBe(7.25);
    expect(quote.bomLines[0]).toMatchObject({ unitPrice: 199.99, priceSource: "catalog_default" });
  });

  it("defaults discountPercent/taxRate to 0 when the columns are null (a row that predates this feature, before backfill)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, [
        {
          id: "quote-1", quote_ref: "SQ-2026-0001", client_name: "Acme", site_name: "Main St", city: "Chicago",
          created_by_email: "sales@ergon.test", created_at: "2026-01-01T00:00:00.000Z", closed_at: null, status: "open",
          client_email: "", proposal_summary: "", contact_full_name: "", contact_phone: "", preferred_communication: "",
          site_street_address: "", site_state: "", site_zip: "", client_street_address: "", client_city: "", client_state: "", client_zip: "",
          saas_type: "", saas_contract_amount: null, saas_billing_frequency: "", sale_amount: null,
          discount_percent: null, tax_rate: null,
          sales_quote_locations: [],
          sales_quote_bom_lines: [],
        },
      ]),
    );
    const [quote] = await loadSalesQuotes("token");
    expect(quote.discountPercent).toBe(0);
    expect(quote.taxRate).toBe(0);
  });
});
