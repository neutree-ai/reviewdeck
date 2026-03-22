/**
 * Unified diff parser and applier.
 */

import {
  type Hunk,
  type HunkLine,
  type FilePatch,
  type FileContents,
  PatchError,
} from "./types.ts";

// Re-export types consumed by other layers
export { type FileContents, PatchError } from "./types.ts";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parsePatch(text: string): FilePatch[] {
  const patches: FilePatch[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    if (!lines[i]!.startsWith("diff --git ")) {
      i++;
      continue;
    }

    const m = lines[i]!.match(/^diff --git a\/(.*) b\/(.*)/);
    const srcName = m?.[1] ?? "";
    const dstName = m?.[2] ?? "";
    i++;

    let isNew = false;
    let isDelete = false;

    // Extended headers
    while (
      i < lines.length &&
      !lines[i]!.startsWith("--- ") &&
      !lines[i]!.startsWith("diff --git ")
    ) {
      if (lines[i]!.startsWith("new file")) isNew = true;
      if (lines[i]!.startsWith("deleted file")) isDelete = true;
      i++;
    }

    if (i >= lines.length || lines[i]!.startsWith("diff --git ")) {
      patches.push({ srcFile: srcName, dstFile: dstName, hunks: [], isNew, isDelete });
      continue;
    }

    // --- line
    let srcFile = srcName;
    if (lines[i]!.startsWith("--- ")) {
      const raw = lines[i]!.slice(4).trim();
      if (raw.startsWith("a/")) srcFile = raw.slice(2);
      else if (raw === "/dev/null") srcFile = dstName;
      else srcFile = raw;
      i++;
    }

    // +++ line
    let dstFile = dstName;
    if (i < lines.length && lines[i]!.startsWith("+++ ")) {
      const raw = lines[i]!.slice(4).trim();
      if (raw.startsWith("b/")) dstFile = raw.slice(2);
      else if (raw === "/dev/null") dstFile = srcFile;
      else dstFile = raw;
      i++;
    }

    const hunks: Hunk[] = [];
    while (i < lines.length && lines[i]!.startsWith("@@")) {
      const [hunk, nextI] = parseHunk(lines, i);
      hunks.push(hunk);
      i = nextI;
    }

    patches.push({ srcFile, dstFile, hunks, isNew, isDelete });
  }

  return patches;
}

function parseHunk(lines: string[], i: number): [Hunk, number] {
  const m = lines[i]!.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!m) throw new PatchError(`Invalid hunk header: ${lines[i]}`);

  const srcStart = parseInt(m[1]!);
  const srcCount = m[2] !== undefined ? parseInt(m[2]) : 1;
  const dstStart = parseInt(m[3]!);
  const dstCount = m[4] !== undefined ? parseInt(m[4]) : 1;

  i++;
  const hunkLines: HunkLine[] = [];
  let srcSeen = 0;
  let dstSeen = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("@@") || line.startsWith("diff --git ")) break;

    if (line.startsWith("-")) {
      hunkLines.push({ type: "-", content: line.slice(1) });
      srcSeen++;
    } else if (line.startsWith("+")) {
      hunkLines.push({ type: "+", content: line.slice(1) });
      dstSeen++;
    } else if (line.startsWith(" ")) {
      hunkLines.push({ type: " ", content: line.slice(1) });
      srcSeen++;
      dstSeen++;
    } else if (line === "\\ No newline at end of file") {
      hunkLines.push({ type: "\\", content: "" });
    } else if (line === "") {
      if (srcSeen < srcCount && dstSeen < dstCount) {
        hunkLines.push({ type: " ", content: "" });
        srcSeen++;
        dstSeen++;
      } else {
        break;
      }
    } else {
      break;
    }

    i++;

    if (srcSeen >= srcCount && dstSeen >= dstCount) {
      if (i < lines.length && lines[i] === "\\ No newline at end of file") {
        hunkLines.push({ type: "\\", content: "" });
        i++;
      }
      break;
    }
  }

  return [{ srcStart, srcCount, dstStart, dstCount, lines: hunkLines }, i];
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export function applyPatch(fileContents: FileContents, patches: FilePatch[]): FileContents {
  const result = new Map<string, string[]>();
  for (const [k, v] of fileContents) {
    result.set(k, [...v]);
  }

  for (const fp of patches) {
    if (fp.isNew) {
      const newLines: string[] = [];
      for (const hunk of fp.hunks) {
        for (const hl of hunk.lines) {
          if (hl.type === "+") newLines.push(hl.content);
        }
      }
      result.set(fp.dstFile, newLines);
      continue;
    }

    if (fp.isDelete) {
      result.delete(fp.srcFile);
      continue;
    }

    // Handle rename
    if (!result.has(fp.dstFile) && result.has(fp.srcFile)) {
      result.set(fp.dstFile, result.get(fp.srcFile)!);
      result.delete(fp.srcFile);
    }

    const target = fp.dstFile;
    if (!result.has(target)) {
      throw new PatchError(`File not found: ${target}`);
    }

    const content = result.get(target)!;

    // Apply hunks in reverse to preserve line numbers
    for (let h = fp.hunks.length - 1; h >= 0; h--) {
      const hunk = fp.hunks[h]!;
      const start = hunk.srcStart - 1; // 0-indexed

      const oldLines = hunk.lines
        .filter((l) => l.type === " " || l.type === "-")
        .map((l) => l.content);
      const newLines = hunk.lines
        .filter((l) => l.type === " " || l.type === "+")
        .map((l) => l.content);

      // Verify context
      for (let j = 0; j < oldLines.length; j++) {
        const idx = start + j;
        if (idx >= content.length) {
          const err = new PatchError(
            `${target}:${idx + 1}: unexpected EOF, expected: ${JSON.stringify(oldLines[j])}`,
          );
          err.fileSnapshot = [...content];
          err.errorLine = idx + 1;
          throw err;
        }
        if (content[idx] !== oldLines[j]) {
          const err = new PatchError(
            `${target}:${idx + 1}: context mismatch\n` +
              `  expected: ${JSON.stringify(oldLines[j])}\n` +
              `  actual:   ${JSON.stringify(content[idx])}`,
          );
          err.fileSnapshot = [...content];
          err.errorLine = idx + 1;
          throw err;
        }
      }

      content.splice(start, oldLines.length, ...newLines);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reconstruct base file contents from a patch alone.
 *
 * For each file in the patch, we rebuild the source-side content using:
 * - context lines (" ") and deleted lines ("-") from hunks -> known lines
 * - gaps between hunks -> filled with placeholder lines
 *
 * This allows verification without access to the original repo.
 */
export function reconstructBase(patches: FilePatch[]): FileContents {
  const base: FileContents = new Map();

  for (const fp of patches) {
    if (fp.isNew) continue; // new file has no base

    // Pure rename or mode-only change (no hunks)
    if (fp.hunks.length === 0) {
      if (!base.has(fp.srcFile)) {
        // Create an empty placeholder so rename logic in applyPatch can find it
        base.set(fp.srcFile, []);
      }
      continue;
    }

    // Determine total line count of the source file.
    // The last hunk tells us: srcStart + srcCount - 1 is the last line it covers.
    const lastHunk = fp.hunks[fp.hunks.length - 1]!;
    const lastCoveredLine = lastHunk.srcStart + lastHunk.srcCount - 1;
    const fileLines: string[] = Array.from<string>({ length: lastCoveredLine }).fill("");

    // Mark which lines we know
    const known = new Set<number>();

    for (const hunk of fp.hunks) {
      let srcLine = hunk.srcStart - 1; // 0-indexed
      for (const hl of hunk.lines) {
        if (hl.type === " " || hl.type === "-") {
          fileLines[srcLine] = hl.content;
          known.add(srcLine);
          srcLine++;
        }
        // "+" lines don't exist in the source
      }
    }

    // Fill gaps with placeholders so context matching still works
    for (let i = 0; i < fileLines.length; i++) {
      if (!known.has(i)) {
        fileLines[i] = `__PLACEHOLDER_LINE_${i + 1}__`;
      }
    }

    base.set(fp.srcFile, fileLines);
  }

  return base;
}

export function filesTouchedByPatches(patches: FilePatch[]): string[] {
  const files = new Set<string>();
  for (const fp of patches) {
    if (fp.srcFile && fp.srcFile !== "/dev/null") files.add(fp.srcFile);
    if (fp.dstFile && fp.dstFile !== "/dev/null") files.add(fp.dstFile);
  }
  return [...files].sort();
}
