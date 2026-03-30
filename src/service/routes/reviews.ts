import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { parsePatch } from "../../core/patch.ts";
import {
  indexChanges,
  validateMeta,
  generateSubPatches,
  resolveSplitGroupMeta,
} from "../../core/split.ts";
import type { SplitMeta, ReviewSubmission } from "../../core/types.ts";
import type { Storage, Session, SubPatchRecord } from "../storage/interface.ts";
import { getCallerId } from "../auth.ts";

export function createReviewRoutes(storage: Storage): Hono {
  const app = new Hono();

  // -----------------------------------------------------------------------
  // Upload a diff (REST sideband — diffs must not flow through LLM tokens)
  // -----------------------------------------------------------------------
  app.post("/uploads", async (c) => {
    const body = await c.req.text();
    if (!body.trim()) return c.json({ error: "Empty diff" }, 400);

    const id = randomUUID();
    await storage.saveUpload({ id, diff: body, createdAt: new Date() });
    const patches = parsePatch(body);
    const changes = indexChanges(patches);

    return c.json({ fileId: id, changeCount: changes.length }, 201);
  });

  // -----------------------------------------------------------------------
  // Create a review session from an uploaded diff + split metadata
  // -----------------------------------------------------------------------
  app.post("/reviews", async (c) => {
    const { fileId, splitMeta } = await c.req.json<{
      fileId: string;
      splitMeta: SplitMeta;
    }>();
    const caller = getCallerId(c);

    const upload = await storage.getUpload(fileId);
    if (!upload) return c.json({ error: "Upload not found" }, 404);

    // Validate
    const patches = parsePatch(upload.diff);
    const changes = indexChanges(patches);
    const errors = validateMeta(splitMeta, changes.length);
    if (errors.length > 0) return c.json({ error: "Invalid split metadata", details: errors }, 400);

    // Generate sub-patches
    const subs = generateSubPatches(upload.diff, splitMeta);
    const groupMeta = resolveSplitGroupMeta(splitMeta, changes);

    const subPatches: SubPatchRecord[] = subs.map((diff, i) => ({
      index: i,
      description: groupMeta[i]!.description,
      diff,
      draftComments: (groupMeta[i]!.draftComments ?? []).map((dc) => ({
        id: randomUUID(),
        change: dc.change,
        file: dc.file,
        line: dc.line,
        side: dc.side,
        body: dc.body,
      })),
    }));

    const session: Session = {
      id: randomUUID(),
      reviewToken: randomUUID(),
      status: "reviewing",
      caller: caller ?? "anonymous",
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
        status: session.status,
        patchCount: subPatches.length,
      },
      201,
    );
  });

  // -----------------------------------------------------------------------
  // Get session status
  // -----------------------------------------------------------------------
  app.get("/reviews/:id", async (c) => {
    const session = await storage.getSession(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);

    return c.json({
      sessionId: session.id,
      status: session.status,
      caller: session.caller,
      patchCount: session.subPatches.length,
      submission: session.submission,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  });

  // -----------------------------------------------------------------------
  // List sessions
  // -----------------------------------------------------------------------
  app.get("/sessions", async (c) => {
    const caller = getCallerId(c);
    const sessions = await storage.listSessions(caller === "anonymous" ? undefined : caller);
    return c.json(
      sessions.map((s) => ({
        sessionId: s.id,
        status: s.status,
        caller: s.caller,
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
    await storage.updateSession(session.id, { status: "completed", submission });

    return c.json({ ok: true });
  });

  return app;
}
