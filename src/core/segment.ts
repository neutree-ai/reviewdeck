import type { ResolvedRewriteBlock, RewriteRegion } from "./types.ts";

/**
 * Experimental: a run of one file's diff lines that renders as one piece in
 * rewrite reading mode, either plain code or the lines one rewrite block
 * stands in for.
 */
export interface PatchSegment {
  /** The rewrite block these lines belong to; absent for plain code. */
  block?: string;
  /** A one-file unified diff of just these lines, keeping the file's line numbers. */
  diff: string;
  /** Unchanged lines between the previous segment (or the file start) and this one. */
  gapBefore: number;
  /** Change lines (+/-) in the segment. */
  changed: number;
  /** First and last line shown on each side, context included. */
  deletions?: [number, number];
  additions?: [number, number];
}

export interface FileSegments {
  /** File name as rewrite regions name it: the old path for a deleted file. */
  file: string;
  segments: PatchSegment[];
}

interface Line {
  text: string;
  type: " " | "-" | "+";
  /** Line numbers the line has, or would have next, on each side. */
  old: number;
  new: number;
  hunk: number;
  /** Hunk header context after the closing `@@`, kept on a hunk's first piece. */
  section: string;
  /** A following "\ No newline at end of file" marker. */
  marker?: string;
  owner?: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Cut a patch into the segments rewrite reading mode renders: a block's lines
 * from its first to its last change, context in between included, become one
 * segment; the lines around them stay code. Change lines of anything else
 * inside that span split it, so a block that is not contiguous gets one
 * segment per run.
 */
export function segmentPatch(diff: string, blocks: ResolvedRewriteBlock[]): FileSegments[] {
  const result: FileSegments[] = [];
  const text = diff.split("\n");
  let i = 0;
  while (i < text.length) {
    if (!text[i]!.startsWith("diff --git ")) {
      i++;
      continue;
    }
    const header: string[] = [text[i++]!];
    while (i < text.length && !text[i]!.startsWith("@@") && !text[i]!.startsWith("diff --git "))
      header.push(text[i++]!);

    const lines: Line[] = [];
    while (i < text.length && text[i]!.startsWith("@@")) {
      const m = text[i]!.match(HUNK_HEADER);
      i++;
      if (!m) continue;
      const hunk = lines.length ? lines.at(-1)!.hunk + 1 : 0;
      // A side with no lines names the line before the hunk.
      let old = Number(m[1]) + (m[2] === "0" ? 1 : 0);
      let next = Number(m[3]) + (m[4] === "0" ? 1 : 0);
      const section = m[5] ?? "";
      while (i < text.length && /^[ +\-\\]/.test(text[i]!)) {
        const t = text[i++]!;
        if (t.startsWith("\\")) {
          if (lines.length) lines.at(-1)!.marker = t;
          continue;
        }
        const type = t[0] as Line["type"];
        lines.push({ text: t, type, old, new: next, hunk, section });
        if (type !== "+") old++;
        if (type !== "-") next++;
      }
    }

    const file = fileName(header);
    const regions = blocks.flatMap((block) =>
      block.regions.filter((r) => r.file === file).map((region) => ({ id: block.id, region })),
    );
    for (const line of lines) {
      if (line.type === " ") continue;
      line.owner = regions.find(({ region }) => owns(region, line))?.id;
    }
    result.push({ file, segments: cut(lines, header) });
  }
  return result;
}

function fileName(header: string[]): string {
  const m = header[0]!.match(/^diff --git a\/(.*) b\/(.*)/);
  const deleted = header.some((h) => h === "+++ /dev/null" || h.startsWith("deleted file"));
  return (deleted ? m?.[1] : m?.[2]) ?? "";
}

function owns(region: RewriteRegion, line: Line): boolean {
  const range = line.type === "-" ? region.deletions : region.additions;
  const n = line.type === "-" ? line.old : line.new;
  return range !== undefined && n >= range[0] && n <= range[1];
}

/** Split a file's lines into code and block segments. */
function cut(lines: Line[], header: string[]): PatchSegment[] {
  // Runs: a block's change lines with nothing but its own lines and context between.
  const runs: { owner: string; from: number; to: number }[] = [];
  let prev: Line | undefined;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!;
    if (line.type === " ") continue;
    const run = runs.at(-1);
    if (line.owner && prev?.owner === line.owner) run!.to = k + 1;
    else if (line.owner) runs.push({ owner: line.owner, from: k, to: k + 1 });
    prev = line;
  }

  const segments: PatchSegment[] = [];
  let at = 0;
  // The old-side line after the previous segment; unchanged gaps match on both sides.
  let nextOld = 1;
  const emit = (from: number, to: number, block?: string) => {
    if (from >= to) return;
    const part = lines.slice(from, to);
    const startsHunk = from === 0 || lines[from - 1]!.hunk !== part[0]!.hunk;
    segments.push({
      ...(block ? { block } : {}),
      diff: [...header, ...hunks(part, startsHunk)].join("\n") + "\n",
      gapBefore: Math.max(0, part[0]!.old - nextOld),
      changed: part.filter((l) => l.type !== " ").length,
      ...span(part),
    });
    const last = part.at(-1)!;
    nextOld = last.old + (last.type === "+" ? 0 : 1);
  };
  for (const run of runs) {
    emit(at, run.from);
    emit(run.from, run.to, run.owner);
    at = run.to;
  }
  emit(at, lines.length);
  return segments;
}

/** Hunks of a segment, one per original hunk it touches, renumbered. */
function hunks(part: Line[], startsHunk: boolean): string[] {
  const out: string[] = [];
  for (let k = 0; k < part.length; ) {
    let j = k;
    while (j < part.length && part[j]!.hunk === part[k]!.hunk) j++;
    const lines = part.slice(k, j);
    const olds = lines.filter((l) => l.type !== "+").length;
    const news = lines.filter((l) => l.type !== "-").length;
    // An empty side names the line before, as git does.
    const oldStart = olds ? lines[0]!.old : Math.max(0, lines[0]!.old - 1);
    const newStart = news ? lines[0]!.new : Math.max(0, lines[0]!.new - 1);
    const section = k === 0 && !startsHunk ? "" : lines[0]!.section;
    out.push(`@@ -${oldStart},${olds} +${newStart},${news} @@${section}`);
    for (const line of lines) {
      out.push(line.text);
      if (line.marker) out.push(line.marker);
    }
    k = j;
  }
  return out;
}

function span(part: Line[]): Pick<PatchSegment, "deletions" | "additions"> {
  const olds = part.filter((l) => l.type !== "+").map((l) => l.old);
  const news = part.filter((l) => l.type !== "-").map((l) => l.new);
  return {
    ...(olds.length ? { deletions: [olds[0]!, olds.at(-1)!] as [number, number] } : {}),
    ...(news.length ? { additions: [news[0]!, news.at(-1)!] as [number, number] } : {}),
  };
}
