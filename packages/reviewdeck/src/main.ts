/**
 * Unified CLI for reviewdeck.
 *
 * Usage:
 *   reviewdeck index <patch> [-o <file>]
 *   reviewdeck split <patch> <meta | -> [-o <dir>]
 *   reviewdeck render [<dir> | -]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { parsePatch, applyPatch, reconstructBase } from "../../../src/core/patch.ts";
import {
  indexChanges,
  formatIndexedChanges,
  validateMeta,
  generateSubPatches,
  resolveSplitGroupMeta,
  type SplitMeta,
  type ResolvedSplitGroupMeta,
} from "../../../src/core/split.ts";

const SUB_PATCH_SEPARATOR = "===SUB_PATCH===";

const args = process.argv.slice(2);
const subcommand = args[0];

if (wantsHelp(args)) {
  printUsage();
  process.exit(0);
}

if (!subcommand) {
  printUsage();
  process.exit(2);
}

switch (subcommand) {
  case "index":
    await cmdIndex(args.slice(1));
    break;
  case "split":
    await cmdSplit(args.slice(1));
    break;
  case "render":
    await cmdRender(args.slice(1));
    break;
  default:
    console.error(`Unknown subcommand: ${subcommand}`);
    printUsage();
    process.exit(2);
}

function printUsage() {
  console.error(`Usage:
  reviewdeck index <patch> [-o <file>]
      Generate a numbered change index from a PR diff for the LLM to group.

  reviewdeck split <patch> <meta | -> [-o <dir>]
      Generate and verify ordered sub-patches from the split metadata.
      This proves the split composes back to the original diff.
      Split metadata may also include draft review comments for render.

  reviewdeck render [<dir> | -] [-p <port>]
      Start the human review UI for the generated sub-patches.
      Use this after "split" when the goal is to let a person review the stack.
      It opens a browser and prints a submission JSON object to stdout.

Examples:
  gh pr diff 123 > pr.diff
  reviewdeck index pr.diff > pr.index.txt
  cat split.json | reviewdeck split pr.diff - -o output/
  reviewdeck render output/`);
}

function wantsHelp(args: string[]): boolean {
  return args.length > 0 && (args[0] === "-h" || args[0] === "--help" || args[0] === "help");
}

function printIndexUsage() {
  console.error(`Usage:
  reviewdeck index <diff-file> [-o <output-file>]

Generate a numbered change index from a PR diff.
The index output is intended to be read by an LLM when producing split metadata.`);
}

function printSplitUsage() {
  console.error(`Usage:
  reviewdeck split <diff-file> <split-json | -> [-o <dir>]

Generate ordered sub-patches from split metadata and verify they compose
back to the original diff.

Split metadata can optionally include group-level "draftComments" so the
review UI can render agent findings inline for accept/reject.

After a successful split, continue with "reviewdeck render" when the goal
is to hand the proposed sub-patches to a human reviewer or collect comments.`);
}

function printRenderUsage() {
  console.error(`Usage:
  reviewdeck render [<dir> | -] [-p <port>]

Prepare generated sub-patches for human review.

- Input can be a directory from "split -o" or stdin from "split"
- Server mode opens a browser and waits for human review submission
- Submission JSON includes final comments plus agent-draft accept/reject status

Examples:
  reviewdeck render output/
  cat split.json | reviewdeck split pr.diff - | reviewdeck render -`);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}

async function readFileOrStdin(path: string): Promise<string> {
  return path === "-" ? readStdin() : readFile(path, "utf-8");
}

function writeSubs(
  subs: string[],
  groups: ResolvedSplitGroupMeta[],
  outDir: string | undefined,
): void {
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    for (let i = 0; i < subs.length; i++) {
      const outPath = `${outDir}/sub${i + 1}.diff`;
      writeFileSync(outPath, subs[i]!);
      const lineCount = subs[i]!.split("\n").length;
      console.error(`  Wrote ${outPath} (${lineCount} lines)`);
    }
    // Write meta.json so render can read descriptions and draft review comments.
    const meta = groups.map((group) => ({
      index: group.index,
      description: group.description,
      draftComments: group.draftComments,
    }));
    writeFileSync(`${outDir}/meta.json`, JSON.stringify(meta, null, 2) + "\n");
    console.error(`  Wrote ${outDir}/meta.json`);
  } else {
    for (let i = 0; i < subs.length; i++) {
      const meta = JSON.stringify(groups[i]!);
      process.stdout.write(`${i > 0 ? "\n" : ""}${SUB_PATCH_SEPARATOR} ${meta}\n`);
      process.stdout.write(subs[i]!);
    }
  }
}

// ---------------------------------------------------------------------------
// index
// ---------------------------------------------------------------------------

async function cmdIndex(args: string[]) {
  if (wantsHelp(args)) {
    printIndexUsage();
    return;
  }

  const { values, positionals } = parseArgs({
    args,
    options: { output: { type: "string", short: "o" } },
    allowPositionals: true,
  });

  const diffFile = positionals[0];
  if (!diffFile) {
    printIndexUsage();
    process.exit(1);
  }

  const text = await readFile(diffFile, "utf-8");
  const patches = parsePatch(text);
  const changes = indexChanges(patches);
  const output = formatIndexedChanges(changes) + `\n\nTotal: ${changes.length} change lines\n`;

  if (values.output) {
    writeFileSync(values.output, output);
    console.error(`Wrote ${values.output} (${changes.length} changes)`);
  } else {
    process.stdout.write(output);
  }
}

// ---------------------------------------------------------------------------
// split (with built-in verification)
// ---------------------------------------------------------------------------

async function cmdSplit(args: string[]) {
  if (wantsHelp(args)) {
    printSplitUsage();
    return;
  }

  const { values, positionals } = parseArgs({
    args,
    options: { output: { type: "string", short: "o" } },
    allowPositionals: true,
  });

  const [diffFile, splitFile] = positionals;
  if (!diffFile || !splitFile) {
    printSplitUsage();
    process.exit(1);
  }

  // Parse inputs
  const diffText = readFileSync(diffFile, "utf-8");
  let meta: SplitMeta;
  const metaRaw = await readFileOrStdin(splitFile);
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    console.error(`ERROR: Invalid JSON in split metadata.
The input must be a valid JSON object with this structure:
{
  "groups": [
    { "description": "...", "changes": [0, 1, "2-5"] }
  ]
}

Received: ${metaRaw.slice(0, 200)}${metaRaw.length > 200 ? "..." : ""}`);
    process.exit(1);
  }

  // Validate meta
  const patches = parsePatch(diffText);
  const changes = indexChanges(patches);
  const errors = validateMeta(meta, changes.length);

  if (errors.length > 0) {
    console.error(`ERROR: Invalid split metadata (${errors.length} issue${errors.length > 1 ? "s" : ""}):
${errors.map((e) => `  - ${e}`).join("\n")}

Total change indices in this diff: 0-${changes.length - 1} (${changes.length} changes).
Every index must appear in exactly one group. Fix the meta JSON and retry.`);
    process.exit(1);
  }

  console.error(`Split: ${meta.groups.length} groups, ${changes.length} changes`);
  for (let i = 0; i < meta.groups.length; i++) {
    const g = meta.groups[i]!;
    console.error(`  ${i + 1}. ${g.description} (${g.changes.length} items)`);
  }

  // Generate sub-patches
  const subs = generateSubPatches(diffText, meta);

  // Verify composition
  const base = reconstructBase(patches);
  const expected = applyPatch(base, patches);

  let state = base;
  for (let i = 0; i < subs.length; i++) {
    try {
      state = applyPatch(state, parsePatch(subs[i]!));
    } catch (e: any) {
      console.error(`ERROR: Sub-patch #${i + 1} ("${meta.groups[i]!.description}") failed to apply: ${e.message}

This usually means the changes in group ${i + 1} conflict with earlier groups.
Check that the change indices in this group are correct and don't depend on changes in later groups.`);
      process.exit(1);
    }
  }

  const allFiles = [...new Set([...expected.keys(), ...state.keys()])].sort();
  const mismatches: string[] = [];

  for (const f of allFiles) {
    const exp = expected.get(f) ?? [];
    const act = state.get(f) ?? [];
    if (exp.length !== act.length || !exp.every((l, i) => l === act[i])) {
      mismatches.push(f);
    }
  }

  if (mismatches.length > 0) {
    console.error(`ERROR: Composition mismatch — sub-patches do NOT reproduce the original diff.
${mismatches.length} file(s) differ after applying all sub-patches sequentially:
${mismatches.map((f) => `  - ${f}`).join("\n")}

This is likely a bug in the splitting algorithm. Please report it.`);
    process.exit(1);
  }

  // All good — output sub-patches
  console.error("OK: Verified — sub-patches compose to equal the original diff.");
  const groupMeta = resolveSplitGroupMeta(meta, changes);
  writeSubs(subs, groupMeta, values.output);

  if (values.output) {
    console.error(`Next: run "reviewdeck render ${values.output}" to review these sub-patches.`);
  } else {
    console.error('Next: pipe this output into "reviewdeck render -" to launch review.');
  }
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

async function cmdRender(args: string[]) {
  if (wantsHelp(args)) {
    printRenderUsage();
    return;
  }

  const { values, positionals } = parseArgs({
    args,
    options: {
      port: { type: "string", short: "p" },
    },
    allowPositionals: true,
  });

  const { startReviewServer, parseSubPatchesFromStdin, parseSubPatchesFromDir } =
    await import("./render.ts");

  const source = positionals[0] ?? "-";
  let subPatches;

  if (source === "-") {
    const input = await readStdin();
    subPatches = parseSubPatchesFromStdin(input, SUB_PATCH_SEPARATOR);
  } else {
    subPatches = await parseSubPatchesFromDir(source);
  }

  if (subPatches.length === 0) {
    console.error("ERROR: No sub-patches to review.");
    process.exit(1);
  }

  console.error(`Loaded ${subPatches.length} sub-patches for review.`);

  const port = values.port ? parseInt(values.port, 10) : undefined;
  const submission = await startReviewServer(subPatches, { port });

  // Output submission as JSON to stdout
  process.stdout.write(JSON.stringify(submission, null, 2));
  process.stdout.write("\n");
}
