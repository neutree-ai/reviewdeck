import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage.ts";
import type { Session, Upload } from "./types.ts";

const SAMPLE_SESSION: Session = {
  id: "s1",
  reviewToken: "tok1",
  status: "pending",
  createdAt: Date.now(),
  createdBy: "alice",
  splitMeta: { groups: [{ description: "g1", changes: [0] }] },
  subPatches: [{ index: 0, description: "g1", diff: "diff", draftComments: [] }],
  reviewUrl: "http://localhost/review/s1?token=tok1",
};

const SAMPLE_UPLOAD: Upload = {
  content: "diff content",
  createdBy: "alice",
  createdAt: Date.now(),
};

describe("MemoryStorage", () => {
  describe("sessions", () => {
    it("save and get", async () => {
      const s = new MemoryStorage();
      await s.saveSession(SAMPLE_SESSION);
      const found = await s.getSession("s1");
      expect(found).toBeDefined();
      expect(found!.id).toBe("s1");
      expect(found!.status).toBe("pending");
    });

    it("get returns undefined for missing", async () => {
      const s = new MemoryStorage();
      expect(await s.getSession("nope")).toBeUndefined();
    });

    it("returns clones (not references)", async () => {
      const s = new MemoryStorage();
      await s.saveSession(SAMPLE_SESSION);
      const a = await s.getSession("s1");
      const b = await s.getSession("s1");
      expect(a).not.toBe(b);
    });

    it("updateSession", async () => {
      const s = new MemoryStorage();
      await s.saveSession(SAMPLE_SESSION);
      const updated = await s.updateSession("s1", { status: "reviewing" });
      expect(updated!.status).toBe("reviewing");
      const found = await s.getSession("s1");
      expect(found!.status).toBe("reviewing");
    });

    it("updateSession returns undefined for missing", async () => {
      const s = new MemoryStorage();
      expect(await s.updateSession("nope", { status: "reviewing" })).toBeUndefined();
    });
  });

  describe("uploads", () => {
    it("save and get", async () => {
      const s = new MemoryStorage();
      await s.saveUpload("u1", SAMPLE_UPLOAD);
      const found = await s.getUpload("u1");
      expect(found).toBeDefined();
      expect(found!.content).toBe("diff content");
    });

    it("get returns undefined for missing", async () => {
      const s = new MemoryStorage();
      expect(await s.getUpload("nope")).toBeUndefined();
    });

    it("delete", async () => {
      const s = new MemoryStorage();
      await s.saveUpload("u1", SAMPLE_UPLOAD);
      await s.deleteUpload("u1");
      expect(await s.getUpload("u1")).toBeUndefined();
    });
  });

  it("close clears all data", async () => {
    const s = new MemoryStorage();
    await s.saveSession(SAMPLE_SESSION);
    await s.saveUpload("u1", SAMPLE_UPLOAD);
    await s.close();
    expect(await s.getSession("s1")).toBeUndefined();
    expect(await s.getUpload("u1")).toBeUndefined();
  });
});
