import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProjectSiteSaveQueue,
  reconcileSavedProjectSites,
  type BomLine,
  type ProjectSite,
} from "./persistence";

function line(overrides: Partial<BomLine> = {}): BomLine {
  return {
    clientId: "client-line-1",
    item: "Camera",
    qty: 1,
    status: "Not started",
    requestSpeed: "Standard",
    ...overrides,
  };
}

function site(overrides: Partial<ProjectSite> = {}): ProjectSite {
  return {
    id: "project-1",
    ref: "PRJ-TEST",
    name: "Test Project",
    client: "Test Client",
    type: "Parking Garage",
    address: "",
    owner: "",
    status: "Draft",
    due: "",
    package: "",
    cameras: 0,
    allocated: 0,
    siteNotes: "",
    sow: { summary: "", preparation: "", infrastructure: "", installation: "", commissioning: "", fineTuning: "", assumptions: "", exclusions: "" },
    bom: [line()],
    ...overrides,
  };
}

function response(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void };
function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function installControlledFetch() {
  const rpcCalls: Array<Record<string, unknown>> = [];
  const rpcResponses: Deferred[] = [];
  globalThis.fetch = vi.fn().mockImplementation(async (input, init?: { body?: string }) => {
    const url = String(input);
    if (url.includes("/projects?on_conflict=")) return response(true, 200, [{ id: "project-1", project_name: "Test Project" }]);
    if (url.includes("/project_scope_of_work?on_conflict=")) return response(true, 200, [{ project_id: "project-1" }]);
    if (url.includes("/rpc/replace_project_bom_lines")) {
      rpcCalls.push(JSON.parse(init?.body ?? "{}"));
      const next = deferred();
      rpcResponses.push(next);
      return next.promise;
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  return { rpcCalls, rpcResponses };
}

function rpcResult(id = "server-line-1", item = "Camera") {
  return response(true, 200, {
    projectId: "project-1",
    updatedCount: 0,
    insertedCount: 1,
    deletedCount: 0,
    lines: [{ id, item, sku: "CAM-1", qty: 1, status: "Not started", requestSpeed: "Standard", po: null, notes: null, procurementTrack: "warehouse_stock", sentToPurchasingAt: null, shipTo: null }],
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reconcileSavedProjectSites", () => {
  it("matches by stable project/line identity and backfills only id and sku", () => {
    const requested = [site()];
    const current = [site({ bom: [line({ item: "Renamed while saving", notes: "newer edit" })] })];
    const saved = [site({ bom: [line({ id: "server-line-1", sku: "CAM-1", item: "Camera", notes: "stale" })] })];
    const result = reconcileSavedProjectSites(current, requested, saved);
    expect(result[0].bom[0]).toMatchObject({ id: "server-line-1", sku: "CAM-1", item: "Renamed while saving", notes: "newer edit" });
  });

  it("returns the same state reference when no identifier changes", () => {
    const current = [site({ bom: [line({ id: "server-line-1", sku: "CAM-1" })] })];
    expect(reconcileSavedProjectSites(current, current, current)).toBe(current);
  });
});

describe("createProjectSiteSaveQueue", () => {
  it("coalesces an overlapping new-line save and sends the returned id in the follow-up", async () => {
    const { rpcCalls, rpcResponses } = installControlledFetch();
    let state = [site()];
    const queue = createProjectSiteSaveQueue((updater) => { state = updater(state); }, () => {});

    queue.enqueue(state, "token");
    await vi.waitFor(() => expect(rpcCalls).toHaveLength(1));
    expect(rpcCalls[0]).toMatchObject({ p_lines: [expect.objectContaining({ id: null })] });

    state = [site({ bom: [line({ item: "Edited while saving" })] })];
    queue.enqueue(state, "token");
    expect(rpcCalls).toHaveLength(1);

    rpcResponses[0].resolve(rpcResult());
    await vi.waitFor(() => expect(rpcCalls).toHaveLength(2));
    expect(rpcCalls[1]).toMatchObject({ p_lines: [expect.objectContaining({ id: "server-line-1", item_name: "Edited while saving" })] });
    expect(state[0].bom[0]).toMatchObject({ id: "server-line-1", item: "Edited while saving" });

    rpcResponses[1].resolve(rpcResult("server-line-1", "Edited while saving"));
    await vi.waitFor(() => expect(rpcCalls).toHaveLength(2));
  });

  it("reports a failure and still runs the latest coalesced snapshot", async () => {
    const { rpcCalls, rpcResponses } = installControlledFetch();
    let state = [site()];
    const onError = vi.fn();
    const queue = createProjectSiteSaveQueue((updater) => { state = updater(state); }, onError);
    queue.enqueue(state, "token");
    await vi.waitFor(() => expect(rpcCalls).toHaveLength(1));
    queue.enqueue([site({ bom: [line({ item: "Retry value" })] })], "token");
    rpcResponses[0].resolve(response(false, 500, { message: "failure" }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(rpcCalls).toHaveLength(2));
    expect(rpcCalls[1]).toMatchObject({ p_lines: [expect.objectContaining({ item_name: "Retry value" })] });
    rpcResponses[1].resolve(rpcResult("server-line-1", "Retry value"));
  });
});
