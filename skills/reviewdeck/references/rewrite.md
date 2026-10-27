# Rewrite Guidance (experimental)

Rewrite blocks fold a few diff lines into one equivalent, more focused line, in place, like an editor code fold. The code stays the main body and every fold opens with one click. The goal is that a reviewer reads less without verifying less.

This file is the default rewrite prompt. If the user supplies their own rewrite prompt or style, follow it instead of this file.

## Core rule: equivalent, not summarized

A rewrite is a change of notation, not a summary. A reviewer who reads only the rewrite must be able to reach the same verdict as one who reads the code.

- Describe what the code does, not what the author meant. If they differ, the code wins.
- Keep every behavior-relevant detail: conditions, values, ordering, error paths, defaults, what is returned or dropped.
- Drop only what does not change behavior: formatting, import shuffles, variable naming, boilerplate. Say what was dropped when it is non-trivial (`Omitted: logging, blank lines`).
- For modified code, express the delta: before → after. For new code, express the final behavior.
- Never smooth over something odd. If a line looks unintended, keep it visible in the rewrite.

## Say what it does, not how it is spelled

A rewrite must save the reviewer a step of interpretation, not just some syntax. Restating the code in words with the same structure (`if ctx is done: err = errors.Join(err, ctx.Err())`) saves nothing: the reader still has to evaluate the expression.

- State the effect the reviewer would otherwise work out: what callers now get, which values, messages or error types result, what is kept and what is lost.
- Spell out library semantics the reviewer would have to recall (`errors.Join` joins messages with a newline; `%w` keeps the wrapped error matchable by `errors.Is`/`errors.As`).
- Use code formatting, inline or fenced, for identifiers, literals and messages the reviewer matches against other code. Don't use it for whole statements.
- Self-check: if putting your words back into syntax gives the original lines, it is a transliteration. Rewrite it in terms of effect, or leave those lines unfolded.
- Effects are still claims about the code. State only what follows from the code and the language/library semantics; don't guess about callers you have not read.

## Choosing a notation

Pick whatever makes the delta easiest to verify:

| Code shape                  | Notation                                                        |
| --------------------------- | --------------------------------------------------------------- |
| Branches / case handling    | Table: case → before → after                                    |
| Sequential flow             | Numbered steps, one effect per step                             |
| Signature / contract change | `before` → `after` with the observable difference               |
| Data / config               | Table of keys and values                                        |
| Mechanical change           | One sentence naming the mechanism (rename X→Y, reorder imports) |
| Tests                       | Table: scenario → expectation, plus what is _not_ covered       |

Use Markdown (GFM). Keep a block short; if the rewrite is not much shorter than the code, leave those lines as code.

## Block boundaries

- Fold at line level: one block = one intent over a contiguous run of lines, usually 1–10. Several small folds beat one big one.
- Keep structure lines as code (`if err != nil {`, `}`, function signatures that did not change), so folded code reads like structured pseudocode.
- Bigger folds are fine when the lines share one intent a reviewer checks as a whole: one test function, an import block, a mechanical sweep in one place.
- Pull blank lines next to a fold into it, so no lone blank line is left between folds.
- Don't fold a line whose code is already the clearest notation (`"-T",`, `return err`). Leave it as code.
- A block's `changes` must belong to its group; blocks in a group must not overlap.
- A block covers one contiguous stretch of its group's changes: no other change of the group may fall between its first and last change, or `split` rejects it. Unchanged lines and other groups' changes in between are fine, so one block can take the same mechanical edit in several nearby places. The review UI shows the block in place of everything from its first to its last line.
- `title` is optional; at line level the rewrite line usually needs none.

## Format

```json
{
  "description": "...",
  "changes": ["0-19"],
  "rewrites": [
    {
      "changes": ["3-6"],
      "rewrite": "returned output no longer mixes in stderr: stdout and stderr are collected separately, unbounded"
    },
    {
      "changes": ["10-12"],
      "rewrite": "ctx canceled or timed out: err also carries `ctx.Err()`, so `errors.Is` matches the ctx cause while `errors.As` still finds `*exec.ExitError`; the message gains a second line"
    },
    {
      "changes": ["14-16"],
      "rewrite": "stderr non-empty: message gets `: ` + raw stderr (untrimmed, may span lines); the original err stays wrapped and matchable"
    }
  ]
}
```

Write the rewrite as one line where possible: a plain statement of effect that reads in place of the folded lines. Use tables or lists only for folds that cover many cases, such as a whole test function.
