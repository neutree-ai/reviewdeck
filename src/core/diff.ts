/**
 * Pure diff algorithms — no I/O.
 */

import type { DiffLine } from "./types.ts";

export function myersDiff(a: string[], b: string[]): DiffLine[] {
  // LCS via dynamic programming (good enough for error messages)
  const n = a.length;
  const m = b.length;

  // For very large files, fall back to a simpler approach
  if (n * m > 10_000_000) {
    return simpleDiff(a, b);
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from<number>({ length: m + 1 }).fill(0),
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: " ", content: a[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.push({ type: "+", content: b[j - 1]! });
      j--;
    } else {
      result.push({ type: "-", content: a[i - 1]! });
      i--;
    }
  }

  return result.reverse();
}

export function simpleDiff(a: string[], b: string[]): DiffLine[] {
  // Line-by-line comparison for large files
  const result: DiffLine[] = [];
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < a.length && i < b.length && a[i] === b[i]) {
      result.push({ type: " ", content: a[i]! });
    } else {
      if (i < a.length) result.push({ type: "-", content: a[i]! });
      if (i < b.length) result.push({ type: "+", content: b[i]! });
    }
  }
  return result;
}
