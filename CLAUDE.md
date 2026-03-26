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

## Release

Release flow is Git-based. Do not run `npm publish` locally for this repo.

For a normal release:

- bump the version in `package.json` and `package-lock.json`
- run release checks locally, typically `npm test`, `npm run build`, and `npm run pack:dry-run`
- commit the release changes
- push the release commit to `main`
- create and push a version tag such as `v0.2.4`

Publishing to npm is handled by GitHub Actions after the tag is pushed.

## Architecture

```
L0  src/core/       Pure computation — zero I/O, zero external deps
L1  src/cli/        CLI entry point — file I/O, git, process control
L1  src/server/     Persistent HTTP review service — MCP, sessions, REST API
L2  src/web/        Web UI — React SPA served by cli (render) or server
    skills/         Published agent skills for `npx skills add`
```

### Dependency rules (enforced by dependency-cruiser)

- `core` must not import from `cli`, `server`, or `web`
- `cli` must not import from `server` or `web`
- `server` must not import from `cli` or `web`
- `web` must not import from `cli` or `server`

## Testing

Tests live next to source files as `*.test.ts`. Run with `vp test`.

```ts
import { describe, expect, it } from "vitest";
```
