# Workspace verification command order (cold install)

## Problem

After a frozen cold install with no prior `dist/`, the default root quality
command `pnpm typecheck` failed before any build had produced the shared
package declaration outputs.

- Root script (before): `"typecheck": "pnpm --recursive --if-present run typecheck"`.
- Shared packages (`card-dsl`, `protocol`, `engine-core`, `card-data`,
  `judge-tools`, `replay-core`) are `composite` projects that emit to `dist/`
  and are reached through their published `exports`/`types` (`./dist/...`).
- `packages/card-data/src/index.ts` imports `@riftbound/card-dsl`, which resolves
  via `node_modules` symlink to that package's `dist/`. With no `dist/`, the
  module and its declarations are missing.

Observed on a fresh cold copy (frozen `install --offline`, no `dist/`):

```
packages/card-data typecheck: src/index.ts(2,35): error TS2307: Cannot find module '@riftbound/card-dsl' or its corresponding type declarations.
packages/card-data typecheck: Failed
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @riftbound/card-data@0.1.0 typecheck: `tsc -p tsconfig.json --noEmit`
Exit status 2
[ELIFECYCLE] Command failed with exit code 2.
```

Exit code `2`. (The underlying condition is a missing referenced `dist/`; the
concrete emitted diagnostic in this workspace was `TS2307`, not `TS6305`.)

## Fix (command order only)

Root `package.json` `scripts.typecheck` now runs an explicit preparation step,
then the original recursive typecheck unchanged:

```json
"typecheck": "pnpm --filter './packages/**' run build && pnpm --recursive --if-present run typecheck"
```

- Only `scripts.typecheck` changed. `name`, `version`, `engines`,
  `packageManager`, `dependencies`, `devDependencies`, and the lockfile are
  untouched.
- The preparation step is a single `pnpm --filter './packages/**' run build`.
  The selector was verified against the local pnpm 11.9.0; it matches exactly the
  seven `packages/*` projects (not `apps/*`), and pnpm orders them by workspace
  topology so `card-dsl`/`protocol` build before `card-data`/`engine-core`.
- This reuses each package's existing `build` script (`tsc -p tsconfig.json`).
  It does not add tools, change rules, types, or export paths, and does not
  replace the real recursive typecheck.
- No Vite/Tauri desktop bundle and no server process is started; `apps/*` are
  excluded from the preparation step, so typecheck does not pre-package the
  frontend or run the server.

## What the preparation step produces

- `dist/` plus `dist/.tsbuildinfo` for the six compiled shared packages
  (`card-data`, `card-dsl`, `engine-core`, `judge-tools`, `protocol`,
  `replay-core`). `integration-tests`'s `build` is `tsc --noEmit`, so it emits
  nothing.
- No generated card-data catalogs are written. `packages/card-data/data/*.json`
  and `data/images/` are only touched by the `sync:*`/`build:catalog` scripts,
  which the preparation step does not run.

## Verification (fresh cold copies, no shared state)

Each cold copy was created from the source tree excluding `dist/`,
`node_modules/`, `*.tsbuildinfo` and the `outputs/` artifacts, then installed
with `pnpm install --frozen-lockfile --offline` (store reused, 0 downloaded).
These are cold copies from the working tree, not Git clean checkouts.

- Before (old script), copy #1: no `dist/` before, `pnpm typecheck` exit `2`
  with `card-data -> @riftbound/card-dsl` `TS2307`. `pnpm build` then
  `pnpm typecheck` => exit `0`.
- After (new script), copy #2: no `dist/` before, `pnpm typecheck` exit `0`.
  The log shows the `'./packages/**'` build (7 projects: dsl, judge-tools,
  protocol, replay-core, then card-data, engine-core, integration-tests) with
  real `dist/*.js` runtime output, followed by the recursive typecheck across
  9 of 10 projects.
- Negative control on copy #2: a temporary syntax error in a private copy of
  `packages/protocol/src/index.ts` => `pnpm typecheck` exit `2`
  (`TS1109 Expression expected`). The file was restored and re-verified green.
  No product source or repository test was modified.
- `pnpm build` on copy #2 exit `0`, generating runtime JS (e.g.
  `packages/card-dsl/dist/index.js`) rather than being skipped by an
  incremental declaration-only `tsbuildinfo` state.
- Hashes: `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `tsconfig.base.json` are
  byte-identical before/after; every production source under `apps/` and
  `packages/` is byte-identical. The only changed hash is root `package.json`
  (the authorized `scripts.typecheck` edit). The temporary `dist/` produced by
  the preparation step is the sole build byproduct.

## Reproduce

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

Raw evidence (logs, hashes, cold copies, selector check) lives under
`outputs/coordination/resume-20261013/artifacts/cold-workspace-typecheck-order/`.
