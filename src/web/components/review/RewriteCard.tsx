import React from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpenText, Code2, MessageSquarePlus } from "lucide-react";
import type { ResolvedRewriteBlock } from "../../../core/types";

/** Tables wider than the card scroll on their own instead of being clipped. */
const markdownComponents: Components = {
  table: ({ node: _, ...props }) => (
    <div className="rw-table">
      <table {...props} />
    </div>
  ),
};

/**
 * A rewrite in place of the code lines it re-expresses. Only the switch shows
 * the code; comments on those lines are listed under the rewrite.
 */
export function RewriteCard({
  block,
  lines,
  onShowCode,
  onComment,
  children,
}: {
  block: ResolvedRewriteBlock;
  /** Change lines the card stands in for. */
  lines: number;
  onShowCode: () => void;
  onComment: () => void;
  /** Comments on the covered lines, and a comment form. */
  children?: React.ReactNode;
}) {
  return (
    <div className="rw-card">
      <div className="rw-body">
        <div className="rw-meta">
          <span className="rw-lines" title={`Stands in for ${lines} changed lines`}>
            {lines} lines
          </span>
          <button className="rw-comment" onClick={onComment} title="Comment on this rewrite">
            <MessageSquarePlus className="size-3.5" />
          </button>
          <button className="rw-switch" onClick={onShowCode} title="Show the code">
            <Code2 className="size-3" />
            code
          </button>
        </div>
        <div className="rw-text">
          {block.title && <strong className="rw-title">{block.title}</strong>}
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {block.rewrite}
          </Markdown>
        </div>
        {React.Children.toArray(children).length > 0 && <div className="rw-notes">{children}</div>}
      </div>
    </div>
  );
}

/** Heads the code of a rewrite the reviewer expanded; switches back to the rewrite. */
export function RewriteBar({
  block,
  onShowRewrite,
}: {
  block: ResolvedRewriteBlock;
  onShowRewrite: () => void;
}) {
  return (
    <div className="rw-bar">
      <span className="rw-bar-label">
        {(block.title ?? block.rewrite.split("\n")[0]!).replace(/[`*]/g, "")}
      </span>
      <button className="rw-switch" onClick={onShowRewrite} title="Show the rewrite">
        <BookOpenText className="size-3" />
        rewrite
      </button>
    </div>
  );
}
