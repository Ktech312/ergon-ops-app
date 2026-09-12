import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  addDirectMessageReaction,
  removeDirectMessageReaction,
  addChannelMessageReaction,
  removeChannelMessageReaction,
  markNotificationRead,
  markAllNotificationsRead,
  updateSalesQuoteLocation,
  updateSalesQuoteLocationItem,
  updateSalesQuoteLocationImageDescription,
  updateSalesQuoteLocationImageMeta,
  moveSalesQuoteLocationImage,
  updateProjectLocation,
  updateProjectLocationItem,
} from "./persistence";

// Overnight reliability closeout part 2 (2026-09-12, task 2): a fresh
// audit of the remaining unchecked-write list found a large group of
// functions that are all genuinely fire-and-forget -- each caller either
// already has its own `.catch(() => {})` (the two notification
// functions) or has NO try/catch anywhere in the chain down to a raw
// onClick/onChange handler (the message-reaction and location/location-
// item updaters), and several are reconciled within seconds by an
// existing 5s poll (message reactions). Making any of these throw would
// only produce a genuine unhandled promise rejection -- a worse failure
// mode than today's silent no-op. These tests lock in the correct fix
// for this whole class: log the real status/body on failure, stay
// non-throwing, change no caller behavior.
//
// The three sales-quote-location-image functions are a related but
// distinct case: each already returns its real response.ok to a caller
// that DOES use the boolean, so these tests confirm the boolean return
// contract is unchanged while the missing diagnostic logging is added.

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
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("message reactions -- logging only, never throw", () => {
  const cases: Array<[string, (accessToken: string) => Promise<void>, string]> = [
    ["addDirectMessageReaction", (token) => addDirectMessageReaction("msg-1", "user-1", "👍", token), "addDirectMessageReaction: insert failed for message msg-1 (500)"],
    ["removeDirectMessageReaction", (token) => removeDirectMessageReaction("msg-1", "user-1", "👍", token), "removeDirectMessageReaction: delete failed for message msg-1 (500)"],
    ["addChannelMessageReaction", (token) => addChannelMessageReaction("msg-1", "user-1", "👍", token), "addChannelMessageReaction: insert failed for message msg-1 (500)"],
    ["removeChannelMessageReaction", (token) => removeChannelMessageReaction("msg-1", "user-1", "👍", token), "removeChannelMessageReaction: delete failed for message msg-1 (500)"],
  ];

  for (const [name, call, expectedLog] of cases) {
    it(`${name} logs and does not throw on failure`, async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
      await expect(call("token")).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining(expectedLog));
    });

    it(`${name} does not log on success`, async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
      await call("token");
      expect(console.error).not.toHaveBeenCalled();
    });
  }
});

describe("notifications -- logging only, never throw (callers already .catch(() => {}))", () => {
  it("markNotificationRead logs and does not throw on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(markNotificationRead("notif-1", "token")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("markNotificationRead: PATCH failed for notification notif-1 (500)"));
  });

  it("markAllNotificationsRead logs and does not throw on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(markAllNotificationsRead("user@example.com", "token")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("markAllNotificationsRead: PATCH failed for user@example.com (500)"));
  });
});

describe("sales quote / project location(-item) updaters -- logging only, never throw", () => {
  it("updateSalesQuoteLocation logs and does not throw on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateSalesQuoteLocation("loc-1", { name: "New Name" }, "token")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateSalesQuoteLocation: PATCH failed for location loc-1 (500)"));
  });

  it("updateSalesQuoteLocationItem logs and does not throw on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateSalesQuoteLocationItem("item-1", { qty: 2 }, "token")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateSalesQuoteLocationItem: PATCH failed for item item-1 (500)"));
  });

  it("updateProjectLocation logs and does not throw on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateProjectLocation("loc-1", { name: "New Name" }, "token")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateProjectLocation: PATCH failed for location loc-1 (500)"));
  });

  it("updateProjectLocationItem logs and does not throw on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateProjectLocationItem("item-1", { qty: 2 }, "token")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateProjectLocationItem: PATCH failed for item item-1 (500)"));
  });
});

describe("sales quote location image writers -- logging added, boolean contract unchanged", () => {
  it("updateSalesQuoteLocationImageDescription logs and still returns false on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateSalesQuoteLocationImageDescription("img-1", "new description", "token")).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateSalesQuoteLocationImageDescription: PATCH failed for image img-1 (500)"));
  });

  it("updateSalesQuoteLocationImageMeta logs and still returns false on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(updateSalesQuoteLocationImageMeta("img-1", { fileName: "new.jpg" }, "token")).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("updateSalesQuoteLocationImageMeta: PATCH failed for image img-1 (500)"));
  });

  it("moveSalesQuoteLocationImage logs and still returns false on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db error" }));
    await expect(moveSalesQuoteLocationImage("img-1", "loc-2", "token")).resolves.toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("moveSalesQuoteLocationImage: PATCH failed for image img-1 (500)"));
  });

  it("all three still return true/success shape and do not log when the write succeeds", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(true, 200, {}));
    await expect(updateSalesQuoteLocationImageDescription("img-1", "x", "token")).resolves.toBe(true);
    await expect(updateSalesQuoteLocationImageMeta("img-1", { fileName: "x" }, "token")).resolves.toBe(true);
    await expect(moveSalesQuoteLocationImage("img-1", "loc-2", "token")).resolves.toBe(true);
    expect(console.error).not.toHaveBeenCalled();
  });
});
