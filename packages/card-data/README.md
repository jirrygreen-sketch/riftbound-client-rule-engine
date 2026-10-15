# @riftbound/card-data

This package owns the versioned card-data boundary, current official-gallery
synchronization, community corrections, and the resumable official image cache.

## Current Snapshot

The 2026-10-15 sync covers Radiance and the current errata set:

- English and Chinese official galleries each contain 1,408 records with matching
  IDs. Radiance grew from 192 to 219 printings, so the official source now
  carries the set ahead of its `2026-10-23` product release.
- Official set coverage is OGN 352, OGS 24, RAD 219, SFD 288, UNL 288, and
  VEN 237.
- The community `v2026-10-14` release has 1,406 cards and matches every official
  ID except `sfd-054-221` and `unl-224-219`, which the official gallery fills.
- A `sync:cards` run on 2026-10-15 loaded 1,406 community cards plus 1,408
  English and 1,408 Chinese official records, generated 1,408 cards, and exited
  0. It wrote:
  - `packages/card-data/dist/cards.json`
  - `packages/card-data/data/catalog.json`
  - `packages/card-data/data/deck-catalog.json`
- `build-deck-catalog` processed 1,408 printings into 1,103 official English
  full-name identities, including 46 cross-set identities and 210 identities with
  more than one printing. It classified 171 printings as alternate and 1,237 as
  standard.
- The persisted deck catalog has 1,408 localized Chinese display names, so no
  printing falls back to its English display name.
- `build:coverage` reports 1,408 printings, 1,103 canonical identities, 0
  executable, 1,375 judge-required, and 33 no-ability printings.

The image cache is complete for this snapshot. `data/images` contains 1,408
files with no zero-byte files. `data/images-manifest.json` is `ok=true` and
`partial=false` with 1,408 entries, zero missing entries, and zero failures; the
run reported `total=1408 downloaded=5 resumed=1403 missing=0 failed=0
pending=0 partial=false`.

Data completion is not effect completion. The runtime currently executes only

Data completion is not effect completion. The runtime currently executes only
the synthetic-demo rules. Official card text, images, and canonical identities
do not imply that the complete official 1,408-card effect set is compiled or
playable.

## Effect Coverage

`buildEffectCoverageReport` compiles persisted catalog entries with the
conservative `@riftbound/card-dsl` compiler. Its report distinguishes:

- `printingCount`: the number of physical/catalog printings, currently 1,408.
- `canonicalIdentityCount`: unique `canonicalCardId` values, currently 1,103.
- `executableCount`: printings whose complete text compiled to verified EffectIR.
- `judgeRequiredCount`: printings with text outside verified compiler coverage.
- `noAbilityCount`: printings with no ability text.

The persisted report currently records 0 executable, 1,375 judge-required,
and 33 no-ability printings. The 33 no-ability printings represent 15
canonical identities: 24 Basic Rune printings across 6 identities and 9
no-text Unit printings across 9 identities.

`noAbility` is a data and coverage classification. The six Basic Runes have
empty upstream `ability` text, but Core Rules 164.2 defines two activated
abilities for every Basic Rune. Those printings are not executable until the
runtime supports Rune objects, the Rune Deck, recycling, resources, and the
activated-ability lifecycle.

`executableCount` is deliberately not a claim of full-card playability; host
trigger timing, legality, and effect ownership still come from the engine. To
build the persisted report, run:

```text
pnpm --filter @riftbound/card-data build:coverage
```

Unknown text is always classified as `judgeRequired`. The package does not
silently infer a damaging, drawing, resource, or summon effect from partial
word matches.

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
with community corrections, rejects invalid or duplicate community card codes,
validates the generated bundle, and atomically writes the snapshot and image
catalog.

```text
pnpm cards:sync
pnpm --filter @riftbound/card-data sync:cards --dry-run
pnpm --filter @riftbound/card-data sync:cards --timeout-ms 60000
```

Useful options include:

- `--dry-run`: download and validate without writing files.
- `--timeout-ms <milliseconds>`: override the 30,000 ms request timeout.
- `--output <file>` and `--catalog-output <file>`: override default paths.

## Card Errata

The official gallery is a *printed* record: it keeps a card's original wording
even after Riot publishes errata for that card. The authoritative corrected
text lives in the errata announcements (Origins, Spiritforged, Unleashed,
Vendetta, and Radiance), which the community dataset carries per printing as
`abilityCorrected` / `abilityEffective` / `matchedErrataCode`.

`scripts/errata.mjs` merges that corrected wording under an evidence rule
instead of trusting it outright. Announcements and the community dataset write
costs in printed notation (`[1]`, `[A]`, `[M]`, `[C]`), while the gallery writes
`:rb_*:` symbols, so the translation is derived from each printing's own
`[OLD TEXT]` against its gallery text and is then required to reproduce that
gallery text character for character. A corrected text is only adopted when:

1. its printed evidence tokenizes in step with the printing's gallery text and
   maps each printed symbol to exactly one gallery symbol;
2. the printed evidence renders back to the gallery text exactly;
3. every `[NEW TEXT]` symbol is justified by that derived correspondence, by the
   printing's own gallery text, or by a documented table entry (`[n]` Energy,
   `[A]` any-Domain Power, `[M]` / `[S]` Might, `[E]` / `[T]` exhaust) whose
   `:rb_*:` form is attested in the gallery corpus vocabulary.

`[C]` (a single rune of the card's own Domain) is deliberately absent from that
table, so an ambiguous `[C]` can never guess a Domain. Errata are published per
identity; a printing without its own annotation inherits a verified sibling's
wording only when the printed text is identical and no matching sibling
disagrees. Everything else is left printed and is therefore classified
`judge-required` by the effect compiler. The 2026-10-15 run resolved 79 annotated
printings into 74 corrected texts, 11 that already matched their printed text,
and 6 inherited by an identical sibling printing, with 0 unresolved.

Errata resolution is data provenance only. Corrected wording is not executable
just because it is verified: unknown mechanics still require an explicit judge
decision, and the deck catalog's `judge-required` count is the authority on what
the runtime may execute.

## Image Synchronization
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

## Catalog Verification Offline vs Persisted

The default suite is offline-safe. `test/deck-catalog-audit.test.mjs` builds
synthetic catalogs through the real `buildDeckCatalog` builder and regresses
canonical identity grouping, alternate/reprint copy limits, unknown-community
isolation, and conservative effect coverage without reading any gitignored
snapshot. `test/card-data.test.mjs` likewise drives the effect-coverage CLI
against a synthetic catalog written to a throwaway artifact directory, checking
argument parsing, exact counts, dry-run behavior, and a missing-path failure.

The suite that reads the gitignored official snapshots is intentionally named
`test/persisted-catalog-audit.mjs` so the default `test/*.test.mjs` glob never
picks it up. Run it explicitly once the persisted data exists:

```text
pnpm --filter @riftbound/card-data build:catalog
pnpm --filter @riftbound/card-data build:coverage
pnpm --filter @riftbound/card-data exec node --test test/persisted-catalog-audit.mjs
```

It asserts the real persisted totals (1,408 printings, 1,103 canonical
identities, 1,375 judge-required, 33 no-ability) and fails loudly with the
missing file path when `data/deck-catalog.json` or `data/effect-coverage.json`
has not been built. It never skips and never fabricates official data.

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

The data sync run above exited 0 and persisted the 1,408-record snapshot.
`docs/implementation-status.md` maintains the current full-workspace
verification status and test totals.

```text
pnpm --filter @riftbound/card-data typecheck
pnpm --filter @riftbound/card-data build
pnpm --filter @riftbound/card-data test
```
