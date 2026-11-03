/**
 * The reviewdeck app's API for its own pages (/api/app/*): the signed-in
 * user's reviews, their conversations with their review agent on NAP (the
 * list here, the conversations themselves through the session relay at
 * /api/app/nap), and the git tokens that agent works with.
 *
 * The browser never talks to NAP: every agent call goes from here, as the
 * user, to the user's own workspace.
 */

import { Hono } from "hono";
import { NapError } from "@neutree-ai/server-sdk";
import { clearAppSessionCookie } from "../auth/app-session.ts";
import type { User } from "../auth/types.ts";
import type { NapPlatform } from "../nap/platform.ts";
import type { Storage } from "../storage/interface.ts";
import { createNapRelayRoutes } from "./nap-relay.ts";

/** Credentials the agent's scripts read from its environment, and nothing else. */
const CREDENTIALS = ["GITHUB_TOKEN", "GITLAB_TOKEN"] as const;

export function createAppRoutes(
  storage: Storage,
  baseUrl: string,
  nap: NapPlatform | undefined,
): Hono {
  const app = new Hono();

  const user = (c: { get(key: "user"): unknown }) => c.get("user") as User;

  async function agentOf(u: User) {
    if (!nap) throw new NapError("The review agent is not configured on this server", 503);
    return nap.agentOf(u);
  }

  app.onError((err, c) => {
    const status = err instanceof NapError && err.status ? err.status : 500;
    console.error(`[app] ${c.req.method} ${c.req.path} → ${status}:`, err.message);
    return c.json({ error: err.message }, status >= 400 && status < 600 ? (status as 500) : 500);
  });

  app.get("/me", (c) => {
    const u = user(c);
    return c.json({
      id: u.id,
      username: u.username,
      displayName: u.displayName ?? u.username,
      agent: nap ? nap.config.agent : null,
    });
  });

  app.post("/logout", (c) => {
    c.header("Set-Cookie", clearAppSessionCookie);
    return c.json({ ok: true });
  });

  app.get("/reviews", async (c) => {
    const sessions = await storage.listSessions({ userId: user(c).id });
    return c.json(
      sessions.map((s) => ({
        sessionId: s.id,
        status: s.status,
        agentSessionId: s.agentSessionId ?? null,
        patchCount: s.subPatches.length,
        commentCount: s.submission?.comments.length ?? 0,
        reviewUrl: `${baseUrl}/review/${s.id}?token=${s.reviewToken}`,
        title: s.subPatches[0]?.description ?? "",
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    );
  });

  // --- Conversations with the review agent ---

  app.get("/chats", async (c) => {
    const { client, workspaceId } = await agentOf(user(c));
    const { items } = await client.listSessions(workspaceId, 50);
    return c.json(
      items
        // Sessions another agent opened are that agent's work, not the user's conversations.
        .filter((s) => !s.caller_agent)
        .map((s) => ({
          id: s.id,
          name: s.name,
          preview: s.preview,
          lastActiveAt: s.last_active_at,
        })),
    );
  });

  // --- Git credentials, injected into the user's workspace as env vars ---

  app.get("/credentials", async (c) => {
    const { client } = await agentOf(user(c));
    const all = await client.request<{ name: string }[]>("GET", "/api/credentials");
    const set = new Set(all.map((cred) => cred.name));
    return c.json(CREDENTIALS.map((name) => ({ name, set: set.has(name) })));
  });

  app.put("/credentials/:name", async (c) => {
    const name = c.req.param("name");
    if (!(CREDENTIALS as readonly string[]).includes(name)) {
      return c.json({ error: "Unknown credential" }, 400);
    }
    const { value } = await c.req.json<{ value?: string }>();
    const { client } = await agentOf(user(c));
    if (!value) {
      await client.forward("DELETE", `/api/credentials/${name}`);
      return c.json({ ok: true });
    }
    await client.request("PUT", `/api/credentials/${name}`, {
      value,
      inject: "env",
      scope: "global",
    });
    return c.json({ ok: true });
  });

  if (nap) app.route("/nap", createNapRelayRoutes(nap));

  return app;
}
