# Implementation Status

Last reviewed: 2026-10-11

This is a current-state summary, not a historical audit. The counts below were
checked against the persisted files and rerun on this machine on 2026-10-11.
The card-data commands were run without writing their persisted snapshots;
the image command was a dry run and changed no image files.

## Current Shape

The repository is a server-and-desktop pnpm workspace:

```text
apps/
  game-server/       HTTP catalog/image/deck APIs and WebSocket rooms
  desktop-client/    React + Vite client with a Tauri 2 desktop shell
packages/
  protocol/          shared command, event, and projection contracts
  engine-core/       deterministic synthetic-demo rules slice
  card-data/         versioned card data, sync scripts, and image manifest
  card-dsl/          synthetic-demo DSL AST validation
  replay-core/       replay envelope and event-log validation
  judge-tools/       judge policy, review, and decision metadata
  integration-tests/ cross-package WebSocket and protocol tests
```

Implemented surfaces include:

- A game server with `/health`, `/api/cards`, `/api/card-images/:id`, and
  `/api/decks/validate`, plus in-memory WebSocket rooms.
- A desktop client that loads the server catalog, groups cards by canonical
  identity, selects printings, and edits a six-zone deck: main deck, runes,
  legend, champion, battlefields, and sideboard. DeckBuilder honors
  `available: false`, preserves API `printingIssues`, and includes a full-art
  preview.
- Server-side bounded Constructed validation using canonical card identity:
  current official ban targets, grouped copy limits, and zone structure. It
  does not yet enforce Domain Identity, Champion/Legend/Signature, or
  independently verified regional availability restrictions.
- Tauri NSIS bundling configuration with PNG and ICO icons and the Tauri CLI as
  a package dependency.

These implemented surfaces do not add up to a complete playable game. The
WebSocket rooms are in-memory and use the synthetic-demo engine, and the deck
builder covers catalog selection and bounded Constructed validation. Official
card-effect execution is outside both surfaces and is not implemented.

## Data, Catalog, And Effects

| Area | Current status |
| --- | --- |
| Official raw card data | Complete for this snapshot: English and Chinese official galleries each contain 1,381 records with matching IDs. |
| Persisted card snapshot | `sync:cards` exited 0 and wrote `packages/card-data/dist/cards.json` and `packages/card-data/data/catalog.json`. Coverage is OGN 352, OGS 24, RAD 192, SFD 288, UNL 288, VEN 237, totaling 1,381. |
| Deck catalog identities | `build-deck-catalog` processed 1,381 printings into 1,080 official English full-name identities, including 46 cross-set identities; variants are 169 alternate and 1,212 standard. |
| Community correction source | Used as a correction/comparison source. The missing `unl-022-219` regular printing was filled from the official gallery. |
| Localized display names | 1,355 printings have a localized Chinese name and 26 fall back to the official English name. |
| Card image cache | Complete for this snapshot. `data/images` contains 1,381 files, including `ogn-028-298.png` (840,102 bytes). `images-manifest.json` is `ok=true`, `partial=false`, with 1,381 entries and zero missing or failed entries. `sync:images --dry-run` reports `total=1381 resumed=1381 missing=0 failed=0 pending=0 partial=false`. |
| Catalog and deck builder | Implemented against the persisted catalog, including canonical grouping, printing selection, six zones, official bans, grouped copy limits, and zone structure. Domain Identity, Champion/Legend/Signature, and independently verified regional availability are not implemented. |
| Playable card effects | Not complete. `engine-core` and `card-dsl` remain a synthetic-demo slice; this is not a complete 1,381-card rules engine. |

This distinction is important: 1,381 reconciled data records establish card
identity, text, image references, and the bounded Constructed policy. They do
not make all card abilities executable. Full effect coverage still needs a real
state model, DSL compilation, trigger/replacement/prevention semantics, and
rule fixtures.

The persisted deck-catalog digest is:
`sha256:c06644d45b8a5ee2fe868a0cbb5edcf7eb3c807e4b482cf982f2a8811df51331`.
The catalog generation fix classifies all 45 official public codes ending in
ASCII `*` as alternate printings and left every `primaryPrintingId` unchanged.

## Verification Status

Completed verification:

- `node scripts/sync-current-cards.mjs --dry-run` exited 0. It loaded 1,380
  community records, 1,381 English official records, and 1,381 Chinese official
  records, generated a 1,381-card bundle, and reported one official-gallery
  fill for `unl-022-219`.
- `pnpm --filter @riftbound/card-data build:catalog` exited 0 and built 1,381
  cards and 1,080 identity groups.
- `pnpm --filter @riftbound/card-data sync:images --dry-run` exited 0 and
  reported 1,381 resumed, zero missing, zero failed, zero pending, and
  `partial=false`; no files were written.
- `pnpm build` exited 0.
- `pnpm typecheck` exited 0.
- The local server on `127.0.0.1:8787` returned HTTP 200 for `/api/cards` with
  1,381 cards and 1,080 groups, and `/health` returned `{"status":"ok","rooms":0}`.
- Deck-catalog generation processed 1,381 printings into 1,080 official English
  full-name identities, including 46 cross-set identities.
- The latest agent-verified full `pnpm test` passed 198 tests: card-data 48,
  desktop-client 37, game-server 47, integration-tests 23, card-dsl 8,
  judge-tools 9, protocol 3, replay-core 10, and engine-core 13.
- Frozen install and audit checks passed locally. The local toolchain uses
  Vitest 5.0.3 and Vite 7.3.7.

DeckBuilder no longer adds printings marked `available: false`, preserves API
`printingIssues`, and includes a full-art preview. The former
`primaryPrintingId` fixture defect is fixed.

Not yet verified:

- Windows NSIS installer creation or installation. The local checkout has no
  `cargo`, `rustc`, or `rustup`, and GitHub Windows CI verification is pending.
- Complete Constructed validation beyond the bounded policy, complete official
  rules, full-card effect execution, persistent rooms, event replay/backfill,
  and production installer/update behavior.

## Commands

Run from the repository root.

```text
pnpm build

pnpm cards:sync
pnpm --filter @riftbound/card-data sync:cards --dry-run
pnpm --filter @riftbound/card-data sync:cards --timeout-ms 60000

pnpm --filter @riftbound/card-data sync:images --dry-run
pnpm --filter @riftbound/card-data sync:images --timeout-ms 60000

pnpm dev:server
pnpm start:server

pnpm desktop:dev
pnpm desktop:build
pnpm --filter @riftbound/desktop-client build
```

Use package-filtered commands when passing options. Do not insert an extra `--`
before script options: the card sync parser tolerates one bare `--`, but the
image sync parser does not.
