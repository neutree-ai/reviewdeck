# reviewdeck

Split large PR diffs into reviewable sub-patches via LLM-assigned groups.

## Toolchain: Vite+

This project uses [Vite+](https://vite.plus) (`vp`) as the unified toolchain. Do not use Bun, npm, pnpm, or Yarn directly.

- `vp install` — install dependencies
- `vp test` — run tests (Vitest)
- `vp check` — format (Oxfmt) + lint (Oxlint) + type check (tsgo)
- `vp check --fix` — auto-fix formatting and lint issues
- `vp dev` — dev server
- `vp build` — production build
- `vp add <pkg>` / `vp remove <pkg>` — manage dependencies

Import test utilities from `vitest`, not `bun:test`. Import config from `vite-plus`.

## Quality checks

```sh
npm run lint   # runs: vp test && vp check && knip && depcruise
```

- **knip** — dead code / unused exports detection
- **dependency-cruiser** — layer dependency rules (`.dependency-cruiser.cjs`)

## Architecture

```
L0  src/core/       Pure computation — zero I/O, zero external deps
L1  src/cli/        CLI entry point — file I/O, git, process control
L2  src/web/        Web UI + API server (future)
    skills/         Published agent skills for `npx skills add`
```

### Dependency rules (enforced by dependency-cruiser)

- `core` must not import from `cli` or `web`
- `cli` must not import from `web`
- `web` may import from `core`, not from `cli`

## Testing

Tests live next to source files as `*.test.ts`. Run with `vp test`.

```ts
import { describe, expect, it } from "vitest";
```
