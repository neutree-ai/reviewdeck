/**
 * Shared types for the reviewdeck core.
 */

// ---------------------------------------------------------------------------
// Patch types
// ---------------------------------------------------------------------------

export interface Hunk {
  srcStart: number;
  srcCount: number;
  dstStart: number;
  dstCount: number;
  lines: HunkLine[];
}

export type HunkLine = {
  type: " " | "-" | "+" | "\\";
  content: string;
};

export interface FilePatch {
  srcFile: string;
  dstFile: string;
  hunks: Hunk[];
  isNew: boolean;
  isDelete: boolean;
}

export type FileContents = Map<string, string[]>;

export class PatchError extends Error {
  /** The file state at the time of failure */
  fileSnapshot?: string[];
  /** Which line in the file the error occurred at (1-indexed) */
  errorLine?: number;

  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

// ---------------------------------------------------------------------------
// Split types
// ---------------------------------------------------------------------------

/** A single change line from the original patch, with its index. */
export interface IndexedChange {
  index: number;
  file: string;
  type: "-" | "+";
  content: string;
  /** 1-based line number in source (for '-') or dest (for '+') */
  lineNo: number;
}

/**
 * A change item: either a single index (number) or a range string ("1-8").
 * Ranges are inclusive on both ends: "3-7" expands to [3, 4, 5, 6, 7].
 */
export type ChangeItem = number | string;

export type ReviewSide = "additions" | "deletions";

export interface DraftReviewCommentInput {
  /** Anchor this draft comment to an indexed change from `reviewdeck index`. */
  change: number;
  body: string;
}

export interface ReviewComment {
  sub: number;
  file: string;
  line: number;
  side: ReviewSide;
  body: string;
  source: "human" | "agent";
  draftId?: string;
}

export interface AgentDraftComment extends Omit<ReviewComment, "source" | "draftId"> {
  id: string;
  change: number;
  source: "agent";
}

export interface AgentDraftCommentDecision extends AgentDraftComment {
  status: "pending" | "accepted" | "rejected";
}

export interface ReviewSubmission {
  comments: ReviewComment[];
  draftComments: AgentDraftCommentDecision[];
}

/** The meta format that the LLM outputs. */
export interface SplitMeta {
  groups: {
    description: string;
    /** 0-based indices, supports range syntax: [0, "2-5", 7, "10-20"] */
    changes: ChangeItem[];
    /** Optional candidate review comments the agent noticed while splitting. */
    draftComments?: DraftReviewCommentInput[];
  }[];
}

// ---------------------------------------------------------------------------
// Diff types
// ---------------------------------------------------------------------------

export interface DiffLine {
  type: " " | "-" | "+";
  content: string;
}
