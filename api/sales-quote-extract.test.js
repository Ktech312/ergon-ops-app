import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockRes, mockFetchRouter, jsonResponse } from "./_test-helpers.js";

const handler = (await import("./sales-quote-extract.js")).default;

const CALLER = { id: "caller-uuid", email: "caller@ergon.test" };

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  delete process.env.OPENAI_API_KEY;
  vi.clearAllMocks();
});

// This route reads its JSON body via `for await (const chunk of req)`
// (bodyParser is disabled -- it also accepts multipart PDF uploads,
// which this suite doesn't exercise). Auth/role/rate-limit checks all
// run before that read, so most scenarios here never need a real body.
function streamingReq({ method = "POST", token, jsonBody = "{}" } = {}) {
  return {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(jsonBody);
    },
  };
}

function routerFor({ isAdmin = false, roleKeys = [] }) {
  return mockFetchRouter([
    { match: "/auth/v1/user", respond: () => jsonResponse(200, CALLER) },
    { match: "/rest/v1/app_admins", respond: () => jsonResponse(200, isAdmin ? [{ user_id: CALLER.id }] : []) },
    { match: "/rest/v1/app_user_roles", respond: () => jsonResponse(200, roleKeys.map((role_key) => ({ role_key }))) },
  ]);
}

describe("sales-quote-extract: authorization gate", () => {
  it("signed-out caller: 401, never reads the body", async () => {
    global.fetch = vi.fn(mockFetchRouter([{ match: "/auth/v1/user", respond: () => jsonResponse(401, {}) }]));
    const res = createMockRes();
    await handler(streamingReq(), res);
    expect(res.statusCode).toBe(401);
  });

  it("signed-in but unauthorized role (e.g. warehouse, engineering): 403", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["warehouse"] }));
    const res = createMockRes();
    await handler(streamingReq({ token: "t" }), res);
    expect(res.statusCode).toBe(403);
  });

  it("sales role: authorized", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["sales"] }));
    const res = createMockRes();
    await handler(streamingReq({ token: "t", jsonBody: JSON.stringify({ text: "PREPARED FOR\nAcme Co\n", sourceFile: "quote.pdf" }) }), res);
    expect(res.statusCode).toBe(200);
  });

  it("pm role: authorized (see the code comment on the deliberate deviation from the literal sales/manager/admin-only default)", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["pm"] }));
    const res = createMockRes();
    await handler(streamingReq({ token: "t", jsonBody: JSON.stringify({ text: "PREPARED FOR\nAcme Co\n" }) }), res);
    expect(res.statusCode).toBe(200);
  });

  it("manager role: authorized", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["manager"] }));
    const res = createMockRes();
    await handler(streamingReq({ token: "t", jsonBody: JSON.stringify({ text: "PREPARED FOR\nAcme Co\n" }) }), res);
    expect(res.statusCode).toBe(200);
  });

  it("admin bypasses the role list entirely", async () => {
    global.fetch = vi.fn(routerFor({ isAdmin: true }));
    const res = createMockRes();
    await handler(streamingReq({ token: "t", jsonBody: JSON.stringify({ text: "PREPARED FOR\nAcme Co\n" }) }), res);
    expect(res.statusCode).toBe(200);
  });

  it("rate-limits a caller who fires far more extraction requests than a real UI could in a minute", async () => {
    global.fetch = vi.fn(routerFor({ roleKeys: ["sales"] }));
    let lastStatus;
    for (let i = 0; i < 12; i += 1) {
      const res = createMockRes();
      await handler(streamingReq({ token: "t" }), res);
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });
});
