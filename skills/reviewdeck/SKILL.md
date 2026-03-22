---
name: reviewdeck
description: Split a large PR diff into a sequence of smaller, reviewable sub-patches. Use when the user wants to break up a big PR for easier code review, or mentions review decks, patch splitting, or review chunking.
compatibility: Requires Node.js 18+ and npx (or the reviewdeck CLI installed globally).
metadata:
  author: yanzhen
  version: "0.1"
---

# Reviewdeck

You help a code reviewer split a large PR diff into a sequence of smaller, logically coherent sub-patches, then prepare the PR for human review.

If the user wants to review a PR, do not stop after `split`. Continue into `render` unless the user explicitly says they only want the split output.
But do not substitute your own code review for the human review step unless the user explicitly asks you to review the code yourself.

When invoking the CLI via `npx`, use `npx reviewdeck@latest ...` so the workflow tracks the latest published CLI version.

## Workflow

### Step 1: Get the diff

Ask the user for the diff, or generate it. See [get-diff reference](references/get-diff.md) for different methods.

### Step 2: Index changes

```bash
npx reviewdeck@latest index pr.diff
```

This outputs to stdout a numbered list of every changed line in the diff.

### Step 3: Generate split metadata

Read the index output, then read the [prompt template](assets/prompt-template.md) and follow its instructions to produce a JSON split plan.

When writing each group's `description`, optimize for reviewer guidance, not literal restatement.
The description should help someone understand why this group exists and why it appears at this point in the sequence.

If you notice concrete review issues while splitting, attach them as `draftComments` on the matching group.
Each draft comment must point to a `change` index that belongs to that same group.
These are candidate co-review comments for the human reviewer to accept or reject later in `render`, not your final autonomous review output.

### Step 4: Split and verify

Pipe the JSON directly via stdin:

```bash
echo '<meta JSON>' | npx reviewdeck@latest split pr.diff -
```

This validates the metadata, generates sub-patches, verifies that applying them sequentially reproduces the original diff, and outputs the sub-patches to stdout separated by `===SUB_PATCH===`.
If your metadata included `draftComments`, they are preserved for `render`.

To write sub-patches to files instead:

```bash
echo '<meta JSON>' | npx reviewdeck@latest split pr.diff - -o output/
```

If the command fails, read the error message, fix the metadata JSON, and retry.

### Step 5: Start human review

After `split` succeeds, the normal next step for PR review is `render`.
Use it to open a human review UI for the generated sub-patches and collect comments.
Default to the live render session. Only switch to `--html` when the user explicitly wants a static artifact, a file to share, or the environment clearly cannot support a live local review session.

Launch a local diff review UI:

```bash
# From a directory of .diff files
npx reviewdeck@latest render output/

# From stdin
echo '<meta JSON>' | npx reviewdeck@latest split pr.diff - | npx reviewdeck@latest render -
```

The server opens a browser, blocks until submission, and prints a review submission JSON object to stdout.
That object contains:

- `comments`: the final comments to submit back to the source review
- `draftComments`: the agent draft comments with `accepted` / `rejected` / `pending` status

Treat `comments` as the final human-approved payload.
Treat `draftComments` as provenance that tells you which of your draft findings survived review.

If the user wants a file instead of a live browser session, generate self-contained HTML:

```bash
echo '<meta JSON>' | npx reviewdeck@latest split pr.diff - | npx reviewdeck@latest render - --html > review.html
```

Treat the live `render` session as the default human review handoff.
Prefer to actually launch it, wait for submission, and then continue the task with the returned submission JSON.

When you finish this step without waiting for a live session, prefer an output like:

- the split completed successfully
- where the review UI or HTML artifact is
- what the user should open next

Do not immediately switch into autonomous bug-finding or produce review findings unless the user explicitly asks for your own review.

After `render` completes and you have the submission JSON:

- summarize the accepted/rejected/pending draft comment outcome clearly
- if there are final `comments`, ask whether the user wants them submitted back to the source review system
- if the user has already made the target explicit in context, such as a specific PR or review thread, go ahead and submit there instead of asking again
- when you do submit, use `comments`, not the raw `draftComments`

If you are still before `render` submission and the user asked for PR review help, do not stop at “artifact generated” when a live local review session is possible.

## Tips

- Aim for 3-6 sub-patches per PR
- Order: peripheral/config first, core logic next, tests last
- Each sub-patch should be independently understandable
- Group descriptions should help the reviewer navigate the stack, not just repeat the touched area
- Use range syntax in changes (for example `"0-23"`) to keep the JSON compact
- Draft comments are optional and should be concrete enough that a human can accept or reject them inline
