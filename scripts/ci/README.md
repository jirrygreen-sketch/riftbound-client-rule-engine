# CI helpers (RIFT-14)

These scripts exist so `.github/workflows/ci.yml` reports a truthful verdict
from a clean checkout. They never edit tests, sources or generated data.

## The problem

The official Riftbound catalog is gitignored generated data:

| Path | Produced by |
| --- | --- |
| `packages/card-data/dist/cards.json` | `pnpm --filter @riftbound/card-data sync:cards` |
| `packages/card-data/data/catalog.json` | same command |
| `packages/card-data/data/deck-catalog.json` | same command (via `build-deck-catalog.mjs`) |
| `packages/card-data/data/effect-coverage.json` | `pnpm --filter @riftbound/card-data build:coverage` |
| `packages/card-data/data/images-manifest.json`, `data/images/` | `pnpm --filter @riftbound/card-data sync:images` |

A CI checkout therefore never contains them. Some suites read the deck catalog
directly (JSON import, `readFileSync`, or
`apps/game-server/src/card-catalog.ts`), so without handling they fail on
`ENOENT` and the job is red for a reason that has nothing to do with the
change under test.

Syncing the data from the live upstream sources does not fix this, it makes it
worse. The suites and the compiled card-dsl constants pin one exact snapshot
(`2026-10-12-official-gallery` / `sha256:53b974c8...a504d10`, 1381
printings). The live sources now produce a *different* snapshot (1408 printings,
`2026-10-15-official-gallery`, `sha256:9ebc300c...e5e3`), which breaks
41 pinned tests across card-dsl and engine-core. See
`probe-official-data-drift.mjs` for the measured evidence.

## What the gate does

| Script | Purpose |
| --- | --- |
| `verify-card-data-absence.mjs` | Fails if any gitignored official data exists in the checkout, because the skip classifier is only sound when the data is verifiably absent. |
| `analyze-workspace-test-log.mjs` | Parses the raw recursive test log and decides the job verdict. |
| `reviewed-official-data-suites.json` | The reviewed list of suites allowed to be reported as skips. |
| `probe-official-data-drift.mjs` | Read-only probe that measures whether the live upstream sources still reproduce the pinned snapshot. |
| `tests/` | Self-checks for the parser and classifier, run by CI before it is trusted. |

The classifier reclassifies a failing suite as an explicit skip only when all of
these hold:

1. the suite's own failure evidence names one of the gitignored official data
   paths, and that path is verifiably absent in this checkout;
2. the same evidence states an absence reason (`ENOENT`,
   `ERR_MODULE_NOT_FOUND`, "no such file or directory", "required official
   catalog missing", "is required for this audit");
3. every failing entry of that suite is data-caused, so one real failure keeps
   the whole suite a failure.

The verdict fails whenever a real failure remains, a failed package has no
parseable evidence, the runner's own counters disagree with what was parsed, or
the log contradicts the process exit code. Skips are always listed in the job
summary with counts, so they can never be silent. A data-caused failure in a
suite that is not in the reviewed list is surfaced with a warning so the
dependency has to be reviewed rather than quietly absorbed.

## Reproducing locally

```
node --test scripts/ci/tests/*.test.mjs

# Simulate the clean-checkout state by pointing the analyzer at a data-free root:
node scripts/ci/analyze-workspace-test-log.mjs \
  --log /tmp/workspace-test.log --repo-root /tmp/empty-checkout --exit-code 1
```

`verify-card-data-absence.mjs` is meant for a clean clone; it deliberately
fails in a developer checkout that has already synchronized the official data.
