import { randomUUID } from "node:crypto";
import { parsePatch } from "../core/patch.ts";
import {
  indexChanges,
  validateMeta,
  generateSubPatches,
  resolveSplitGroupMeta,
  resolveGroupRewrites,
  rewriteCoverage,
} from "../core/split.ts";
import type { SplitMeta } from "../core/types.ts";
import type { SubPatchRecord } from "./storage/interface.ts";

export type BuiltReview =
  | { ok: false; errors: string[] }
  | {
      ok: true;
      subPatches: SubPatchRecord[];
      /** Per group with rewrites: how many of its change lines they cover. */
      rewriteCoverage: { group: number; covered: number; total: number }[];
    };

/**
 * Validate split metadata against a diff and build the review's sub-patches,
 * with their draft comments and (experimental) rewrite blocks resolved. The
 * one place MCP's create_review and REST's POST /reviews build a review.
 */
export function buildReview(diff: string, splitMeta: SplitMeta): BuiltReview {
  const changes = indexChanges(parsePatch(diff));
  const errors = validateMeta(splitMeta, changes.length);
  if (errors.length > 0) return { ok: false, errors };

  const subs = generateSubPatches(diff, splitMeta);
  const groupMeta = resolveSplitGroupMeta(splitMeta, changes);
  const rewrites = resolveGroupRewrites(splitMeta, subs);

  const subPatches: SubPatchRecord[] = subs.map((sub, i) => ({
    index: i,
    description: groupMeta[i]!.description,
    diff: sub,
    draftComments: groupMeta[i]!.draftComments.map((dc) => ({
      id: randomUUID(),
      change: dc.change,
      file: dc.file,
      line: dc.line,
      side: dc.side,
      body: dc.body,
    })),
    ...(rewrites[i]!.rewrites && { rewrites: rewrites[i]!.rewrites }),
  }));

  return {
    ok: true,
    subPatches,
    rewriteCoverage: subPatches
      .filter((sp) => sp.rewrites?.length)
      .map((sp) => ({ group: sp.index, ...rewriteCoverage(sp.diff, sp.rewrites) })),
  };
}
