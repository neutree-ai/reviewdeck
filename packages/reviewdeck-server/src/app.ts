import type { Hono as HonoType } from "hono";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { randomUUID } from "node:crypto";
import { parsePatch } from "../../../src/core/patch.ts";
import { indexChanges, formatIndexedChanges } from "../../../src/core/split.ts";
import type { SplitMeta } from "../../../src/core/types.ts";
import { authenticateHeaders } from "./auth.ts";
import type { SessionService } from "./sessions.ts";
import type { Storage } from "./storage.ts";

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
  sessions: SessionService;
  storage: Storage;
  baseUrl: string;
  mcpRouter?: HonoType;
}

export function createApp(opts: AppOptions) {
  const { secret, sessions, storage } = opts;

  const app = new Hono();

  // --- Request logging ---
  app.use(async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    const status = c.res.status;
    const caller = c.get("callerId" as any) ?? "-";
    console.error(`${c.req.method} ${c.req.path} ${status} ${ms}ms caller=${caller}`);
  });

  // --- Health check (no auth) ---
  app.get("/health", (c) => c.json({ ok: true }));

  // --- MCP endpoint (auth required) ---
  if (opts.mcpRouter) {
    app.use("/mcp", requireAuth(secret));
    app.route("/mcp", opts.mcpRouter);
  }

  // --- Review UI API (review token auth, no Bearer required) ---

  const requireReviewToken = async (c: any, next: any) => {
    const id = c.req.param("id");
    const token = c.req.query("token");
    if (!token || !(await sessions.verifyReviewToken(id, token))) {
      return c.json({ error: "Invalid or missing review token" }, 401);
    }
    await next();
  };

  app.get("/api/sessions/:id/patches", requireReviewToken, async (c) => {
    const id = c.req.param("id");
    const session = await sessions.markReviewing(id);
    if (!session) {
      const existing = await sessions.get(id);
      if (!existing) return c.json({ error: "Session not found" }, 404);
      return c.json(existing.subPatches);
    }
    return c.json(session.subPatches);
  });

  app.post("/api/sessions/:id/submit", requireReviewToken, async (c) => {
    const submission = await c.req.json();
    const session = await sessions.submit(c.req.param("id"), submission);
    if (!session) return c.json({ error: "Session not found or already completed" }, 404);
    return c.json({ ok: true });
  });

  // --- Authed REST API (Bearer token required, mounted at /api) ---
  const authed = new Hono();
  authed.use(requireAuth(secret));

  // Upload diff — returns fileId + indexed changes
  authed.post("/uploads", async (c) => {
    const body = await c.req.text();
    if (!body.trim()) return c.json({ error: "Empty body" }, 400);
    const callerId = c.get("callerId") as string;
    const fileId = randomUUID();
    await storage.saveUpload(fileId, { content: body, createdBy: callerId, createdAt: Date.now() });
    const patches = parsePatch(body);
    const changes = indexChanges(patches);
    const indexed = formatIndexedChanges(changes);
    return c.json(
      { fileId, indexed: `${indexed}\n\nTotal: ${changes.length} change lines\n` },
      201,
    );
  });

  // Create session
  authed.post("/sessions", async (c) => {
    const parsed = await c.req.json<{ diffFileId: string; splitMeta: SplitMeta }>();
    const upload = await storage.getUpload(parsed.diffFileId);
    if (!upload) return c.json({ error: "Diff file not found" }, 404);
    const callerId = c.get("callerId") as string;
    try {
      const session = await sessions.create({
        diffContent: upload.content,
        splitMeta: parsed.splitMeta,
        createdBy: callerId,
        baseUrl: opts.baseUrl,
      });
      await storage.deleteUpload(parsed.diffFileId);
      return c.json(
        { sessionId: session.id, reviewUrl: session.reviewUrl, status: session.status },
        201,
      );
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  // Get session status
  authed.get("/sessions/:id/status", async (c) => {
    const session = await sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({
      sessionId: session.id,
      status: session.status,
      createdAt: session.createdAt,
      createdBy: session.createdBy,
      reviewUrl: session.reviewUrl,
      submission: session.submission ?? null,
    });
  });

  app.route("/api", authed);

  // --- Static / SPA (last — serves review UI and assets without auth) ---
  // Skip /api and /mcp paths so they are never shadowed by the SPA fallback.
  const skipNonStatic = async (c: any, next: any) => {
    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/mcp")) return next();
    return serveStatic({ root: "./dist/web" })(c, next);
  };
  const spaFallback = async (c: any, next: any) => {
    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/mcp")) return next();
    return serveStatic({ root: "./dist/web", path: "index.html" })(c, next);
  };
  app.use("/*", skipNonStatic);
  app.use("/*", spaFallback);

  return app;
}
