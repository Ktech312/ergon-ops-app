import { describe, it, expect, beforeEach, vi } from "vitest";
import { createDeviceRecipeSaveQueue, reconcileSavedDeviceRecipes, type BuildRecipe } from "./persistence";

// Found in review (2026-09-12) of the deployed saveDeviceRecipes wiring:
// backfilling a new recipe's server-assigned equipmentTypeId by matching
// `saved.find((entry) => entry.name === recipe.name)` breaks the moment a
// recipe is renamed while its save is still in flight -- the server echo
// still carries the OLD name at that point, so the match fails and the id
// is never attached. The next save then sends p_equipment_type_id: null
// again with the NEW name, and the RPC creates a second, duplicate
// equipment_types row for what the user experiences as one recipe.
// There's a second form of the same problem: two overlapping saves (an
// edit arriving while an earlier save for the same brand-new recipe is
// still in flight) can each send null, since neither has learned the
// real id yet -- same duplicate-row outcome, different trigger.
//
// The fix has two independent pieces, tested separately below:
// - reconcileSavedDeviceRecipes: a pure function that matches a save
//   result back to a local recipe via a stable clientId plus the
//   request/result arrays' shared index, never via `name`, and only ever
//   backfills the equipmentTypeId field -- it never replaces a recipe
//   with the (possibly stale) server echo.
// - createDeviceRecipeSaveQueue: serializes saveDeviceRecipes calls so a
//   brand-new recipe is never sent with p_equipment_type_id: null more
//   than once concurrently -- a save requested while one is already in
//   flight is coalesced into exactly one follow-up, run once the first
//   settles, with the newly assigned id already merged in.

function makeRecipe(overrides: Partial<BuildRecipe> = {}): BuildRecipe {
  return {
    clientId: "client-1",
    name: "New Equipment 1",
    outputName: "New Equipment 1",
    description: "",
    components: [],
    ...overrides,
  };
}

// The raw shape the RPC returns over the wire (imageUrl: string | null) --
// used only as a fetch response body. saveDeviceRecipes converts this via
// mapSaveEquipmentRecipeResult before reconcileSavedDeviceRecipes ever
// sees it, which is what makeMappedSavedRecipe below represents.
function makeRawRpcResult(overrides: Partial<{
  equipmentTypeId: string;
  name: string;
  outputName: string;
  description: string;
  imageUrl: string | null;
  retired: boolean;
  components: Array<{ itemName: string; qty: number }>;
}> = {}) {
  return {
    equipmentTypeId: "server-1",
    name: "New Equipment 1",
    outputName: "New Equipment 1",
    description: "",
    imageUrl: null,
    retired: false,
    components: [],
    ...overrides,
  };
}

// The already-mapped shape (imageUrl?: string, no clientId) --
// reconcileSavedDeviceRecipes' own `saved` parameter type, for testing it
// directly without going through an actual RPC round-trip.
function makeMappedSavedRecipe(overrides: Partial<Omit<BuildRecipe, "clientId">> = {}): Omit<BuildRecipe, "clientId"> {
  return {
    equipmentTypeId: "server-1",
    name: "New Equipment 1",
    outputName: "New Equipment 1",
    description: "",
    components: [],
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

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void };

function createDeferred(): Deferred {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Each rpc/save_equipment_recipe call gets its own controllable deferred
// response, in call order -- lets a test start a save, inspect what was
// sent, make further changes while it's still "in flight," and only then
// choose when (and with what) it resolves.
function installControlledFetch() {
  const deferreds: Deferred[] = [];
  const calls: Array<{ body: unknown }> = [];
  const mock = vi.fn().mockImplementation(async (input, init?: { method?: string; body?: string }) => {
    const url = String(input);
    if (!url.includes("/rpc/save_equipment_recipe")) {
      throw new Error(`Unmocked fetch call in test: ${init?.method ?? "GET"} ${url}`);
    }
    calls.push({ body: init?.body ? JSON.parse(init.body) : undefined });
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

describe("reconcileSavedDeviceRecipes (pure)", () => {
  it("matches a result to a recipe via clientId and request/result index, never via name", () => {
    const current: BuildRecipe[] = [makeRecipe({ clientId: "c1", name: "Renamed After Send", outputName: "Renamed After Send" })];
    const requested: BuildRecipe[] = [makeRecipe({ clientId: "c1", name: "Original Name", outputName: "Original Name" })];
    const saved = [makeMappedSavedRecipe({ equipmentTypeId: "server-1", name: "Original Name", outputName: "Original Name" })];
    const next = reconcileSavedDeviceRecipes(current, requested, saved);
    expect(next[0].equipmentTypeId).toBe("server-1");
    // The server echo's stale (pre-rename) name is never copied back in.
    expect(next[0].name).toBe("Renamed After Send");
  });

  it("returns the exact same array reference when there is nothing to backfill", () => {
    const current: BuildRecipe[] = [makeRecipe({ clientId: "c1", equipmentTypeId: "server-1" })];
    const requested = current;
    const saved = [makeMappedSavedRecipe({ equipmentTypeId: "server-1" })];
    expect(reconcileSavedDeviceRecipes(current, requested, saved)).toBe(current);
  });

  it("only ever backfills equipmentTypeId -- other fields keep current's (newer) values, not the server echo's", () => {
    const current: BuildRecipe[] = [makeRecipe({ clientId: "c1", description: "newer local description" })];
    const requested: BuildRecipe[] = [makeRecipe({ clientId: "c1", description: "older description as of the request" })];
    const saved = [makeMappedSavedRecipe({ equipmentTypeId: "server-1", description: "older description as of the request" })];
    const next = reconcileSavedDeviceRecipes(current, requested, saved);
    expect(next[0].equipmentTypeId).toBe("server-1");
    expect(next[0].description).toBe("newer local description");
  });
});

describe("createDeviceRecipeSaveQueue -- only one creation call using null id", () => {
  it("a second enqueue for the same not-yet-saved recipe while the first is in flight does not trigger a second concurrent RPC call", async () => {
    const { calls } = installControlledFetch();
    let state: BuildRecipe[] = [makeRecipe({ clientId: "c1" })];
    const queue = createDeviceRecipeSaveQueue(
      (updater) => {
        state = updater(state);
      },
      () => {},
    );

    queue.enqueue(state, "token");
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ p_equipment_type_id: null });

    queue.enqueue(state, "token");
    // Still exactly one call -- the second enqueue was coalesced, not sent.
    expect(calls).toHaveLength(1);
  });
});

describe("createDeviceRecipeSaveQueue -- the follow-up call using the returned real id", () => {
  it("once the in-flight save resolves, the coalesced follow-up sends the real id, not null again", async () => {
    const { calls, deferreds } = installControlledFetch();
    let state: BuildRecipe[] = [makeRecipe({ clientId: "c1" })];
    const queue = createDeviceRecipeSaveQueue(
      (updater) => {
        state = updater(state);
      },
      () => {},
    );

    queue.enqueue(state, "token");
    queue.enqueue(state.map((r) => ({ ...r, description: "edited while saving" })), "token");
    expect(calls).toHaveLength(1);

    deferreds[0].resolve(respond(true, 200, makeRawRpcResult({ equipmentTypeId: "server-1" })));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toMatchObject({ p_equipment_type_id: "server-1" });

    deferreds[1].resolve(respond(true, 200, makeRawRpcResult({ equipmentTypeId: "server-1", description: "edited while saving" })));
    await vi.waitFor(() => expect(state[0].equipmentTypeId).toBe("server-1"));
  });
});

describe("createDeviceRecipeSaveQueue -- rename while the first save is in flight", () => {
  it("preserves the rename in local state and sends it (with the real id) in the follow-up call", async () => {
    const { calls, deferreds } = installControlledFetch();
    let state: BuildRecipe[] = [makeRecipe({ clientId: "c1", name: "New Equipment 1", outputName: "New Equipment 1" })];
    const queue = createDeviceRecipeSaveQueue(
      (updater) => {
        state = updater(state);
      },
      () => {},
    );

    queue.enqueue(state, "token");
    expect(calls[0].body).toMatchObject({ p_equipment_type_id: null, p_equipment_name: "New Equipment 1" });

    // Simulate the user renaming the recipe while that first save is still
    // in flight -- exactly as the UI's own onChange -> setDeviceRecipes
    // would, independent of the save queue itself. This is what makes
    // `state` diverge from what call 1 actually sent.
    state = state.map((r) => (r.clientId === "c1" ? { ...r, name: "Renamed Equipment", outputName: "Renamed Equipment" } : r));
    queue.enqueue(state, "token");

    deferreds[0].resolve(respond(true, 200, makeRawRpcResult({ equipmentTypeId: "server-1", name: "New Equipment 1", outputName: "New Equipment 1" })));
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    // The follow-up uses the real id and the renamed value -- the rename
    // was never lost, and it's never re-sent as a fresh creation (null id).
    expect(calls[1].body).toMatchObject({ p_equipment_type_id: "server-1", p_equipment_name: "Renamed Equipment" });
    // Local state reflects the rename even before the follow-up resolves --
    // the id backfill from call 1 never overwrote it with the old name.
    expect(state[0].name).toBe("Renamed Equipment");
    expect(state[0].equipmentTypeId).toBe("server-1");

    deferreds[1].resolve(respond(true, 200, makeRawRpcResult({ equipmentTypeId: "server-1", name: "Renamed Equipment", outputName: "Renamed Equipment" })));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
  });
});

describe("createDeviceRecipeSaveQueue -- multiple edits while the first save is in flight", () => {
  it("coalesces several enqueue calls into exactly one follow-up, using only the latest one", async () => {
    const { calls, deferreds } = installControlledFetch();
    let state: BuildRecipe[] = [makeRecipe({ clientId: "c1", description: "v1" })];
    const queue = createDeviceRecipeSaveQueue(
      (updater) => {
        state = updater(state);
      },
      () => {},
    );

    queue.enqueue(state, "token");
    queue.enqueue(state.map((r) => ({ ...r, description: "v2" })), "token");
    queue.enqueue(state.map((r) => ({ ...r, description: "v3" })), "token");
    queue.enqueue(state.map((r) => ({ ...r, description: "v4 (latest)" })), "token");
    // Only the very first call was actually sent -- v2/v3/v4 were all
    // coalesced into a single pending snapshot, not three separate calls.
    expect(calls).toHaveLength(1);

    deferreds[0].resolve(respond(true, 200, makeRawRpcResult({ equipmentTypeId: "server-1", description: "v1" })));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    // Exactly one follow-up call, and it carries the LAST edit, not v2/v3.
    expect(calls[1].body).toMatchObject({ p_description: "v4 (latest)" });

    deferreds[1].resolve(respond(true, 200, makeRawRpcResult({ equipmentTypeId: "server-1", description: "v4 (latest)" })));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
  });
});

describe("createDeviceRecipeSaveQueue -- out-of-date server data does not overwrite newer local edits", () => {
  it("applies only the id backfill against the true current state, even when it has moved on since the request was sent", async () => {
    const { calls, deferreds } = installControlledFetch();
    let state: BuildRecipe[] = [makeRecipe({ clientId: "c1", description: "description as of the request" })];
    const queue = createDeviceRecipeSaveQueue(
      (updater) => {
        state = updater(state);
      },
      () => {},
    );

    queue.enqueue(state, "token");
    expect(calls).toHaveLength(1);

    // The live recipe changes again while the request above is still in
    // flight, WITHOUT going through enqueue() again (e.g. a keystroke that
    // hasn't hit its own debounce yet) -- this is the "current" the
    // reconciliation must respect once the in-flight request resolves.
    state = state.map((r) => (r.clientId === "c1" ? { ...r, description: "newer, not-yet-saved edit" } : r));

    deferreds[0].resolve(respond(true, 200, makeRawRpcResult({ equipmentTypeId: "server-1", description: "description as of the request" })));
    await vi.waitFor(() => expect(state[0].equipmentTypeId).toBe("server-1"));

    // The id was backfilled, but the server's now-stale echoed description
    // never overwrote the newer local edit.
    expect(state[0].description).toBe("newer, not-yet-saved edit");
  });
});

describe("createDeviceRecipeSaveQueue -- two separate new recipes receiving their corresponding ids", () => {
  it("backfills each recipe's own server-assigned id, never swapping them", async () => {
    const { calls, deferreds } = installControlledFetch();
    let state: BuildRecipe[] = [
      makeRecipe({ clientId: "c1", name: "Recipe One", outputName: "Recipe One" }),
      makeRecipe({ clientId: "c2", name: "Recipe Two", outputName: "Recipe Two" }),
    ];
    const queue = createDeviceRecipeSaveQueue(
      (updater) => {
        state = updater(state);
      },
      () => {},
    );

    queue.enqueue(state, "token");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ p_equipment_type_id: null, p_equipment_name: "Recipe One" });
    deferreds[0].resolve(respond(true, 200, makeRawRpcResult({ equipmentTypeId: "server-1", name: "Recipe One", outputName: "Recipe One" })));

    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toMatchObject({ p_equipment_type_id: null, p_equipment_name: "Recipe Two" });
    deferreds[1].resolve(respond(true, 200, makeRawRpcResult({ equipmentTypeId: "server-2", name: "Recipe Two", outputName: "Recipe Two" })));

    await vi.waitFor(() => {
      expect(state.find((r) => r.clientId === "c1")?.equipmentTypeId).toBe("server-1");
      expect(state.find((r) => r.clientId === "c2")?.equipmentTypeId).toBe("server-2");
    });
  });
});

describe("createDeviceRecipeSaveQueue -- error handling", () => {
  it("reports a failed save via onError and still runs a coalesced follow-up afterward", async () => {
    const { calls, deferreds } = installControlledFetch();
    let state: BuildRecipe[] = [makeRecipe({ clientId: "c1" })];
    const onError = vi.fn();
    const queue = createDeviceRecipeSaveQueue(
      (updater) => {
        state = updater(state);
      },
      onError,
    );

    queue.enqueue(state, "token");
    queue.enqueue(state.map((r) => ({ ...r, description: "retry me" })), "token");
    deferreds[0].resolve(respond(false, 500, { message: "db error" }));

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toMatchObject({ p_description: "retry me" });
  });
});
