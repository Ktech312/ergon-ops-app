import { describe, it, expect, vi } from "vitest";
import { runClosedWonConversionFlow, buildProjectConversionStatusMessage } from "./quote-conversion-flow";
import type { ProjectConversionOutcome, ProjectSite } from "./persistence";

function makeProject(overrides: Partial<ProjectSite> = {}): ProjectSite {
  return { name: "Acme Garage", ref: "PRJ-0001", ...overrides } as unknown as ProjectSite;
}

// Migration 127's create_project_from_quote() RPC requires the database's
// own sales_quotes.status to already be 'closed_won'. The old
// handleStatusChange called onUpdateStatus() without awaiting it, so it
// could show the "Create Project?" prompt and call the RPC before the
// status write had even landed -- or after it had silently failed
// (handleUpdateSalesQuoteStatus swallowed the error and never told the
// caller). These tests lock in the fixed sequencing: the status update
// must resolve, and report true, before the prompt or the conversion ever
// runs.

describe("runClosedWonConversionFlow", () => {
  it("does not prompt or convert while the status update is still pending (delayed update)", async () => {
    let resolveUpdate!: (value: boolean) => void;
    const updateStatus = vi.fn(() => new Promise<boolean>((resolve) => { resolveUpdate = resolve; }));
    const confirmCreateProject = vi.fn(() => true);
    const createProject = vi.fn().mockResolvedValue(undefined);

    const flowPromise = runClosedWonConversionFlow({ nextStatus: "closed_won", updateStatus, confirmCreateProject, createProject });

    // Still pending -- neither the prompt nor the RPC should have fired yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(confirmCreateProject).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();

    resolveUpdate(true);
    await flowPromise;

    expect(confirmCreateProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledTimes(1);
  });

  it("does not prompt or convert when the status update fails", async () => {
    const updateStatus = vi.fn().mockResolvedValue(false);
    const confirmCreateProject = vi.fn(() => true);
    const createProject = vi.fn().mockResolvedValue(undefined);

    await runClosedWonConversionFlow({ nextStatus: "closed_won", updateStatus, confirmCreateProject, createProject });

    expect(updateStatus).toHaveBeenCalledTimes(1);
    expect(confirmCreateProject).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("prompts and converts once the status update resolves true for a closed_won transition", async () => {
    const updateStatus = vi.fn().mockResolvedValue(true);
    const confirmCreateProject = vi.fn(() => true);
    const createProject = vi.fn().mockResolvedValue(undefined);

    await runClosedWonConversionFlow({ nextStatus: "closed_won", updateStatus, confirmCreateProject, createProject });

    expect(confirmCreateProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledTimes(1);
  });

  it("does not prompt for a status change that isn't closed_won, even on success", async () => {
    const updateStatus = vi.fn().mockResolvedValue(true);
    const confirmCreateProject = vi.fn(() => true);
    const createProject = vi.fn().mockResolvedValue(undefined);

    await runClosedWonConversionFlow({ nextStatus: "open", updateStatus, confirmCreateProject, createProject });

    expect(confirmCreateProject).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("does not convert when the user dismisses the confirm prompt", async () => {
    const updateStatus = vi.fn().mockResolvedValue(true);
    const confirmCreateProject = vi.fn(() => false);
    const createProject = vi.fn().mockResolvedValue(undefined);

    await runClosedWonConversionFlow({ nextStatus: "closed_won", updateStatus, confirmCreateProject, createProject });

    expect(confirmCreateProject).toHaveBeenCalledTimes(1);
    expect(createProject).not.toHaveBeenCalled();
  });
});

// Pure message-building logic extracted from main.tsx's
// runCreateProjectFromQuote specifically so these behaviors -- especially
// "never claim an unverified project is complete" and "never leak a raw
// server message" -- have real test coverage instead of living only in
// main.tsx, where nothing in this codebase renders and asserts on JSX.
describe("buildProjectConversionStatusMessage", () => {
  it("surfaces a known/generic failure message as both the status line and the alert, verbatim", () => {
    const result: ProjectConversionOutcome = { ok: false, reason: "not_closed_won", message: "Sales Quote \"Acme Garage\" is not Closed - Won yet -- set its status first, then try again." };
    const { status, alert } = buildProjectConversionStatusMessage(result);
    expect(status).toBe(result.message);
    expect(alert).toBe(result.message);
  });

  it("never claims an existing, unverified (pre-127) project is complete -- in either the status or the alert", () => {
    const result: ProjectConversionOutcome = {
      ok: true,
      project: makeProject(),
      alreadyExisted: true,
      structureVerified: false,
      bomLineCount: 0,
      locationCount: 0,
      locationItemCount: 0,
      totalPhotos: 0,
      copiedPhotos: 0,
      alreadyCopiedPhotos: 0,
      failedPhotos: [],
    };
    const { status, alert } = buildProjectConversionStatusMessage(result);
    for (const text of [status, alert]) {
      expect(text).not.toBeNull();
      expect(text).toMatch(/not verified complete/i);
      // Guards against an uncritical completeness claim -- "not verified
      // complete" itself is fine and expected; "is complete"/"are complete"
      // with no "not" would be the actual bug this test exists to catch.
      expect(text).not.toMatch(/\b(is|are) complete\b/i);
    }
    expect(alert).not.toBeNull();
  });

  it("shows a clean success with no alert when structure is verified and every photo copied", () => {
    const result: ProjectConversionOutcome = {
      ok: true,
      project: makeProject(),
      alreadyExisted: false,
      structureVerified: true,
      bomLineCount: 2,
      locationCount: 1,
      locationItemCount: 1,
      totalPhotos: 3,
      copiedPhotos: 2,
      alreadyCopiedPhotos: 1,
      failedPhotos: [],
    };
    const { status, alert } = buildProjectConversionStatusMessage(result);
    expect(status).toContain("Created Project");
    expect(status).toContain("3 of 3 photos copied");
    expect(alert).toBeNull();
  });

  it("names the full transfer counts (BOM lines, locations, location items), not just photos, so the PM can tell exactly what transferred", () => {
    const result: ProjectConversionOutcome = {
      ok: true,
      project: makeProject(),
      alreadyExisted: false,
      structureVerified: true,
      bomLineCount: 5,
      locationCount: 2,
      locationItemCount: 7,
      totalPhotos: 0,
      copiedPhotos: 0,
      alreadyCopiedPhotos: 0,
      failedPhotos: [],
    };
    const { status } = buildProjectConversionStatusMessage(result);
    expect(status).toContain("5 BOM lines");
    expect(status).toContain("2 locations");
    expect(status).toContain("7 location items");
  });

  it("singularizes the transfer-count wording for a count of exactly one", () => {
    const result: ProjectConversionOutcome = {
      ok: true,
      project: makeProject(),
      alreadyExisted: false,
      structureVerified: true,
      bomLineCount: 1,
      locationCount: 1,
      locationItemCount: 1,
      totalPhotos: 0,
      copiedPhotos: 0,
      alreadyCopiedPhotos: 0,
      failedPhotos: [],
    };
    const { status } = buildProjectConversionStatusMessage(result);
    expect(status).toContain("1 BOM line,");
    expect(status).toContain("1 location,");
    expect(status).toContain("1 location item");
    expect(status).not.toContain("1 BOM lines");
    expect(status).not.toContain("1 locations");
    expect(status).not.toContain("1 location items");
  });

  it("does not add transfer counts to the unverified-project message (would falsely imply a guarantee)", () => {
    const result: ProjectConversionOutcome = {
      ok: true,
      project: makeProject(),
      alreadyExisted: true,
      structureVerified: false,
      bomLineCount: 2,
      locationCount: 1,
      locationItemCount: 1,
      totalPhotos: 0,
      copiedPhotos: 0,
      alreadyCopiedPhotos: 0,
      failedPhotos: [],
    };
    const { status } = buildProjectConversionStatusMessage(result);
    expect(status).not.toMatch(/\d+ BOM line/);
  });

  it("uses \"Found existing Project\" wording (not \"Created\") when the project already existed", () => {
    const result: ProjectConversionOutcome = {
      ok: true,
      project: makeProject(),
      alreadyExisted: true,
      structureVerified: true,
      bomLineCount: 2,
      locationCount: 1,
      locationItemCount: 1,
      totalPhotos: 0,
      copiedPhotos: 0,
      alreadyCopiedPhotos: 0,
      failedPhotos: [],
    };
    const { status } = buildProjectConversionStatusMessage(result);
    expect(status).toContain("Found existing Project");
    expect(status).not.toContain("Created Project");
  });

  it("omits the photo-count summary entirely when the quote has no photos", () => {
    const result: ProjectConversionOutcome = {
      ok: true,
      project: makeProject(),
      alreadyExisted: false,
      structureVerified: true,
      bomLineCount: 0,
      locationCount: 0,
      locationItemCount: 0,
      totalPhotos: 0,
      copiedPhotos: 0,
      alreadyCopiedPhotos: 0,
      failedPhotos: [],
    };
    const { status } = buildProjectConversionStatusMessage(result);
    expect(status).not.toMatch(/photos copied/);
  });

  it("keeps failed photos visible in both the status line and the alert, without claiming the whole project failed", () => {
    const result: ProjectConversionOutcome = {
      ok: true,
      project: makeProject(),
      alreadyExisted: false,
      structureVerified: true,
      bomLineCount: 2,
      locationCount: 1,
      locationItemCount: 1,
      totalPhotos: 2,
      copiedPhotos: 1,
      alreadyCopiedPhotos: 0,
      failedPhotos: [{ locationName: "Main Garage", fileName: "front.jpg", reason: "The file copied, but its photo record could not be saved. Try Create Project again." }],
    };
    const { status, alert } = buildProjectConversionStatusMessage(result);
    expect(status).toMatch(/1 photo did not copy/);
    expect(status).toContain("see alert for details");
    expect(alert).not.toBeNull();
    expect(alert).toContain("Main Garage");
    expect(alert).toContain("front.jpg");
    expect(alert).toMatch(/BOM, scope of work, and locations are complete/);
  });
});
