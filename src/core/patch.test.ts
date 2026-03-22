import { describe, expect, it } from "vitest";
import { type FileContents, applyPatch, parsePatch, reconstructBase, PatchError } from "./patch.ts";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe("parsePatch", () => {
  it("parses a simple modification", () => {
    const patch = `diff --git a/foo.py b/foo.py
index 1234567..abcdefg 100644
--- a/foo.py
+++ b/foo.py
@@ -1,4 +1,4 @@
 line1
-line2
+lineX
 line3
 line4
`;
    const result = parsePatch(patch);
    expect(result).toHaveLength(1);
    expect(result[0]!.dstFile).toBe("foo.py");
    expect(result[0]!.hunks).toHaveLength(1);
    expect(result[0]!.hunks[0]!.srcStart).toBe(1);
    expect(result[0]!.hunks[0]!.srcCount).toBe(4);
  });

  it("parses new file", () => {
    const patch = `diff --git a/new.py b/new.py
new file mode 100644
index 0000000..abcdefg
--- /dev/null
+++ b/new.py
@@ -0,0 +1,3 @@
+line1
+line2
+line3
`;
    const result = parsePatch(patch);
    expect(result).toHaveLength(1);
    expect(result[0]!.isNew).toBe(true);
  });

  it("parses deleted file", () => {
    const patch = `diff --git a/old.py b/old.py
deleted file mode 100644
index abcdefg..0000000
--- a/old.py
+++ /dev/null
@@ -1,3 +0,0 @@
-line1
-line2
-line3
`;
    const result = parsePatch(patch);
    expect(result).toHaveLength(1);
    expect(result[0]!.isDelete).toBe(true);
  });

  it("parses multiple hunks", () => {
    const patch = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
 line1
-line2
+lineA
 line3
@@ -10,3 +10,3 @@
 line10
-line11
+lineB
 line12
`;
    const result = parsePatch(patch);
    expect(result).toHaveLength(1);
    expect(result[0]!.hunks).toHaveLength(2);
  });

  it("parses multiple files", () => {
    const patch = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
 line1
-line2
+lineA
 line3
diff --git a/bar.py b/bar.py
--- a/bar.py
+++ b/bar.py
@@ -1,3 +1,3 @@
 bar1
-bar2
+barX
 bar3
`;
    const result = parsePatch(patch);
    expect(result).toHaveLength(2);
    expect(result[0]!.dstFile).toBe("foo.py");
    expect(result[1]!.dstFile).toBe("bar.py");
  });
});

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

describe("applyPatch", () => {
  it("applies simple replacement", () => {
    const base: FileContents = new Map([["foo.py", ["line1", "line2", "line3", "line4"]]]);
    const patch = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,4 +1,4 @@
 line1
-line2
+lineX
 line3
 line4
`;
    const result = applyPatch(base, parsePatch(patch));
    expect(result.get("foo.py")).toEqual(["line1", "lineX", "line3", "line4"]);
  });

  it("applies insertion", () => {
    const base: FileContents = new Map([["foo.py", ["line1", "line2", "line3"]]]);
    const patch = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,5 @@
 line1
+new1
+new2
 line2
 line3
`;
    const result = applyPatch(base, parsePatch(patch));
    expect(result.get("foo.py")).toEqual(["line1", "new1", "new2", "line2", "line3"]);
  });

  it("applies deletion", () => {
    const base: FileContents = new Map([["foo.py", ["line1", "line2", "line3", "line4"]]]);
    const patch = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,4 +1,2 @@
 line1
-line2
-line3
 line4
`;
    const result = applyPatch(base, parsePatch(patch));
    expect(result.get("foo.py")).toEqual(["line1", "line4"]);
  });

  it("creates new file", () => {
    const base: FileContents = new Map();
    const patch = `diff --git a/new.py b/new.py
new file mode 100644
--- /dev/null
+++ b/new.py
@@ -0,0 +1,2 @@
+hello
+world
`;
    const result = applyPatch(base, parsePatch(patch));
    expect(result.get("new.py")).toEqual(["hello", "world"]);
  });

  it("deletes file", () => {
    const base: FileContents = new Map([["old.py", ["line1", "line2"]]]);
    const patch = `diff --git a/old.py b/old.py
deleted file mode 100644
--- a/old.py
+++ /dev/null
@@ -1,2 +0,0 @@
-line1
-line2
`;
    const result = applyPatch(base, parsePatch(patch));
    expect(result.has("old.py")).toBe(false);
  });

  it("throws on context mismatch", () => {
    const base: FileContents = new Map([["foo.py", ["line1", "WRONG", "line3"]]]);
    const patch = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
 line1
-line2
+lineX
 line3
`;
    expect(() => applyPatch(base, parsePatch(patch))).toThrow(PatchError);
  });

  it("applies multiple hunks", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const base: FileContents = new Map([["foo.py", lines]]);
    const patch = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
 line1
-line2
+lineA
 line3
@@ -18,3 +18,3 @@
 line18
-line19
+lineB
 line20
`;
    const result = applyPatch(base, parsePatch(patch));
    expect(result.get("foo.py")![1]).toBe("lineA");
    expect(result.get("foo.py")![18]).toBe("lineB");
  });
});

// ---------------------------------------------------------------------------
// Composition: sub-patches compose to equal original
// ---------------------------------------------------------------------------

describe("composition", () => {
  it("simple 2-way split", () => {
    const base: FileContents = new Map([["foo.py", ["line1", "line2", "line3", "line4", "line5"]]]);

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

    const sub1 = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,5 +1,5 @@
 line1
-line2
+lineA
 line3
 line4
 line5
`;

    const sub2 = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,5 +1,5 @@
 line1
 lineA
 line3
-line4
+lineB
 line5
`;

    const expected = applyPatch(base, parsePatch(original));
    const s1 = applyPatch(base, parsePatch(sub1));
    const actual = applyPatch(s1, parsePatch(sub2));
    expect(actual).toEqual(expected);
  });

  it("split with insertions and deletions", () => {
    const base: FileContents = new Map([["foo.py", ["a", "b", "c", "d", "e"]]]);

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

    const sub1 = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,5 +1,6 @@
 a
-b
+B1
+B2
 c
 d
 e
`;

    const sub2 = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,6 +1,5 @@
 a
 B1
 B2
 c
-d
 e
`;

    const expected = applyPatch(base, parsePatch(original));
    const s1 = applyPatch(base, parsePatch(sub1));
    const actual = applyPatch(s1, parsePatch(sub2));
    expect(actual).toEqual(expected);
    expect(actual.get("foo.py")).toEqual(["a", "B1", "B2", "c", "e"]);
  });

  it("split across multiple files", () => {
    const base: FileContents = new Map([
      ["foo.py", ["f1", "f2", "f3"]],
      ["bar.py", ["b1", "b2", "b3"]],
    ]);

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

    const sub1 = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
 f1
-f2
+fX
 f3
`;

    const sub2 = `diff --git a/bar.py b/bar.py
--- a/bar.py
+++ b/bar.py
@@ -1,3 +1,3 @@
 b1
-b2
+bX
 b3
`;

    const expected = applyPatch(base, parsePatch(original));
    const s1 = applyPatch(base, parsePatch(sub1));
    const actual = applyPatch(s1, parsePatch(sub2));
    expect(actual).toEqual(expected);
  });

  it("3-way split", () => {
    const base: FileContents = new Map([["f.py", ["a", "b", "c", "d", "e", "f"]]]);

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

    const sub1 = `diff --git a/f.py b/f.py
--- a/f.py
+++ b/f.py
@@ -1,6 +1,6 @@
-a
+A
 b
 c
 d
 e
 f
`;

    const sub2 = `diff --git a/f.py b/f.py
--- a/f.py
+++ b/f.py
@@ -1,6 +1,6 @@
 A
 b
-c
+C
 d
 e
 f
`;

    const sub3 = `diff --git a/f.py b/f.py
--- a/f.py
+++ b/f.py
@@ -1,6 +1,6 @@
 A
 b
 C
 d
-e
+E
 f
`;

    const expected = applyPatch(base, parsePatch(original));
    let state = applyPatch(base, parsePatch(sub1));
    state = applyPatch(state, parsePatch(sub2));
    state = applyPatch(state, parsePatch(sub3));
    expect(state).toEqual(expected);
  });

  it("detects mismatch", () => {
    const base: FileContents = new Map([["foo.py", ["line1", "line2", "line3"]]]);

    const original = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
 line1
-line2
+lineX
 line3
`;

    const wrongSub = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1,3 +1,3 @@
 line1
-line2
+lineY
 line3
`;

    const expected = applyPatch(base, parsePatch(original));
    const actual = applyPatch(base, parsePatch(wrongSub));
    expect(actual).not.toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// reconstructBase: verify without base files
// ---------------------------------------------------------------------------

describe("reconstructBase", () => {
  it("reconstructs base and verifies identity (patch == single sub-patch)", () => {
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
    const patches = parsePatch(original);
    const base = reconstructBase(patches);

    // Apply original patch to reconstructed base
    const expected = applyPatch(base, patches);
    // Apply same patch as the only sub-patch -> should match
    const actual = applyPatch(base, patches);
    expect(actual).toEqual(expected);
  });

  it("reconstructs base with multiple hunks and gaps", () => {
    const original = `diff --git a/big.py b/big.py
--- a/big.py
+++ b/big.py
@@ -2,3 +2,3 @@
 ctx1
-old1
+new1
 ctx2
@@ -20,3 +20,3 @@
 ctx3
-old2
+new2
 ctx4
`;
    const patches = parsePatch(original);
    const base = reconstructBase(patches);

    // Lines 2-4 and 20-22 should be real content, gap in between is placeholders
    expect(base.get("big.py")![1]).toBe("ctx1"); // line 2 (0-indexed: 1)
    expect(base.get("big.py")![2]).toBe("old1"); // line 3
    expect(base.get("big.py")![3]).toBe("ctx2"); // line 4
    expect(base.get("big.py")![19]).toBe("ctx3"); // line 20
    expect(base.get("big.py")![5]).toContain("__PLACEHOLDER_LINE_"); // gap

    // Apply original -> expected
    const expected = applyPatch(base, patches);

    // Split into 2 sub-patches
    const sub1 = `diff --git a/big.py b/big.py
--- a/big.py
+++ b/big.py
@@ -2,3 +2,3 @@
 ctx1
-old1
+new1
 ctx2
`;
    const sub2 = `diff --git a/big.py b/big.py
--- a/big.py
+++ b/big.py
@@ -20,3 +20,3 @@
 ctx3
-old2
+new2
 ctx4
`;

    const s1 = applyPatch(base, parsePatch(sub1));
    const actual = applyPatch(s1, parsePatch(sub2));
    expect(actual).toEqual(expected);
  });

  it("works for new file patches (no base needed)", () => {
    const original = `diff --git a/new.py b/new.py
new file mode 100644
--- /dev/null
+++ b/new.py
@@ -0,0 +1,3 @@
+line1
+line2
+line3
`;
    const patches = parsePatch(original);
    const base = reconstructBase(patches);
    expect(base.has("new.py")).toBe(false); // new file, no base

    const expected = applyPatch(base, patches);
    expect(expected.get("new.py")).toEqual(["line1", "line2", "line3"]);
  });
});
