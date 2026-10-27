import { describe, expect, it } from "vitest";
import { parsePatch } from "./patch.ts";
import { segmentPatch } from "./segment.ts";
import type { ResolvedRewriteBlock, RewriteRegion } from "./types.ts";

const block = (id: string, ...regions: Omit<RewriteRegion, "file">[]): ResolvedRewriteBlock => ({
  id,
  rewrite: id,
  changes: [],
  anchor: { file: "foo.py", line: 1, side: "additions" },
  regions: regions.map((region) => ({ file: "foo.py", ...region })),
});

const header = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py`;

/** Hunk headers and bodies of a segment, without the file header. */
const body = (diff: string) =>
  diff
    .split("\n")
    .filter((line) => /^[@ +\-\\]/.test(line) && !/^(---|\+\+\+) /.test(line))
    .join("\n");

describe("segmentPatch", () => {
  const patch = `${header}
@@ -1,7 +1,7 @@ def f():
 a
 b
 c
-d
+D
 e
 f
 g
`;

  it("cuts a block out of the code around it", () => {
    const [file] = segmentPatch(patch, [block("rw1", { deletions: [4, 4], additions: [4, 4] })]);
    expect(file!.file).toBe("foo.py");
    expect(file!.segments.map((s) => [s.block, body(s.diff)])).toEqual([
      [undefined, "@@ -1,3 +1,3 @@ def f():\n a\n b\n c"],
      ["rw1", "@@ -4,1 +4,1 @@\n-d\n+D"],
      [undefined, "@@ -5,3 +5,3 @@\n e\n f\n g"],
    ]);
    expect(file!.segments.map((s) => s.gapBefore)).toEqual([0, 0, 0]);
    expect(file!.segments.map((s) => s.changed)).toEqual([0, 2, 0]);
    expect(file!.segments[1]).toMatchObject({ deletions: [4, 4], additions: [4, 4] });
    expect(file!.segments[2]).toMatchObject({ deletions: [5, 7], additions: [5, 7] });
  });

  it("keeps each segment a patch of its own with the file header", () => {
    const [file] = segmentPatch(patch, [block("rw1", { deletions: [4, 4], additions: [4, 4] })]);
    for (const segment of file!.segments) {
      const [parsed] = parsePatch(segment.diff);
      expect(parsed!.dstFile).toBe("foo.py");
      expect(parsed!.hunks).toHaveLength(1);
    }
  });

  it("leaves a file without blocks as one code segment", () => {
    const [file] = segmentPatch(patch, []);
    expect(file!.segments).toHaveLength(1);
    expect(body(file!.segments[0]!.diff)).toBe(body(patch));
  });

  it("takes a block across hunks, gap included", () => {
    const twoHunks = `${header}
@@ -1,4 +1,5 @@
 a
 b
 c
+x
 d
@@ -20,3 +21,4 @@
 t
+y
 u
 v
`;
    const [file] = segmentPatch(twoHunks, [
      block("rw1", { additions: [4, 4] }, { additions: [22, 22] }),
    ]);
    expect(file!.segments.map((s) => [s.block, body(s.diff), s.gapBefore])).toEqual([
      [undefined, "@@ -1,3 +1,3 @@\n a\n b\n c", 0],
      ["rw1", "@@ -4,1 +4,2 @@\n+x\n d\n@@ -20,1 +21,2 @@\n t\n+y", 0],
      [undefined, "@@ -21,2 +23,2 @@\n u\n v", 0],
    ]);
  });

  it("counts the unchanged lines before a segment", () => {
    const later = `${header}
@@ -20,3 +20,3 @@
 t
-u
+U
 v
@@ -40,2 +40,2 @@
-w
+W
 x
`;
    const [file] = segmentPatch(later, [
      block("rw1", { deletions: [21, 21], additions: [21, 21] }),
    ]);
    expect(file!.segments.map((s) => [s.block, s.gapBefore])).toEqual([
      [undefined, 19],
      ["rw1", 0],
      [undefined, 0],
    ]);
    // The trailing code segment spans the gap between the two hunks itself.
    expect(body(file!.segments[2]!.diff)).toBe(
      "@@ -22,1 +22,1 @@\n v\n@@ -40,2 +40,2 @@\n-w\n+W\n x",
    );
  });

  it("splits a block that other changes interrupt", () => {
    const interrupted = `${header}
@@ -1,4 +1,4 @@
 a
-b
+B
-c
+C
 d
`;
    const [file] = segmentPatch(interrupted, [
      block("rw1", { deletions: [2, 2] }, { additions: [3, 3] }),
    ]);
    expect(file!.segments.map((s) => [s.block, body(s.diff)])).toEqual([
      [undefined, "@@ -1,1 +1,1 @@\n a"],
      ["rw1", "@@ -2,1 +1,0 @@\n-b"],
      [undefined, "@@ -3,1 +2,1 @@\n+B\n-c"],
      ["rw1", "@@ -3,0 +3,1 @@\n+C"],
      [undefined, "@@ -4,1 +4,1 @@\n d"],
    ]);
  });

  it("numbers a new file's segments from an empty old side", () => {
    const created = `diff --git a/new.py b/new.py
new file mode 100644
--- /dev/null
+++ b/new.py
@@ -0,0 +1,4 @@
+a
+b
+c
+d
`;
    const [file] = segmentPatch(created, [
      { ...block("rw1"), regions: [{ file: "new.py", additions: [1, 2] }] },
    ]);
    expect(file!.segments.map((s) => [s.block, body(s.diff), s.gapBefore])).toEqual([
      ["rw1", "@@ -0,0 +1,2 @@\n+a\n+b", 0],
      [undefined, "@@ -0,0 +3,2 @@\n+c\n+d", 0],
    ]);
  });

  it("names a deleted file by its old path and keeps no-newline markers", () => {
    const deleted = `diff --git a/old.py b/old.py
deleted file mode 100644
--- a/old.py
+++ /dev/null
@@ -1,2 +0,0 @@
-a
-b
\\ No newline at end of file
`;
    const [file] = segmentPatch(deleted, [
      { ...block("rw1"), regions: [{ file: "old.py", deletions: [2, 2] }] },
    ]);
    expect(file!.file).toBe("old.py");
    expect(body(file!.segments[1]!.diff)).toBe("@@ -2,1 +0,0 @@\n-b\n\\ No newline at end of file");
  });
});
