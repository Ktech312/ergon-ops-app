import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadAuthSession, saveAuthSession, signInWithPassword, signInWithGoogleRedirect, consumeOAuthRedirectSession, signOut, type AuthSession } from "./persistence";

// Login page redesign (2026-09-22), item 9: "Remember me" honesty --
// checked persists in localStorage (survives closing the browser),
// unchecked persists only in sessionStorage (ends when this browser
// session closes), and sign-out/OAuth-return/refresh must all preserve
// or clear the correct storage. These tests exercise persistence.ts's
// actual storage-selection logic directly.
//
// Deliberately NOT a rendered-component test of the login screen itself
// (no "Create user" button, keyboard Enter-to-submit, the role="alert"
// accessible failure message, business-signup navigation) -- main.tsx
// executes a real createRoot(...).render(...) at module scope (its own
// last few lines), so importing it at all in a test would attempt a real
// DOM render immediately; rendering it under React Testing Library would
// require pulling App/RequestCompanySignupPage/etc. into their own
// module first, a structural refactor well beyond this batch's actual
// scope. Those behaviors were instead verified live in a real browser
// (screenshot walkthrough, DOM queries for role="alert" and 44px touch
// targets, and a real failed-login round trip against production
// Supabase Auth) -- see this batch's own commit message for the detail.

const AUTH_SESSION_KEY = "ergon:auth-session:v1";
const AUTH_REMEMBER_HINT_KEY = "ergon:auth-remember-hint:v1";

function respond(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function sampleSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    accessToken: "access-token-abc",
    refreshToken: "refresh-token-abc",
    expiresAt: Date.now() + 3600_000,
    email: "person@example.com",
    userId: "user-1",
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});

describe("saveAuthSession / loadAuthSession -- remember-me storage split", () => {
  it("remember=true writes to localStorage and clears any sessionStorage copy", () => {
    window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sampleSession({ userId: "stale" })));
    const session = sampleSession();
    saveAuthSession(session, true);
    expect(JSON.parse(window.localStorage.getItem(AUTH_SESSION_KEY)!)).toEqual(session);
    expect(window.sessionStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });

  it("remember=false writes to sessionStorage and clears any localStorage copy", () => {
    window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sampleSession({ userId: "stale" })));
    const session = sampleSession();
    saveAuthSession(session, false);
    expect(JSON.parse(window.sessionStorage.getItem(AUTH_SESSION_KEY)!)).toEqual(session);
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });

  it("omitting remember preserves an existing session-only (sessionStorage) session -- e.g. a token refresh must not upgrade it", () => {
    saveAuthSession(sampleSession({ userId: "original" }), false);
    const refreshed = sampleSession({ userId: "refreshed", accessToken: "new-token" });
    saveAuthSession(refreshed);
    expect(JSON.parse(window.sessionStorage.getItem(AUTH_SESSION_KEY)!)).toEqual(refreshed);
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });

  it("omitting remember preserves an existing remembered (localStorage) session", () => {
    saveAuthSession(sampleSession({ userId: "original" }), true);
    const refreshed = sampleSession({ userId: "refreshed", accessToken: "new-token" });
    saveAuthSession(refreshed);
    expect(JSON.parse(window.localStorage.getItem(AUTH_SESSION_KEY)!)).toEqual(refreshed);
    expect(window.sessionStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });

  it("omitting remember with no prior session defaults to localStorage (matches this app's pre-remember-me behavior)", () => {
    const session = sampleSession();
    saveAuthSession(session);
    expect(JSON.parse(window.localStorage.getItem(AUTH_SESSION_KEY)!)).toEqual(session);
  });

  it("saveAuthSession(null) clears both storage locations", () => {
    saveAuthSession(sampleSession(), true);
    saveAuthSession(null);
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });

  it("loadAuthSession reads an existing localStorage session -- an already-remembered session from before this change keeps loading, nobody gets silently signed out by this deployment", () => {
    const session = sampleSession();
    window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    expect(loadAuthSession()).toEqual(session);
  });

  it("loadAuthSession falls back to sessionStorage when localStorage has nothing", () => {
    const session = sampleSession();
    window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    expect(loadAuthSession()).toEqual(session);
  });

  it("loadAuthSession prefers localStorage when both somehow have a session", () => {
    window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sampleSession({ userId: "session-only" })));
    window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sampleSession({ userId: "remembered" })));
    expect(loadAuthSession()?.userId).toBe("remembered");
  });

  it("loadAuthSession returns null when neither storage has a session", () => {
    expect(loadAuthSession()).toBeNull();
  });
});

describe("signInWithPassword -- remember-me threads through to storage", () => {
  it("remember=true persists to localStorage", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, { access_token: "at", refresh_token: "rt", expires_in: 3600, user: { id: "u1", email: "a@b.com" } }));
    await signInWithPassword("a@b.com", "password123", true);
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).not.toBeNull();
    expect(window.sessionStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });

  it("remember=false persists only to sessionStorage", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, { access_token: "at", refresh_token: "rt", expires_in: 3600, user: { id: "u1", email: "a@b.com" } }));
    await signInWithPassword("a@b.com", "password123", false);
    expect(window.sessionStorage.getItem(AUTH_SESSION_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });

  it("defaults to remember=false (session-only) when not passed -- matches the login checkbox's own unchecked default", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, { access_token: "at", refresh_token: "rt", expires_in: 3600, user: { id: "u1", email: "a@b.com" } }));
    await signInWithPassword("a@b.com", "password123");
    expect(window.sessionStorage.getItem(AUTH_SESSION_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });
});

describe("signOut -- clears both storage locations", () => {
  it("clears a remembered (localStorage) session", async () => {
    saveAuthSession(sampleSession(), true);
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await signOut(sampleSession());
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });

  it("clears a session-only (sessionStorage) session", async () => {
    saveAuthSession(sampleSession(), false);
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await signOut(sampleSession());
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });

  it("clears both even when the logout network call itself fails (best-effort, never blocks sign-out)", async () => {
    saveAuthSession(sampleSession(), true);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    await signOut(sampleSession());
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });
});

describe("signInWithGoogleRedirect / consumeOAuthRedirectSession -- remember-me survives the redirect", () => {
  // jsdom's window.location.assign is a real, non-configurable navigation
  // that throws "Not implemented: navigation" rather than actually
  // navigating -- signInWithGoogleRedirect writes the remember hint
  // BEFORE calling it, so that write is already done by the time this
  // throws; the try/catch here is only swallowing jsdom's own
  // navigation-not-implemented noise, not asserting anything about it.
  it("signInWithGoogleRedirect stashes a remembered hint in sessionStorage before navigating away", () => {
    try {
      signInWithGoogleRedirect(true);
    } catch {
      // jsdom does not implement real navigation -- expected, ignored.
    }
    expect(window.sessionStorage.getItem(AUTH_REMEMBER_HINT_KEY)).toBe("1");
  });

  it("signInWithGoogleRedirect(false) stashes a session-only hint", () => {
    try {
      signInWithGoogleRedirect(false);
    } catch {
      // jsdom does not implement real navigation -- expected, ignored.
    }
    expect(window.sessionStorage.getItem(AUTH_REMEMBER_HINT_KEY)).toBe("0");
  });

  it("consumeOAuthRedirectSession honors a remembered hint and clears it after use", async () => {
    window.sessionStorage.setItem(AUTH_REMEMBER_HINT_KEY, "1");
    window.history.replaceState(null, "", "/#access_token=at&refresh_token=rt&expires_in=3600&type=");
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, { id: "u1", email: "oauth@example.com" }));

    const session = await consumeOAuthRedirectSession();

    expect(session?.email).toBe("oauth@example.com");
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).not.toBeNull();
    expect(window.sessionStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_REMEMBER_HINT_KEY)).toBeNull();
  });

  it("consumeOAuthRedirectSession defaults to session-only when no hint was stashed", async () => {
    window.history.replaceState(null, "", "/#access_token=at2&refresh_token=rt2&expires_in=3600&type=");
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, { id: "u2", email: "oauth2@example.com" }));

    const session = await consumeOAuthRedirectSession();

    expect(session?.email).toBe("oauth2@example.com");
    expect(window.sessionStorage.getItem(AUTH_SESSION_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });
});
