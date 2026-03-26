import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadStore } from "./uploads.ts";

describe("UploadStore", () => {
  let store: UploadStore;

  beforeEach(() => {
    store = new UploadStore(1000); // 1 second TTL for tests
  });

  it("add() returns unique IDs", () => {
    const id1 = store.add("diff content 1", "alice");
    const id2 = store.add("diff content 2", "bob");
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it("get() returns existing upload", () => {
    const id = store.add("my diff", "alice");
    const upload = store.get(id);
    expect(upload).toBeDefined();
    expect(upload!.content).toBe("my diff");
    expect(upload!.createdBy).toBe("alice");
    expect(upload!.createdAt).toBeTypeOf("number");
  });

  it("get() returns undefined for missing upload", () => {
    expect(store.get("nonexistent-id")).toBeUndefined();
  });

  it("delete() removes upload and returns true", () => {
    const id = store.add("content", "alice");
    expect(store.delete(id)).toBe(true);
    expect(store.get(id)).toBeUndefined();
  });

  it("delete() returns false for missing upload", () => {
    expect(store.delete("nonexistent-id")).toBe(false);
  });

  it("prune() removes expired uploads", () => {
    vi.useFakeTimers();
    try {
      const store2 = new UploadStore(1000);
      const id1 = store2.add("old", "alice");

      // Advance past TTL
      vi.advanceTimersByTime(1500);

      const id2 = store2.add("new", "bob");

      // Trigger prune via start — but we can also just call it directly
      // We'll use the internal timer approach: start + advance
      store2.start();
      vi.advanceTimersByTime(600); // TTL/2 = 500ms triggers prune

      expect(store2.get(id1)).toBeUndefined();
      expect(store2.get(id2)).toBeDefined();

      store2.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
