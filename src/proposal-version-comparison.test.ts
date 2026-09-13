import { describe, it, expect } from "vitest";
import { compareProposalSnapshots, type ProposalSnapshot } from "./persistence";

// Queue A5 (2026-09-12): read-only proposal-version comparison. These
// tests exercise the pure comparison function directly -- no DOM
// rendering, no persistence calls, no side effects of any kind. The
// comparison itself must never be confused with a certified legal
// document diff; that framing is enforced in the UI copy, not tested
// here (nothing here asserts UI text).

function makeSnapshot(overrides: Partial<ProposalSnapshot> = {}): ProposalSnapshot {
  return {
    companyName: "Ergon",
    companyLogoUrl: "https://example.test/logo.png",
    clientName: "Acme Co",
    siteName: "Main St Garage",
    city: "Chicago",
    quoteRef: "SQ-2026-0001",
    proposalSummary: "Initial proposal.",
    bom: [
      { item: "Camera A", qty: 2, notes: "", imageUrl: "", description: "Entry camera", manufacturer: "Acme", hasDatasheet: false, datasheetUrl: "" },
      { item: "Sign B", qty: 1, notes: "Wall mount", imageUrl: "", description: "", manufacturer: "", hasDatasheet: true, datasheetUrl: "https://example.test/sign-b.pdf" },
    ],
    templateSections: [
      { title: "Assumptions", body: "Standard assumptions." },
      { title: "Warranty", body: "One year warranty." },
    ],
    ...overrides,
  };
}

describe("compareProposalSnapshots -- identical versions", () => {
  it("reports no field changes and every BOM line/section as unchanged", () => {
    const snapshot = makeSnapshot();
    const result = compareProposalSnapshots(snapshot, makeSnapshot());
    expect(result.fieldChanges).toEqual({});
    expect(result.bomLines).toEqual([
      { kind: "unchanged", item: "Camera A" },
      { kind: "unchanged", item: "Sign B" },
    ]);
    expect(result.templateSections).toEqual([
      { kind: "unchanged", title: "Assumptions" },
      { kind: "unchanged", title: "Warranty" },
    ]);
  });
});

describe("compareProposalSnapshots -- added/removed sections and lines", () => {
  it("reports a section present only in the later version as added, and one only in the earlier version as removed", () => {
    const before = makeSnapshot({ templateSections: [{ title: "Assumptions", body: "Standard assumptions." }] });
    const after = makeSnapshot({ templateSections: [{ title: "Payment Terms", body: "Net 30." }] });
    const result = compareProposalSnapshots(before, after);
    expect(result.templateSections).toContainEqual({ kind: "removed", title: "Assumptions", before: { title: "Assumptions", body: "Standard assumptions." } });
    expect(result.templateSections).toContainEqual({ kind: "added", title: "Payment Terms", after: { title: "Payment Terms", body: "Net 30." } });
  });

  it("reports a BOM line present only in the later version as added, and one only in the earlier version as removed", () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      bom: [
        { item: "Camera A", qty: 2, notes: "", imageUrl: "", description: "Entry camera", manufacturer: "Acme", hasDatasheet: false, datasheetUrl: "" },
        { item: "New Sensor", qty: 3, notes: "", imageUrl: "", description: "", manufacturer: "", hasDatasheet: false, datasheetUrl: "" },
      ],
    });
    const result = compareProposalSnapshots(before, after);
    expect(result.bomLines).toContainEqual({ kind: "unchanged", item: "Camera A" });
    expect(result.bomLines.some((diff) => diff.kind === "removed" && diff.item === "Sign B")).toBe(true);
    expect(result.bomLines.some((diff) => diff.kind === "added" && diff.item === "New Sensor")).toBe(true);
  });
});

describe("compareProposalSnapshots -- changed values", () => {
  it("reports a field-level change with both the before and after value", () => {
    const before = makeSnapshot({ proposalSummary: "Draft summary." });
    const after = makeSnapshot({ proposalSummary: "Final summary." });
    const result = compareProposalSnapshots(before, after);
    expect(result.fieldChanges.proposalSummary).toEqual({ before: "Draft summary.", after: "Final summary." });
  });

  it("reports a changed BOM line with exactly the fields that actually changed", () => {
    const before = makeSnapshot();
    const after = makeSnapshot({
      bom: [
        { item: "Camera A", qty: 4, notes: "", imageUrl: "", description: "Entry camera", manufacturer: "Acme", hasDatasheet: false, datasheetUrl: "" },
        { item: "Sign B", qty: 1, notes: "Wall mount", imageUrl: "", description: "", manufacturer: "", hasDatasheet: true, datasheetUrl: "https://example.test/sign-b.pdf" },
      ],
    });
    const result = compareProposalSnapshots(before, after);
    const cameraDiff = result.bomLines.find((diff) => diff.item === "Camera A");
    expect(cameraDiff).toMatchObject({ kind: "changed", changedFields: ["qty"] });
  });

  it("reports a changed template section body", () => {
    const before = makeSnapshot();
    const after = makeSnapshot({ templateSections: [{ title: "Assumptions", body: "Revised assumptions." }, { title: "Warranty", body: "One year warranty." }] });
    const result = compareProposalSnapshots(before, after);
    expect(result.templateSections).toContainEqual({
      kind: "changed",
      title: "Assumptions",
      before: { title: "Assumptions", body: "Standard assumptions." },
      after: { title: "Assumptions", body: "Revised assumptions." },
    });
  });
});

describe("compareProposalSnapshots -- missing optional fields from older proposals", () => {
  it("does not throw and treats a missing companyName/companyLogoUrl as an empty-string comparison, not a crash", () => {
    const olderProposal: ProposalSnapshot = {
      clientName: "Acme Co",
      siteName: "Main St Garage",
      city: "Chicago",
      quoteRef: "SQ-2026-0001",
      proposalSummary: "Initial proposal.",
      bom: [],
      templateSections: [],
      // companyName/companyLogoUrl intentionally absent -- this proposal
      // was sent before that snapshot field existed.
    };
    const newerProposal = makeSnapshot();
    const result = compareProposalSnapshots(olderProposal, newerProposal);
    expect(result.fieldChanges.companyName).toEqual({ before: "", after: "Ergon" });
  });
});

// Queue C1.8 (2026-09-13): frozen Sales pricing (migration 136) extended
// compareProposalSnapshots with unitPrice/lineTotal (per BOM line) and
// subtotal/discountPercent/discountAmount/taxRate/taxAmount/grandTotal
// (top-level) -- these tests prove the extension, and that a proposal sent
// before pricing existed still compares cleanly against one sent after.
describe("compareProposalSnapshots -- pricing (Queue C1)", () => {
  it("reports a changed unitPrice/lineTotal on a BOM line", () => {
    const before = makeSnapshot({
      bom: [
        { item: "Camera A", qty: 2, notes: "", imageUrl: "", description: "Entry camera", manufacturer: "Acme", hasDatasheet: false, datasheetUrl: "", unitPrice: 100, lineTotal: 200 },
      ],
    });
    const after = makeSnapshot({
      bom: [
        { item: "Camera A", qty: 2, notes: "", imageUrl: "", description: "Entry camera", manufacturer: "Acme", hasDatasheet: false, datasheetUrl: "", unitPrice: 120, lineTotal: 240 },
      ],
    });
    const result = compareProposalSnapshots(before, after);
    const cameraDiff = result.bomLines.find((diff) => diff.item === "Camera A");
    expect(cameraDiff).toMatchObject({ kind: "changed", changedFields: expect.arrayContaining(["unitPrice", "lineTotal"]) });
  });

  it("reports changed subtotal/discountAmount/taxAmount/grandTotal as top-level field changes", () => {
    const before = makeSnapshot({ subtotal: 200, discountPercent: 0, discountAmount: 0, taxRate: 0, taxAmount: 0, grandTotal: 200 });
    const after = makeSnapshot({ subtotal: 200, discountPercent: 10, discountAmount: 20, taxRate: 8, taxAmount: 14.4, grandTotal: 194.4 });
    const result = compareProposalSnapshots(before, after);
    expect(result.fieldChanges.discountPercent).toEqual({ before: "0", after: "10" });
    expect(result.fieldChanges.discountAmount).toEqual({ before: "0", after: "20" });
    expect(result.fieldChanges.taxAmount).toEqual({ before: "0", after: "14.4" });
    expect(result.fieldChanges.grandTotal).toEqual({ before: "200", after: "194.4" });
    // subtotal itself is unchanged (200 both times) -- must NOT appear.
    expect(result.fieldChanges.subtotal).toBeUndefined();
  });

  it("compares a pre-pricing proposal against a priced one without crashing or inventing a false $0 diff", () => {
    const olderProposal: ProposalSnapshot = {
      clientName: "Acme Co",
      siteName: "Main St Garage",
      city: "Chicago",
      quoteRef: "SQ-2026-0001",
      proposalSummary: "Initial proposal.",
      bom: [{ item: "Camera A", qty: 2, notes: "", imageUrl: "", description: "", manufacturer: "", hasDatasheet: false, datasheetUrl: "" }],
      templateSections: [],
      // No pricing fields at all -- sent before migration 136.
    };
    const newerProposal = makeSnapshot({
      bom: [{ item: "Camera A", qty: 2, notes: "", imageUrl: "", description: "", manufacturer: "", hasDatasheet: false, datasheetUrl: "", unitPrice: 100, lineTotal: 200 }],
      subtotal: 200,
      grandTotal: 200,
    });
    expect(() => compareProposalSnapshots(olderProposal, newerProposal)).not.toThrow();
    const result = compareProposalSnapshots(olderProposal, newerProposal);
    // Missing -> present is a real, correctly-reported change (absence
    // compared as "", never treated as an equal-to-zero non-change).
    expect(result.fieldChanges.grandTotal).toEqual({ before: "", after: "200" });
    const cameraDiff = result.bomLines.find((diff) => diff.item === "Camera A");
    expect(cameraDiff).toMatchObject({ kind: "changed", changedFields: expect.arrayContaining(["unitPrice", "lineTotal"]) });
  });
});
