# @riftbound/card-data

This package owns the versioned card-data boundary, current official-gallery
synchronization, community corrections, and the resumable official image cache.

## Current Snapshot

The current persisted data phase is complete:

- English and Chinese official galleries each contain 1,381 records with matching
  IDs.
- Official set coverage is OGN 352, OGS 24, RAD 192, SFD 288, UNL 288, and
  VEN 237.
- The community source's missing `unl-022-219` regular printing was filled from
  the official gallery.
- A dry run on 2026-10-11 loaded 1,380 community cards plus 1,381 English and
  1,381 Chinese official records, generated 1,381 cards, and exited 0 without
  changing the persisted snapshot.
- The successful run exited 0 and wrote:
  - `packages/card-data/dist/cards.json`
  - `packages/card-data/data/catalog.json`
- `build-deck-catalog` processed 1,381 printings into 1,080 official English
  full-name identities, including 46 cross-set identities. A 2026-10-11 run
  exited 0 and reported the same totals. It classified 169 printings as
  alternate and 1,212 as standard. The 45 official public codes ending in ASCII
  `*` are alternate; this reclassification left every `primaryPrintingId`
  unchanged.
- The persisted deck-catalog digest is
  `sha256:c06644d45b8a5ee2fe868a0cbb5edcf7eb3c807e4b482cf982f2a8811df51331`.
- The persisted deck catalog has 1,355 localized Chinese display names and 26
  English-name fallbacks.

The image cache is complete for this snapshot. `data/images` contains 1,381
files with no zero-byte files; `ogn-028-298.png` is present and is 840,102
bytes. `data/images-manifest.json` is `ok=true` and `partial=false` with
1,381 entries, zero missing entries, and zero failures. A 2026-10-11
`sync:images --dry-run` reported `total=1381 downloaded=0 resumed=1381
missing=0 failed=0 pending=0 partial=false` and wrote no files.

Data completion is not effect completion. The runtime currently executes only
the synthetic-demo rules. Official card text, images, and canonical identities
do not imply that the complete official 1,381-card effect set is compiled or
playable.

## Runtime Boundary

The package exports:

- `CardDefinition`, `CardDataSet`, `CardDataManifest`, `CardDataBundle`, and
  `CardDataRegistry` types.
- Canonical and rules-identity fields for grouping printings without treating
  variants as different gameplay cards.
- Strict input guards and assertions for untrusted data.
- Digest generation over a canonical JSON representation.
- A generic deck-list validator for collection/version boundaries, unknown
  cards, copy limits, required tags, allowed card types, and size bounds.

Display names are never runtime identity. The bounded Constructed policy --
official bans, grouped copy limits, and zone structure -- is implemented by
`@riftbound/game-server`, not hard-coded here. Domain Identity,
Champion/Legend/Signature, and independently verified regional availability
restrictions are outside the current policy.

## Card Synchronization

The current-card sync downloads the community correction dataset and both
official gallery locales, reconciles IDs and pagination, merges official records
with community corrections, validates the generated bundle, and atomically writes
the snapshot and image catalog.

```text
pnpm cards:sync
pnpm --filter @riftbound/card-data sync:cards --dry-run
pnpm --filter @riftbound/card-data sync:cards --timeout-ms 60000
```

Useful options include:

- `--dry-run`: download and validate without writing files.
- `--timeout-ms <milliseconds>`: override the 30,000 ms request timeout.
- `--output <file>` and `--catalog-output <file>`: override default paths.

## Image Synchronization

The image sync reads `data/catalog.json`, downloads only HTTPS URLs from the
official image host, validates image structure and content type, and atomically
writes each file. It resumes existing images only when their URL, byte length,
SHA-256, content type, and manifest entry match.

```text
pnpm --filter @riftbound/card-data sync:images --dry-run
pnpm --filter @riftbound/card-data sync:images --timeout-ms 60000
```

Useful options include:

- `--dry-run`: report resumed, pending, missing, and failed files without
  downloading or writing.
- `--concurrency <1-8>`: parallel downloads; default 4.
- `--timeout-ms <milliseconds>`: per-request timeout; default 30,000.
- `--retries <0-5>`: retries after the first attempt; default 2.
- `--limit <number>`: download a prefix and mark the manifest partial.
- `--output <directory>` and `--manifest <file>`: override default paths.

## Deck Catalog

The deck-catalog builder groups official English full names across sets and art
variants while retaining printing identity for deck entries. Run it with:

```text
pnpm --filter @riftbound/card-data exec node scripts/build-deck-catalog.mjs
```

## Option Syntax

Use:

```text
pnpm --filter @riftbound/card-data sync:cards --dry-run
```

Do not insert a separate bare `--` between the script name and its options. The
current card-sync parser tolerates one bare `--` for compatibility, but the
image-sync parser has no sentinel handling and rejects it as an unknown option.
The package-filtered form shown above is the supported syntax for all scripts.

## Verification

The data sync run above exited 0 and persisted the 1,381-record snapshot.
`pnpm build`, `pnpm typecheck`, frozen install, and audit checks exit 0 for the
workspace. The latest agent-verified full `pnpm test` passes 198 tests:
card-data 48, desktop-client 37, game-server 47, integration-tests 23,
card-dsl 8, judge-tools 9, protocol 3, replay-core 10, and engine-core 13.

```text
pnpm --filter @riftbound/card-data typecheck
pnpm --filter @riftbound/card-data build
pnpm --filter @riftbound/card-data test
```
