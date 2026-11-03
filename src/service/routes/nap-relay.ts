/**
 * The NAP UI SDK's calls (/api/app/nap/*), relayed to the platform as the
 * signed-in user: the conversation itself through the server SDK's session
 * relay, and an allow-list of what the composer reads. The page never holds a
 * platform token, and whatever workspace it names is only a key: every call
 * goes to the user's own review agent.
 *
 *   session relay   session, messages, streamed turns, queued follow-ups,
 *                   questions, interrupt (see createSessionRelay)
 *   composer        GET /workspaces/:w/commands, GET /workspaces/:w/skills
 */

import { Hono, type Context } from "hono";
import { createSessionRelay, workspacePath } from "@neutree-ai/server-sdk";
import type { User } from "../auth/types.ts";
import type { NapPlatform } from "../nap/platform.ts";

const BASE = "/api/app/nap";

function passThrough(res: Response): Response {
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
}

export function createNapRelayRoutes(nap: NapPlatform): Hono {
  const app = new Hono();
  const userOf = (c: Context) => c.get("user") as User;

  const relay = createSessionRelay<User>({
    basePath: BASE,
    resolve: (user) => nap.agentOf(user),
  });

  for (const what of ["commands", "skills"]) {
    app.get(`/workspaces/:w/${what}`, async (c) => {
      const { client, workspaceId } = await nap.agentOf(userOf(c));
      return passThrough(await client.forward("GET", `${workspacePath(workspaceId)}/${what}`));
    });
  }

  app.all("*", (c) => relay.handle(c.req.raw, userOf(c)));
  return app;
}
