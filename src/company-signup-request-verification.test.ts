import { describe, it, expect, vi } from "vitest";
import { requestCompanySignup } from "./persistence";

// Migration 196's own item 7 (2026-09-22, E's review): api/request-
// company-signup.js deliberately returns a 200 with submitted:false (not
// a 4xx/5xx) when Supabase env vars are missing, so a misconfigured
// deploy doesn't look like a validation error -- but requestCompanySignup
// used to only check response.ok, which is true for ANY 200 regardless
// of the submitted field. Found live-testing the feature: the public
// form showed "Request received" even when nothing had actually been
// submitted. This is the same class of bug this repo's own standing
// "verify writes affected rows, not just response.ok" lesson already
// covers for every other write path (see purchasing-write-verification
// .test.ts, inventory-and-project-write-verification.test.ts).

function respond(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

describe("requestCompanySignup -- submitted:false is treated as failure, not success", () => {
  it("resolves without throwing when the API reports submitted:true", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, { submitted: true }));
    await expect(requestCompanySignup("Acme Co", "Jane", "jane@acmeco.com")).resolves.toBeUndefined();
  });

  it("throws when the API returns 200 with submitted:false (e.g. misconfigured deploy)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, { submitted: false, reason: "Not configured." }));
    await expect(requestCompanySignup("Acme Co", "Jane", "jane@acmeco.com")).rejects.toThrow("Not configured.");
  });

  it("throws when the API returns a non-200 error response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { error: "Could not submit this signup request. Please check the details and try again." }));
    await expect(requestCompanySignup("Acme Co", "Jane", "jane@acmeco.com")).rejects.toThrow("Could not submit this signup request");
  });

  it("throws a generic message when the API returns 200 with no submitted field at all", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await expect(requestCompanySignup("Acme Co", "Jane", "jane@acmeco.com")).rejects.toThrow("Could not submit this signup request.");
  });
});
