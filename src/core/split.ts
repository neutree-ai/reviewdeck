/**
 * Split a patch into sub-patches based on a meta assignment.
 *
 * Flow:
 *   1. indexChanges(patch) -> indexed change lines (for LLM to see)
 *   2. LLM outputs a SplitMeta (group assignments)
 *   3. generateSubPatches(patch, meta) -> sub-patch strings
 */

import type {
  AgentDraftComment,
  ChangeItem,
  FilePatch,
  IndexedChange,
  SplitMeta,
} from "./types.ts";
import { parsePatch } from "./patch.ts";

export type { SplitMeta } from "./types.ts";
export interface ResolvedSplitGroupMeta {
  index: number;
  description: string;
  draftComments: AgentDraftComment[];
}

// ---------------------------------------------------------------------------
// Range expansion
// ---------------------------------------------------------------------------

/**
 * Expand a single ChangeItem into concrete indices.
 *   - number → [number]
 *   - "3-7"  → [3, 4, 5, 6, 7]  (inclusive)
 */
function expandItem(item: ChangeItem): number[] {
  if (typeof item === "number") return [item];
  const m = item.match(/^(\d+)-(\d+)$/);
  if (!m) throw new Error(`Invalid change item: ${JSON.stringify(item)}`);
  const start = parseInt(m[1]!);
  const end = parseInt(m[2]!);
  if (start > end) throw new Error(`Invalid range: ${item} (start > end)`);
  const result: number[] = [];
  for (let i = start; i <= end; i++) result.push(i);
  return result;
}

/**
 * Expand an array of ChangeItems into a flat array of indices.
 */
export function expandChanges(items: ChangeItem[]): number[] {
  return items.flatMap(expandItem);
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

export function indexChanges(patches: FilePatch[]): IndexedChange[] {
  const result: IndexedChange[] = [];
  let idx = 0;

  for (const fp of patches) {
    if (fp.hunks.length === 0) continue;

    for (const hunk of fp.hunks) {
      let srcLine = hunk.srcStart;
      let dstLine = hunk.dstStart;

      for (const hl of hunk.lines) {
        if (hl.type === "-") {
          result.push({
            index: idx++,
            file: fp.srcFile,
            type: "-",
            content: hl.content,
            lineNo: srcLine,
          });
          srcLine++;
        } else if (hl.type === "+") {
          result.push({
            index: idx++,
            file: fp.dstFile,
            type: "+",
            content: hl.content,
            lineNo: dstLine,
          });
          dstLine++;
        } else if (hl.type === " ") {
          srcLine++;
          dstLine++;
        }
      }
    }
  }

  return result;
}

/**
 * Format indexed changes for display (to include in LLM prompt).
 */
export function formatIndexedChanges(changes: IndexedChange[]): string {
  const lines: string[] = [];
  let currentFile = "";

  for (const c of changes) {
    if (c.file !== currentFile) {
      if (currentFile) lines.push("");
      lines.push(`## ${c.file}`);
      currentFile = c.file;
    }
    lines.push(`  [${c.index}] ${c.type} L${c.lineNo}: ${c.content}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateMeta(meta: SplitMeta, totalChanges: number): string[] {
  const errors: string[] = [];
  const assigned = new Set<number>();

  for (let g = 0; g < meta.groups.length; g++) {
    const group = meta.groups[g]!;
    if (!group.description) {
      errors.push(`Group ${g + 1}: missing description`);
    }
    let expanded: number[];
    try {
      expanded = expandChanges(group.changes);
    } catch (e: any) {
      errors.push(`Group ${g + 1}: ${e.message}`);
      continue;
    }
    for (const idx of expanded) {
      if (idx < 0 || idx >= totalChanges) {
        errors.push(`Group ${g + 1}: index ${idx} out of range [0, ${totalChanges - 1}]`);
      }
      if (assigned.has(idx)) {
        errors.push(`Group ${g + 1}: index ${idx} already assigned to another group`);
      }
      assigned.add(idx);
    }

    const groupChanges = new Set(expanded);
    for (let c = 0; c < (group.draftComments?.length ?? 0); c++) {
      const comment = group.draftComments![c]!;
      if (!comment.body?.trim()) {
        errors.push(`Group ${g + 1}: draft comment ${c + 1} is missing body`);
      }
      if (comment.change < 0 || comment.change >= totalChanges) {
        errors.push(
          `Group ${g + 1}: draft comment ${c + 1} change ${comment.change} out of range [0, ${totalChanges - 1}]`,
        );
        continue;
      }
      if (!groupChanges.has(comment.change)) {
        errors.push(
          `Group ${g + 1}: draft comment ${c + 1} change ${comment.change} is not assigned to this group`,
        );
      }
    }
  }

  for (let i = 0; i < totalChanges; i++) {
    if (!assigned.has(i)) {
      errors.push(`Change ${i} is not assigned to any group`);
    }
  }

  return errors;
}

export function resolveSplitGroupMeta(
  meta: SplitMeta,
  changes: IndexedChange[],
): ResolvedSplitGroupMeta[] {
  return meta.groups.map((group, groupIndex) => ({
    index: groupIndex,
    description: group.description,
    draftComments: (group.draftComments ?? []).map((comment, commentIndex) => {
      const change = changes[comment.change]!;
      return {
        id: `g${groupIndex + 1}-draft${commentIndex + 1}`,
        sub: groupIndex,
        change: comment.change,
        file: change.file,
        line: change.lineNo,
        side: change.type === "+" ? "additions" : "deletions",
        body: comment.body.trim(),
        source: "agent",
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Alignment: the core data model
// ---------------------------------------------------------------------------

interface AlignmentEntry {
  kind: "context" | "delete" | "add";
  content: string;
  changeIndex?: number; // set for delete and add
}

interface HunkAlignment {
  srcStart: number;
  srcCount: number;
  entries: AlignmentEntry[];
}

interface FileAlignmentInfo {
  srcFile: string;
  dstFile: string;
  hunks: HunkAlignment[];
  isNew: boolean;
  isDelete: boolean;
  isPureRename: boolean;
}

function buildAlignments(patches: FilePatch[]): FileAlignmentInfo[] {
  const result: FileAlignmentInfo[] = [];
  let changeIdx = 0;

  for (const fp of patches) {
    const isPureRename = fp.srcFile !== fp.dstFile && fp.hunks.length === 0;

    if (fp.hunks.length === 0) {
      result.push({
        srcFile: fp.srcFile,
        dstFile: fp.dstFile,
        hunks: [],
        isNew: fp.isNew,
        isDelete: fp.isDelete,
        isPureRename,
      });
      continue;
    }

    const hunks: HunkAlignment[] = [];
    for (const hunk of fp.hunks) {
      const entries: AlignmentEntry[] = [];
      for (const hl of hunk.lines) {
        if (hl.type === " ") {
          entries.push({ kind: "context", content: hl.content });
        } else if (hl.type === "-") {
          entries.push({ kind: "delete", content: hl.content, changeIndex: changeIdx++ });
        } else if (hl.type === "+") {
          entries.push({ kind: "add", content: hl.content, changeIndex: changeIdx++ });
        }
      }
      hunks.push({ srcStart: hunk.srcStart, srcCount: hunk.srcCount, entries });
    }

    result.push({
      srcFile: fp.srcFile,
      dstFile: fp.dstFile,
      hunks,
      isNew: fp.isNew,
      isDelete: fp.isDelete,
      isPureRename: false,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Sub-patch generation: directly from alignment, no full-file reconstruction
// ---------------------------------------------------------------------------

function generateHunkForGroup(
  ha: HunkAlignment,
  groupOf: Map<number, number>,
  g: number,
): { hunkText: string; beforeCount: number; afterCount: number; leadTrim: number } | null {
  const diffLines: { type: " " | "-" | "+"; content: string }[] = [];

  for (const e of ha.entries) {
    if (e.kind === "context") {
      diffLines.push({ type: " ", content: e.content });
    } else if (e.kind === "delete") {
      const assignedGroup = groupOf.get(e.changeIndex!) ?? 0;
      if (assignedGroup === g) {
        diffLines.push({ type: "-", content: e.content });
      } else if (assignedGroup > g) {
        diffLines.push({ type: " ", content: e.content });
      }
    } else if (e.kind === "add") {
      const assignedGroup = groupOf.get(e.changeIndex!) ?? 0;
      if (assignedGroup === g) {
        diffLines.push({ type: "+", content: e.content });
      } else if (assignedGroup < g) {
        diffLines.push({ type: " ", content: e.content });
      }
    }
  }

  const hasChanges = diffLines.some((d) => d.type !== " ");
  if (!hasChanges) return null;

  const lines: string[] = [];
  for (const d of diffLines) {
    lines.push(`${d.type}${d.content}`);
  }

  // Trim leading/trailing context to 3 lines max
  const CONTEXT = 3;
  let trimStart = 0;
  let trimEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith(" ")) trimStart++;
    else break;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.startsWith(" ")) trimEnd++;
    else break;
  }

  const leadTrim = Math.max(0, trimStart - CONTEXT);
  const tailTrim = Math.max(0, trimEnd - CONTEXT);

  const trimmed = lines.slice(leadTrim, lines.length - tailTrim || undefined);
  const trimmedBeforeCount = trimmed.filter((l) => l.startsWith(" ") || l.startsWith("-")).length;
  const trimmedAfterCount = trimmed.filter((l) => l.startsWith(" ") || l.startsWith("+")).length;

  const hunkText = trimmed.join("\n");

  return {
    hunkText,
    beforeCount: trimmedBeforeCount,
    afterCount: trimmedAfterCount,
    leadTrim,
  };
}

function computeBeforeStart(
  ha: HunkAlignment,
  fileHunks: HunkAlignment[],
  hunkIndex: number,
  groupOf: Map<number, number>,
  g: number,
): number {
  let lineNo = ha.srcStart;

  for (let h = 0; h < hunkIndex; h++) {
    const priorHunk = fileHunks[h]!;
    for (const e of priorHunk.entries) {
      if (e.kind === "delete" && (groupOf.get(e.changeIndex!) ?? 0) < g) {
        lineNo--;
      } else if (e.kind === "add" && (groupOf.get(e.changeIndex!) ?? 0) < g) {
        lineNo++;
      }
    }
  }

  return lineNo;
}

export function generateSubPatches(originalText: string, meta: SplitMeta): string[] {
  const patches = parsePatch(originalText);
  const changes = indexChanges(patches);

  // Validate
  const errors = validateMeta(meta, changes.length);
  if (errors.length > 0) {
    throw new Error(`Invalid split meta:\n${errors.join("\n")}`);
  }

  // Build assignment map: changeIndex -> group (0-based)
  const groupOf = new Map<number, number>();
  for (let g = 0; g < meta.groups.length; g++) {
    for (const idx of expandChanges(meta.groups[g]!.changes)) {
      groupOf.set(idx, g);
    }
  }

  const alignments = buildAlignments(patches);

  // Precompute per-file metadata for new/delete files
  const fileInfo = alignments.map((fa) => {
    const allAdds = fa.isNew
      ? fa.hunks.flatMap((h) => h.entries.filter((e) => e.kind === "add"))
      : [];
    const allDeletes = fa.isDelete
      ? fa.hunks.flatMap((h) => h.entries.filter((e) => e.kind === "delete"))
      : [];
    const firstAddGroup =
      allAdds.length > 0 ? Math.min(...allAdds.map((e) => groupOf.get(e.changeIndex!) ?? 0)) : -1;
    const lastDeleteGroup =
      allDeletes.length > 0
        ? Math.max(...allDeletes.map((e) => groupOf.get(e.changeIndex!) ?? 0))
        : -1;
    return { allAdds, allDeletes, firstAddGroup, lastDeleteGroup };
  });

  const subPatches: string[] = [];

  for (let g = 0; g < meta.groups.length; g++) {
    const parts: string[] = [];

    for (let fi = 0; fi < alignments.length; fi++) {
      const fa = alignments[fi]!;
      const info = fileInfo[fi]!;

      // Pure rename: emit in group 0
      if (fa.isPureRename) {
        if (g === 0) {
          parts.push(`diff --git a/${fa.srcFile} b/${fa.dstFile}`);
          parts.push("similarity index 100%");
          parts.push(`rename from ${fa.srcFile}`);
          parts.push(`rename to ${fa.dstFile}`);
        }
        continue;
      }

      const fileHunks: string[] = [];
      let isFileNew = false;
      let isFileDelete = false;

      // Check if this is a new file that gets created in this group
      if (fa.isNew) {
        const inThisGroup = info.allAdds.some((e) => (groupOf.get(e.changeIndex!) ?? 0) === g);
        if (!inThisGroup) continue;
        if (g === info.firstAddGroup) isFileNew = true;
      }

      // Check if this is a delete that completes in this group
      if (fa.isDelete) {
        const inThisGroup = info.allDeletes.some((e) => (groupOf.get(e.changeIndex!) ?? 0) === g);
        if (!inThisGroup) continue;
        if (g === info.lastDeleteGroup) isFileDelete = true;
      }

      for (let h = 0; h < fa.hunks.length; h++) {
        const ha = fa.hunks[h]!;
        const result = generateHunkForGroup(ha, groupOf, g);
        if (!result) continue;

        let beforeStart = computeBeforeStart(ha, fa.hunks, h, groupOf, g) + result.leadTrim;
        // New files have srcStart=0, but once created by an earlier group the
        // file content is 1-indexed, so adjust.
        if (fa.isNew && g > info.firstAddGroup) {
          beforeStart += 1;
        }
        fileHunks.push(
          `@@ -${beforeStart},${result.beforeCount} +${beforeStart},${result.afterCount} @@\n${result.hunkText}`,
        );
      }

      if (fileHunks.length === 0) continue;

      // Fix afterStart: compute running offset for consecutive hunks
      const fixedHunks = fixHunkLineNumbers(fileHunks);

      // Emit file header
      const srcPath = fa.srcFile;
      const dstPath = fa.dstFile;
      parts.push(`diff --git a/${srcPath} b/${dstPath}`);
      if (isFileNew) {
        parts.push("new file mode 100644");
        parts.push("--- /dev/null");
        parts.push(`+++ b/${dstPath}`);
      } else if (isFileDelete) {
        parts.push("deleted file mode 100644");
        parts.push(`--- a/${srcPath}`);
        parts.push("+++ /dev/null");
      } else {
        parts.push(`--- a/${srcPath}`);
        parts.push(`+++ b/${dstPath}`);
      }
      parts.push(...fixedHunks);
    }

    subPatches.push(parts.join("\n") + "\n");
  }

  return subPatches;
}

function fixHunkLineNumbers(hunks: string[]): string[] {
  let dstOffset = 0;
  const result: string[] = [];

  for (const hunk of hunks) {
    const lines = hunk.split("\n");
    const header = lines[0]!;
    const m = header.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
    if (!m) {
      result.push(hunk);
      continue;
    }

    const srcStart = parseInt(m[1]!);
    const srcCount = parseInt(m[2]!);
    const afterCount = parseInt(m[4]!);
    const dstStart = srcStart + dstOffset;

    lines[0] = `@@ -${srcStart},${srcCount} +${dstStart},${afterCount} @@`;
    result.push(lines.join("\n"));

    dstOffset += afterCount - srcCount;
  }

  return result;
}
