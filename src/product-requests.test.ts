import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadProductRequests,
  loadProductRequestReviews,
  createProductRequest,
  logProductRequestReview,
  changeProductRequestStatus,
  releaseProductRequest,
} from "./persistence";

// Engineering/Product Development module, first release (migration 201,
// decision D14). Focused regression tests for the persistence.ts layer,
// matching this repo's established write-verification test convention
// (see support-cases.test.ts). Deliberately NOT a rendered-component
// test of EngineeringRequestsPage/NewProductRequestModal/
// ProductRequestDetailModal -- same main.tsx module-scope
// createRoot(...).render(...) constraint documented in
// auth-session-persistence.test.ts's own header. Verified live in
// production instead, after deploy.

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
});

function sampleProductRequestRow() {
  return {
    id: "req-1",
    workspace_id: "ws-1",
    request_number: "PR-2026-0001",
    title: "Outdoor housing revision",
    source_project_id: null,
    source_client_name: "Acme Co",
    requested_by_email: "pm@example.com",
    status: "submitted",
    requirements: "Needs IP67 rating",
    released_catalog_item_id: null,
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
  };
}

describe("loadProductRequests / loadProductRequestReviews -- a failed load must never look like an empty list", () => {
  it("maps a successful product_requests response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [sampleProductRequestRow()]));
    const result = await loadProductRequests("token-abc");
    expect(result).toEqual([
      {
        id: "req-1",
        workspaceId: "ws-1",
        requestNumber: "PR-2026-0001",
        title: "Outdoor housing revision",
        sourceProjectId: null,
        sourceClientName: "Acme Co",
        requestedByEmail: "pm@example.com",
        status: "submitted",
        requirements: "Needs IP67 rating",
        releasedCatalogItemId: null,
        createdAt: "2026-09-23T00:00:00Z",
        updatedAt: "2026-09-23T00:00:00Z",
      },
    ]);
  });

  it("throws (never returns []) when the request fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db down" }));
    await expect(loadProductRequests("token-abc")).rejects.toThrow("db down");
  });

  it("resolves to [] with no access token, rather than throwing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const result = await loadProductRequests(undefined);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loadProductRequestReviews throws (never returns []) when the request fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db down" }));
    await expect(loadProductRequestReviews("req-1", "token-abc")).rejects.toThrow("db down");
  });

  it("loadProductRequestReviews maps a successful response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(true, 200, [
        {
          id: "rev-1",
          product_request_id: "req-1",
          kind: "technical_review",
          outcome: "pass",
          notes: "Looks good",
          previous_status: "requirements_review",
          new_status: "prototyping",
          reviewed_by_email: "eng@example.com",
          reviewed_at: "2026-09-23T00:00:00Z",
        },
      ]),
    );
    const result = await loadProductRequestReviews("req-1", "token-abc");
    expect(result).toEqual([
      {
        id: "rev-1",
        productRequestId: "req-1",
        kind: "technical_review",
        outcome: "pass",
        notes: "Looks good",
        previousStatus: "requirements_review",
        newStatus: "prototyping",
        reviewedByEmail: "eng@example.com",
        reviewedAt: "2026-09-23T00:00:00Z",
      },
    ]);
  });
});

describe("createProductRequest", () => {
  it("posts the expected RPC body shape, including null defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, sampleProductRequestRow()));
    globalThis.fetch = fetchMock;
    await createProductRequest({ title: "Outdoor housing revision" }, "token-abc");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/create_product_request");
    expect(JSON.parse(init.body)).toEqual({
      p_title: "Outdoor housing revision",
      p_requirements: null,
      p_source_project_id: null,
      p_source_client_name: null,
    });
  });

  it("surfaces the real error detail on rejection (e.g. cross-workspace source project)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { message: "That project does not belong to your workspace." }));
    await expect(createProductRequest({ title: "x", sourceProjectId: "other-ws-project" }, "token-abc")).rejects.toThrow("does not belong to your workspace");
  });

  it("throws when called with no access token, never calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(createProductRequest({ title: "x" }, undefined)).rejects.toThrow("Not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("logProductRequestReview", () => {
  it("posts the expected RPC body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respond(true, 200, {
        id: "rev-1",
        product_request_id: "req-1",
        kind: "technical_review",
        outcome: "pass",
        notes: "Looks good",
        previous_status: "requirements_review",
        new_status: "prototyping",
        reviewed_by_email: "eng@example.com",
        reviewed_at: "2026-09-23T00:00:00Z",
      }),
    );
    globalThis.fetch = fetchMock;
    await logProductRequestReview({ productRequestId: "req-1", kind: "technical_review", outcome: "pass", notes: "Looks good" }, "token-abc");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ p_product_request_id: "req-1", p_kind: "technical_review", p_outcome: "pass", p_notes: "Looks good" });
  });

  it("rejects kind=release_readiness with the real server error, matching the RPC's own guard", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(false, 400, { message: "log_product_request_review only accepts technical_review or prototype_test -- use release_product_request() for release_readiness" }),
    );
    await expect(
      logProductRequestReview({ productRequestId: "req-1", kind: "technical_review" as never, outcome: "pass" }, "token-abc"),
    ).rejects.toThrow("release_product_request");
  });
});

describe("changeProductRequestStatus / releaseProductRequest", () => {
  it("changeProductRequestStatus posts the expected body, empty note becomes null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, sampleProductRequestRow()));
    globalThis.fetch = fetchMock;
    await changeProductRequestStatus("req-1", "requirements_review", "", "token-abc");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ p_product_request_id: "req-1", p_new_status: "requirements_review", p_note: null });
  });

  it("changeProductRequestStatus surfaces a rejected invalid transition (reaching released directly)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(false, 400, { message: "Invalid target status: released (use release_product_request() to reach released)" }),
    );
    await expect(changeProductRequestStatus("req-1", "submitted" as never, "", "token-abc")).rejects.toThrow("release_product_request");
  });

  it("releaseProductRequest (mode=new) posts the expected body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, { ...sampleProductRequestRow(), status: "released", released_catalog_item_id: "cat-1" }));
    globalThis.fetch = fetchMock;
    await releaseProductRequest(
      { productRequestId: "req-1", mode: "new", catalogNumber: "CAM-1042", productName: "Outdoor Housing v2", defaultSellPrice: 199.99, notes: "First release" },
      "token-abc",
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/release_product_request");
    expect(JSON.parse(init.body)).toEqual({
      p_product_request_id: "req-1",
      p_mode: "new",
      p_existing_catalog_item_id: null,
      p_catalog_number: "CAM-1042",
      p_product_name: "Outdoor Housing v2",
      p_sales_description: null,
      p_technical_description: null,
      p_category: null,
      p_default_sell_price: 199.99,
      p_notes: "First release",
    });
  });

  it("releaseProductRequest (mode=update) posts existingCatalogItemId and omits catalogNumber", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, sampleProductRequestRow()));
    globalThis.fetch = fetchMock;
    await releaseProductRequest({ productRequestId: "req-1", mode: "update", existingCatalogItemId: "cat-1", productName: "Revised name" }, "token-abc");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.p_existing_catalog_item_id).toBe("cat-1");
    expect(body.p_catalog_number).toBeNull();
    expect(body.p_default_sell_price).toBe(0);
  });

  it("releaseProductRequest surfaces a rejected cross-workspace catalog item", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { message: "That catalog item does not belong to this request's workspace" }));
    await expect(
      releaseProductRequest({ productRequestId: "req-1", mode: "update", existingCatalogItemId: "other-ws-item" }, "token-abc"),
    ).rejects.toThrow("does not belong to this request's workspace");
  });

  it("releaseProductRequest surfaces a rejected not-release-ready request", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { message: "Only a release_ready request can be released (current status: submitted)" }));
    await expect(releaseProductRequest({ productRequestId: "req-1", mode: "new", catalogNumber: "X" }, "token-abc")).rejects.toThrow("release_ready");
  });
});
