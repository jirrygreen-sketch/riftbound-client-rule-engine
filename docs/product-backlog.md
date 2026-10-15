# Product Backlog

Last reviewed: 2026-10-13

> **2026-10-13 refresh (10th).** Incremental facts since the 9th note; the full
> delivery goal remains **active / not complete**. The **131/141 V2 cores are now
> terminal**; wave 160 froze a **346/57** core-baseline pass (test-framework
> baseline only — no production source registry, no public Main/fullmatch). The
> user-facing resource work is still **unwired at the public path**: the public
> room stops at `setup → mulligan → awaiting-turn-start`, there is **no public
> "start turn/enter Main" command**, turn-start needs a trusted provider
> (currently always pending), so **real Main payment, continuous payment, and
> the arbitrary `+/-` counter are not delivered**. The designed behavior (already
> validated only at kernel/component level) is: energy is an independent count;
> Power shows a total plus the six domains plus Any; three "gain resource"
> sources — tap a basic rune (**+1 Energy**), recycle a basic rune (**+1 exact
> single-domain Power**), tap-and-kill Gold (**+1 Any Power**) — go into the
> current-turn pool first, payment deducts only the chosen plan and keeps the
> balance, and **Main start / Ending clear both pools by CR**. The prototype's
> `+/-` / free-balance is **sandbox-only**; the authoritative client must not
> invent resources. Waves 163 (formal replay dist, 77/77; 8795 still on 144 old
> cached imports), 164 (scoped Gold/continuation internal-command pass), 158
> (token findings → 165), and 166 (resource-gap evidence → 167) add the current
> evidence; 161/165/167/168/169/170 remain **in-flight, not accepted**.

> **2026-10-13 refresh (9th).** Incremental facts since the 2026-10-12 note. The
> Basic Rune official IR (CR-v1.4:164.2 two Reaction activations — exhaust for
> +1 Energy, recycle to the source-owner Rune Deck for +1 exact single-domain
> Power) now binds exactly 30 printings in `card-dsl`'s `duel-official-programs`
> registry: **52 resolved / 1329 unknown of 1381** (was 22 resolved). This is
> **binding/IR only — automatic card execution is still 0**; no production
> resources/Main. The backlog's "complete rules engine" work (official objects,
> HOT FEPR, DSL compilation, event pipeline, fixtures) is unchanged and
> unfinished. Remediation queues and their acceptance gates are tracked in
> [`docs/full-product/progress.md`](full-product/progress.md) §七之二. The full
> delivery goal remains **active / not complete**.

> **Current round (2026-10-12 full-product round, base `8d3929d`).** See
> [`docs/full-product/progress.md`](full-product/progress.md) for the current
> module status, priority selection, and reproducible verification commands.
> In the current round the milestone is the authoritative action/target loop
> for the **public foundation match**: the server publishes legal actions and
> target options in the projection (`GameProjection.actionOptions`,
> `contract: "riftbound.action-options.v1"`, `PROTOCOL_VERSION=0.2.1`), the
> client consumes them, and the authoritative command plus reconnect/recovery
> path closes the loop. This does **not** implement official rules: the public
> foundation path must not be conflated with the unwired experimental
> full-product orchestrator, and the experimental life/health/attack runtime
> keeps its existing boundary. Current-round full-product edits and final
> workspace verification are **实施中 / 待主控验收** and are filled in by the
> coordinating task after integration.
>
> Any coverage/test numbers below are **historical** and were not re-run in the
> current round.

The backlog distinguishes data and catalog infrastructure from playable rules.
The data snapshot is complete for another local checkout, but the rules engine
is still a synthetic-demo / narrow foundation slice.

## Priority Summary

| Priority | Scope | Current state |
| --- | --- | --- |
| P0 | Shared protocol, engine slice, in-memory server rooms, desktop client, DSL/replay/judge package foundations | Implemented; see `docs/implementation-status.md` for the current full-workspace verification status and test totals. |
| P1 | Official card snapshot, image cache, catalog APIs, six-zone deck builder, official bans | Complete for the current snapshot: 1,381 images with zero missing or failed. |
| P1 | Complete official rules engine and executable 1,381-card effects | Not complete. The `.gitignore`-ignored `packages/card-data/data/` snapshot is now present in this checkout: 1,381 printings, executable **0**, judge-required **1,348**, no-ability **33**. `card-dsl`'s `duel-official-programs` binds **52 resolved / 1329 unknown** (Basic Rune IR included) — **binding/IR only, automatic execution still 0**. The real-resource public path is still unwired: no public start-turn/enter-Main command, no trusted turn-start provider, so **real Main payment is not delivered**. |
| P2 | Durable rooms, reconnect backfill, deterministic replay, full desktop gameplay | Not complete. Wave 163 promoted the replay-core **formal dist** (`file-event-store.js` → `802fc017…`) and the formal replay suite passes **77/77**, but **8795 still runs 144 old cached imports** — the durable/runtime path is not yet on the new formal build. |
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

The existing catalog must not be mistaken for executable rules.
The persisted effect-coverage report distinguishes 1,381 printings from 1,080
canonical identities. Its 33 no-ability printings represent 15 identities:
24 Basic Rune printings across 6 identities and 9 no-text Unit printings across
9 identities. The Basic Runes have rules-defined activated abilities despite
empty upstream text, so `noAbility` is a text/coverage classification rather
than an executable status.

The remaining work is:
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
