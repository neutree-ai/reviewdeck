import type { AgentDraftCommentDecision } from "./types";

export interface CommentFlowCounts {
  totalDrafts: number;
  final: number;
  human: number;
  included: number;
  pending: number;
  omitted: number;
}

export function countCommentFlow(
  manualComments: ArrayLike<unknown>,
  draftComments: AgentDraftCommentDecision[],
): CommentFlowCounts {
  const counts = draftComments.reduce(
    (acc, draft) => {
      if (draft.status === "accepted") {
        acc.included += 1;
      } else if (draft.status === "rejected") {
        acc.omitted += 1;
      } else {
        acc.pending += 1;
      }
      return acc;
    },
    {
      totalDrafts: draftComments.length,
      final: manualComments.length,
      human: manualComments.length,
      included: 0,
      pending: 0,
      omitted: 0,
    },
  );

  counts.final += counts.included;
  return counts;
}
