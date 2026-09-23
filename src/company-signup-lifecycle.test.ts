import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchCompanySignupByToken,
  acceptCompanySignup,
  companySignupTokenState,
  revokeCompanySignupToken,
  regenerateCompanySignupToken,
  type CompanySignupRequest,
} from "./persistence";

// Migration 196/197's own claim-path hardening, item 6 of E's review:
// focused regression tests for the status/outcome mappers and the new
// lifecycle controls (revoke/regenerate), matching this repo's own
// established write-verification test convention (see
// purchasing-write-verification.test.ts et al.).

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

describe("fetchCompanySignupByToken -- maps get_company_signup_by_token's real status", () => {
  it("maps a valid, unused, unexpired token to status: valid", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ company_name: "Acme Co", status: "valid" }]));
    const result = await fetchCompanySignupByToken("11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({ companyName: "Acme Co", status: "valid" });
  });

  it.each(["expired", "revoked", "used"])("maps status: %s through unchanged", async (status) => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ company_name: "Acme Co", status }]));
    const result = await fetchCompanySignupByToken("11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({ companyName: "Acme Co", status });
  });

  it("maps zero rows (a token that never matched anything) to not_found with no company name", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, []));
    const result = await fetchCompanySignupByToken("11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({ companyName: null, status: "not_found" });
  });

  it("maps a non-ok response to not_found rather than throwing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    const result = await fetchCompanySignupByToken("11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({ companyName: null, status: "not_found" });
  });

  it("falls back to not_found for an unrecognized status value rather than trusting it blindly", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ company_name: "Acme Co", status: "some_future_value_this_client_does_not_know_about" }]));
    const result = await fetchCompanySignupByToken("11111111-1111-1111-1111-111111111111");
    expect(result.status).toBe("not_found");
  });

  it("never calls fetch for an empty token", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const result = await fetchCompanySignupByToken("");
    expect(result).toEqual({ companyName: null, status: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("acceptCompanySignup -- passes through every real outcome", () => {
  it.each([
    "accepted",
    "not_found",
    "expired",
    "revoked",
    "already_used",
    "email_not_confirmed",
    "email_mismatch",
    "already_member_of_another_workspace",
  ])("passes through outcome: %s unchanged", async (outcome) => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, [{ outcome, joined_workspace_id: outcome === "accepted" ? "ws-1" : null }]));
    const result = await acceptCompanySignup("11111111-1111-1111-1111-111111111111", "token-abc");
    expect(result.outcome).toBe(outcome);
    expect(result.workspaceId).toBe(outcome === "accepted" ? "ws-1" : null);
  });

  it("throws with the real Postgres error detail on a non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { message: "Must be signed in to accept a company signup" }));
    await expect(acceptCompanySignup("11111111-1111-1111-1111-111111111111", "token-abc")).rejects.toThrow("Must be signed in to accept a company signup");
  });

  it("throws when called with no access token, never calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(acceptCompanySignup("11111111-1111-1111-1111-111111111111", undefined)).rejects.toThrow("Not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function makeRequest(overrides: Partial<CompanySignupRequest>): CompanySignupRequest {
  return {
    id: "req-1",
    companyName: "Acme Co",
    requesterName: "Jane",
    requesterEmail: "jane@acmeco.com",
    status: "approved",
    reviewedBy: "admin-1",
    reviewedAt: new Date().toISOString(),
    rejectionReason: null,
    createdWorkspaceId: "ws-1",
    signupToken: "11111111-1111-1111-1111-111111111111",
    signupTokenUsedAt: null,
    signupTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    signupTokenRevokedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("companySignupTokenState -- mirrors get_company_signup_by_token's own server-side CASE", () => {
  it("reports not_applicable for a pending request (no token exists yet)", () => {
    expect(companySignupTokenState(makeRequest({ status: "pending", signupToken: null, signupTokenExpiresAt: null }))).toBe("not_applicable");
  });

  it("reports not_applicable for a rejected request", () => {
    expect(companySignupTokenState(makeRequest({ status: "rejected", signupToken: null, signupTokenExpiresAt: null }))).toBe("not_applicable");
  });

  it("reports revoked when signupTokenRevokedAt is set, even if not yet expired or used", () => {
    expect(companySignupTokenState(makeRequest({ signupTokenRevokedAt: new Date().toISOString() }))).toBe("revoked");
  });

  it("reports expired when signupTokenExpiresAt is in the past", () => {
    expect(companySignupTokenState(makeRequest({ signupTokenExpiresAt: new Date(Date.now() - 1000).toISOString() }))).toBe("expired");
  });

  it("reports used when signupTokenUsedAt is set and the token is not expired or revoked", () => {
    expect(companySignupTokenState(makeRequest({ signupTokenUsedAt: new Date().toISOString() }))).toBe("used");
  });

  it("reports valid for an approved, unused, unexpired, unrevoked token", () => {
    expect(companySignupTokenState(makeRequest({}))).toBe("valid");
  });

  it("revoked takes priority over expired when both are somehow true", () => {
    expect(
      companySignupTokenState(
        makeRequest({
          signupTokenRevokedAt: new Date().toISOString(),
          signupTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      ),
    ).toBe("revoked");
  });
});

describe("revokeCompanySignupToken / regenerateCompanySignupToken -- write-verification", () => {
  it("revoke succeeds silently on a 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await expect(revokeCompanySignupToken("req-1", "token-abc")).resolves.toBeUndefined();
  });

  it("revoke surfaces the real error detail, not just response.ok, when the RPC rejects it", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { message: "This token has already been used -- nothing to revoke" }));
    await expect(revokeCompanySignupToken("req-1", "token-abc")).rejects.toThrow("This token has already been used");
  });

  it("regenerate returns the new token on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, { signup_token: "22222222-2222-2222-2222-222222222222" }));
    const result = await regenerateCompanySignupToken("req-1", "token-abc");
    expect(result).toEqual({ signupToken: "22222222-2222-2222-2222-222222222222" });
  });

  it("regenerate surfaces the real error detail when the RPC rejects it", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 400, { message: "This request has already been accepted -- nothing to regenerate" }));
    await expect(regenerateCompanySignupToken("req-1", "token-abc")).rejects.toThrow("already been accepted");
  });

  it("both throw when called with no access token, never calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(revokeCompanySignupToken("req-1", undefined)).rejects.toThrow("Not configured.");
    await expect(regenerateCompanySignupToken("req-1", undefined)).rejects.toThrow("Not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
