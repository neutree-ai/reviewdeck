import { describe, expect, it } from "vitest";
import { NapPlatform } from "./platform.ts";
import type { Session } from "../storage/interface.ts";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "review-1",
    reviewToken: "t",
    status: "completed",
    userId: "alice",
    agentSessionId: "nap-session-1",
    agentWorkspaceId: "ws-1",
    splitMeta: { groups: [] },
    subPatches: [],
    submission: { comments: [], draftComments: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// A fake platform: issues user tokens and answers chat with the given statuses in turn.
function fakeNap(chatStatuses: number[]) {
  const chats: { path: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/token")) {
      return Response.json({ access_token: "user-token", expires_in: 3600 });
    }
    if (url.pathname.endsWith("/chat")) {
      chats.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
      const status = chatStatuses.shift() ?? 202;
      return Response.json(status === 409 ? { code: "session_busy" } : {}, { status });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof globalThis.fetch;
  const nap = new NapPlatform(
    { baseUrl: "https://nap.test", clientId: "rd", clientSecret: "s", agent: "reviewer", fetch },
    async () => {},
  );
  return { nap, chats };
}

describe("NapPlatform.notifySubmitted", () => {
  it("posts the submission into the session that asked for the review", async () => {
    const { nap, chats } = fakeNap([202]);
    await nap.notifySubmitted(session());
    expect(chats).toHaveLength(1);
    expect(chats[0]!.path).toBe("/api/workspaces/ws-1/chat");
    expect(chats[0]!.body).toMatchObject({ session_id: "nap-session-1", mode: "async" });
    expect(chats[0]!.body.message).toContain("review-1");
  });

  it("waits out a turn that is still running", async () => {
    const { nap, chats } = fakeNap([409, 409, 202]);
    await nap.notifySubmitted(session());
    expect(chats).toHaveLength(3);
  });

  it("leaves reviews the platform did not vouch for alone", async () => {
    const { nap, chats } = fakeNap([]);
    await nap.notifySubmitted(session({ agentWorkspaceId: undefined }));
    expect(chats).toHaveLength(0);
  });
});
