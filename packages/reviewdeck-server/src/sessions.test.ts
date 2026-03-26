import { describe, expect, it } from "vitest";
import { SessionService } from "./sessions.ts";
import { MemoryStorage } from "./storage.ts";
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

const VALID_META: SplitMeta = {
  groups: [{ description: "test group", changes: [0, 1] }],
};

const BASE_URL = "http://localhost:3000";

function setup() {
  const storage = new MemoryStorage();
  const sessions = new SessionService(storage);
  return { storage, sessions };
}

describe("SessionService", () => {
  describe("create()", () => {
    it("creates session with correct fields", async () => {
      const { sessions } = setup();
      const session = await sessions.create({
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

    it("throws with invalid splitMeta", async () => {
      const { sessions } = setup();
      const badMeta: SplitMeta = {
        groups: [{ description: "partial", changes: [0] }],
      };
      await expect(
        sessions.create({
          diffContent: DIFF,
          splitMeta: badMeta,
          createdBy: "alice",
          baseUrl: BASE_URL,
        }),
      ).rejects.toThrow(/Invalid split metadata/);
    });
  });

  describe("get()", () => {
    it("returns existing session", async () => {
      const { sessions } = setup();
      const session = await sessions.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      const found = await sessions.get(session.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(session.id);
    });

    it("returns undefined for missing session", async () => {
      const { sessions } = setup();
      expect(await sessions.get("nonexistent")).toBeUndefined();
    });
  });

  describe("verifyReviewToken()", () => {
    it("returns true for correct token", async () => {
      const { sessions } = setup();
      const session = await sessions.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      expect(await sessions.verifyReviewToken(session.id, session.reviewToken)).toBe(true);
    });

    it("returns false for wrong token", async () => {
      const { sessions } = setup();
      const session = await sessions.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      expect(await sessions.verifyReviewToken(session.id, "bad")).toBe(false);
    });
  });

  describe("markReviewing()", () => {
    it("transitions pending to reviewing", async () => {
      const { sessions } = setup();
      const session = await sessions.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      const updated = await sessions.markReviewing(session.id);
      expect(updated!.status).toBe("reviewing");
    });

    it("no-ops on non-pending session", async () => {
      const { sessions } = setup();
      const session = await sessions.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      await sessions.markReviewing(session.id);
      const again = await sessions.markReviewing(session.id);
      expect(again!.status).toBe("reviewing");
    });

    it("returns undefined for missing session", async () => {
      const { sessions } = setup();
      expect(await sessions.markReviewing("nonexistent")).toBeUndefined();
    });
  });

  describe("submit()", () => {
    it("transitions to completed and stores submission", async () => {
      const { sessions } = setup();
      const session = await sessions.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      await sessions.markReviewing(session.id);
      const submission = { comments: [], draftComments: [] };
      const result = await sessions.submit(session.id, submission);
      expect(result!.status).toBe("completed");
      expect(result!.submission).toEqual(submission);
    });

    it("works from pending status directly", async () => {
      const { sessions } = setup();
      const session = await sessions.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      const result = await sessions.submit(session.id, { comments: [], draftComments: [] });
      expect(result!.status).toBe("completed");
    });

    it("returns undefined on already completed", async () => {
      const { sessions } = setup();
      const session = await sessions.create({
        diffContent: DIFF,
        splitMeta: VALID_META,
        createdBy: "alice",
        baseUrl: BASE_URL,
      });
      await sessions.submit(session.id, { comments: [], draftComments: [] });
      const again = await sessions.submit(session.id, { comments: [], draftComments: [] });
      expect(again).toBeUndefined();
    });

    it("returns undefined for missing session", async () => {
      const { sessions } = setup();
      expect(
        await sessions.submit("nonexistent", { comments: [], draftComments: [] }),
      ).toBeUndefined();
    });
  });
});
