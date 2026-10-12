# Implementation Status

Last reviewed: 2026-10-12

This is a current-state summary, not a historical audit. Data and catalog
statements below describe the persisted snapshot last verified on
2026-10-11. The verification below reflects the full recursive test, typecheck,
and build runs completed on 2026-10-12. It does not re-assert server smoke,
frozen-install, audit, or CI verification.

## Current Shape

The repository is a server-and-desktop pnpm workspace:

```text
apps/
  game-server/       HTTP catalog/image/deck APIs and WebSocket rooms
  desktop-client/    React + Vite client with a Tauri 2 desktop shell
packages/
  protocol/          shared command, event, and projection contracts
  engine-core/       deterministic synthetic-demo and foundation game state
  card-data/         versioned card data, sync scripts, and image manifest
  card-dsl/          synthetic-demo DSL and EffectIR validation
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
WebSocket rooms are in-memory. The synthetic-demo mode uses the narrow demo
engine, while the foundation mode maps submitted official printings through the
server adapter into `createConfiguredGame`. That foundation surface is a
deliberately narrow CR v1.4 1v1 Duel vertical slice, not a complete official
rules implementation. It starts with four submitted Main Deck cards in submitted
order and does not model official shuffling, mulligans, first-player selection,
battlefield selection, rune channeling, sideboarding, or official ability
execution.

Official card ability text is not parsed. Cards with unmodeled official text,
inherent rune abilities, token-like definitions, or a mapped multi-type
definition become judge-required effects and block automatic resolution rather
than being approximated. Unsupported card types are rejected rather than being
guessed as another engine type. Player confirmation cannot resolve
judge-required effects; an authoritative ruling is required.

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
| Playable card effects | Not complete. `engine-core` covers explicitly modeled synthetic-demo and foundation semantics, while `card-dsl` validates synthetic-demo DSL and EffectIR; neither is a complete 1,381-card rules engine. Unmodeled official text and object semantics are judge-required. |

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

Current test verification reported on 2026-10-12:

- `protocol`: 8 passed.
- `engine-core`: 27 passed.
- `game-server`: 78 passed.
- `desktop-client`: 58 passed.
- `card-data`: 51 passed.
- `card-dsl`: 17 passed.
- `judge-tools`: 18 passed.
- `replay-core`: 10 passed.
- `integration-tests`: 34 passed.

A full `pnpm test` run exited 0 with these package results: 301 tests passed.
`pnpm typecheck`, `pnpm build`, and `git diff --check` also exited 0.
After the final reconnect visibility fix, the desktop-client tests passed
58/58 again and its build, including TypeScript checking, exited 0.

One isolated
`game-server` package run had a timing-sensitive reconnect failure, but that
failure did not reproduce in the full recursive run; it is not a verified
stable result.

Persisted data checks last completed on 2026-10-11:

- `node scripts/sync-current-cards.mjs --dry-run` exited 0. It loaded 1,380
  community records, 1,381 English official records, and 1,381 Chinese official
  records, generated a 1,381-card bundle, and reported one official-gallery
  fill for `unl-022-219`.
- `pnpm --filter @riftbound/card-data build:catalog` exited 0 and built 1,381
  cards and 1,080 identity groups.
- `pnpm --filter @riftbound/card-data sync:images --dry-run` exited 0 and
  reported 1,381 resumed, zero missing, zero failed, zero pending, and
  `partial=false`; no files were written.
- Deck-catalog generation processed 1,381 printings into 1,080 official English
  full-name identities, including 46 cross-set identities.

Server smoke, frozen-install, and audit checks also passed in that earlier
workspace state on 2026-10-11. Those three checks have not been re-asserted for
the current workspace.

DeckBuilder no longer adds printings marked `available: false`, preserves API
`printingIssues`, and includes a full-art preview. The former
`primaryPrintingId` fixture defect is fixed.

Not yet verified:

- Windows NSIS installer creation or installation. The local checkout has no
  `cargo`, `rustc`, or `rustup`, and GitHub Windows CI verification is pending.
- Complete Constructed validation beyond the bounded policy, complete official
  rules, full-card effect execution, persistent rooms and event history,
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
