import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { CallerVerifier } from "@neutree-ai/server-sdk";
import { MemoryStorage } from "../storage/memory.ts";
import { ReviewDeckOAuthProvider } from "../auth/provider.ts";
import { createMcpAuthMiddleware } from "../auth/middleware.ts";
import { initSigningKey } from "../auth/token.ts";
import { createMcpRouter } from "./transport.ts";
import type { Session } from "../storage/interface.ts";

initSigningKey();

const NAP = "https://nap.test";
const CLIENT_ID = "reviewdeck";
const BASE = "http://rd.test";

const DIFF = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
+new
`;

let privateKey: CryptoKey;
let verifier: CallerVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256" };
  const fetchJwks = (async () => Response.json({ keys: [jwk] })) as unknown as typeof fetch;
  verifier = new CallerVerifier({ baseUrl: NAP, clientId: CLIENT_ID, fetch: fetchJwks });
});

function statement(claims: Record<string, unknown>, key = privateKey) {
  return new SignJWT({ aud: CLIENT_ID, sub: "nap-user", workspace_id: "ws-1", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setExpirationTime("5m")
    .sign(key);
}

function setup() {
  const storage = new MemoryStorage();
  const provider = new ReviewDeckOAuthProvider(storage, BASE);
  const app = new Hono();
  app.use("/mcp/*", createMcpAuthMiddleware(provider, verifier));
  app.route("/mcp", createMcpRouter(storage, BASE));
  return { app, storage };
}

async function callTool(
  app: Hono,
  headers: Record<string, string>,
  name: string,
  args: Record<string, unknown>,
) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  if (res.status !== 200) return { status: res.status, result: undefined };
  const data = text.match(/^data: (.*)$/m)?.[1] ?? text;
  const payload = JSON.parse(data).result.content[0].text;
  return { status: res.status, result: JSON.parse(payload) as Record<string, unknown> };
}

function sessionOf(userId: string): Session {
  return {
    id: `s-${userId}`,
    reviewToken: `t-${userId}`,
    status: "reviewing",
    userId,
    splitMeta: { groups: [] },
    subPatches: [],
    submission: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("MCP auth for platform callers", () => {
  it("refuses a call with neither a statement nor a token", async () => {
    const { app } = setup();
    const { status } = await callTool(app, {}, "get_review", { sessionId: "x" });
    expect(status).toBe(401);
  });

  it("refuses a statement the platform did not sign", async () => {
    const { app } = setup();
    const forged = await statement({ ext: "alice" }, (await generateKeyPair("ES256")).privateKey);
    const { status } = await callTool(app, { "X-Platform-Caller": forged }, "get_review", {
      sessionId: "x",
    });
    expect(status).toBe(401);
  });

  it("acts as the user the statement names, with its session and workspace", async () => {
    const { app, storage } = setup();
    await storage.saveUpload({ id: "u1", diff: DIFF, createdAt: new Date() });
    const jwt = await statement({ ext: "alice", session_id: "nap-session-1" });

    const { result } = await callTool(
      app,
      // A plain header naming another session is ignored for a platform caller.
      { "X-Platform-Caller": jwt, "X-Session-Id": "spoofed" },
      "create_review",
      { diffFileId: "u1", splitMeta: { groups: [{ description: "all", changes: [0, 1] }] } },
    );

    const session = await storage.getSession(result!.sessionId as string);
    expect(session).toMatchObject({
      userId: "alice",
      agentSessionId: "nap-session-1",
      agentWorkspaceId: "ws-1",
    });
  });

  it("keeps a group's rewrites and reports how much of it they cover", async () => {
    const { app, storage } = setup();
    await storage.saveUpload({ id: "u1", diff: DIFF, createdAt: new Date() });
    const jwt = await statement({ ext: "alice" });

    const { result } = await callTool(app, { "X-Platform-Caller": jwt }, "create_review", {
      diffFileId: "u1",
      splitMeta: {
        groups: [
          {
            description: "all",
            changes: ["0-1"],
            rewrites: [{ changes: ["0-1"], title: "Rename", rewrite: "`old` becomes `new`." }],
          },
        ],
      },
    });

    expect(result!.rewriteCoverage).toEqual([{ group: 0, covered: 2, total: 2 }]);
    const session = await storage.getSession(result!.sessionId as string);
    expect(session!.subPatches[0]!.rewrites).toMatchObject([
      { id: "g1-rw1", title: "Rename", rewrite: "`old` becomes `new`.", changes: [0, 1] },
    ]);
  });

  it("refuses a rewrite that does not fit its group", async () => {
    const { app, storage } = setup();
    await storage.saveUpload({ id: "u1", diff: DIFF, createdAt: new Date() });
    const jwt = await statement({ ext: "alice" });

    const { result } = await callTool(app, { "X-Platform-Caller": jwt }, "create_review", {
      diffFileId: "u1",
      splitMeta: {
        groups: [
          { description: "all", changes: ["0-1"], rewrites: [{ changes: [0], rewrite: " " }] },
        ],
      },
    });
    expect(result!.error).toBe("Invalid split metadata");
  });

  it("does not show one user's review to another", async () => {
    const { app, storage } = setup();
    await storage.saveSession(sessionOf("alice"));
    const jwt = await statement({ ext: "mallory" });

    const { result } = await callTool(app, { "X-Platform-Caller": jwt }, "get_review", {
      sessionId: "s-alice",
    });
    expect(result).toEqual({ error: "Session not found" });
  });
});
