import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadConversations, createGroupConversation, canonicalConversationPair } from "./persistence";

// Multi-person direct conversations (migration 203, ad-hoc group DMs). Focused regression
// tests for the persistence.ts layer, matching this repo's established convention (see
// support-cases.test.ts/product-requests.test.ts). Membership is fixed at creation this
// release (no Add People/Leave Group) -- see PRODUCT_MULTIPERSON_CONVERSATIONS_DESIGN.md.

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

function oneToOneRow(id: string, a: string, b: string) {
  return {
    id,
    participant_a_id: a,
    participant_b_id: b,
    is_group: false,
    title: null,
    last_message_at: "2026-09-24T00:00:00Z",
    created_at: "2026-09-24T00:00:00Z",
  };
}

function groupRow(id: string, title: string | null) {
  return {
    id,
    participant_a_id: null,
    participant_b_id: null,
    is_group: true,
    title,
    last_message_at: "2026-09-24T01:00:00Z",
    created_at: "2026-09-24T01:00:00Z",
  };
}

describe("canonicalConversationPair -- unchanged 1:1 dedupe ordering", () => {
  it("sorts the two ids regardless of call order", () => {
    expect(canonicalConversationPair("b", "a")).toEqual(["a", "b"]);
    expect(canonicalConversationPair("a", "b")).toEqual(["a", "b"]);
  });
});

describe("loadConversations -- 1:1 conversations are unaffected by group support", () => {
  it("returns only 1:1 conversations when the user has no group memberships", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("conversation_members?user_id=eq.")) return respond(true, 200, []);
      if (url.includes("conversations?or=")) return respond(true, 200, [oneToOneRow("conv-1", "me", "other")]);
      throw new Error("unexpected fetch: " + url);
    });
    globalThis.fetch = fetchMock;
    const result = await loadConversations("me", "token-abc");
    expect(result).toEqual([
      expect.objectContaining({ id: "conv-1", isGroup: false, participantAId: "me", participantBId: "other", memberUserIds: ["me", "other"] }),
    ]);
    // No group-conversation follow-up requests fired when there are zero memberships.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resolves to [] with no access token, rather than throwing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const result = await loadConversations("me", undefined);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("loadConversations -- group conversations", () => {
  it("merges 1:1 and group conversations, sorted by last_message_at, with real member lists", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("conversation_members?user_id=eq.")) {
        return respond(true, 200, [{ conversation_id: "group-1" }]);
      }
      if (url.includes("conversations?or=")) {
        return respond(true, 200, [oneToOneRow("conv-1", "me", "other")]);
      }
      if (url.includes("conversations?id=in.")) {
        return respond(true, 200, [groupRow("group-1", "ZZ Test Group")]);
      }
      if (url.includes("conversation_members?conversation_id=in.")) {
        return respond(true, 200, [
          { conversation_id: "group-1", user_id: "me" },
          { conversation_id: "group-1", user_id: "other" },
          { conversation_id: "group-1", user_id: "third" },
        ]);
      }
      throw new Error("unexpected fetch: " + url);
    });
    globalThis.fetch = fetchMock;
    const result = await loadConversations("me", "token-abc");
    expect(result).toHaveLength(2);
    // group-1's last_message_at (01:00) is newer than conv-1's (00:00) -- sorted first.
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: "group-1",
        isGroup: true,
        title: "ZZ Test Group",
        participantAId: null,
        participantBId: null,
        memberUserIds: expect.arrayContaining(["me", "other", "third"]),
      }),
    );
    expect(result[1]).toEqual(expect.objectContaining({ id: "conv-1", isGroup: false }));
  });

  it("returns [] (does not throw) when the 1:1 request itself fails -- unchanged pre-203 contract", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(respond(false, 500, { message: "db down" }));
    const result = await loadConversations("me", "token-abc");
    // loadConversations has always silently returned [] on failure (a background poll, not
    // a user-initiated load) -- unlike loadSupportCases/loadProductRequests, which throw.
    // Confirmed this migration doesn't change that contract, not a newly-introduced gap.
    expect(result).toEqual([]);
  });
});

describe("createGroupConversation", () => {
  it("posts the expected RPC body and includes the creator in the returned member list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, groupRow("group-1", "Launch Team")));
    globalThis.fetch = fetchMock;
    const result = await createGroupConversation(["other", "third"], "Launch Team", "me", "token-abc");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("rpc/create_group_conversation");
    expect(JSON.parse(init.body)).toEqual({ p_title: "Launch Team", p_member_user_ids: ["other", "third"] });
    expect(result.isGroup).toBe(true);
    expect(result.memberUserIds).toEqual(["me", "other", "third"]);
  });

  it("sends null for an empty/whitespace-only title, matching the RPC's own optional-title contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(true, 200, groupRow("group-1", null)));
    globalThis.fetch = fetchMock;
    await createGroupConversation(["other", "third"], "   ", "me", "token-abc");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.p_title).toBeNull();
  });

  it("surfaces the real error detail on rejection (e.g. a cross-workspace member)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      respond(false, 400, { message: "Every member must be an active member of your own workspace." }),
    );
    await expect(createGroupConversation(["other", "cross-ws"], undefined, "me", "token-abc")).rejects.toThrow(
      "active member of your own workspace",
    );
  });

  it("throws when called with no access token, never calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(createGroupConversation(["other"], undefined, "me", undefined)).rejects.toThrow("Not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
