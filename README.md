# reviewdeck

Split large PR diffs into reviewable sub-patches via LLM-assigned groups.

## Status

`reviewdeck` is the product name for this first public release.

## Install CLI

Run it ad hoc:

```bash
npx reviewdeck@latest index pr.diff
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
npx reviewdeck@latest index pr.diff > pr.index.txt
```

Have the agent use the `reviewdeck` skill to turn the indexed changes into split metadata JSON, then:

```bash
cat split.json | npx reviewdeck@latest split pr.diff - -o output/
npx reviewdeck@latest render output/
```

If the goal is PR review, `render` is the normal next step after `split`; `split` only proves the sub-patches are valid and ordered.
`render` is meant to produce a human review UI or artifact, not to replace the human review with automatic findings.
The split metadata descriptions should read like reviewer-facing guideposts, not raw area labels.
The split metadata can also include optional group-level `draftComments`, which render shows inline as agent co-review drafts for the human reviewer to accept or reject.
When `render` submits, it prints a JSON object with final `comments` plus `draftComments` status so an agent can tell which drafts were accepted before deciding whether to post them back to a PR.

## Develop

```bash
vp install
vp test            # run tests
vp check           # format + lint + type check
npm run lint       # full quality pipeline
npm run pack:dry-run
```
