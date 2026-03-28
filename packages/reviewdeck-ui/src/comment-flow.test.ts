import { describe, expect, it } from "vitest";
import { countCommentFlow } from "./comment-flow";
import type { AgentDraftCommentDecision } from "./types";

function makeDraft(
  id: string,
  status: AgentDraftCommentDecision["status"],
): AgentDraftCommentDecision {
  return {
    id,
    sub: 0,
    change: 0,
    file: "a.ts",
    line: 1,
    side: "additions",
    body: id,
    source: "agent",
    status,
  };
}

describe("countCommentFlow", () => {
  it("tracks draft triage separately from human comments", () => {
    const counts = countCommentFlow(
      [{ body: "human-1" }, { body: "human-2" }],
      [makeDraft("d1", "accepted"), makeDraft("d2", "pending"), makeDraft("d3", "rejected")],
    );

    expect(counts).toEqual({
      totalDrafts: 3,
      final: 3,
      human: 2,
      included: 1,
      pending: 1,
      omitted: 1,
    });
  });

  it("keeps human-only comments out of draft progress", () => {
    const counts = countCommentFlow([{ body: "human-1" }], []);

    expect(counts).toEqual({
      totalDrafts: 0,
      final: 1,
      human: 1,
      included: 0,
      pending: 0,
      omitted: 0,
    });
  });
});
