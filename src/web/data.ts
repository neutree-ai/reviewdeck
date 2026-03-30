import type { ReviewSubmission } from "../core/types";

export interface SubPatch {
  index: number;
  description: string;
  diff: string;
  draftComments: {
    id: string;
    change: number;
    file: string;
    line: number;
    side: string;
    body: string;
    sub: number;
    source: "agent";
  }[];
}

export interface DataOptions {
  /** Base URL for API requests (default: current origin) */
  baseUrl?: string;
  /** Review token for service-mode authentication */
  token?: string;
}

function buildUrl(path: string, opts: DataOptions): string {
  const base = opts.baseUrl ?? "";
  const url = `${base}${path}`;
  return opts.token ? `${url}?token=${encodeURIComponent(opts.token)}` : url;
}

export async function fetchPatches(opts: DataOptions = {}): Promise<SubPatch[]> {
  if ((window as { __PATCHES__?: SubPatch[] }).__PATCHES__) {
    return (window as { __PATCHES__: SubPatch[] }).__PATCHES__;
  }
  const res = await fetch(buildUrl("/api/patches", opts));
  return res.json();
}

export async function submitReview(
  submission: ReviewSubmission,
  opts: DataOptions = {},
): Promise<void> {
  await fetch(buildUrl("/api/submit", opts), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submission),
  });
}
