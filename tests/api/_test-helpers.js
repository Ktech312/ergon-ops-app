// Shared by tests/api/*.test.js -- not matched by vitest's test-file
// glob itself (no ".test." in the name), just an importable helper.
// Lives outside api/ itself, same reason the *.test.js files do -- see
// the comment in vitest.config.ts.

export function createMockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  };
}

export function createMockReq({ method = "POST", body = {}, token } = {}) {
  return {
    method,
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

// Builds a fetch mock that dispatches to the first matching handler by
// substring match against the request URL, in order. Each route file
// under test makes several real fetch calls (auth check, role lookup,
// entity lookup, the actual send) -- this lets a test describe only the
// URLs it cares about instead of a rigid call-by-call sequence.
export function mockFetchRouter(handlers) {
  return async (url, options) => {
    const urlStr = String(url);
    for (const handler of handlers) {
      if (urlStr.includes(handler.match)) {
        return handler.respond(urlStr, options);
      }
    }
    throw new Error(`mockFetchRouter: no handler matched ${urlStr}`);
  };
}

export function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

// A real Supabase /auth/v1/user success response, keyed by token so a
// test can simulate two different signed-in callers.
export function authUserResponse(user) {
  return jsonResponse(200, user);
}

// System Health Phase B (migrations 151/152) call sites fire a
// best-effort RPC on nearly every code path in several routes now
// (cron, rate-limit) -- most tests for those routes don't care about
// System Health at all and would otherwise need to either add their own
// matcher or (worse) silently log a caught "no handler matched" error
// that has nothing to do with what the test is actually checking. Spread
// this into a test's own handler list for a benign, ignore-it default;
// a test that DOES care about System Health behavior adds its own
// more specific matcher for these same URLs instead (listed first, so
// it wins -- mockFetchRouter matches in order).
export function systemHealthRpcHandlers() {
  return [
    { match: "/rest/v1/rpc/record_system_health_event", respond: () => jsonResponse(200, { event_id: "test-event-id", alert_worthy: false }) },
    { match: "/rest/v1/rpc/record_system_health_recovery", respond: () => jsonResponse(200, { recovered: false, was_alerted: false }) },
  ];
}
