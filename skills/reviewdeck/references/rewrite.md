# Rewrite Guidance (experimental)

Rewrite blocks fold a few diff lines into one equivalent, more focused description, in place, like an editor code fold. The code stays the main body and every fold opens with one click. The goal is that a reviewer reads less without verifying less.

This file is the default rewrite prompt. If the user supplies their own rewrite prompt or style, follow it instead of this file.

## Core rule: equivalent, not summarized

A rewrite is a change of notation, not a summary. A reviewer who reads only the rewrite must be able to reach the same verdict as one who reads the code.

- Describe what the code does, not what the author meant. If they differ, the code wins.
- Keep every behavior-relevant detail: conditions, values, ordering, error paths, defaults, what is returned or dropped.
- Drop only what does not change behavior: formatting, import shuffles, variable naming, boilerplate. Say what was dropped when it is non-trivial (`Omitted: logging, blank lines`).
- For modified code, express the delta: before → after. For new code, express the final behavior.
- Never smooth over something odd. If a line looks unintended, keep it visible in the rewrite.

## The reader

Write for one reader: a reviewer who will check the logic, knows the project's domain, and has not read these lines.

- A rewrite only describes the code. Review opinions ("no catch here", "not covered", "could be simpler") go into `draftComments`, never into a rewrite.
- Don't narrate the diff process ("same as the deleted form below"). For a pure move, one plain line is enough: "the local form moves here unchanged".

## Style: mini-spec

Write rewrites like the process specifications of Structured Analysis (DeMarco): structured natural language for steps and branches, decision tables for many conditions, data named once and used consistently.

### Sentences

- Every sentence has a subject. Name who acts (the function, the page, the server, the user), even when the previous line had the same subject. Write "The page saves `to` as the post-login path", not "Save `to` as the post-login path".
- One action per line. Steps go in a numbered list; branches go in a bullet list with "if / else if / otherwise", and nesting is shown by indentation.
- No parenthetical asides. If a detail matters, give it its own line; if it does not, drop it.
- Start a block about a function with its name in plain text and what it is for: "parseSsoCallbackHash: reads the sign-in result from the URL hash".

### Names must be readable in place

The reader sees the rewrite, not the code behind other folds. A name used in a rewrite must be one of these:

- visible as code in the same view;
- explained in the same rewrite, by its meaning, the first time it appears: "no longer hidden by the page's `hideForm` option", not "no longer controlled by hideForm";
- a domain word the reader already knows.

Prefer the meaning over the identifier. Only keep the identifier when the reader needs it to find the thing in the code.

### Code font

Use code font only for what the reader matches character by character: literal values, routes, error codes, message keys, storage keys, and identifiers kept on purpose. Write everything else as plain words. Heavy code font breaks the reading flow, especially in non-English prose.

### Choosing a form

| Code shape                  | Form                                                     |
| --------------------------- | -------------------------------------------------------- |
| Sequential flow             | Numbered steps, one action per step, each with a subject |
| Branches                    | if / else if / otherwise bullets, nested by indentation  |
| Many conditions or cases    | Decision table: condition → result                       |
| Before / after behavior     | Table: aspect → before → after                           |
| Signature / contract change | `before` → `after` with the observable difference        |
| Data / config               | Table of keys and values                                 |
| Mechanical change           | One sentence naming the mechanism (rename X→Y, move)     |
| Tests                       | Table: scenario → expectation                            |

Use Markdown (GFM). Keep a block short; if the rewrite is not much shorter or clearer than the code, leave those lines as code.

## Say what it does, not how it is spelled

A rewrite must save the reviewer a step of interpretation, not just some syntax. Restating the code with the same structure (`if ctx is done: err = errors.Join(err, ctx.Err())`) saves nothing: the reader still has to evaluate the expression.

- State the effect the reviewer would otherwise work out: what callers now get, which values, messages or error types result, what is kept and what is lost.
- Spell out library semantics the reviewer would have to recall (`errors.Join` joins messages with a newline; `%w` keeps the wrapped error matchable by `errors.Is`/`errors.As`).
- Self-check: if putting your words back into syntax gives the original lines, it is a transliteration. Rewrite it in terms of effect, or leave those lines unfolded.
- Effects are still claims about the code. State only what follows from the code and the language/library semantics; don't guess about callers you have not read.

## Block boundaries

- Fold at line level: one block = one intent over a contiguous run of lines, usually 1–10. Several small folds beat one big one.
- Don't put unrelated changes in one block, such as a deletion of one feature next to the addition of another. Split them, or leave one as code.
- Keep structure lines as code (`if err != nil {`, `}`, function signatures that did not change), so folded code reads like structured pseudocode.
- Bigger folds are fine when the lines share one intent a reviewer checks as a whole: one test function, an import block, a mechanical sweep in one place.
- Pull blank lines next to a fold into it, so no lone blank line is left between folds.
- Don't fold a line whose code is already the clearest notation (`"-T",`, `return err`). Leave it as code.
- A block's `changes` must belong to its group; blocks in a group must not overlap.
- A block covers one contiguous stretch of its group's changes: no other change of the group may fall between its first and last change, or `split` rejects it. Unchanged lines and other groups' changes in between are fine, so one block can take the same mechanical edit in several nearby places. The review UI shows the block in place of everything from its first to its last line.
- `title` is optional; at line level the rewrite usually needs none.

## Format

```json
{
  "description": "...",
  "changes": ["0-19"],
  "rewrites": [
    {
      "changes": ["3-6"],
      "rewrite": "run: the command now collects stdout and stderr separately, without a size limit. The returned output no longer contains stderr."
    },
    {
      "changes": ["10-12"],
      "rewrite": "- If the context is canceled or timed out: the returned error also carries the context's error.\n  - `errors.Is` then matches the context cause.\n  - `errors.As` still finds `*exec.ExitError`.\n  - The error message gains a second line."
    },
    {
      "changes": ["14-16"],
      "rewrite": "- If stderr is not empty: the error message ends with `: ` and the raw stderr, untrimmed and possibly several lines long.\n- The original error stays wrapped, so callers can still match it."
    }
  ]
}
```
