import type { AgentDraftComment, ReviewSubmission, SplitMeta } from "../../../src/core/types.ts";

export interface SubPatch {
  index: number;
  description: string;
  diff: string;
  draftComments: AgentDraftComment[];
}

export type SessionStatus = "pending" | "reviewing" | "completed" | "expired";

export interface Session {
  id: string;
  /** Token scoped to this session — grants review access without the shared secret. */
  reviewToken: string;
  status: SessionStatus;
  createdAt: number;
  createdBy: string;
  diffFileId: string;
  splitMeta: SplitMeta;
  subPatches: SubPatch[];
  reviewUrl: string;
  submission?: ReviewSubmission;
  completedAt?: number;
}

export interface Upload {
  content: string;
  createdBy: string;
  createdAt: number;
}

export interface AuthResult {
  ok: boolean;
  id: string;
  error?: string;
}
