import { describe, expect, it } from "vitest";
import {
  expandChanges,
  indexChanges,
  formatIndexedChanges,
  validateMeta,
  generateSubPatches,
  resolveSplitGroupMeta,
  type SplitMeta,
} from "./split.ts";
import { parsePatch, applyPatch, reconstructBase } from "./patch.ts";

// ---------------------------------------------------------------------------
// indexChanges
// ---------------------------------------------------------------------------

describe("indexChanges", () => {
  it("indexes all change lines", () => {
    const patch = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,5 +1,5 @@
 line1
-line2
+lineA
 line3
-line4
+lineB
 line5
`;
    const changes = indexChanges(parsePatch(patch));
    expect(changes).toHaveLength(4);
    expect(changes[0]).toMatchObject({ index: 0, type: "-", content: "line2" });
    expect(changes[1]).toMatchObject({ index: 1, type: "+", content: "lineA" });
    expect(changes[2]).toMatchObject({ index: 2, type: "-", content: "line4" });
    expect(changes[3]).toMatchObject({ index: 3, type: "+", content: "lineB" });
  });

  it("skips pure renames", () => {
    const patch = `diff --git a/old.py b/new.py
similarity index 100%
rename from old.py
rename to new.py
`;
    const changes = indexChanges(parsePatch(patch));
    expect(changes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatIndexedChanges
// ---------------------------------------------------------------------------

describe("formatIndexedChanges", () => {
  it("formats grouped by file", () => {
    const patch = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
 a
-b
+B
 c
`;
    const changes = indexChanges(parsePatch(patch));
    const output = formatIndexedChanges(changes);
    expect(output).toContain("## foo.py");
    expect(output).toContain("[0] - L2: b");
    expect(output).toContain("[1] + L2: B");
  });
});

// ---------------------------------------------------------------------------
// validateMeta
// ---------------------------------------------------------------------------

describe("validateMeta", () => {
  it("accepts valid meta", () => {
    const meta: SplitMeta = {
      groups: [
        { description: "first", changes: [0, 1] },
        { description: "second", changes: [2, 3] },
      ],
    };
    expect(validateMeta(meta, 4)).toEqual([]);
  });

  it("reports unassigned changes", () => {
    const meta: SplitMeta = {
      groups: [{ description: "partial", changes: [0, 1] }],
    };
    const errors = validateMeta(meta, 4);
    expect(errors.length).toBe(2);
    expect(errors[0]).toContain("Change 2");
    expect(errors[1]).toContain("Change 3");
  });

  it("reports duplicate assignments", () => {
    const meta: SplitMeta = {
      groups: [
        { description: "a", changes: [0, 1] },
        { description: "b", changes: [1, 2, 3] },
      ],
    };
    const errors = validateMeta(meta, 4);
    expect(errors.some((e) => e.includes("index 1 already assigned"))).toBe(true);
  });

  it("reports out of range", () => {
    const meta: SplitMeta = {
      groups: [{ description: "a", changes: [0, 1, 2, 3, 99] }],
    };
    const errors = validateMeta(meta, 4);
    expect(errors.some((e) => e.includes("out of range"))).toBe(true);
  });

  it("accepts valid draft comments anchored to the same group", () => {
    const meta: SplitMeta = {
      groups: [
        {
          description: "first",
          changes: [0, 1],
          draftComments: [{ change: 1, body: "Check the new branch ordering." }],
        },
        { description: "second", changes: [2, 3] },
      ],
    };
    expect(validateMeta(meta, 4)).toEqual([]);
  });

  it("rejects draft comments that point outside the group", () => {
    const meta: SplitMeta = {
      groups: [
        {
          description: "first",
          changes: [0, 1],
          draftComments: [{ change: 2, body: "This belongs later." }],
        },
        { description: "second", changes: [2, 3] },
      ],
    };
    const errors = validateMeta(meta, 4);
    expect(errors.some((e) => e.includes("is not assigned to this group"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// expandChanges
// ---------------------------------------------------------------------------

describe("expandChanges", () => {
  it("passes through plain numbers", () => {
    expect(expandChanges([0, 1, 2])).toEqual([0, 1, 2]);
  });

  it("expands range strings", () => {
    expect(expandChanges(["3-7"])).toEqual([3, 4, 5, 6, 7]);
  });

  it("handles mixed items", () => {
    expect(expandChanges([0, "2-5", 7, "10-12"])).toEqual([0, 2, 3, 4, 5, 7, 10, 11, 12]);
  });

  it("handles single-element range", () => {
    expect(expandChanges(["5-5"])).toEqual([5]);
  });

  it("throws on invalid range", () => {
    expect(() => expandChanges(["abc"])).toThrow("Invalid change item");
  });

  it("throws on reversed range", () => {
    expect(() => expandChanges(["8-3"])).toThrow("start > end");
  });
});

// ---------------------------------------------------------------------------
// validateMeta with ranges
// ---------------------------------------------------------------------------

describe("validateMeta with ranges", () => {
  it("accepts range syntax", () => {
    const meta: SplitMeta = {
      groups: [
        { description: "first", changes: ["0-1"] },
        { description: "second", changes: ["2-3"] },
      ],
    };
    expect(validateMeta(meta, 4)).toEqual([]);
  });

  it("accepts mixed syntax", () => {
    const meta: SplitMeta = {
      groups: [
        { description: "first", changes: [0, 1] },
        { description: "second", changes: ["2-3"] },
      ],
    };
    expect(validateMeta(meta, 4)).toEqual([]);
  });

  it("detects overlap in ranges", () => {
    const meta: SplitMeta = {
      groups: [
        { description: "a", changes: ["0-2"] },
        { description: "b", changes: ["2-3"] },
      ],
    };
    const errors = validateMeta(meta, 4);
    expect(errors.some((e) => e.includes("index 2 already assigned"))).toBe(true);
  });

  it("reports invalid range syntax", () => {
    const meta: SplitMeta = {
      groups: [{ description: "a", changes: ["bad"] as any }],
    };
    const errors = validateMeta(meta, 4);
    expect(errors.some((e) => e.includes("Invalid change item"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateSubPatches: end-to-end
// ---------------------------------------------------------------------------

describe("generateSubPatches", () => {
  it("simple 2-way split", () => {
    const original = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,5 +1,5 @@
 line1
-line2
+lineA
 line3
-line4
+lineB
 line5
`;
    // changes: 0=-line2, 1=+lineA, 2=-line4, 3=+lineB
    const meta: SplitMeta = {
      groups: [
        { description: "change line2", changes: [0, 1] },
        { description: "change line4", changes: [2, 3] },
      ],
    };

    const subs = generateSubPatches(original, meta);
    expect(subs).toHaveLength(2);

    // Verify composition via harness logic
    const patches = parsePatch(original);
    const base = reconstructBase(patches);
    const expected = applyPatch(base, patches);

    let state = base;
    for (const sub of subs) {
      state = applyPatch(state, parsePatch(sub));
    }
    expect(state).toEqual(expected);
  });

  it("3-way split", () => {
    const original = `diff --git a/f.py b/f.py
--- a/f.py
+++ b/f.py
@@ -1,6 +1,6 @@
-a
+A
 b
-c
+C
 d
-e
+E
 f
`;
    // changes: 0=-a, 1=+A, 2=-c, 3=+C, 4=-e, 5=+E
    const meta: SplitMeta = {
      groups: [
        { description: "change a->A", changes: [0, 1] },
        { description: "change c->C", changes: [2, 3] },
        { description: "change e->E", changes: [4, 5] },
      ],
    };

    const subs = generateSubPatches(original, meta);
    expect(subs).toHaveLength(3);

    const patches = parsePatch(original);
    const base = reconstructBase(patches);
    const expected = applyPatch(base, patches);

    let state = base;
    for (const sub of subs) {
      state = applyPatch(state, parsePatch(sub));
    }
    expect(state).toEqual(expected);
  });

  it("split with insertion and deletion", () => {
    const original = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,5 +1,5 @@
 a
-b
+B1
+B2
 c
-d
 e
`;
    // changes: 0=-b, 1=+B1, 2=+B2, 3=-d
    const meta: SplitMeta = {
      groups: [
        { description: "replace b with B1,B2", changes: [0, 1, 2] },
        { description: "delete d", changes: [3] },
      ],
    };

    const subs = generateSubPatches(original, meta);

    const patches = parsePatch(original);
    const base = reconstructBase(patches);
    const expected = applyPatch(base, patches);

    let state = base;
    for (const sub of subs) {
      state = applyPatch(state, parsePatch(sub));
    }
    expect(state).toEqual(expected);
  });

  it("split across multiple files", () => {
    const original = `diff --git a/bar.py b/bar.py
--- a/bar.py
+++ b/bar.py
@@ -1,3 +1,3 @@
 b1
-b2
+bX
 b3
diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
 f1
-f2
+fX
 f3
`;
    // changes: 0=-b2, 1=+bX (bar.py), 2=-f2, 3=+fX (foo.py)
    const meta: SplitMeta = {
      groups: [
        { description: "change foo.py", changes: [2, 3] },
        { description: "change bar.py", changes: [0, 1] },
      ],
    };

    const subs = generateSubPatches(original, meta);

    const patches = parsePatch(original);
    const base = reconstructBase(patches);
    const expected = applyPatch(base, patches);

    let state = base;
    for (const sub of subs) {
      state = applyPatch(state, parsePatch(sub));
    }
    expect(state).toEqual(expected);
  });

  it("splits new file (/dev/null) across two groups", () => {
    // Simulates the reported bug: splitting a new file's additions into two
    // groups causes context mismatch in sub-patch #2 because line numbers
    // are off-by-one for new files in subsequent groups.
    const lines = Array.from({ length: 20 }, (_, i) => `+line${i + 1}`).join("\n");
    const original = `diff --git a/pkg/gate.go b/pkg/gate.go
new file mode 100644
--- /dev/null
+++ b/pkg/gate.go
@@ -0,0 +1,20 @@
${lines}
`;
    // 20 additions: indices 0-19
    // Group 0: first 10 lines, Group 1: last 10 lines
    const meta: SplitMeta = {
      groups: [
        { description: "gate: core struct", changes: ["0-9"] },
        { description: "gate: methods", changes: ["10-19"] },
      ],
    };

    const subs = generateSubPatches(original, meta);
    expect(subs).toHaveLength(2);

    // Sub-patch 1 should create the file
    expect(subs[0]).toContain("new file mode 100644");
    expect(subs[0]).toContain("--- /dev/null");

    // Sub-patch 2 should modify (not create) the file
    expect(subs[1]).not.toContain("new file");
    expect(subs[1]).toContain("--- a/pkg/gate.go");

    // Verify composition
    const patches = parsePatch(original);
    const base = reconstructBase(patches);
    const expected = applyPatch(base, patches);

    let state = base;
    for (const sub of subs) {
      state = applyPatch(state, parsePatch(sub));
    }
    expect(state).toEqual(expected);
  });

  it("splits new file across three groups", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `+L${i + 1}`).join("\n");
    const original = `diff --git a/new.go b/new.go
new file mode 100644
--- /dev/null
+++ b/new.go
@@ -0,0 +1,30 @@
${lines}
`;
    const meta: SplitMeta = {
      groups: [
        { description: "part 1", changes: ["0-9"] },
        { description: "part 2", changes: ["10-19"] },
        { description: "part 3", changes: ["20-29"] },
      ],
    };

    const subs = generateSubPatches(original, meta);
    expect(subs).toHaveLength(3);

    const patches = parsePatch(original);
    const base = reconstructBase(patches);
    const expected = applyPatch(base, patches);

    let state = base;
    for (const sub of subs) {
      state = applyPatch(state, parsePatch(sub));
    }
    expect(state).toEqual(expected);
  });

  it("rejects invalid meta", () => {
    const original = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
 a
-b
+B
 c
`;
    const meta: SplitMeta = {
      groups: [{ description: "partial", changes: [0] }],
    };

    expect(() => generateSubPatches(original, meta)).toThrow("not assigned");
  });

  it("works with range syntax in meta", () => {
    const original = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,5 +1,5 @@
 line1
-line2
+lineA
 line3
-line4
+lineB
 line5
`;
    // changes: 0=-line2, 1=+lineA, 2=-line4, 3=+lineB
    const meta: SplitMeta = {
      groups: [
        { description: "change line2", changes: ["0-1"] },
        { description: "change line4", changes: ["2-3"] },
      ],
    };

    const subs = generateSubPatches(original, meta);
    expect(subs).toHaveLength(2);

    const patches = parsePatch(original);
    const base = reconstructBase(patches);
    const expected = applyPatch(base, patches);

    let state = base;
    for (const sub of subs) {
      state = applyPatch(state, parsePatch(sub));
    }
    expect(state).toEqual(expected);
  });

  it("works with mixed range and number syntax", () => {
    const original = `diff --git a/f.py b/f.py
--- a/f.py
+++ b/f.py
@@ -1,6 +1,6 @@
-a
+A
 b
-c
+C
 d
-e
+E
 f
`;
    // changes: 0=-a, 1=+A, 2=-c, 3=+C, 4=-e, 5=+E
    const meta: SplitMeta = {
      groups: [
        { description: "change a and c", changes: ["0-3"] },
        { description: "change e", changes: [4, 5] },
      ],
    };

    const subs = generateSubPatches(original, meta);
    expect(subs).toHaveLength(2);

    const patches = parsePatch(original);
    const base = reconstructBase(patches);
    const expected = applyPatch(base, patches);

    let state = base;
    for (const sub of subs) {
      state = applyPatch(state, parsePatch(sub));
    }
    expect(state).toEqual(expected);
  });
});

describe("resolveSplitGroupMeta", () => {
  it("maps draft comments to inline review locations", () => {
    const original = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
 line1
-line2
+lineA
 line3
`;
    const meta: SplitMeta = {
      groups: [
        {
          description: "Update the main branch behavior",
          changes: [0, 1],
          draftComments: [{ change: 1, body: "Potential regression in the new branch." }],
        },
      ],
    };

    const changes = indexChanges(parsePatch(original));
    const groups = resolveSplitGroupMeta(meta, changes);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.description).toBe("Update the main branch behavior");
    expect(groups[0]!.draftComments).toEqual([
      {
        id: "g1-draft1",
        sub: 0,
        change: 1,
        file: "foo.py",
        line: 2,
        side: "additions",
        body: "Potential regression in the new branch.",
        source: "agent",
      },
    ]);
  });
});
