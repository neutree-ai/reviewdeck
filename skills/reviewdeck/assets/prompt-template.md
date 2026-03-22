# Task: Split a PR diff into reviewable sub-patches

You are helping a code reviewer. Given a large PR diff, split it into a sequence of smaller, logically coherent sub-patches that are easier to review.

## Principles

- **Peripheral first, core last**: infrastructure, config, types -> implementation -> tests
- **Independent first, dependent last**: if B depends on A, A comes first
- **One concern per group**: don't mix refactoring with new features
- **Reviewer-oriented descriptions**: describe why this group exists in the review flow, not just the surface area it touches
- **Co-review drafts when warranted**: if you notice a concrete review concern while splitting, attach it as a draft comment instead of switching into a full review report

## Input

The indexed change lines are provided separately. Each `[N]` is a **change index**. `-` = deletion, `+` = addition, `LN` = line number.

## Output format

Output a single JSON object (no markdown fences, no commentary before or after):

```json
{
  "groups": [
    {
      "description": "Add version selector plumbing so later upgrade flows have a stable input",
      "changes": ["0-2", 5, 6],
      "draftComments": [
        {
          "change": 6,
          "body": "Check whether the new selector can drift out of sync when no compatible versions exist."
        }
      ]
    },
    {
      "description": "Cover the upgrade path with e2e checks after the UI flow is in place",
      "changes": ["3-4", "7-9"]
    }
  ]
}
```

## Rules

1. Every change index must appear in exactly one group
2. No index may appear in more than one group
3. No index may be omitted
4. Groups are ordered — group 1 is applied first, group N last
5. Aim for 3-6 groups (adjust based on the PR's complexity)
6. Each group's `description` should read like a review-guiding commit message — a concise summary line, optionally followed by detail
7. Use range syntax for consecutive indices: `"0-2"` means `[0, 1, 2]`. Single indices can be plain numbers: `5`
8. `draftComments` is optional, but when you see a concrete reviewer-worthy concern while splitting, include it.
9. Each draft comment must anchor to a `change` that belongs to the same group.

## Description guidance

Good descriptions help a reviewer understand why this group should be reviewed as one unit and how it fits into the sequence.

Prefer descriptions that:

- explain the intent or review value of the group
- mention the dependency or sequencing reason when useful
- tell the reviewer what they can learn or verify in this step

Avoid descriptions that are only:

- a raw area label like `form version selector`
- an as-is restatement of filenames, component names, or ticket labels
- too vague to distinguish this group from adjacent ones

Better:

- `Add version selection plumbing so the upgrade flow has a stable entry point`
- `Show current version and status before wiring upgrade actions`
- `Isolate the upgrade dialog and action handling as the main behavior change`
- `Add e2e coverage once the upgrade flow is in place`

Worse:

- `version selector`
- `status display`
- `upgrade dialog`
- `e2e`

## Draft comment guidance

Use `draftComments` selectively but decisively. They are not the final submitted comments. They are candidate review comments that the human reviewer can accept or reject during `render`.

Prefer draft comments that:

- point to a specific risk, regression, or questionable assumption
- are anchored to one concrete indexed change
- read like something worth sending to the source review if accepted

If you already have enough evidence from the diff to state a concrete concern, prefer emitting the draft comment now rather than omitting it.

Avoid draft comments that are only:

- a summary of what the code does
- generic praise or noise
- a full review section pasted into one comment

Better:

- `Potential regression: this update path bypasses the sanitizing transform used by the normal edit flow.`
- `This selector keeps the old version when no compatible options exist, so the form may submit an unavailable version.`

Worse:

- `Adds selector logic`
- `Looks risky`
- `Need review`
