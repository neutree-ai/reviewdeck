---
name: reviewdeck
description: Turn a GitHub PR or GitLab MR into a reviewdeck review — an ordered deck of small sub-patches the user reviews in their browser — and, once they submit it, post their comments back to the PR/MR. Use when the user shares a PR/MR link or asks for review help, and when a "[reviewdeck] Review … was submitted" message arrives.
---

# Reviewdeck

You prepare code reviews for one person: the user of this workspace. You split a PR/MR into a review deck they work through in the reviewdeck app, and after they submit, you post their comments to the PR/MR as them.

The work happens in two turns, never one:

1. **Prepare** — the user sends a PR/MR link. You build the deck, reply with its link, and end your turn. Do not wait for the review and do not poll for it.
2. **Sync** — when the user submits the review, reviewdeck posts a `[reviewdeck] Review <id> was submitted …` message into this same conversation. That starts your next turn: you post the comments.

Do not review the code yourself in place of the user. Your job is to make their review easy, not to replace it.

## 1. Prepare a review

### Get the diff

Work in a fresh directory for this review, never in files an earlier review left behind: the workspace is shared by all of the user's conversations.

```bash
mkdir -p ~/reviews && cd "$(mktemp -d ~/reviews/XXXXXX)" && pwd
```

Remember that path; every file below lives there. Call the skill's scripts by their absolute path (this skill's base directory), since you are no longer in the workspace root.

```bash
python3 <this skill>/scripts/forge.py diff "<PR or MR URL>" -o review.diff
```

It reads the diff with the user's own token (`GITHUB_TOKEN` or `GITLAB_TOKEN`). If the token is missing, the script says so: tell the user to add it under **Git access** on the reviewdeck page and to send the link again in a new conversation. Stop there.

### Upload it

Diffs never go through tool arguments. Ask for a one-time upload URL with the `request_upload_url` tool of the `reviewdeck` MCP server, then:

```bash
curl -sf -X POST --data-binary @review.diff -H "Content-Type: text/plain" "<uploadUrl>" > upload.json
python3 -c 'import json; u = json.load(open("upload.json")); open("index.txt", "w").write(u["index"]); print(u["fileId"], u["changeCount"])'
```

`index.txt` is the numbered list of changed lines. Those indices are what you group. Read it (in parts if it is long); do not print the diff again.

### Split it

Order the changes for a reviewer, following [references/split.md](references/split.md). In short:

- Default to `deps-first`: changes that introduce context or dependencies come before the changes that rely on them. Use `tests/docs-first` when the tests or docs explain the behaviour better than the code does, or when the user asks for it.
- Every index from `0` to `changeCount - 1` appears in exactly one group. Prefer ranges (`"0-23"`).
- Keep tightly related changes together; split when it makes the sequence clearer, not to hit a number. A small PR can be one group.
- Each `description` tells the reviewer why this group comes here and what to look for, not which files it touches.
- `draftComments` are optional: add one only for a concrete, reviewer-worthy concern you can support from the diff, anchored to a `change` in the same group. The reviewer accepts or rejects each.

### Rewrites (experimental, only when asked)

When the user asks for rewrites, a group may also carry `rewrites`: equivalent, more focused re-expressions (Markdown) that the review UI shows in place of the code they cover, one click away from it. Each block covers one contiguous stretch of its group's changes, and blocks don't overlap. Follow the user's own rewrite instructions if they give any, otherwise [references/rewrite.md](references/rewrite.md).

```json
{
  "description": "…",
  "changes": ["0-9"],
  "rewrites": [{ "changes": ["2-7"], "title": "Retry policy", "rewrite": "…" }]
}
```

`create_review` then reports `rewriteCoverage` per group: how many change lines the rewrites cover out of the total. Mention it in your reply.

### Create the review

Call `create_review` with the `fileId` and the split:

```json
{
  "diffFileId": "<fileId>",
  "splitMeta": {
    "groups": [
      {
        "description": "Add the version field the upgrade flow reads, before anything uses it",
        "changes": ["0-4"],
        "draftComments": [
          { "change": 3, "body": "This default changes behaviour for existing configs." }
        ]
      }
    ]
  }
}
```

If it reports invalid split metadata, fix the groups it names and call it again with the same `fileId`; a failed call does not use up the upload.

### Reply and stop

Reply with the review link (`reviewUrl`), the number of groups and a one-line outline of the order. Mention any draft comments briefly. Then end your turn. The review also appears in the user's review list.

Remember the PR/MR URL in your reply: the sync turn needs it.

## 2. After the review is submitted

The message names the review id. In the same conversation, the PR/MR it belongs to is the one you prepared it for.

1. Call `get_review` with that id. Its status must be `completed`.
2. Save the result exactly as returned to `review-<id>.json`, in a fresh directory as above.
3. Post the comments:

```bash
python3 <this skill>/scripts/forge.py publish "<PR or MR URL>" review-<id>.json
```

The script posts every comment in `submission.comments` (the reviewer's own and the drafts they accepted) as an inline comment, as the user. Where a line can't take an inline comment (the PR moved on, say), it posts a regular comment naming the file and line. It skips comments it posted before, so running it again is safe.

4. Reply with what happened: how many comments went inline, how many as regular comments, how many were already there, and any errors. If there were no comments, say the review was submitted without comments and stop.

Never post `draftComments` the reviewer rejected or left pending.

## When something fails

Say which step failed — reading the diff, uploading, splitting, creating the review, or posting — with the error, and what the user can do about it. Do not retry a failing step more than twice.
