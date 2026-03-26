import { describe, expect, it } from "vitest";
import { SessionStore } from "./sessions.ts";
import type { SplitMeta } from "../../../src/core/types.ts";

const DIFF = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3
`;

// changes: 0 = -old, 1 = +new
const VALID_META: SplitMeta = {
  groups: [{ description: "test group", changes: [0, 1] }],
};

const BASE_URL = "http://localhost:3000";

describe("SessionStore", () => {
  // ---------------------------------------------------------------------------
  // create()
  // ---------------------------------------------------------------------------

  describe("create()", () => {
    it("creates session with correct fields from valid diff + splitMeta", () => {
      const store = new SessionStore();
      const session = store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });

      expect(session.id).toBeTruthy();
      expect(session.status).toBe("pending");
      expect(session.createdBy).toBe("alice");
      expect(session.createdAt).toBeTypeOf("number");
      expect(session.reviewToken).toBeTruthy();
      expect(session.reviewUrl).toBe(
        `${BASE_URL}/review/${session.id}?token=${session.reviewToken}`,
      );
      expect(session.splitMeta).toEqual(VALID_META);
      expect(session.subPatches).toHaveLength(1);
      expect(session.subPatches[0]!.description).toBe("test group");
      expect(session.subPatches[0]!.diff).toContain("-old");
      expect(session.subPatches[0]!.diff).toContain("+new");
    });

    it("throws with invalid splitMeta (unassigned changes)", () => {
      const store = new SessionStore();
      const badMeta: SplitMeta = {
        groups: [{ description: "partial", changes: [0] }],
      };

      expect(() =>
        store.create({
          diffContent: DIFF,
          splitMeta: badMeta,
          createdBy: "alice",
          baseUrl: BASE_URL,
        }),
      ).toThrow(/Invalid split metadata/);
    });
  });

  // ---------------------------------------------------------------------------
  // get()
  // ---------------------------------------------------------------------------

  describe("get()", () => {
    it("returns existing session", () => {
      const store = new SessionStore();
      const session = store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      expect(store.get(session.id)).toBe(session);
    });

    it("returns undefined for missing session", () => {
      const store = new SessionStore();
      expect(store.get("nonexistent")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // markReviewing()
  // ---------------------------------------------------------------------------

  describe("markReviewing()", () => {
    it("transitions pending to reviewing", () => {
      const store = new SessionStore();
      const session = store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      expect(session.status).toBe("pending");

      const updated = store.markReviewing(session.id);
      expect(updated).toBeDefined();
      expect(updated!.status).toBe("reviewing");
    });

    it("no-ops on non-pending session (returns it unchanged)", () => {
      const store = new SessionStore();
      const session = store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      store.markReviewing(session.id); // pending -> reviewing
      expect(session.status).toBe("reviewing");

      const again = store.markReviewing(session.id);
      expect(again).toBeDefined();
      expect(again!.status).toBe("reviewing"); // unchanged
    });

    it("returns undefined for missing session", () => {
      const store = new SessionStore();
      expect(store.markReviewing("nonexistent")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // submit()
  // ---------------------------------------------------------------------------

  describe("submit()", () => {
    it("transitions reviewing to completed and stores submission", () => {
      const store = new SessionStore();
      const session = store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      store.markReviewing(session.id);

      const submission = { comments: [], draftComments: [] };
      const result = store.submit(session.id, submission);

      expect(result).toBeDefined();
      expect(result!.status).toBe("completed");
      expect(result!.submission).toEqual(submission);
      expect(result!.completedAt).toBeTypeOf("number");
    });

    it("also works from pending status directly", () => {
      const store = new SessionStore();
      const session = store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });

      const submission = { comments: [], draftComments: [] };
      const result = store.submit(session.id, submission);
      expect(result).toBeDefined();
      expect(result!.status).toBe("completed");
    });

    it("returns undefined on already completed session", () => {
      const store = new SessionStore();
      const session = store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      store.submit(session.id, { comments: [], draftComments: [] });

      const again = store.submit(session.id, { comments: [], draftComments: [] });
      expect(again).toBeUndefined();
    });

    it("returns undefined for missing session", () => {
      const store = new SessionStore();
      expect(store.submit("nonexistent", { comments: [], draftComments: [] })).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // list()
  // ---------------------------------------------------------------------------

  describe("list()", () => {
    it("returns all sessions without filter", () => {
      const store = new SessionStore();
      store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "bob",
        baseUrl: BASE_URL,
      });

      expect(store.list()).toHaveLength(2);
    });

    it("filters by createdBy", () => {
      const store = new SessionStore();
      store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "bob",
        baseUrl: BASE_URL,
      });
      store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });

      const aliceSessions = store.list("alice");
      expect(aliceSessions).toHaveLength(2);
      expect(aliceSessions.every((s) => s.createdBy === "alice")).toBe(true);
    });

    it("returns empty array when no sessions match filter", () => {
      const store = new SessionStore();
      store.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });

      expect(store.list("nobody")).toHaveLength(0);
    });
  });
});
