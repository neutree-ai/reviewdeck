import type { ReviewSubmission } from "../core/types";

interface SubPatch {
  index: number;
  description: string;
  diff: string;
  draftComments: import("../core/types").AgentDraftComment[];
}

/**
 * Extract session ID from URL path: /review/:sessionId
 * Returns null if not in session mode (e.g., CLI render).
 */
export function getSessionId(): string | null {
  const match = window.location.pathname.match(/^\/review\/([^/]+)/);
  return match?.[1] ?? null;
}

/** Extract review token from URL query: ?token=xxx */
function getReviewToken(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

/** Build session API URL with review token query param. */
function sessionUrl(sessionId: string, path: string): string {
  const token = getReviewToken();
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  return `/api/sessions/${sessionId}/${path}${qs}`;
}

export async function fetchPatches(): Promise<SubPatch[]> {
  if ((window as { __PATCHES__?: SubPatch[] }).__PATCHES__) {
    return (window as { __PATCHES__: SubPatch[] }).__PATCHES__;
  }

  const sessionId = getSessionId();
  const url = sessionId ? sessionUrl(sessionId, "patches") : "/api/patches";
  const res = await fetch(url);
  return res.json();
}

export async function submitReview(submission: ReviewSubmission): Promise<void> {
  const sessionId = getSessionId();
  const url = sessionId ? sessionUrl(sessionId, "submit") : "/api/submit";
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submission),
  });
}
