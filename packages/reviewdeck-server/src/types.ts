import type { AgentDraftComment, ReviewSubmission, SplitMeta } from "../../../src/core/types.ts";

export interface SubPatch {
  index: number;
  description: string;
  diff: string;
  draftComments: AgentDraftComment[];
}

export type SessionStatus = "pending" | "reviewing" | "completed";

export interface Session {
  id: string;
  reviewToken: string;
  status: SessionStatus;
  createdAt: number;
  createdBy: string;
  splitMeta: SplitMeta;
  subPatches: SubPatch[];
  reviewUrl: string;
  submission?: ReviewSubmission;
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
