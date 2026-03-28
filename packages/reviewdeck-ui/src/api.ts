import type { ReviewSubmission } from "./types";

export interface ApiConfig {
  sessionId: string;
  reviewToken: string;
  serverUrl: string;
}

interface SubPatch {
  index: number;
  description: string;
  diff: string;
  draftComments: import("./types").AgentDraftComment[];
}

function sessionUrl(config: ApiConfig, path: string): string {
  const base = config.serverUrl.replace(/\/$/, "");
  const qs = `?token=${encodeURIComponent(config.reviewToken)}`;
  return `${base}/api/sessions/${config.sessionId}/${path}${qs}`;
}

export async function fetchPatches(config: ApiConfig): Promise<SubPatch[]> {
  const res = await fetch(sessionUrl(config, "patches"));
  if (!res.ok) throw new Error(`Failed to fetch patches: ${res.status}`);
  return res.json();
}

export async function submitReview(config: ApiConfig, submission: ReviewSubmission): Promise<void> {
  const res = await fetch(sessionUrl(config, "submit"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submission),
  });
  if (!res.ok) throw new Error(`Failed to submit review: ${res.status}`);
}
