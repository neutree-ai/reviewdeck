import type { ReviewSubmission, SplitMeta } from "../../core/types.ts";

export interface SubPatchRecord {
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
  }[];
}

export interface Session {
  id: string;
  /** Scoped token for browser access to this session */
  reviewToken: string;
  status: "pending" | "reviewing" | "completed";
  /** Who requested this review (e.g. agent name, API key identifier) */
  caller: string;
  splitMeta: SplitMeta;
  subPatches: SubPatchRecord[];
  submission: ReviewSubmission | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Upload {
  id: string;
  diff: string;
  createdAt: Date;
}

export interface Storage {
  // Uploads (ephemeral diff holding)
  saveUpload(upload: Upload): Promise<void>;
  getUpload(id: string): Promise<Upload | undefined>;
  deleteUpload(id: string): Promise<void>;

  // Sessions
  saveSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  getSessionByToken(reviewToken: string): Promise<Session | undefined>;
  updateSession(
    id: string,
    updates: Partial<Pick<Session, "status" | "submission" | "subPatches" | "updatedAt">>,
  ): Promise<Session | undefined>;
  listSessions(caller?: string): Promise<Session[]>;

  close(): Promise<void>;
}
