import { describe, it, expect, beforeEach, vi } from "vitest";
import { createClientLedgerSaveQueue, type ProjectLedgerInfo } from "./persistence";

// Queue A10 (2026-09-12): implements
// PRODUCT_CLIENT_LEDGER_SAVE_RECOVERY_PLAN.md's Option B -- a serialized,
// latest-snapshot save queue, keyed per projectId, replacing the earlier
// caller-side per-field revert-on-failure attempt (2026-09-11, reverted as
// concurrency-unsafe: a stale in-flight revert could overwrite a second,
// later, already-succeeded edit). These six tests are the ones that
// document itself named as the proof no older failed request can overwrite
// a newer edit.

function makeRow(overrides: Partial<ProjectLedgerInfo> = {}): ProjectLedgerInfo {
  return { projectId: "proj-1", kickoffDate: "", warrantyExpirationDate: "", addedToLedger: false, ledgerBucket: null, ...overrides };
}

function respond(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    kickoff_date: null,
    warranty_expiration_date: null,
    added_to_ledger: false,
    ledger_bucket: null,
    ...overrides,
  };
}

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void };

function createDeferred(): Deferred {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Each PATCH projects?id=eq.<id> call gets its own controllable deferred
// response, in call order.
function installControlledFetch() {
  const deferreds: Deferred[] = [];
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const mock = vi.fn().mockImplementation(async (input, init?: { method?: string; body?: string }) => {
    const url = String(input);
    if (!url.includes("/projects?id=eq.") || init?.method !== "PATCH") {
      throw new Error(`Unmocked fetch call in test: ${init?.method ?? "GET"} ${url}`);
    }
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : {} });
    const deferred = createDeferred();
    deferreds.push(deferred);
    return deferred.promise;
  });
  globalThis.fetch = mock;
  return { calls, deferreds };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createClientLedgerSaveQueue -- 1. an older failed save never overwrites a newer edit to the same field", () => {
  it("final state reflects the second edit, not a revert to the pre-first-edit value", async () => {
    const { calls, deferreds } = installControlledFetch();
    let state: ProjectLedgerInfo[] = [makeRow({ ledgerBucket: null })];
    const queue = createClientLedgerSaveQueue(
      (updater) => {
        state = updater(state);
      },
      () => {},
    );

    queue.enqueue("proj-1", { ledgerBucket: "active" }, "token");
    expect(calls).toHaveLength(1);
    // Second edit arrives while the first is still in flight.
    queue.enqueue("proj-1", { ledgerBucket: "archived" }, "token");
    expect(calls).toHaveLength(1); // coalesced into pending, not sent yet

    deferreds[0].resolve(respond(false, 500, { message: "db error" }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toEqual({ ledger_bucket: "archived" });

    deferreds[1].resolve(respond(true, 200, [projectRow({ ledger_bucket: "archived" })]));
    await vi.waitFor(() => expect(state[0].ledgerBucket).toBe("archived"));
  });
});

describe("createClientLedgerSaveQueue -- 2. edits to different fields both survive", () => {
  it("the first (failed, unretried) field and the second (confirmed) field are both preserved locally", async () => {
    const { calls, deferreds } = installControlledFetch();
    let state: ProjectLedgerInfo[] = [makeRow({ kickoffDate: "2026-01-01" })];
    const onError = vi.fn();
    const queue = createClientLedgerSaveQueue(
      (updater) => {
        state = updater(state);
      },
      onError,
    );

    queue.enqueue("proj-1", { kickoffDate: "2026-02-01" }, "token");
    // Optimistic local update the real caller (handleUpdateProjectLedgerInfo)
    // would already have applied before enqueueing -- simulated directly here
    // since this test targets the queue, not the React handler.
    state = state.map((row) => (row.projectId === "proj-1" ? { ...row, kickoffDate: "2026-02-01" } : row));

    queue.enqueue("proj-1", { warrantyExpirationDate: "2027-01-01" }, "token");
    state = state.map((row) => (row.projectId === "proj-1" ? { ...row, warrantyExpirationDate: "2027-01-01" } : row));

    deferreds[0].resolve(respond(false, 500, { message: "db error" }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toEqual({ warranty_expiration_date: "2027-01-01" });

    deferreds[1].resolve(respond(true, 200, [projectRow({ kickoff_date: "2026-01-01", warranty_expiration_date: "2027-01-01" })]));
    await vi.waitFor(() => expect(state[0].warrantyExpirationDate).toBe("2027-01-01"));
    // kickoffDate's failed save is neither reverted nor silently dropped --
    // the local optimistic value from the caller survives untouched.
    expect(state[0].kickoffDate).toBe("2026-02-01");
  });
});

describe("createClientLedgerSaveQueue -- 3. a failed save with no further edits", () => {
  it("preserves the optimistic value and surfaces the failure exactly once", async () => {
    const { deferreds } = installControlledFetch();
    let state: ProjectLedgerInfo[] = [makeRow({ addedToLedger: true })];
    const onError = vi.fn();
    const queue = createClientLedgerSaveQueue(
      (updater) => {
        state = updater(state);
      },
      onError,
    );

    queue.enqueue("proj-1", { addedToLedger: true }, "token");
    deferreds[0].resolve(respond(false, 500, { message: "db error" }));

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(state[0].addedToLedger).toBe(true);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateProjectLedgerInfo: PATCH failed for project proj-1 (500)"));
  });
});

describe("createClientLedgerSaveQueue -- 4. two different projects never block each other", () => {
  it("a slow save for project A does not delay project B's save", async () => {
    const { calls, deferreds } = installControlledFetch();
    let state: ProjectLedgerInfo[] = [makeRow({ projectId: "proj-a" }), makeRow({ projectId: "proj-b" })];
    const queue = createClientLedgerSaveQueue(
      (updater) => {
        state = updater(state);
      },
      () => {},
    );

    queue.enqueue("proj-a", { kickoffDate: "2026-01-01" }, "token");
    queue.enqueue("proj-b", { kickoffDate: "2026-02-01" }, "token");
    // Both fire immediately -- proj-b's save is not queued behind proj-a's.
    expect(calls).toHaveLength(2);

    deferreds[1].resolve(respond(true, 200, [{ id: "proj-b", kickoff_date: "2026-02-01", warranty_expiration_date: null, added_to_ledger: false, ledger_bucket: null }]));
    await vi.waitFor(() => expect(state.find((row) => row.projectId === "proj-b")?.kickoffDate).toBe("2026-02-01"));
    // proj-a's own save is still unresolved and untouched by proj-b settling.
    expect(state.find((row) => row.projectId === "proj-a")?.kickoffDate).toBe("");

    deferreds[0].resolve(respond(true, 200, [{ id: "proj-a", kickoff_date: "2026-01-01", warranty_expiration_date: null, added_to_ledger: false, ledger_bucket: null }]));
    await vi.waitFor(() => expect(state.find((row) => row.projectId === "proj-a")?.kickoffDate).toBe("2026-01-01"));
  });
});

describe("createClientLedgerSaveQueue -- 5. a third edit arriving while a second is already pending", () => {
  it("merges the second and third into one pending snapshot; only one follow-up PATCH is sent", async () => {
    const { calls, deferreds } = installControlledFetch();
    let state: ProjectLedgerInfo[] = [makeRow()];
    const queue = createClientLedgerSaveQueue(
      (updater) => {
        state = updater(state);
      },
      () => {},
    );

    queue.enqueue("proj-1", { kickoffDate: "2026-01-01" }, "token");
    queue.enqueue("proj-1", { kickoffDate: "2026-02-01" }, "token");
    queue.enqueue("proj-1", { kickoffDate: "2026-03-01" }, "token");
    expect(calls).toHaveLength(1); // only the first was actually sent

    deferreds[0].resolve(respond(true, 200, [projectRow({ kickoff_date: "2026-01-01" })]));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    // The one follow-up carries the LATEST value, not the second edit's.
    expect(calls[1].body).toEqual({ kickoff_date: "2026-03-01" });

    deferreds[1].resolve(respond(true, 200, [projectRow({ kickoff_date: "2026-03-01" })]));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
  });
});

describe("createClientLedgerSaveQueue -- 6. reconciliation applies the server's real returned value", () => {
  it("a server-normalized value (e.g. a null-coalesced date) is reflected locally, not just left as-is", async () => {
    const { deferreds } = installControlledFetch();
    let state: ProjectLedgerInfo[] = [makeRow({ warrantyExpirationDate: "bad-input" })];
    const queue = createClientLedgerSaveQueue(
      (updater) => {
        state = updater(state);
      },
      () => {},
    );

    queue.enqueue("proj-1", { warrantyExpirationDate: "bad-input" }, "token");
    // Server rejects the malformed date and coalesces it to null instead.
    deferreds[0].resolve(respond(true, 200, [projectRow({ warranty_expiration_date: null })]));

    await vi.waitFor(() => expect(state[0].warrantyExpirationDate).toBe(""));
  });

  it("does not overwrite a field with a newer, still-unsent pending edit", async () => {
    const { calls, deferreds } = installControlledFetch();
    let state: ProjectLedgerInfo[] = [makeRow({ kickoffDate: "2026-01-01" })];
    const queue = createClientLedgerSaveQueue(
      (updater) => {
        state = updater(state);
      },
      () => {},
    );

    queue.enqueue("proj-1", { kickoffDate: "2026-01-01" }, "token");
    // A newer edit is queued (pending) before the first save resolves.
    queue.enqueue("proj-1", { kickoffDate: "2026-06-01" }, "token");
    state = state.map((row) => (row.projectId === "proj-1" ? { ...row, kickoffDate: "2026-06-01" } : row));

    // The first save's own confirmed echo is for the OLD value -- must not
    // stomp the already-newer optimistic local value while a pending save
    // for this same field is scheduled to run next.
    deferreds[0].resolve(respond(true, 200, [projectRow({ kickoff_date: "2026-01-01" })]));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(state[0].kickoffDate).toBe("2026-06-01");

    deferreds[1].resolve(respond(true, 200, [projectRow({ kickoff_date: "2026-06-01" })]));
    await vi.waitFor(() => expect(state[0].kickoffDate).toBe("2026-06-01"));
  });
});
