import { describe, it, expect, beforeEach, vi } from "vitest";
import { createProjectFromClosedWonQuote, type SalesQuote, type SalesQuoteLocation, type SalesQuoteLocationImage } from "./persistence";

// Migration 127 moved the project/scope-of-work/BOM-lines/locations/
// location-items writes for a Sales Quote -> Project conversion into one
// atomic, idempotent, workspace-safe RPC (rpc/create_project_from_quote),
// so this file only needs to cover the frontend's own remaining
// responsibilities: (1) turning a known RPC rejection (EC001-EC007) into a
// safe, specific message instead of the generic fallback, and (2) per-photo
// copy tracking -- copying a storage object is an HTTP call, not something
// the RPC's SQL transaction can wrap. The SQL side (authorization,
// workspace ownership, atomicity, idempotency, the project-name-collision
// guard, camera/vpu line-item coverage, soft-delete exclusion, and
// structure-verification for a pre-existing project) is covered by the
// transaction-safe SQL test script in
// backend/supabase/migration_127_conversion_tests.sql.

function makeQuote(overrides: Partial<SalesQuote> = {}): SalesQuote {
  return {
    id: "quote-1",
    quoteRef: "SQ-2026-0001",
    clientName: "Acme Parking",
    siteName: "Acme Garage",
    city: "Springfield",
    createdByEmail: "sales@ergon.test",
    createdAt: "2026-01-01T00:00:00.000Z",
    closedAt: "2026-01-02T00:00:00.000Z",
    status: "closed_won",
    locations: [],
    bomLines: [],
    clientEmail: "",
    proposalSummary: "",
    contactFullName: "",
    contactPhone: "",
    preferredCommunication: "",
    siteStreetAddress: "",
    siteState: "",
    siteZip: "",
    clientStreetAddress: "",
    clientCity: "",
    clientState: "",
    clientZip: "",
    saasType: "",
    saasContractAmount: null,
    saasBillingFrequency: "",
    saleAmount: null,
    ...overrides,
  };
}

function makeLocation(overrides: Partial<SalesQuoteLocation> = {}): SalesQuoteLocation {
  return {
    id: "loc-1",
    quoteId: "quote-1",
    locationType: "garage",
    name: "Main Garage",
    address: "",
    lineSort: 0,
    fli: false,
    lpr: false,
    peopleCounting: false,
    fliCameraItemId: null,
    lprCameraItemId: null,
    peopleCountingCameraItemId: null,
    entriesCount: 0,
    exitsCount: 0,
    levelsCount: 0,
    images: [],
    signLines: [],
    sensorLines: [],
    miscLines: [],
    cameraLines: [],
    vpuLines: [],
    ...overrides,
  };
}

function makeImage(overrides: Partial<SalesQuoteLocationImage> = {}): SalesQuoteLocationImage {
  return {
    id: "img-1",
    imageType: "photo",
    storagePath: "sales-quote-images/loc-1/photo.jpg",
    fileName: "photo.jpg",
    description: "",
    uploadedAt: "2026-01-01T00:00:00.000Z",
    uploadedByEmail: "sales@ergon.test",
    lat: null,
    lng: null,
    ...overrides,
  };
}

const RPC_RESULT_NO_LOCATIONS = {
  project_id: "project-1",
  already_existed: false,
  structure_verified: true,
  bom_line_count: 2,
  location_count: 0,
  location_item_count: 0,
  locations: [] as Array<{ quote_location_id: string; project_location_id: string; already_copied_quote_image_ids: string[] }>,
};

const FINAL_PROJECT_ROW = { id: "project-1", project_name: "Acme Garage" };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("createProjectFromClosedWonQuote -- RPC rejection reporting", () => {
  it("calls rpc/create_project_from_quote with p_quote_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: "EC001", message: "Only a PM or admin may convert a Sales Quote into a Project." }, 400));
    globalThis.fetch = fetchMock;
    await createProjectFromClosedWonQuote(makeQuote({ locations: [makeLocation({ images: [makeImage()] })] }), "token-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/create_project_from_quote");
    expect(JSON.parse(init.body)).toEqual({ p_quote_id: "quote-1" });
  });

  it.each([
    ["EC001", "not_authorized"],
    ["EC002", "wrong_workspace"],
    ["EC003", "quote_not_found"],
    ["EC004", "not_closed_won"],
    ["EC005", "name_collision"],
    ["EC006", "conversion_in_progress"],
    ["EC007", "workspace_unavailable"],
  ] as const)("surfaces the RPC's own message for known code %s as reason %s, without touching photos", async (code, reason) => {
    const serverMessage = `server message for ${code}`;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code, message: serverMessage }, 400));
    globalThis.fetch = fetchMock;
    const result = await createProjectFromClosedWonQuote(makeQuote({ locations: [makeLocation({ images: [makeImage()] })] }), "token-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(reason);
      expect(result.message).toBe(serverMessage);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the generic message for an unrecognized code, never echoing raw server text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: "23503", message: "insert or update on table violates foreign key constraint \"internal_fk\"" }, 500));
    globalThis.fetch = fetchMock;
    const result = await createProjectFromClosedWonQuote(makeQuote(), "token-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unknown");
      expect(result.message).not.toContain("internal_fk");
      expect(result.message).toMatch(/check your connection/i);
    }
  });

  it("falls back to the generic message on a network-level throw", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await createProjectFromClosedWonQuote(makeQuote(), "token-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unknown");
      expect(result.message).toMatch(/check your connection/i);
    }
  });
});

describe("createProjectFromClosedWonQuote -- success cases", () => {
  it("returns the project with correct counts, structureVerified, and zero photos when the quote has no locations", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse(RPC_RESULT_NO_LOCATIONS));
      if (String(url).includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await createProjectFromClosedWonQuote(makeQuote(), "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.name).toBe("Acme Garage");
    expect(result.alreadyExisted).toBe(false);
    expect(result.structureVerified).toBe(true);
    expect(result.bomLineCount).toBe(2);
    expect(result.totalPhotos).toBe(0);
    expect(result.copiedPhotos).toBe(0);
    expect(result.failedPhotos).toEqual([]);
  });

  it("copies each photo, tags it with source_quote_image_id, and counts it", async () => {
    const rpcResult = {
      ...RPC_RESULT_NO_LOCATIONS,
      location_count: 1,
      locations: [{ quote_location_id: "loc-1", project_location_id: "proj-loc-1", already_copied_quote_image_ids: [] }],
    };
    const insertCalls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse(rpcResult));
      if (u.includes("/storage/v1/object/copy")) return Promise.resolve(jsonResponse({}));
      if (u.includes("/rest/v1/project_location_images")) {
        insertCalls.push(JSON.parse(String(init?.body)));
        return Promise.resolve(jsonResponse({}));
      }
      if (u.includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch: ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const quote = makeQuote({ locations: [makeLocation({ images: [makeImage({ id: "img-1" })] })] });
    const result = await createProjectFromClosedWonQuote(quote, "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalPhotos).toBe(1);
    expect(result.copiedPhotos).toBe(1);
    expect(result.alreadyCopiedPhotos).toBe(0);
    expect(result.failedPhotos).toEqual([]);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({ project_location_id: "proj-loc-1", source_quote_image_id: "img-1", origin: "sales" });
  });

  it("skips photos the RPC already reports as copied, without calling storage copy again", async () => {
    const rpcResult = {
      ...RPC_RESULT_NO_LOCATIONS,
      location_count: 1,
      locations: [{ quote_location_id: "loc-1", project_location_id: "proj-loc-1", already_copied_quote_image_ids: ["img-1"] }],
    };
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse(rpcResult));
      if (u.includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch (should have skipped the already-copied photo): ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const quote = makeQuote({ locations: [makeLocation({ images: [makeImage({ id: "img-1" })] })] });
    const result = await createProjectFromClosedWonQuote(quote, "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalPhotos).toBe(1);
    expect(result.copiedPhotos).toBe(0);
    expect(result.alreadyCopiedPhotos).toBe(1);
    expect(result.failedPhotos).toEqual([]);
  });

  it("surfaces structureVerified=false for an existing, unverified (pre-127) project", async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse({ ...RPC_RESULT_NO_LOCATIONS, already_existed: true, structure_verified: false }));
      if (u.includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch: ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await createProjectFromClosedWonQuote(makeQuote(), "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyExisted).toBe(true);
    expect(result.structureVerified).toBe(false);
  });

  it("skips a location the RPC didn't report (e.g. soft-deleted mid-flight) without crashing", async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse(RPC_RESULT_NO_LOCATIONS));
      if (u.includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch (should have skipped the unreported location entirely): ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const quote = makeQuote({ locations: [makeLocation({ images: [makeImage()] })] });
    const result = await createProjectFromClosedWonQuote(quote, "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalPhotos).toBe(0);
  });
});

describe("createProjectFromClosedWonQuote -- photo failure handling", () => {
  const rpcResultOneLocation = {
    ...RPC_RESULT_NO_LOCATIONS,
    location_count: 1,
    locations: [{ quote_location_id: "loc-1", project_location_id: "proj-loc-1", already_copied_quote_image_ids: [] }],
  };

  it("tracks a failed storage copy as a reported failure, does not attempt cleanup (nothing was copied), and still returns the project", async () => {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse(rpcResultOneLocation));
      if (u.includes("/storage/v1/object/copy")) return Promise.resolve(jsonResponse({ message: "not found" }, 404));
      if (u.includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch (a failed copy should never attempt a DELETE or an insert): ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const quote = makeQuote({ locations: [makeLocation({ name: "Main Garage", images: [makeImage({ fileName: "front.jpg" })] })] });
    const result = await createProjectFromClosedWonQuote(quote, "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.name).toBe("Acme Garage");
    expect(result.copiedPhotos).toBe(0);
    expect(result.failedPhotos).toEqual([
      { locationName: "Main Garage", fileName: "front.jpg", reason: "Could not copy the file into the project's storage." },
    ]);
  });

  it("cleans up the orphaned storage object when the database row insert fails, shows a stable message, and logs the real error", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const deleteCalls: string[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse(rpcResultOneLocation));
      if (u.includes("/storage/v1/object/copy")) return Promise.resolve(jsonResponse({}));
      if (u.includes("/rest/v1/project_location_images") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ code: "23514", message: "new row violates check constraint" }, 400));
      }
      if (u.includes("/storage/v1/object/") && init?.method === "DELETE") {
        deleteCalls.push(u);
        return Promise.resolve(jsonResponse({}));
      }
      if (u.includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch: ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const quote = makeQuote({ locations: [makeLocation({ images: [makeImage({ fileName: "front.jpg" })] })] });
    const result = await createProjectFromClosedWonQuote(quote, "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.copiedPhotos).toBe(0);
    // Stable, plain-language message shown to the user -- the raw
    // PostgREST detail never appears here.
    expect(result.failedPhotos).toEqual([
      { locationName: "Main Garage", fileName: "front.jpg", reason: "The file copied, but its photo record could not be saved. Try Create Project again." },
    ]);
    expect(deleteCalls).toHaveLength(1);
    // The raw technical detail is still logged, just not shown.
    expect(consoleErrorSpy.mock.calls.some((call) => call.some((arg) => typeof arg === "string" && arg.includes("new row violates check constraint")))).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  it("logs a non-2xx cleanup DELETE response (status + body) instead of silently swallowing it", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse(rpcResultOneLocation));
      if (u.includes("/storage/v1/object/copy")) return Promise.resolve(jsonResponse({}));
      if (u.includes("/rest/v1/project_location_images") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ message: "server error" }, 500));
      }
      if (u.includes("/storage/v1/object/") && init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ message: "object not found" }, 404));
      }
      if (u.includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch: ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const quote = makeQuote({ locations: [makeLocation({ images: [makeImage({ fileName: "front.jpg" })] })] });
    const result = await createProjectFromClosedWonQuote(quote, "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.failedPhotos).toHaveLength(1);
    expect(
      consoleErrorSpy.mock.calls.some((call) => call.some((arg) => arg === 404) && call.some((arg) => typeof arg === "string" && arg.includes("clean up"))),
    ).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  it("logs a rejected cleanup DELETE network request instead of silently swallowing it, and does not let it turn into an unhandled rejection or a worse failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse(rpcResultOneLocation));
      if (u.includes("/storage/v1/object/copy")) return Promise.resolve(jsonResponse({}));
      if (u.includes("/rest/v1/project_location_images") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ message: "server error" }, 500));
      }
      if (u.includes("/storage/v1/object/") && init?.method === "DELETE") {
        return Promise.reject(new Error("storage delete network failure"));
      }
      if (u.includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch: ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const quote = makeQuote({ locations: [makeLocation({ images: [makeImage({ fileName: "front.jpg" })] })] });
    const result = await createProjectFromClosedWonQuote(quote, "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.failedPhotos).toHaveLength(1);
    expect(
      consoleErrorSpy.mock.calls.some((call) => call.some((arg) => arg instanceof Error && arg.message === "storage delete network failure")),
    ).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  it("treats a uniqueness conflict (409) as already-copied after confirming a row exists, and cleans up only its own redundant copy -- never the winning concurrent copy", async () => {
    const deleteCalls: string[] = [];
    let copiedDestinationKey: string | null = null;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse(rpcResultOneLocation));
      if (u.includes("/storage/v1/object/copy")) {
        copiedDestinationKey = (JSON.parse(String(init?.body)) as { destinationKey: string }).destinationKey;
        return Promise.resolve(jsonResponse({}));
      }
      if (u.includes("/rest/v1/project_location_images") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ code: "23505", message: "duplicate key value violates unique constraint" }, 409));
      }
      if (u.includes("/rest/v1/project_location_images") && u.includes("source_quote_image_id=eq.")) {
        return Promise.resolve(jsonResponse([{ id: "existing-row-id" }]));
      }
      if (u.includes("/storage/v1/object/") && init?.method === "DELETE") {
        deleteCalls.push(u);
        return Promise.resolve(jsonResponse({}));
      }
      if (u.includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch: ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const quote = makeQuote({ locations: [makeLocation({ images: [makeImage({ id: "img-1" })] })] });
    const result = await createProjectFromClosedWonQuote(quote, "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.copiedPhotos).toBe(0);
    expect(result.alreadyCopiedPhotos).toBe(1);
    expect(result.failedPhotos).toEqual([]);
    expect(deleteCalls).toHaveLength(1);
    // The deleted object is exactly this attempt's own copy destination
    // (a fresh, timestamped path unique to this call) -- never a path this
    // attempt didn't itself just create, which is what would be true of
    // the OTHER, winning concurrent attempt's own copy.
    expect(copiedDestinationKey).not.toBeNull();
    expect(deleteCalls[0]).toContain(copiedDestinationKey as unknown as string);
  });

  it("reports a real failure (not a false already-copied) if a 409 conflict's row can't actually be confirmed", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse(rpcResultOneLocation));
      if (u.includes("/storage/v1/object/copy")) return Promise.resolve(jsonResponse({}));
      if (u.includes("/rest/v1/project_location_images") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ code: "23505" }, 409));
      }
      if (u.includes("/rest/v1/project_location_images") && u.includes("source_quote_image_id=eq.")) {
        return Promise.resolve(jsonResponse([]));
      }
      if (u.includes("/storage/v1/object/") && init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({}));
      }
      if (u.includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch: ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const quote = makeQuote({ locations: [makeLocation({ images: [makeImage({ id: "img-1" })] })] });
    const result = await createProjectFromClosedWonQuote(quote, "token-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyCopiedPhotos).toBe(0);
    expect(result.failedPhotos).toEqual([
      { locationName: "Main Garage", fileName: "photo.jpg", reason: "The file copied but its record could not be confirmed." },
    ]);
  });

  it("does not retry on a 400 without `origin` (migration-087 fallback removed) -- reports the real error instead", async () => {
    let insertAttempts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("rpc/create_project_from_quote")) return Promise.resolve(jsonResponse(rpcResultOneLocation));
      if (u.includes("/storage/v1/object/copy")) return Promise.resolve(jsonResponse({}));
      if (u.includes("/rest/v1/project_location_images") && init?.method === "POST") {
        insertAttempts += 1;
        return Promise.resolve(jsonResponse({ message: "column \"origin\" does not exist" }, 400));
      }
      if (u.includes("/storage/v1/object/") && init?.method === "DELETE") return Promise.resolve(jsonResponse({}));
      if (u.includes("/rest/v1/projects?")) return Promise.resolve(jsonResponse([FINAL_PROJECT_ROW]));
      throw new Error(`unexpected fetch: ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const quote = makeQuote({ locations: [makeLocation({ images: [makeImage({ fileName: "front.jpg" })] })] });
    const result = await createProjectFromClosedWonQuote(quote, "token-1");
    expect(insertAttempts).toBe(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.failedPhotos).toEqual([
      { locationName: "Main Garage", fileName: "front.jpg", reason: "The file copied, but its photo record could not be saved. Try Create Project again." },
    ]);
  });
});
