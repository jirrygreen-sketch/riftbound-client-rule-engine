# Product Backlog

Last reviewed: 2026-10-11

The backlog distinguishes data and catalog infrastructure from playable rules.
The current data snapshot is complete, but the rules engine is still a
synthetic-demo slice.

## Priority Summary

| Priority | Scope | Current state |
| --- | --- | --- |
| P0 | Shared protocol, engine slice, in-memory server rooms, desktop client, DSL/replay/judge package foundations | Implemented; the current full workspace test pass is 208 tests. |
| P1 | Official card snapshot, image cache, catalog APIs, six-zone deck builder, official bans | Complete for the current snapshot: 1,381 images with zero missing or failed. |
| P1 | Complete official rules engine and executable 1,381-card effects | Not complete; only the synthetic-demo effect is executable. |
| P2 | Durable rooms, reconnect backfill, deterministic replay, full desktop gameplay | Not complete. |
| P3 | Installer, update, judge workflow, release gates | The workflow builds NSIS and uploads the artifact; installation and update behavior remain unverified. |

## P0: Foundation

Implemented:

- `@riftbound/protocol` as the shared command, event, room, and projection
  contract.
- `@riftbound/engine-core` as a deterministic synthetic-demo rules slice.
- In-memory game-server rooms with session, projection, and command handling.
- Desktop catalog loading and six-zone deck editing.
- `card-dsl`, `replay-core`, and `judge-tools` package foundations.

Remaining acceptance work:

- Keep the synthetic-demo protocol as a regression boundary until the official
  state model replaces it.

## P1: Data, Catalog, And Deck Legality

Completed for the current snapshot:

- Fetch and reconcile the official English and Chinese galleries, each with
  1,381 matching IDs.
- Persist `packages/card-data/dist/cards.json` and
  `packages/card-data/data/catalog.json`.
- Confirm set coverage: OGN 352, OGS 24, RAD 192, SFD 288, UNL 288, VEN 237.
- Generate the deck catalog from 1,381 printings: 1,080 official English
  full-name identities, 46 cross-set identities, 169 alternate printings, and
  1,212 standard printings.
- Classify all 45 official public codes ending in ASCII `*` as alternate while
  keeping every `primaryPrintingId` stable.
- Fill the community source's missing `unl-022-219` regular printing from the
  official gallery.
- Serve the catalog and images through the game-server HTTP API.
- Enforce canonical identity, official constructed bans, zone membership, zone
  sizes, and grouped copy limits.
- Keep unavailable printings out of deck entries, preserve API
  `printingIssues`, and provide a full-art preview.

The current localization state is documented: 1,355 printings use localized
Chinese display names and 26 use the English fallback.

Acceptance:

- Maintain a non-partial image manifest reporting 1,381 images with zero
  missing and failed images.
- Preserve the documented 26 English display-name fallbacks unless an official
  Chinese source provides replacements.
- Continue covering banned cards, printing variants, canonical limits, and
  every deck zone in server and client deck-validation tests.

## P1: Complete Rules Engine

The existing catalog must not be mistaken for executable rules. The remaining
work is:

1. Replace the synthetic state model with official game objects, stable IDs,
   zones, turn state, Chain items, tokens, and counters.
2. Implement HOT FEPR, Priority, Focus, Finalize, Execute, Pass, Resolve, and
   Cleanup to a fixed point.
3. Compile card text into validated DSL/IR with cost, target, trigger, and
   replacement/prevention plans.
4. Implement the event pipeline and deterministic replay invariants.
5. Build official-rule fixtures and golden replays before claiming broad card
   coverage.
6. Track per-card effect coverage explicitly; do not treat raw text or image
   presence as executable behavior.

## P2: Online Product

- Persist rooms, events, commands, snapshots, and replay envelopes.
- Support reconnect by event sequence with a fallback snapshot and state hash.
- Guarantee idempotent command handling across retries and process restarts.
- Separate player, audit, and judge views so hidden information never leaks.
- Complete the desktop game table for official rules, not only the demo slice.

## P3: Release

- Verify `desktop:dev`, `desktop:build`, and the generated NSIS installer on a
  Rust-enabled Windows host. GitHub CI must be observed after each release
  candidate; artifact upload success alone does not verify installation.
- Generate and lock `src-tauri/Cargo.lock`.
- Add installer, upgrade, rollback, and crash-recovery tests.
- Complete judge review/correction workflows and release evidence packaging.
- Establish final CI gates for typecheck, build, tests, replay determinism,
  privacy, and packaging.

## Command Notes

Use filtered package commands for options:

```text
pnpm --filter @riftbound/card-data sync:cards --dry-run
pnpm --filter @riftbound/card-data sync:images --dry-run
pnpm --filter @riftbound/desktop-client build
```

Do not use `pnpm --filter PACKAGE script -- --option`. The card sync script
currently tolerates one bare `--`, but the image sync script does not.
