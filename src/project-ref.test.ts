import { describe, it, expect } from "vitest";
import { computeNextProjectRef } from "./persistence";

// Fixed 2026-09-08: nextProjectRef() (main.tsx) used to hardcode the
// literal year 2026 in both its match pattern and generated prefix, so it
// would have kept minting "PRJ-2026-####" forever after the calendar
// rolled over to 2027 instead of starting a fresh sequence, the same class
// of bug the real server-side quote_ref counter (migration 066) already
// avoids by deriving its year from extract(year from now()). These tests
// pin the year-boundary behavior via the extracted pure function so this
// can't silently regress again.
describe("computeNextProjectRef", () => {
  it("preserves current 2026 behavior: continues an existing 2026 sequence", () => {
    const refs = ["PRJ-2026-0001", "PRJ-2026-0002", "PRJ-2026-0005"];
    expect(computeNextProjectRef(refs, 2026)).toBe("PRJ-2026-0006");
  });

  it("starts a fresh 0001 sequence for a year with no existing refs (e.g. the first ref ever created)", () => {
    expect(computeNextProjectRef([], 2026)).toBe("PRJ-2026-0001");
  });

  it("year-boundary: rolls over to a fresh 0001 sequence for 2027 even though 2026 refs already exist, instead of continuing 2026's numbering or staying stuck on 2026", () => {
    const refs = ["PRJ-2026-0001", "PRJ-2026-0002", "PRJ-2026-0099"];
    expect(computeNextProjectRef(refs, 2027)).toBe("PRJ-2027-0001");
  });

  it("year-boundary: once 2027 refs exist, continues 2027's own sequence and ignores 2026 refs entirely", () => {
    const refs = ["PRJ-2026-0099", "PRJ-2027-0001", "PRJ-2027-0002"];
    expect(computeNextProjectRef(refs, 2027)).toBe("PRJ-2027-0003");
  });

  it("ignores refs that don't match the PRJ-<year>-#### shape at all (e.g. a manually renamed or malformed ref)", () => {
    const refs = ["PRJ-2026-0003", "not-a-ref", "PRJ-2025-0999"];
    expect(computeNextProjectRef(refs, 2026)).toBe("PRJ-2026-0004");
  });
});
