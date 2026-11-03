# reviewdeck

Split large PR diffs into reviewable sub-patches via LLM-assigned groups.

## Status

`reviewdeck` is the product name for this first public release.

## Install CLI

Run it ad hoc:

```bash
npx reviewdeck@^0.6.0 index pr.diff
```

Or install it into another repo:

```bash
npm install -D reviewdeck
```

## Install Skill

The repo exposes a standard skill at `skills/reviewdeck`, so external users can install it with `npx skills add`:

```bash
npx skills add neutree-ai/reviewdeck --skill reviewdeck
```

Useful variants:

```bash
# list skills in the repo first
npx skills add neutree-ai/reviewdeck --list

# install globally instead of into the current project
npx skills add neutree-ai/reviewdeck --skill reviewdeck --global
```

## Review A PR

```bash
gh pr diff 123 > pr.diff
npx reviewdeck@^0.6.0 index pr.diff > pr.index.txt
```

Have the agent use the `reviewdeck` skill to turn the indexed changes into split metadata JSON, then:

```bash
cat split.json | npx reviewdeck@^0.6.0 split pr.diff - -o output/
npx reviewdeck@^0.6.0 render output/
```

If the goal is PR review, `render` is the normal next step after `split`; `split` only proves the sub-patches are valid and ordered.
`render` is meant to produce a human review UI or artifact, not to replace the human review with automatic findings.
When generating split metadata, the skill can follow lightweight review patterns such as `deps-first` or `tests/docs-first`; if the user has no clear preference, `deps-first` is the default.
The split metadata descriptions are most useful when they explain why the changes are grouped together or what the reviewer should verify in that step.
The split metadata can also include optional group-level `draftComments`, which render shows inline as agent co-review drafts for the human reviewer to accept or reject.
When `render` submits, it prints a JSON object with final `comments` plus `draftComments` status so an agent can tell which drafts were accepted before deciding whether to post them back to a PR.

## Run As A Multi-User App On NAP

`reviewdeck serve` can also be an application on [NAP](https://github.com/neutree-ai/agent-platform): every reviewdeck user gets their own review agent in a NAP workspace, declared once in an App Spec.

- Users sign in at `/app`, paste a PR/MR link, and chat with their agent. It splits the diff, creates the review and replies with the link, then ends its turn.
- When the user submits the review, reviewdeck posts a message into that conversation, and the agent posts the comments back to the PR/MR with the user's own git token.
- The agent calls `/mcp` through NAP's MCP proxy. NAP signs each call with the user it comes from (`X-Platform-Caller`), so workspaces hold no reviewdeck credential. OAuth MCP clients keep working as before.

The agent's spec, prompt and skill live in [`nap/`](nap/). To deploy:

1. An NAP admin registers the application (client id `reviewdeck`) and shares a model provider with its team.
2. Set `RD_NAP_URL`, `RD_NAP_CLIENT_ID`, `RD_NAP_CLIENT_SECRET` (plus `RD_NAP_PROVIDER`, `RD_NAP_MODEL`, `BASE_URL` for deploying) where the server runs.
3. `node nap/deploy.ts` shows the plan; `node nap/deploy.ts --apply` publishes the prompt and skill and applies the spec.

## Develop

```bash
vp install
vp test            # run tests
vp check           # format + lint + type check
npm run lint       # full quality pipeline
npm run pack:dry-run
```
