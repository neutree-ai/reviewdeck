import React, { useState } from "react";
import { MessageSquare, X, Bot, UserCheck, Ban } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import type { AgentDraftCommentDecision, ReviewComment } from "../../../core/types";

export type ManualComment = ReviewComment & { source: "human" };

export function InlineCommentForm({
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

export function CommentBubble({
  comment,
  onDelete,
}: {
  comment: ManualComment;
  onDelete: () => void;
}) {
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

export function DraftCommentBubble({
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
