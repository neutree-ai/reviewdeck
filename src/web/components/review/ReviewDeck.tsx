import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";
import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs";
import {
  MessageSquare,
  Columns2,
  Rows3,
  WrapText,
  ArrowUp,
  Check,
  Eye,
  X,
  Bot,
  UserCheck,
  Ban,
} from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import { countCommentFlow } from "../../comment-flow";
import type {
  AgentDraftComment,
  AgentDraftCommentDecision,
  ReviewComment,
  ReviewSubmission,
} from "../../../core/types";

const DIFF_STYLE_STORAGE_KEY = "reviewdeck:review:diff-style";
const DIFF_WRAP_STORAGE_KEY = "reviewdeck:review:diff-wrap";

export interface SubPatch {
  index: number;
  description: string;
  diff: string;
  draftComments: AgentDraftComment[];
}

export interface ReviewDeckProps {
  patches: SubPatch[];
  onSubmit?: (submission: ReviewSubmission) => void | Promise<void>;
}

type ManualComment = ReviewComment & { source: "human" };

type AnnotationMeta =
  | { kind: "comment"; comment: ManualComment; commentIndex: number }
  | { kind: "draft"; draft: AgentDraftCommentDecision }
  | { kind: "pending" };

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InlineCommentForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");

  return (
    <div className="bg-card/80 p-3 backdrop-blur-sm">
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Leave a comment..."
        className="resize-y text-[13px]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (text.trim()) onSubmit(text.trim());
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          <kbd className="rounded border border-border px-1 py-0.5 font-[family-name:var(--font-mono)] text-[10px]">
            ⌘↵
          </kbd>{" "}
          to submit
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="default" size="sm" onClick={() => text.trim() && onSubmit(text.trim())}>
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentBubble({ comment, onDelete }: { comment: ManualComment; onDelete: () => void }) {
  return (
    <div className="annotation-card annotation-card-human group/comment flex items-start gap-2.5 rounded-md px-3.5 py-3 text-[13px] leading-relaxed shadow-[0_1px_2px_oklch(0/0/0/0.15)]">
      <MessageSquare className="annotation-meta mt-0.5 size-3 shrink-0" />
      <span className="annotation-body flex-1 whitespace-pre-wrap leading-6">{comment.body}</span>
      <button
        onClick={onDelete}
        className="annotation-meta mt-0.5 shrink-0 rounded p-1 hover:bg-white/8 hover:text-white"
        title="Delete comment"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function DraftCommentBubble({
  draft,
  onSetStatus,
}: {
  draft: AgentDraftCommentDecision;
  onSetStatus: (status: AgentDraftCommentDecision["status"]) => void;
}) {
  const statusLabel =
    draft.status === "accepted" ? "Accepted" : draft.status === "rejected" ? "Rejected" : "Draft";
  const toneClass =
    draft.status === "accepted"
      ? "annotation-card-agent-accepted"
      : draft.status === "rejected"
        ? "annotation-card-agent-rejected"
        : "annotation-card-agent-pending";

  return (
    <div
      className={cn(
        "annotation-card flex flex-col gap-2.5 rounded-md px-3.5 py-3 text-[13px] leading-relaxed shadow-[0_1px_2px_oklch(0/0/0/0.15)]",
        toneClass,
      )}
    >
      <div className="annotation-meta flex items-center gap-2 text-[11px] uppercase tracking-wide">
        <Bot className="size-3 shrink-0" />
        <span>Agent draft</span>
        <Badge variant="outline" size="sm">
          {statusLabel}
        </Badge>
      </div>
      <div className="annotation-body whitespace-pre-wrap text-[13px] leading-6">{draft.body}</div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="annotation-button-accept gap-1.5"
          onClick={() => onSetStatus("accepted")}
        >
          <UserCheck className="size-3" />
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="annotation-button-reject gap-1.5"
          onClick={() => onSetStatus("rejected")}
        >
          <Ban className="size-3" />
          Reject
        </Button>
      </div>
    </div>
  );
}

function buildSubmission(
  manualComments: ManualComment[],
  draftComments: AgentDraftCommentDecision[],
): ReviewSubmission {
  const acceptedDraftComments: ReviewComment[] = draftComments
    .filter((draft) => draft.status === "accepted")
    .map((draft) => ({
      sub: draft.sub,
      file: draft.file,
      line: draft.line,
      side: draft.side,
      body: draft.body,
      source: "agent",
      draftId: draft.id,
    }));

  return {
    comments: [...manualComments, ...acceptedDraftComments],
    draftComments,
  };
}

function countDraftStatuses(draftComments: AgentDraftCommentDecision[]) {
  return draftComments.reduce(
    (acc, draft) => {
      acc.total += 1;
      acc[draft.status] += 1;
      return acc;
    },
    { total: 0, pending: 0, accepted: 0, rejected: 0 },
  );
}

function CommentStatusCard({
  title,
  counts,
  compact = false,
  minimal = false,
}: {
  title: string;
  counts: ReturnType<typeof countCommentFlow>;
  compact?: boolean;
  minimal?: boolean;
}) {
  if (counts.totalDrafts === 0) return null;

  const includedWidth =
    counts.totalDrafts > 0 ? `${(counts.included / counts.totalDrafts) * 100}%` : "0%";
  const pendingWidth =
    counts.totalDrafts > 0 ? `${(counts.pending / counts.totalDrafts) * 100}%` : "0%";
  const omittedWidth =
    counts.totalDrafts > 0 ? `${(counts.omitted / counts.totalDrafts) * 100}%` : "0%";

  if (compact) {
    return (
      <div
        title={`${title}: ${counts.included} included, ${counts.pending} pending, ${counts.omitted} omitted`}
      >
        <div className="comment-progress-track overflow-hidden rounded-full">
          {counts.totalDrafts > 0 ? (
            <>
              {counts.included > 0 && (
                <div
                  className="comment-progress-segment comment-progress-segment-included"
                  style={{ width: includedWidth }}
                />
              )}
              {counts.pending > 0 && (
                <div
                  className="comment-progress-segment comment-progress-segment-pending"
                  style={{ width: pendingWidth }}
                />
              )}
              {counts.omitted > 0 && (
                <div
                  className="comment-progress-segment comment-progress-segment-omitted"
                  style={{ width: omittedWidth }}
                />
              )}
            </>
          ) : (
            <div className="comment-progress-empty" />
          )}
        </div>
      </div>
    );
  }

  if (minimal) {
    return (
      <div
        title={`${counts.included} included, ${counts.pending} pending, ${counts.omitted} omitted`}
      >
        <div className="comment-progress-track overflow-hidden rounded-full">
          {counts.totalDrafts > 0 ? (
            <>
              {counts.included > 0 && (
                <div
                  className="comment-progress-segment comment-progress-segment-included"
                  style={{ width: includedWidth }}
                />
              )}
              {counts.pending > 0 && (
                <div
                  className="comment-progress-segment comment-progress-segment-pending"
                  style={{ width: pendingWidth }}
                />
              )}
              {counts.omitted > 0 && (
                <div
                  className="comment-progress-segment comment-progress-segment-omitted"
                  style={{ width: omittedWidth }}
                />
              )}
            </>
          ) : (
            <div className="comment-progress-empty" />
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className="comment-progress-chip">
            <span className="comment-progress-dot comment-progress-dot-included" />
            {counts.included}
          </span>
          <span className="comment-progress-chip">
            <span className="comment-progress-dot comment-progress-dot-pending" />
            {counts.pending}
          </span>
          <span className="comment-progress-chip">
            <span className="comment-progress-dot comment-progress-dot-omitted" />
            {counts.omitted}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground">
          {counts.totalDrafts} drafts
        </span>
      </div>
      <div className="comment-progress-track mt-2 overflow-hidden rounded-full">
        {counts.totalDrafts > 0 ? (
          <>
            {counts.included > 0 && (
              <div
                className="comment-progress-segment comment-progress-segment-included"
                style={{ width: includedWidth }}
              />
            )}
            {counts.pending > 0 && (
              <div
                className="comment-progress-segment comment-progress-segment-pending"
                style={{ width: pendingWidth }}
              />
            )}
            {counts.omitted > 0 && (
              <div
                className="comment-progress-segment comment-progress-segment-omitted"
                style={{ width: omittedWidth }}
              />
            )}
          </>
        ) : (
          <div className="comment-progress-empty" />
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        <span className="comment-progress-chip">
          <span className="comment-progress-dot comment-progress-dot-included" />
          {counts.included} included
        </span>
        <span className="comment-progress-chip">
          <span className="comment-progress-dot comment-progress-dot-pending" />
          {counts.pending} pending
        </span>
        <span className="comment-progress-chip">
          <span className="comment-progress-dot comment-progress-dot-omitted" />
          {counts.omitted} omitted
        </span>
      </div>
    </div>
  );
}

function FileDiffView({
  fileDiff,
  comments,
  draftComments,
  diffStyle,
  wrap,
  viewed,
  onAddComment,
  onDeleteComment,
  onSetDraftStatus,
  onToggleViewed,
}: {
  fileDiff: FileDiffMetadata;
  comments: ManualComment[];
  draftComments: AgentDraftCommentDecision[];
  diffStyle: "unified" | "split";
  wrap: boolean;
  viewed: boolean;
  onAddComment: (comment: Omit<ManualComment, "sub" | "source">) => void;
  onDeleteComment: (commentIndex: number) => void;
  onSetDraftStatus: (draftId: string, status: AgentDraftCommentDecision["status"]) => void;
  onToggleViewed: () => void;
}) {
  const [pendingLine, setPendingLine] = useState<{
    line: number;
    side: "additions" | "deletions";
  } | null>(null);

  const annotations: DiffLineAnnotation<AnnotationMeta>[] = useMemo(() => {
    const result: DiffLineAnnotation<AnnotationMeta>[] = [];

    comments.forEach((comment, i) => {
      if (comment.file !== fileDiff.name) return;
      result.push({
        side: comment.side,
        lineNumber: comment.line,
        metadata: { kind: "comment", comment, commentIndex: i },
      });
    });

    draftComments.forEach((draft) => {
      if (draft.file !== fileDiff.name) return;
      result.push({
        side: draft.side,
        lineNumber: draft.line,
        metadata: { kind: "draft", draft },
      });
    });

    if (pendingLine) {
      result.push({
        side: pendingLine.side,
        lineNumber: pendingLine.line,
        metadata: { kind: "pending" },
      });
    }

    return result;
  }, [comments, draftComments, fileDiff.name, pendingLine]);

  const options = useMemo(
    () => ({
      theme: { dark: "github-dark", light: "github-light" } as const,
      diffStyle,
      overflow: (wrap ? "wrap" : "scroll") as "wrap" | "scroll",
      diffIndicators: "classic" as const,
      lineDiffType: "word" as const,
      // Force WASM Oniguruma. The default `shiki-js` engine has catastrophic
      // backtracking on Go struct tags + interface{} — see
      // https://github.com/shikijs/textmate-grammars-themes/issues/182
      preferredHighlighter: "shiki-wasm" as const,
      expandUnchanged: true,
      enableGutterUtility: true,
      enableLineSelection: true,
      lineHoverHighlight: "both" as const,
      disableFileHeader: true,
      collapsed: viewed,
      onGutterUtilityClick: (range: { start: number; side?: string }) => {
        setPendingLine({
          line: range.start,
          side: (range.side as "additions" | "deletions") ?? "additions",
        });
      },
    }),
    [diffStyle, wrap, viewed],
  );

  const renderAnnotation = useCallback(
    (ann: DiffLineAnnotation<AnnotationMeta>) => {
      if (ann.metadata.kind === "pending") {
        return (
          <InlineCommentForm
            onSubmit={(body) => {
              onAddComment({
                file: fileDiff.name,
                line: ann.lineNumber,
                side: ann.side as "additions" | "deletions",
                body,
              });
              setPendingLine(null);
            }}
            onCancel={() => setPendingLine(null)}
          />
        );
      }

      if (ann.metadata.kind === "draft") {
        return (
          <DraftCommentBubble
            draft={ann.metadata.draft}
            onSetStatus={(status) => onSetDraftStatus(ann.metadata.draft.id, status)}
          />
        );
      }

      return (
        <CommentBubble
          comment={ann.metadata.comment}
          onDelete={() => onDeleteComment(ann.metadata.commentIndex)}
        />
      );
    },
    [fileDiff.name, onAddComment, onDeleteComment, onSetDraftStatus],
  );

  const diffSummary = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    fileDiff.hunks.forEach((hunk) => {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    });
    return { additions, deletions };
  }, [fileDiff.hunks]);

  return (
    <div
      className={cn(
        "animate-fade-in-up rounded-lg border shadow-[0_1px_3px_oklch(0/0/0/0.2)] transition-colors",
        viewed ? "border-border/30 bg-card/55" : "border-border/60 bg-transparent",
      )}
    >
      <div className="file-toolbar sticky top-0 z-20 flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0 flex items-center gap-3">
          <button
            onClick={onToggleViewed}
            className={cn(
              "flex size-[18px] shrink-0 items-center justify-center rounded border-2 transition-colors",
              viewed
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground bg-transparent",
            )}
            title={viewed ? "Mark as unviewed" : "Mark as viewed"}
          >
            {viewed && <Check className="size-3" strokeWidth={3} />}
          </button>
          <div className="min-w-0">
            <div className="truncate font-[family-name:var(--font-mono)] text-[12px] font-medium text-foreground">
              {fileDiff.prevName ? `${fileDiff.prevName} -> ${fileDiff.name}` : fileDiff.name}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground">
          {diffSummary.deletions > 0 && (
            <span className="file-toolbar-deletions">-{diffSummary.deletions}</span>
          )}
          {diffSummary.additions > 0 && (
            <span className="file-toolbar-additions">+{diffSummary.additions}</span>
          )}
        </div>
      </div>
      <div className="overflow-hidden rounded-b-lg">
        <FileDiff
          fileDiff={fileDiff}
          options={options}
          lineAnnotations={annotations}
          renderAnnotation={renderAnnotation}
        />
      </div>
    </div>
  );
}

function SubPatchView({
  patch,
  comments,
  draftComments,
  diffStyle,
  wrap,
  viewedFiles,
  onAddComment,
  onDeleteComment,
  onSetDraftStatus,
  onToggleViewed,
}: {
  patch: SubPatch;
  comments: ManualComment[];
  draftComments: AgentDraftCommentDecision[];
  diffStyle: "unified" | "split";
  wrap: boolean;
  viewedFiles: Set<string>;
  onAddComment: (comment: Omit<ManualComment, "sub" | "source">) => void;
  onDeleteComment: (commentIndex: number) => void;
  onSetDraftStatus: (draftId: string, status: AgentDraftCommentDecision["status"]) => void;
  onToggleViewed: (file: string) => void;
}) {
  const fileDiffs = useMemo(() => {
    const parsed = parsePatchFiles(patch.diff);
    return parsed.flatMap((p) => p.files);
  }, [patch.diff]);

  const draftCounts = useMemo(() => countDraftStatuses(draftComments), [draftComments]);

  return (
    <div className="animate-fade-in-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="font-[family-name:var(--font-mono)] text-[11px] font-medium tracking-widest text-primary">
              {String(patch.index + 1).padStart(2, "0")}
            </span>
            <h3 className="font-[family-name:var(--font-mono)] text-base font-semibold tracking-tight">
              {patch.description}
            </h3>
          </div>
          {draftCounts.total > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" size="sm">
                <Bot className="mr-1 size-3" />
                {draftCounts.accepted} accepted
              </Badge>
              <Badge variant="outline" size="sm">
                {draftCounts.pending} pending
              </Badge>
              <Badge variant="outline" size="sm">
                {draftCounts.rejected} rejected
              </Badge>
              {draftCounts.pending > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      draftComments
                        .filter((draft) => draft.status === "pending")
                        .forEach((draft) => onSetDraftStatus(draft.id, "accepted"));
                    }}
                  >
                    <UserCheck className="size-3" />
                    Accept Pending
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() => {
                      draftComments
                        .filter((draft) => draft.status === "pending")
                        .forEach((draft) => onSetDraftStatus(draft.id, "rejected"));
                    }}
                  >
                    <Ban className="size-3" />
                    Reject Pending
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        <span className="flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground">
          <Eye className="size-3" />
          {fileDiffs.filter((fd) => viewedFiles.has(fd.name)).length}/{fileDiffs.length}
        </span>
      </div>

      <div className="stagger-children space-y-3">
        {fileDiffs.map((fd) => (
          <FileDiffView
            key={fd.name}
            fileDiff={fd}
            comments={comments}
            draftComments={draftComments}
            diffStyle={diffStyle}
            wrap={wrap}
            viewed={viewedFiles.has(fd.name)}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
            onSetDraftStatus={onSetDraftStatus}
            onToggleViewed={() => onToggleViewed(fd.name)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReviewDeck({ patches, onSubmit }: ReviewDeckProps) {
  const [comments, setComments] = useState<ManualComment[]>([]);
  const [draftComments, setDraftComments] = useState<AgentDraftCommentDecision[]>([]);
  const [activeSub, setActiveSub] = useState(0);
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">(() => {
    if (typeof window === "undefined") return "split";
    const stored = window.localStorage.getItem(DIFF_STYLE_STORAGE_KEY);
    return stored === "unified" || stored === "split" ? stored : "split";
  });
  const [wrap, setWrap] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(DIFF_WRAP_STORAGE_KEY) === "1";
  });
  const [submitted, setSubmitted] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [viewedFiles, setViewedFiles] = useState<Map<number, Set<string>>>(new Map());
  const prevAllViewedRef = useRef(false);

  // Initialize draft comments from patches
  useEffect(() => {
    setDraftComments(
      patches.flatMap((patch) =>
        patch.draftComments.map((draft) => ({
          ...draft,
          status: "pending" as const,
        })),
      ),
    );
  }, [patches]);

  useEffect(() => {
    window.localStorage.setItem(DIFF_STYLE_STORAGE_KEY, diffStyle);
  }, [diffStyle]);

  useEffect(() => {
    window.localStorage.setItem(DIFF_WRAP_STORAGE_KEY, wrap ? "1" : "0");
  }, [wrap]);

  const addComment = useCallback(
    (subIndex: number, comment: Omit<ManualComment, "sub" | "source">) => {
      setComments((prev) => [...prev, { ...comment, sub: subIndex, source: "human" }]);
    },
    [],
  );

  const deleteComment = useCallback((globalIndex: number) => {
    setComments((prev) => prev.filter((_, i) => i !== globalIndex));
  }, []);

  const setDraftStatus = useCallback(
    (draftId: string, status: AgentDraftCommentDecision["status"]) => {
      setDraftComments((prev) =>
        prev.map((draft) => (draft.id === draftId ? { ...draft, status } : draft)),
      );
    },
    [],
  );

  const submission = useMemo(
    () => buildSubmission(comments, draftComments),
    [comments, draftComments],
  );

  const handleSubmit = useCallback(async () => {
    if (onSubmit) await onSubmit(submission);
    setSubmittedCount(submission.comments.length);
    setSubmitted(true);
  }, [submission, onSubmit]);

  const toggleViewed = useCallback((subIndex: number, fileName: string) => {
    setViewedFiles((prev) => {
      const next = new Map(prev);
      const files = new Set(next.get(subIndex) ?? []);
      if (files.has(fileName)) {
        files.delete(fileName);
      } else {
        files.add(fileName);
      }
      next.set(subIndex, files);
      return next;
    });
  }, []);

  const activeFileDiffs = useMemo(() => {
    if (!patches[activeSub]) return [];
    const parsed = parsePatchFiles(patches[activeSub].diff);
    return parsed.flatMap((p) => p.files);
  }, [patches, activeSub]);

  const activeViewedSet = viewedFiles.get(activeSub) ?? new Set();
  const allViewed =
    activeFileDiffs.length > 0 && activeFileDiffs.every((fd) => activeViewedSet.has(fd.name));

  useEffect(() => {
    prevAllViewedRef.current = allViewed;
  }, [activeSub]);

  useEffect(() => {
    if (allViewed && !prevAllViewedRef.current && activeSub < patches.length - 1) {
      const timer = setTimeout(() => setActiveSub((s) => s + 1), 600);
      prevAllViewedRef.current = allViewed;
      return () => clearTimeout(timer);
    }
    prevAllViewedRef.current = allViewed;
  }, [viewedFiles, allViewed, activeSub, patches.length]);

  const isStepViewed = useCallback(
    (subIndex: number) => {
      const viewed = viewedFiles.get(subIndex);
      if (!viewed || viewed.size === 0 || !patches[subIndex]) return false;
      const parsed = parsePatchFiles(patches[subIndex].diff);
      const files = parsed.flatMap((p) => p.files);
      return files.length > 0 && files.every((fd) => viewed.has(fd.name));
    },
    [viewedFiles, patches],
  );

  const activeComments = useMemo(() => {
    const result: { comment: ManualComment; globalIndex: number }[] = [];
    comments.forEach((comment, i) => {
      if (comment.sub === activeSub) result.push({ comment, globalIndex: i });
    });
    return result;
  }, [comments, activeSub]);

  const activeDraftComments = useMemo(
    () => draftComments.filter((draft) => draft.sub === activeSub),
    [draftComments, activeSub],
  );

  const activeCommentsRaw = activeComments.map((entry) => entry.comment);

  const handleDeleteComment = useCallback(
    (localIndex: number) => {
      const entry = activeComments[localIndex];
      if (entry) deleteComment(entry.globalIndex);
    },
    [activeComments, deleteComment],
  );

  const globalCommentCounts = useMemo(
    () => countCommentFlow(comments, draftComments),
    [comments, draftComments],
  );

  const activeCommentCounts = useMemo(
    () => countCommentFlow(activeCommentsRaw, activeDraftComments),
    [activeCommentsRaw, activeDraftComments],
  );

  if (submitted) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background text-foreground">
        <div className="animate-fade-in-up flex size-14 items-center justify-center rounded-full bg-success/15 shadow-[0_0_20px_oklch(0.65_0.17_155/0.15)]">
          <Check className="size-6 text-success" strokeWidth={2.5} />
        </div>
        <div className="animate-fade-in-up text-center" style={{ animationDelay: "80ms" }}>
          <p className="font-[family-name:var(--font-mono)] text-lg font-semibold tracking-tight">
            Review submitted
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {submittedCount} final comment{submittedCount !== 1 ? "s" : ""} sent. You can close this
            tab.
          </p>
        </div>
      </div>
    );
  }

  if (patches.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-foreground">
        <div className="animate-pulse-dot size-2 rounded-full bg-primary" />
        <span className="font-[family-name:var(--font-mono)] text-xs tracking-widest text-muted-foreground">
          LOADING
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-background text-foreground">
      <nav className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center justify-between px-4 pb-3 pt-5">
          <div>
            <h1 className="font-[family-name:var(--font-mono)] text-[11px] font-medium tracking-[0.2em] text-muted-foreground">
              REVIEW
            </h1>
            <p className="mt-0.5 font-[family-name:var(--font-mono)] text-xs text-muted-foreground/50">
              {patches.length} patches
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => setWrap((w) => !w)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider shadow-[0_1px_2px_oklch(0/0/0/0.12)] transition-colors",
                wrap
                  ? "bg-primary text-primary-foreground"
                  : "bg-background/70 text-muted-foreground hover:bg-surface hover:text-foreground",
              )}
              title={wrap ? "Disable line wrap" : "Wrap long lines"}
            >
              <WrapText className="size-3" />
              Wrap
            </button>
            <div className="inline-flex rounded-md border border-border bg-background/70 p-1 shadow-[0_1px_2px_oklch(0/0/0/0.12)]">
              <button
                onClick={() => setDiffStyle("split")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider transition-colors",
                  diffStyle === "split"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface hover:text-foreground",
                )}
                title="Use split diff view"
              >
                <Columns2 className="size-3" />
                Split
              </button>
              <button
                onClick={() => setDiffStyle("unified")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider transition-colors",
                  diffStyle === "unified"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface hover:text-foreground",
                )}
                title="Use unified diff view"
              >
                <Rows3 className="size-3" />
                Unified
              </button>
            </div>
          </div>
        </div>

        {globalCommentCounts.totalDrafts > 0 && (
          <div className="px-3 pb-3">
            <div className="rounded-md border border-border/70 bg-background/60 p-3">
              <CommentStatusCard title="Whole review" counts={globalCommentCounts} minimal />
            </div>
          </div>
        )}

        <div className="rail-track stagger-children flex-1 overflow-y-auto px-2 py-2">
          {patches.map((patch) => {
            const subComments = comments.filter((comment) => comment.sub === patch.index);
            const subDraftComments = draftComments.filter((draft) => draft.sub === patch.index);
            const commentCounts = countCommentFlow(subComments, subDraftComments);
            const isActive = activeSub === patch.index;
            const stepDone = isStepViewed(patch.index);

            return (
              <button
                key={patch.index}
                onClick={() => setActiveSub(patch.index)}
                className={cn(
                  "animate-fade-in-up group relative flex w-full items-start gap-3 rounded-md px-2 py-2.5 text-left transition-all duration-150",
                  isActive ? "bg-surface" : "hover:bg-surface/50",
                )}
              >
                <div className="relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center">
                  {stepDone ? (
                    <span className="flex size-5 items-center justify-center rounded-full bg-success/20 text-success">
                      <Check className="size-3" strokeWidth={2.5} />
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full font-[family-name:var(--font-mono)] text-[10px] font-semibold transition-all duration-150",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-[0_0_8px_oklch(0.78_0.145_75/0.3)]"
                          : "border border-border bg-card text-muted-foreground group-hover:border-foreground/20 group-hover:text-foreground/70",
                      )}
                    >
                      {patch.index + 1}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1 pt-px">
                  <span
                    className={cn(
                      "block truncate text-[13px] leading-snug transition-colors",
                      stepDone
                        ? "text-muted-foreground line-through decoration-muted-foreground/30"
                        : isActive
                          ? "font-medium text-foreground"
                          : "text-muted-foreground group-hover:text-foreground/80",
                    )}
                  >
                    {patch.description}
                  </span>
                  {(subComments.length > 0 || subDraftComments.length > 0) && (
                    <span className="mt-1 inline-flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/60">
                      {commentCounts.final > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare className="size-2.5" />
                          {commentCounts.final}
                        </span>
                      )}
                      {commentCounts.human > 0 && <span>{commentCounts.human} human</span>}
                      {commentCounts.included > 0 && <span>{commentCounts.included} included</span>}
                      {commentCounts.pending > 0 && <span>{commentCounts.pending} pending</span>}
                      {commentCounts.omitted > 0 && <span>{commentCounts.omitted} omitted</span>}
                    </span>
                  )}
                  {isActive && activeCommentCounts.totalDrafts > 0 && (
                    <div className="mt-3 rounded-md border border-border/60 bg-background/55 p-2.5">
                      <CommentStatusCard title="This patch" counts={activeCommentCounts} compact />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t border-border p-3">
          <Button variant="default" className="w-full gap-2" onClick={handleSubmit}>
            <ArrowUp className="size-3.5" />
            <span className="font-[family-name:var(--font-mono)] text-xs tracking-wide">
              Submit
            </span>
            <Badge variant="default" size="sm">
              {submission.comments.length}
            </Badge>
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Submit sends accepted agent drafts plus your own comments. Rejected drafts stay out.
          </p>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <div className="p-6">
          {patches[activeSub] && (
            <SubPatchView
              key={activeSub}
              patch={patches[activeSub]}
              comments={activeCommentsRaw}
              draftComments={activeDraftComments}
              diffStyle={diffStyle}
              wrap={wrap}
              viewedFiles={activeViewedSet}
              onAddComment={(comment) => addComment(activeSub, comment)}
              onDeleteComment={handleDeleteComment}
              onSetDraftStatus={setDraftStatus}
              onToggleViewed={(file) => toggleViewed(activeSub, file)}
            />
          )}
        </div>
      </main>
    </div>
  );
}
