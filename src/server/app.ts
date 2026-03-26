import type { Hono as HonoType } from "hono";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { parsePatch } from "../core/patch.ts";
import { indexChanges, formatIndexedChanges } from "../core/split.ts";
import type { SplitMeta } from "../core/types.ts";
import { authenticateHeaders } from "./auth.ts";
import type { SessionStore } from "./sessions.ts";
import type { UploadStore } from "./uploads.ts";

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function requireAuth(secret: string) {
  return async (c: any, next: any) => {
    const auth = authenticateHeaders(c.req.raw.headers, secret);
    if (!auth.ok) return c.json({ error: auth.error }, 401);
    c.set("callerId", auth.id);
    await next();
  };
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export interface AppOptions {
  secret: string;
  sessions: SessionStore;
  uploads: UploadStore;
  baseUrl: string;
  mcpRouter?: HonoType;
}

export function createApp(opts: AppOptions) {
  const { secret, sessions, uploads } = opts;

  const app = new Hono();
  const authed = new Hono();
  authed.use(requireAuth(secret));

  // --- MCP endpoint (auth required) ---
  if (opts.mcpRouter) {
    app.use("/mcp", requireAuth(secret));
    app.route("/mcp", opts.mcpRouter);
  }

  // --- Authed REST API ---

  // Upload diff — returns fileId + indexed changes
  authed.post("/api/uploads", async (c) => {
    const body = await c.req.text();
    if (!body.trim()) return c.json({ error: "Empty body" }, 400);
    const callerId = c.get("callerId") as string;
    const fileId = uploads.add(body, callerId);
    const patches = parsePatch(body);
    const changes = indexChanges(patches);
    const indexed = formatIndexedChanges(changes);
    return c.json(
      { fileId, indexed: `${indexed}\n\nTotal: ${changes.length} change lines\n` },
      201,
    );
  });

  // Create session
  authed.post("/api/sessions", async (c) => {
    const parsed = await c.req.json<{ diffFileId: string; splitMeta: SplitMeta }>();
    const upload = uploads.get(parsed.diffFileId);
    if (!upload) return c.json({ error: "Diff file not found" }, 404);
    const callerId = c.get("callerId") as string;
    try {
      const session = sessions.create({
        diffContent: upload.content,
        splitMeta: parsed.splitMeta,
        createdBy: callerId,
        baseUrl: opts.baseUrl,
      });
      uploads.delete(parsed.diffFileId);
      return c.json(
        { sessionId: session.id, reviewUrl: session.reviewUrl, status: session.status },
        201,
      );
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  // Get session status
  authed.get("/api/sessions/:id/status", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({
      sessionId: session.id,
      status: session.status,
      createdAt: session.createdAt,
      createdBy: session.createdBy,
      reviewUrl: session.reviewUrl,
      completedAt: session.completedAt ?? null,
      submission: session.submission ?? null,
    });
  });

  // --- Review UI API (review token auth, registered before authed catch-all) ---

  const requireReviewToken = async (c: any, next: any) => {
    const id = c.req.param("id");
    const token = c.req.query("token");
    if (!token || !sessions.verifyReviewToken(id, token)) {
      return c.json({ error: "Invalid or missing review token" }, 401);
    }
    await next();
  };

  app.get("/api/sessions/:id/patches", requireReviewToken, (c) => {
    const id = c.req.param("id");
    const session = sessions.markReviewing(id);
    if (!session) {
      const existing = sessions.get(id);
      if (!existing) return c.json({ error: "Session not found" }, 404);
      return c.json(existing.subPatches);
    }
    return c.json(session.subPatches);
  });

  app.post("/api/sessions/:id/submit", requireReviewToken, async (c) => {
    const submission = await c.req.json();
    const session = sessions.submit(c.req.param("id"), submission);
    if (!session) return c.json({ error: "Session not found or already completed" }, 404);
    return c.json({ ok: true });
  });

  app.route("/", authed);

  // --- Static / SPA ---
  app.use("/*", serveStatic({ root: "./dist/web" }));
  app.use("/*", serveStatic({ root: "./dist/web", path: "index.html" }));

  return app;
}
