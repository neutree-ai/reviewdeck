---
name: reviewdeck
description: Split a large PR diff into a sequence of smaller, reviewable sub-patches. Use when the user wants to break up a big PR for easier code review, or mentions review decks, patch splitting, or review chunking.
compatibility: Requires Node.js 18+ and npx (or the reviewdeck CLI installed globally).
metadata:
  author: yanzhen
  version: "0.2"
---

# Reviewdeck

You help a code reviewer turn a large PR diff into a small review deck, then hand it off for human review.

Default posture:

- If the user wants PR review help, do not stop after `split`. Continue into `render` unless the user explicitly says they only want split output.
- Do not substitute your own autonomous review for the human review step unless the user explicitly asks you to review the code yourself.
- When invoking the CLI via `npx`, use `npx reviewdeck@latest ...` so the workflow tracks the latest published CLI version.

## Main Path

### 1. Get the diff

Use the cheapest path that already matches the user's situation:

- If the user already provided a `.diff`, use it directly.
- If the user is reviewing a GitHub PR, run:

```bash
gh pr diff 123 > pr.diff
```

- If the user is in a local git repo and wants the current branch vs `main`, run:

```bash
git diff main...HEAD > pr.diff
```

Other common fallbacks:

```bash
# Specific PR in another repo
gh pr diff 123 --repo owner/repo > pr.diff

# Between two commits
git diff <commit-a> <commit-b> > pr.diff

# Staged changes
git diff --cached > pr.diff
```

### 2. Index changes

```bash
npx reviewdeck@latest index pr.diff
```

This prints a numbered list of changed lines. Those indices are the units you group in the split metadata.

### 3. Generate split metadata

Output a single JSON object:

```json
{
  "groups": [
    {
      "description": "Add version selection plumbing so later upgrade flows have a stable input",
      "changes": ["0-2", 5, 6]
    }
  ]
}
```

Default rules:

- Every change index must appear exactly once.
- Aim for 3-6 groups unless the PR is unusually small or large.
- Order groups for review: peripheral first, core logic later, tests last.
- `description` should help a reviewer navigate the sequence, not just restate filenames or labels.
- `draftComments` is optional. Add it only for concrete reviewer-worthy concerns you can already support from the diff.
- Each draft comment must anchor to a `change` that belongs to the same group.

If you need heavier guidance for grouping, description writing, or draft comment quality, then read [references/split.md](references/split.md).

### 4. Split and verify

```bash
echo '<meta JSON>' | npx reviewdeck@latest split pr.diff -
```

Or write files:

```bash
echo '<meta JSON>' | npx reviewdeck@latest split pr.diff - -o output/
```

This validates the metadata, generates sub-patches, and verifies that they compose back to the original diff.

If `split` fails, read the error, fix the metadata JSON, and retry.

### 5. Hand off to human review

After `split` succeeds, the default next step is live review:

```bash
npx reviewdeck@latest render output/
```

Or from stdin:

```bash
echo '<meta JSON>' | npx reviewdeck@latest split pr.diff - | npx reviewdeck@latest render -
```

The server opens a browser, blocks until submission, and prints a review submission JSON object to stdout.

Default behavior:

- Prefer to actually launch `render` and wait for submission when the user wants PR review help.
- Do not stop at “split succeeded” if a live local review session is possible.
- Treat `comments` as the final human-approved payload.
- Treat `draftComments` as provenance for which agent drafts were accepted, rejected, or left pending.

### 6. Submit comments back to source

After `render` completes:

- Summarize accepted/rejected/pending draft comment outcomes.
- If there are final `comments`, ask whether the user wants them submitted back to the source review system.
- If the target is already explicit in context, such as a specific PR or review thread, continue there instead of asking again.
- When submitting, use `comments`, not raw `draftComments`.
- If there are no final `comments`, say so clearly and stop.
- Ask first when the target review system or PR/thread is not explicit.
