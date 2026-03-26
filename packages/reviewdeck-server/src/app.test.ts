import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { SessionStore } from "./sessions.ts";
import { UploadStore } from "./uploads.ts";
import type { SplitMeta } from "../../../src/core/types.ts";

const SECRET = "test-secret";
const BASE_URL = "http://localhost:3000";

const DIFF = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3
`;

const VALID_META: SplitMeta = {
  groups: [{ description: "test group", changes: [0, 1] }],
};

const AUTH_HEADERS = {
  Authorization: "Bearer test-secret",
  "x-id": "tester",
};

function setup() {
  const sessions = new SessionStore();
  const uploads = new UploadStore();
  const app = createApp({ secret: SECRET, sessions, uploads, baseUrl: BASE_URL });
  return { app, sessions, uploads };
}

/** Helper: upload diff + create session, return sessionId and reviewToken. */
async function createSession(app: ReturnType<typeof createApp>) {
  const uploadRes = await app.request("/api/uploads", {
    method: "POST",
    headers: AUTH_HEADERS,
    body: DIFF,
  });
  const { fileId } = await uploadRes.json();
  const createRes = await app.request("/api/sessions", {
    method: "POST",
    headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ diffFileId: fileId, splitMeta: VALID_META }),
  });
  const { sessionId, reviewUrl } = await createRes.json();
  const token = new URL(reviewUrl).searchParams.get("token")!;
  return { sessionId, token };
}

// ---------------------------------------------------------------------------
// POST /api/uploads
// ---------------------------------------------------------------------------

describe("POST /api/uploads", () => {
  it("with auth returns 201 with fileId and indexed", async () => {
    const { app } = setup();
    const res = await app.request("/api/uploads", {
      method: "POST",
      headers: AUTH_HEADERS,
      body: DIFF,
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.fileId).toBeTruthy();
    expect(json.indexed).toContain("Total:");
  });

  it("without auth returns 401", async () => {
    const { app } = setup();
    const res = await app.request("/api/uploads", {
      method: "POST",
      body: DIFF,
    });
    expect(res.status).toBe(401);
  });

  it("with empty body returns 400", async () => {
    const { app } = setup();
    const res = await app.request("/api/uploads", {
      method: "POST",
      headers: AUTH_HEADERS,
      body: "   ",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Empty body/);
  });
});

// ---------------------------------------------------------------------------
// POST /api/sessions
// ---------------------------------------------------------------------------

describe("POST /api/sessions", () => {
  it("with valid data returns 201 with sessionId and reviewUrl", async () => {
    const { app } = setup();

    // First upload the diff
    const uploadRes = await app.request("/api/uploads", {
      method: "POST",
      headers: AUTH_HEADERS,
      body: DIFF,
    });
    const { fileId } = await uploadRes.json();

    // Create session
    const res = await app.request("/api/sessions", {
      method: "POST",
      headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ diffFileId: fileId, splitMeta: VALID_META }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.sessionId).toBeTruthy();
    expect(json.reviewUrl).toContain("/review/");
    expect(json.status).toBe("pending");
  });

  it("with missing diffFileId returns 404", async () => {
    const { app } = setup();
    const res = await app.request("/api/sessions", {
      method: "POST",
      headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ diffFileId: "nonexistent", splitMeta: VALID_META }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/sessions/:id/status
// ---------------------------------------------------------------------------

describe("GET /api/sessions/:id/status", () => {
  it("with auth returns session data", async () => {
    const { app } = setup();

    // Upload + create session
    const uploadRes = await app.request("/api/uploads", {
      method: "POST",
      headers: AUTH_HEADERS,
      body: DIFF,
    });
    const { fileId } = await uploadRes.json();

    const createRes = await app.request("/api/sessions", {
      method: "POST",
      headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ diffFileId: fileId, splitMeta: VALID_META }),
    });
    const { sessionId } = await createRes.json();

    // Get status
    const res = await app.request(`/api/sessions/${sessionId}/status`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sessionId).toBe(sessionId);
    expect(json.status).toBe("pending");
    expect(json.createdBy).toBe("tester");
    expect(json.reviewUrl).toContain("/review/");
  });

  it("missing session returns 404", async () => {
    const { app } = setup();
    const res = await app.request("/api/sessions/nonexistent/status", {
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/sessions/:id/patches (review token required)
// ---------------------------------------------------------------------------

describe("GET /api/sessions/:id/patches", () => {
  it("returns patches array with valid review token", async () => {
    const { app } = setup();
    const { sessionId, token } = await createSession(app);

    const res = await app.request(`/api/sessions/${sessionId}/patches?token=${token}`);
    expect(res.status).toBe(200);
    const patches = await res.json();
    expect(Array.isArray(patches)).toBe(true);
    expect(patches).toHaveLength(1);
    expect(patches[0].description).toBe("test group");
    expect(patches[0].diff).toContain("-old");
    expect(patches[0].diff).toContain("+new");
  });

  it("missing token returns 401", async () => {
    const { app } = setup();
    const { sessionId } = await createSession(app);
    const res = await app.request(`/api/sessions/${sessionId}/patches`);
    expect(res.status).toBe(401);
  });

  it("wrong token returns 401", async () => {
    const { app } = setup();
    const { sessionId } = await createSession(app);
    const res = await app.request(`/api/sessions/${sessionId}/patches?token=bad`);
    expect(res.status).toBe(401);
  });

  it("missing session returns 401", async () => {
    const { app } = setup();
    const res = await app.request("/api/sessions/nonexistent/patches?token=bad");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/sessions/:id/submit (review token required)
// ---------------------------------------------------------------------------

describe("POST /api/sessions/:id/submit", () => {
  it("returns 200 on successful submission", async () => {
    const { app } = setup();
    const { sessionId, token } = await createSession(app);

    const res = await app.request(`/api/sessions/${sessionId}/submit?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments: [], draftComments: [] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("already completed session returns 404", async () => {
    const { app } = setup();
    const { sessionId, token } = await createSession(app);

    await app.request(`/api/sessions/${sessionId}/submit?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments: [], draftComments: [] }),
    });

    const res = await app.request(`/api/sessions/${sessionId}/submit?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments: [], draftComments: [] }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/already completed/);
  });

  it("missing token returns 401", async () => {
    const { app } = setup();
    const { sessionId } = await createSession(app);
    const res = await app.request(`/api/sessions/${sessionId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments: [], draftComments: [] }),
    });
    expect(res.status).toBe(401);
  });
});
