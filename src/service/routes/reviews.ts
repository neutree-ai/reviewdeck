import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { parsePatch } from "../../core/patch.ts";
import { indexChanges, formatIndexedChanges } from "../../core/split.ts";
import type { SplitMeta, ReviewSubmission } from "../../core/types.ts";
import { buildReview } from "../build-review.ts";
import type { Storage, Session } from "../storage/interface.ts";

export interface ReviewRouteHooks {
  /** Told about each submission once it is stored. Errors are logged, never shown to the reviewer. */
  onSubmitted?(session: Session): Promise<void>;
}

export function createReviewRoutes(
  storage: Storage,
  baseUrl: string,
  hooks: ReviewRouteHooks = {},
): Hono {
  const app = new Hono();

  // -----------------------------------------------------------------------
  // Upload a diff (REST sideband — diffs must not flow through LLM tokens)
  // -----------------------------------------------------------------------
  app.post("/uploads", async (c) => {
    // Strip NUL bytes — Postgres text columns reject 0x00 (binary files can leak it into diffs)
    const body = (await c.req.text()).replaceAll("\u0000", "");
    if (!body.trim()) return c.json({ error: "Empty diff" }, 400);

    const id = randomUUID();
    await storage.saveUpload({ id, diff: body, createdAt: new Date() });
    const patches = parsePatch(body);
    const changes = indexChanges(patches);
    const index = formatIndexedChanges(changes);

    return c.json({ fileId: id, changeCount: changes.length, index }, 201);
  });

  // -----------------------------------------------------------------------
  // Create a review session from an uploaded diff + split metadata
  // -----------------------------------------------------------------------
  app.post("/reviews", async (c) => {
    const {
      fileId,
      splitMeta,
      agentId: bodyAgentId,
      agentSessionId: bodyAgentSessionId,
    } = await c.req.json<{
      fileId: string;
      splitMeta: SplitMeta;
      agentId?: string;
      agentSessionId?: string;
    }>();
    const userId = (c.get("userId") as string) ?? "";
    const agentId = bodyAgentId ?? c.req.header("x-agent-id");
    const agentSessionId = bodyAgentSessionId ?? c.req.header("x-session-id");

    const upload = await storage.getUpload(fileId);
    if (!upload) return c.json({ error: "Upload not found" }, 404);

    const built = buildReview(upload.diff, splitMeta);
    if (!built.ok) {
      return c.json({ error: "Invalid split metadata", details: built.errors }, 400);
    }
    const { subPatches } = built;

    const session: Session = {
      id: randomUUID(),
      reviewToken: randomUUID(),
      status: "reviewing",
      userId,
      agentId,
      agentSessionId,
      splitMeta,
      subPatches,
      submission: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await storage.saveSession(session);
    await storage.deleteUpload(fileId);

    return c.json(
      {
        sessionId: session.id,
        reviewToken: session.reviewToken,
        reviewUrl: `${baseUrl}/review/${session.id}?token=${session.reviewToken}`,
        status: session.status,
        patchCount: subPatches.length,
        ...(built.rewriteCoverage.length > 0 && { rewriteCoverage: built.rewriteCoverage }),
      },
      201,
    );
  });

  // -----------------------------------------------------------------------
  // Get session status
  // -----------------------------------------------------------------------
  app.get("/reviews/:id", async (c) => {
    const userId = (c.get("userId") as string) ?? "";
    const session = await storage.getSession(c.req.param("id"));
    // Someone else's session reads as missing, not forbidden: ids are not to be probed.
    if (!session || session.userId !== userId) return c.json({ error: "Session not found" }, 404);

    return c.json({
      sessionId: session.id,
      status: session.status,
      userId: session.userId,
      agentId: session.agentId,
      agentSessionId: session.agentSessionId,
      patchCount: session.subPatches.length,
      reviewUrl: `${baseUrl}/review/${session.id}?token=${session.reviewToken}`,
      submission: session.submission,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  });

  // -----------------------------------------------------------------------
  // List sessions
  // -----------------------------------------------------------------------
  app.get("/sessions", async (c) => {
    const userId = (c.get("userId") as string) ?? "";
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const agentId = c.req.query("agentId");
    const agentSessionId = c.req.query("agentSessionId");
    const all = c.req.query("all") === "true";

    const filter = all
      ? { userId }
      : {
          userId,
          agentId: agentId ?? undefined,
          agentSessionId: agentSessionId ?? undefined,
        };
    const sessions = await storage.listSessions(filter);

    return c.json(
      sessions.map((s) => ({
        sessionId: s.id,
        status: s.status,
        userId: s.userId,
        agentId: s.agentId,
        agentSessionId: s.agentSessionId,
        reviewUrl: `${baseUrl}/review/${s.id}?token=${s.reviewToken}`,
        patchCount: s.subPatches.length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    );
  });

  // -----------------------------------------------------------------------
  // SPA-compatible endpoints: GET /patches and POST /submit
  // These are used by the web UI, scoped by ?token=<reviewToken>
  // -----------------------------------------------------------------------
  app.get("/patches", async (c) => {
    const token = c.req.query("token");
    if (!token) return c.json({ error: "Missing token parameter" }, 400);

    const session = await storage.getSessionByToken(token);
    if (!session) return c.json({ error: "Session not found" }, 404);

    return c.json(
      session.subPatches.map((sp) => ({
        index: sp.index,
        description: sp.description,
        diff: sp.diff,
        draftComments: sp.draftComments.map((dc) => ({
          ...dc,
          source: "agent" as const,
          sub: sp.index,
        })),
        rewrites: sp.rewrites,
      })),
    );
  });

  app.post("/submit", async (c) => {
    const token = c.req.query("token");
    if (!token) return c.json({ error: "Missing token parameter" }, 400);

    const session = await storage.getSessionByToken(token);
    if (!session) return c.json({ error: "Session not found" }, 404);
    if (session.status === "completed") return c.json({ error: "Already submitted" }, 409);

    const submission: ReviewSubmission = await c.req.json();
    const updated = await storage.updateSession(session.id, { status: "completed", submission });

    if (updated && hooks.onSubmitted) {
      hooks.onSubmitted(updated).catch((e) => {
        console.error(`[reviews] onSubmitted failed for session ${session.id}:`, e);
      });
    }
    return c.json({ ok: true });
  });

  return app;
}
