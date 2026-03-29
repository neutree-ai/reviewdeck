import "./reviewdeck.css";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";
import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs";
import {
  MessageSquare,
  Columns2,
  Rows3,
  ArrowUp,
  Check,
  Eye,
  X,
  Bot,
  UserCheck,
  Ban,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Badge } from "./components/ui/badge";
import { cn } from "./lib/utils";
import { countCommentFlow } from "./comment-flow";
import { fetchPatches, submitReview } from "./api";
import type { ApiConfig } from "./api";
import type {
  AgentDraftComment,
  AgentDraftCommentDecision,
  ReviewComment,
  ReviewSubmission,
} from "./types";

export interface ReviewDeckProps {
  sessionId: string;
  reviewToken: string;
  serverUrl: string;
  diffStyle?: "unified" | "split";
  readOnly?: boolean;
  onSubmit?: (submission: ReviewSubmission) => void;
}

const DIFF_STYLE_STORAGE_KEY = "reviewdeck:review:diff-style";

interface SubPatch {
  index: number;
  description: string;
  diff: string;
  draftComments: AgentDraftComment[];
}

type ManualComment = ReviewComment & { source: "human" };

type AnnotationMeta =
  | { kind: "comment"; comment: ManualComment; commentIndex: number }
  | { kind: "draft"; draft: AgentDraftCommentDecision }
  | { kind: "pending" };

function InlineCommentForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");

  return (
    <div className="rd:bg-card/80 rd:p-3 rd:backdrop-blur-sm">
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Leave a comment..."
        className="rd:resize-y rd:text-[13px]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (text.trim()) onSubmit(text.trim());
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="rd:mt-2 rd:flex rd:items-center rd:justify-between">
        <span className="rd:text-[11px] rd:text-muted-foreground">
          <kbd className="rd:rounded rd:border rd:border-border rd:px-1 rd:py-0.5 rd:font-[family-name:var(--font-mono)] rd:text-[10px]">
            ⌘↵
          </kbd>{" "}
          to submit
        </span>
        <div className="rd:flex rd:gap-2">
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
    <div className="annotation-card annotation-card-human rd:group/comment rd:flex rd:items-start rd:gap-2.5 rd:rounded-md rd:px-3.5 rd:py-3 rd:text-[13px] rd:leading-relaxed rd:shadow-[0_1px_2px_oklch(0/0/0/0.15)]">
      <MessageSquare className="annotation-meta rd:mt-0.5 rd:size-3 rd:shrink-0" />
      <span className="annotation-body rd:flex-1 rd:whitespace-pre-wrap rd:leading-6">
        {comment.body}
      </span>
      <button
        onClick={onDelete}
        className="annotation-meta rd:mt-0.5 rd:shrink-0 rd:rounded rd:p-1 hover:rd:bg-white/8 hover:rd:text-white"
        title="Delete comment"
      >
        <X className="rd:size-3" />
      </button>
    </div>
  );
}

function DraftCommentBubble({
  draft,
  onSetStatus,
  readOnly,
}: {
  draft: AgentDraftCommentDecision;
  onSetStatus: (status: AgentDraftCommentDecision["status"]) => void;
  readOnly?: boolean;
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
        "annotation-card rd:flex rd:flex-col rd:gap-2.5 rd:rounded-md rd:px-3.5 rd:py-3 rd:text-[13px] rd:leading-relaxed rd:shadow-[0_1px_2px_oklch(0/0/0/0.15)]",
        toneClass,
      )}
    >
      <div className="annotation-meta rd:flex rd:items-center rd:gap-2 rd:text-[11px] rd:uppercase rd:tracking-wide">
        <Bot className="rd:size-3 rd:shrink-0" />
        <span>Agent draft</span>
        <Badge variant="outline" size="sm">
          {statusLabel}
        </Badge>
      </div>
      <div className="annotation-body rd:whitespace-pre-wrap rd:text-[13px] rd:leading-6">
        {draft.body}
      </div>
      {!readOnly && (
        <div className="rd:flex rd:gap-2">
          <Button
            size="sm"
            variant="outline"
            className="annotation-button-accept rd:gap-1.5"
            onClick={() => onSetStatus("accepted")}
          >
            <UserCheck className="rd:size-3" />
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="annotation-button-reject rd:gap-1.5"
            onClick={() => onSetStatus("rejected")}
          >
            <Ban className="rd:size-3" />
            Reject
          </Button>
        </div>
      )}
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
        <div className="comment-progress-track rd:overflow-hidden rd:rounded-full">
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
        <div className="comment-progress-track rd:overflow-hidden rd:rounded-full">
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
        <div className="rd:mt-2 rd:flex rd:flex-wrap rd:gap-2 rd:text-[11px]">
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
      <div className="rd:flex rd:items-center rd:justify-between rd:gap-3">
        <span className="rd:text-[11px] rd:uppercase rd:tracking-wide rd:text-muted-foreground">
          {title}
        </span>
        <span className="rd:font-[family-name:var(--font-mono)] rd:text-[11px] rd:text-muted-foreground">
          {counts.totalDrafts} drafts
        </span>
      </div>
      <div className="comment-progress-track rd:mt-2 rd:overflow-hidden rd:rounded-full">
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
      <div className="rd:mt-2 rd:flex rd:flex-wrap rd:gap-2 rd:text-[11px]">
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
  viewed,
  readOnly,
  onAddComment,
  onDeleteComment,
  onSetDraftStatus,
  onToggleViewed,
}: {
  fileDiff: FileDiffMetadata;
  comments: ManualComment[];
  draftComments: AgentDraftCommentDecision[];
  diffStyle: "unified" | "split";
  viewed: boolean;
  readOnly?: boolean;
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
      diffIndicators: "classic" as const,
      lineDiffType: "word" as const,
      expandUnchanged: true,
      enableGutterUtility: !readOnly,
      enableLineSelection: true,
      lineHoverHighlight: "both" as const,
      disableFileHeader: true,
      collapsed: viewed,
      onGutterUtilityClick: readOnly
        ? undefined
        : (range: { start: number; side?: string }) => {
            setPendingLine({
              line: range.start,
              side: (range.side as "additions" | "deletions") ?? "additions",
            });
          },
    }),
    [diffStyle, viewed, readOnly],
  );

  const renderAnnotation = useCallback(
    (ann: DiffLineAnnotation<AnnotationMeta>) => {
      if (ann.metadata.kind === "pending") {
        if (readOnly) return null;
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
        const { draft } = ann.metadata;
        return (
          <DraftCommentBubble
            draft={draft}
            onSetStatus={(status) => onSetDraftStatus(draft.id, status)}
            readOnly={readOnly}
          />
        );
      }

      if (ann.metadata.kind === "comment") {
        const { comment, commentIndex } = ann.metadata;
        return (
          <CommentBubble
            comment={comment}
            onDelete={() => onDeleteComment(commentIndex)}
          />
        );
      }

      return null;
    },
    [fileDiff.name, onAddComment, onDeleteComment, onSetDraftStatus, readOnly],
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
        "animate-fade-in-up rd:rounded-lg rd:border rd:shadow-[0_1px_3px_oklch(0/0/0/0.2)] rd:transition-colors",
        viewed ? "rd:border-border/30 rd:bg-card/55" : "rd:border-border/60 rd:bg-transparent",
      )}
    >
      <div className="file-toolbar rd:sticky rd:top-0 rd:z-20 rd:flex rd:items-center rd:justify-between rd:gap-3 rd:px-3 rd:py-2.5">
        <div className="rd:min-w-0 rd:flex rd:items-center rd:gap-3">
          <button
            onClick={onToggleViewed}
            className={cn(
              "rd:flex rd:size-[18px] rd:shrink-0 rd:items-center rd:justify-center rd:rounded rd:border-2 rd:transition-colors",
              viewed
                ? "rd:border-primary rd:bg-primary rd:text-primary-foreground"
                : "rd:border-muted-foreground/50 rd:bg-transparent",
            )}
            title={viewed ? "Mark as unviewed" : "Mark as viewed"}
          >
            {viewed && <Check className="rd:size-3" strokeWidth={3} />}
          </button>
          <div className="rd:min-w-0">
            <div className="rd:truncate rd:font-[family-name:var(--font-mono)] rd:text-[12px] rd:font-medium rd:text-foreground">
              {fileDiff.prevName ? `${fileDiff.prevName} -> ${fileDiff.name}` : fileDiff.name}
            </div>
          </div>
        </div>
        <div className="rd:flex rd:shrink-0 rd:items-center rd:gap-2 rd:font-[family-name:var(--font-mono)] rd:text-[11px] rd:text-muted-foreground">
          {diffSummary.deletions > 0 && (
            <span className="file-toolbar-deletions">-{diffSummary.deletions}</span>
          )}
          {diffSummary.additions > 0 && (
            <span className="file-toolbar-additions">+{diffSummary.additions}</span>
          )}
        </div>
      </div>
      <div className="rd:overflow-hidden rd:rounded-b-lg">
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
  viewedFiles,
  readOnly,
  onAddComment,
  onDeleteComment,
  onSetDraftStatus,
  onToggleViewed,
}: {
  patch: SubPatch;
  comments: ManualComment[];
  draftComments: AgentDraftCommentDecision[];
  diffStyle: "unified" | "split";
  viewedFiles: Set<string>;
  readOnly?: boolean;
  onAddComment: (comment: Omit<ManualComment, "sub" | "source">) => void;
  onDeleteComment: (commentIndex: number) => void;
  onSetDraftStatus: (draftId: string, status: AgentDraftCommentDecision["status"]) => void;
  onToggleViewed: (file: string) => void;
}) {
  const fileDiffs = useMemo(() => {
    const parsed = parsePatchFiles(patch.diff);
    return parsed.flatMap((p) => p.files);
  }, [patch.diff]);

  const viewedCount = fileDiffs.filter((fd) => viewedFiles.has(fd.name)).length;
  const draftCounts = useMemo(() => countDraftStatuses(draftComments), [draftComments]);

  return (
    <div className="animate-fade-in-up">
      <div className="rd:mb-5 rd:flex rd:flex-wrap rd:items-start rd:justify-between rd:gap-4">
        <div className="rd:min-w-0">
          <div className="rd:flex rd:items-baseline rd:gap-3">
            <span className="rd:font-[family-name:var(--font-mono)] rd:text-[11px] rd:font-medium rd:tracking-widest rd:text-primary">
              {String(patch.index + 1).padStart(2, "0")}
            </span>
            <h3 className="rd:font-[family-name:var(--font-mono)] rd:text-base rd:font-semibold rd:tracking-tight">
              {patch.description}
            </h3>
          </div>
          {draftCounts.total > 0 && (
            <div className="rd:mt-3 rd:flex rd:flex-wrap rd:items-center rd:gap-2">
              <Badge variant="outline" size="sm">
                <Bot className="rd:mr-1 rd:size-3" />
                {draftCounts.accepted} accepted
              </Badge>
              <Badge variant="outline" size="sm">
                {draftCounts.pending} pending
              </Badge>
              <Badge variant="outline" size="sm">
                {draftCounts.rejected} rejected
              </Badge>
              {!readOnly && draftCounts.pending > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rd:gap-1.5"
                    onClick={() => {
                      draftComments
                        .filter((draft) => draft.status === "pending")
                        .forEach((draft) => onSetDraftStatus(draft.id, "accepted"));
                    }}
                  >
                    <UserCheck className="rd:size-3" />
                    Accept Pending
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rd:gap-1.5"
                    onClick={() => {
                      draftComments
                        .filter((draft) => draft.status === "pending")
                        .forEach((draft) => onSetDraftStatus(draft.id, "rejected"));
                    }}
                  >
                    <Ban className="rd:size-3" />
                    Reject Pending
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        <span className="rd:flex rd:items-center rd:gap-1.5 rd:font-[family-name:var(--font-mono)] rd:text-[11px] rd:text-muted-foreground">
          <Eye className="rd:size-3" />
          {viewedCount}/{fileDiffs.length}
        </span>
      </div>

      <div className="stagger-children rd:space-y-3">
        {fileDiffs.map((fd) => (
          <FileDiffView
            key={fd.name}
            fileDiff={fd}
            comments={comments}
            draftComments={draftComments}
            diffStyle={diffStyle}
            viewed={viewedFiles.has(fd.name)}
            readOnly={readOnly}
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

export function ReviewDeck(props: ReviewDeckProps) {
  const [patches, setPatches] = useState<SubPatch[]>([]);
  const [comments, setComments] = useState<ManualComment[]>([]);
  const [draftComments, setDraftComments] = useState<AgentDraftCommentDecision[]>([]);
  const [activeSub, setActiveSub] = useState(0);
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">(() => {
    if (typeof window === "undefined") return props.diffStyle ?? "split";
    const stored = window.localStorage.getItem(DIFF_STYLE_STORAGE_KEY);
    return stored === "unified" || stored === "split" ? stored : (props.diffStyle ?? "split");
  });
  const [submitted, setSubmitted] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [viewedFiles, setViewedFiles] = useState<Map<number, Set<string>>>(new Map());
  const prevAllViewedRef = useRef(false);

  const apiConfig: ApiConfig = useMemo(
    () => ({
      sessionId: props.sessionId,
      reviewToken: props.reviewToken,
      serverUrl: props.serverUrl,
    }),
    [props.sessionId, props.reviewToken, props.serverUrl],
  );

  useEffect(() => {
    fetchPatches(apiConfig).then((loadedPatches) => {
      setPatches(loadedPatches);
      setDraftComments(
        loadedPatches.flatMap((patch) =>
          patch.draftComments.map((draft) => ({
            ...draft,
            status: "pending" as const,
          })),
        ),
      );
    });
  }, [apiConfig]);

  useEffect(() => {
    window.localStorage.setItem(DIFF_STYLE_STORAGE_KEY, diffStyle);
  }, [diffStyle]);

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
    await submitReview(apiConfig, submission);
    setSubmittedCount(submission.comments.length);
    setSubmitted(true);
    props.onSubmit?.(submission);
  }, [apiConfig, submission, props.onSubmit]);

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
      <div className="rd:flex rd:h-screen rd:flex-col rd:items-center rd:justify-center rd:gap-4">
        <div className="animate-fade-in-up rd:flex rd:size-14 rd:items-center rd:justify-center rd:rounded-full rd:bg-success/15 rd:shadow-[0_0_20px_oklch(0.65_0.17_155/0.15)]">
          <Check className="rd:size-6 rd:text-success" strokeWidth={2.5} />
        </div>
        <div className="animate-fade-in-up rd:text-center" style={{ animationDelay: "80ms" }}>
          <p className="rd:font-[family-name:var(--font-mono)] rd:text-lg rd:font-semibold rd:tracking-tight">
            Review submitted
          </p>
          <p className="rd:mt-1 rd:text-sm rd:text-muted-foreground">
            {submittedCount} final comment{submittedCount !== 1 ? "s" : ""} sent. You can close this
            tab.
          </p>
        </div>
      </div>
    );
  }

  if (patches.length === 0) {
    return (
      <div className="rd:flex rd:h-screen rd:flex-col rd:items-center rd:justify-center rd:gap-3">
        <div className="animate-pulse-dot rd:size-2 rd:rounded-full rd:bg-primary" />
        <span className="rd:font-[family-name:var(--font-mono)] rd:text-xs rd:tracking-widest rd:text-muted-foreground">
          LOADING
        </span>
      </div>
    );
  }

  return (
    <div className="rd:flex rd:h-screen">
      <nav className="rd:flex rd:w-72 rd:shrink-0 rd:flex-col rd:border-r rd:border-border rd:bg-card/40">
        <div className="rd:flex rd:items-center rd:justify-between rd:px-4 rd:pb-3 rd:pt-5">
          <div>
            <h1 className="rd:font-[family-name:var(--font-mono)] rd:text-[11px] rd:font-medium rd:tracking-[0.2em] rd:text-muted-foreground">
              REVIEW
            </h1>
            <p className="rd:mt-0.5 rd:font-[family-name:var(--font-mono)] rd:text-xs rd:text-muted-foreground/50">
              {patches.length} patches
            </p>
          </div>
          <div className="rd:inline-flex rd:rounded-md rd:border rd:border-border rd:bg-background/70 rd:p-1 rd:shadow-[0_1px_2px_oklch(0/0/0/0.12)]">
            <button
              onClick={() => setDiffStyle("split")}
              className={cn(
                "rd:flex rd:items-center rd:gap-1.5 rd:rounded rd:px-2.5 rd:py-1.5 rd:font-[family-name:var(--font-mono)] rd:text-[10px] rd:uppercase rd:tracking-wider rd:transition-colors",
                diffStyle === "split"
                  ? "rd:bg-primary rd:text-primary-foreground"
                  : "rd:text-muted-foreground hover:rd:bg-surface hover:rd:text-foreground",
              )}
              title="Use split diff view"
            >
              <Columns2 className="rd:size-3" />
              Split
            </button>
            <button
              onClick={() => setDiffStyle("unified")}
              className={cn(
                "rd:flex rd:items-center rd:gap-1.5 rd:rounded rd:px-2.5 rd:py-1.5 rd:font-[family-name:var(--font-mono)] rd:text-[10px] rd:uppercase rd:tracking-wider rd:transition-colors",
                diffStyle === "unified"
                  ? "rd:bg-primary rd:text-primary-foreground"
                  : "rd:text-muted-foreground hover:rd:bg-surface hover:rd:text-foreground",
              )}
              title="Use unified diff view"
            >
              <Rows3 className="rd:size-3" />
              Unified
            </button>
          </div>
        </div>

        {globalCommentCounts.totalDrafts > 0 && (
          <div className="rd:px-3 rd:pb-3">
            <div className="rd:rounded-md rd:border rd:border-border/70 rd:bg-background/60 rd:p-3">
              <CommentStatusCard title="Whole review" counts={globalCommentCounts} minimal />
            </div>
          </div>
        )}

        <div className="rail-track stagger-children rd:flex-1 rd:overflow-y-auto rd:px-2 rd:py-2">
          {patches.map((patch) => {
            const subComments = comments.filter((comment) => comment.sub === patch.index);
            const subDraftComments = draftComments.filter((draft) => draft.sub === patch.index);
            const draftCounts = countDraftStatuses(subDraftComments);
            const commentCounts = countCommentFlow(subComments, subDraftComments);
            const isActive = activeSub === patch.index;
            const stepDone = isStepViewed(patch.index);

            return (
              <button
                key={patch.index}
                onClick={() => setActiveSub(patch.index)}
                className={cn(
                  "animate-fade-in-up rd:group rd:relative rd:flex rd:w-full rd:items-start rd:gap-3 rd:rounded-md rd:px-2 rd:py-2.5 rd:text-left rd:transition-all rd:duration-150",
                  isActive ? "rd:bg-surface" : "hover:rd:bg-surface/50",
                )}
              >
                <div className="rd:relative rd:z-10 rd:mt-0.5 rd:flex rd:size-5 rd:shrink-0 rd:items-center rd:justify-center">
                  {stepDone ? (
                    <span className="rd:flex rd:size-5 rd:items-center rd:justify-center rd:rounded-full rd:bg-success/20 rd:text-success">
                      <Check className="rd:size-3" strokeWidth={2.5} />
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "rd:flex rd:size-5 rd:items-center rd:justify-center rd:rounded-full rd:font-[family-name:var(--font-mono)] rd:text-[10px] rd:font-semibold rd:transition-all rd:duration-150",
                        isActive
                          ? "rd:bg-primary rd:text-primary-foreground rd:shadow-[0_0_8px_oklch(0.78_0.145_75/0.3)]"
                          : "rd:border rd:border-border rd:bg-card rd:text-muted-foreground rd:group-hover:rd:border-foreground/20 rd:group-hover:rd:text-foreground/70",
                      )}
                    >
                      {patch.index + 1}
                    </span>
                  )}
                </div>

                <div className="rd:min-w-0 rd:flex-1 rd:pt-px">
                  <span
                    className={cn(
                      "rd:block rd:truncate rd:text-[13px] rd:leading-snug rd:transition-colors",
                      stepDone
                        ? "rd:text-muted-foreground rd:line-through rd:decoration-muted-foreground/30"
                        : isActive
                          ? "rd:font-medium rd:text-foreground"
                          : "rd:text-muted-foreground rd:group-hover:rd:text-foreground/80",
                    )}
                  >
                    {patch.description}
                  </span>
                  {(subComments.length > 0 || subDraftComments.length > 0) && (
                    <span className="rd:mt-1 rd:inline-flex rd:flex-wrap rd:items-center rd:gap-2 rd:text-[11px] rd:text-muted-foreground/60">
                      {commentCounts.final > 0 && (
                        <span className="rd:inline-flex rd:items-center rd:gap-1">
                          <MessageSquare className="rd:size-2.5" />
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
                    <div className="rd:mt-3 rd:rounded-md rd:border rd:border-border/60 rd:bg-background/55 rd:p-2.5">
                      <CommentStatusCard title="This patch" counts={activeCommentCounts} compact />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {!props.readOnly && (
          <div className="rd:border-t rd:border-border rd:p-3">
            <Button variant="default" className="rd:w-full rd:gap-2" onClick={handleSubmit}>
              <ArrowUp className="rd:size-3.5" />
              <span className="rd:font-[family-name:var(--font-mono)] rd:text-xs rd:tracking-wide">
                Submit
              </span>
              <Badge variant="default" size="sm">
                {submission.comments.length}
              </Badge>
            </Button>
            <p className="rd:mt-2 rd:text-[11px] rd:text-muted-foreground">
              Submit sends accepted agent drafts plus your own comments. Rejected drafts stay out.
            </p>
          </div>
        )}
      </nav>

      <main className="rd:flex-1 rd:overflow-y-auto">
        <div className="rd:p-6">
          {patches[activeSub] && (
            <SubPatchView
              key={activeSub}
              patch={patches[activeSub]}
              comments={activeCommentsRaw}
              draftComments={activeDraftComments}
              diffStyle={diffStyle}
              viewedFiles={activeViewedSet}
              readOnly={props.readOnly}
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
