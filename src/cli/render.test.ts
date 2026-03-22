import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSubPatchesFromDir, parseSubPatchesFromStdin } from "./render.ts";

const SEPARATOR = "===SUB_PATCH===";

const fakeDiff = (file: string) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,1 @@\n-old\n+new\n`;

// ---------------------------------------------------------------------------
// parseSubPatchesFromStdin
// ---------------------------------------------------------------------------

describe("parseSubPatchesFromStdin", () => {
  it("parses single patch", () => {
    const input = fakeDiff("foo.ts");
    const result = parseSubPatchesFromStdin(input, SEPARATOR);
    expect(result).toHaveLength(1);
    expect(result[0]!.index).toBe(0);
    expect(result[0]!.diff).toContain("foo.ts");
    expect(result[0]!.draftComments).toEqual([]);
  });

  it("parses multiple patches with descriptions", () => {
    const input = [
      fakeDiff("a.ts"),
      `\n${SEPARATOR} Add helpers\n`,
      fakeDiff("b.ts"),
      `\n${SEPARATOR} Fix tests\n`,
      fakeDiff("c.ts"),
    ].join("");
    const result = parseSubPatchesFromStdin(input, SEPARATOR);
    expect(result).toHaveLength(3);
    expect(result[1]!.description).toBe("Add helpers");
    expect(result[2]!.description).toBe("Fix tests");
  });

  it("parses headered patches with JSON metadata", () => {
    const input = [
      `${SEPARATOR} {"index":0,"description":"Add helpers","draftComments":[{"id":"g1-draft1","sub":0,"change":3,"file":"a.ts","line":4,"side":"additions","body":"Potential regression.","source":"agent"}]}\n`,
      fakeDiff("a.ts"),
      `\n${SEPARATOR} {"index":1,"description":"Fix tests","draftComments":[]}\n`,
      fakeDiff("b.ts"),
    ].join("");
    const result = parseSubPatchesFromStdin(input, SEPARATOR);
    expect(result).toHaveLength(2);
    expect(result[0]!.description).toBe("Add helpers");
    expect(result[0]!.draftComments).toHaveLength(1);
    expect(result[0]!.draftComments[0]!.body).toBe("Potential regression.");
    expect(result[1]!.description).toBe("Fix tests");
  });
});

// ---------------------------------------------------------------------------
// parseSubPatchesFromDir
// ---------------------------------------------------------------------------

describe("parseSubPatchesFromDir", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reviewdeck-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads .diff files in numeric order", () => {
    // Write files that would sort wrong lexicographically
    for (const i of [1, 2, 10, 11, 3, 20]) {
      writeFileSync(join(dir, `sub${i}.diff`), fakeDiff(`file${i}.ts`));
    }

    return parseSubPatchesFromDir(dir).then((result) => {
      expect(result).toHaveLength(6);
      expect(result.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
      // Verify numeric order: 1, 2, 3, 10, 11, 20
      expect(result[0]!.diff).toContain("file1.ts");
      expect(result[1]!.diff).toContain("file2.ts");
      expect(result[2]!.diff).toContain("file3.ts");
      expect(result[3]!.diff).toContain("file10.ts");
      expect(result[4]!.diff).toContain("file11.ts");
      expect(result[5]!.diff).toContain("file20.ts");
    });
  });

  it("reads descriptions from meta.json", () => {
    writeFileSync(join(dir, "sub1.diff"), fakeDiff("a.ts"));
    writeFileSync(join(dir, "sub2.diff"), fakeDiff("b.ts"));
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify([
        { index: 0, description: "First change" },
        {
          index: 1,
          description: "Second change",
          draftComments: [
            {
              id: "g2-draft1",
              sub: 1,
              change: 7,
              file: "b.ts",
              line: 3,
              side: "additions",
              body: "Check null handling.",
              source: "agent",
            },
          ],
        },
      ]),
    );

    return parseSubPatchesFromDir(dir).then((result) => {
      expect(result[0]!.description).toBe("First change");
      expect(result[1]!.description).toBe("Second change");
      expect(result[1]!.draftComments[0]!.body).toBe("Check null handling.");
    });
  });

  it("falls back to filename when no meta.json", () => {
    writeFileSync(join(dir, "sub1.diff"), fakeDiff("pkg/util.go"));

    return parseSubPatchesFromDir(dir).then((result) => {
      expect(result[0]!.description).toBe("pkg/util.go");
    });
  });

  it("ignores non-.diff files", () => {
    writeFileSync(join(dir, "sub1.diff"), fakeDiff("a.ts"));
    writeFileSync(join(dir, "meta.json"), "[]");
    writeFileSync(join(dir, "notes.txt"), "some notes");

    return parseSubPatchesFromDir(dir).then((result) => {
      expect(result).toHaveLength(1);
    });
  });
});
