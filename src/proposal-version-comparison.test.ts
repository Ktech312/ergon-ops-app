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
