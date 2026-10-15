# Riftbound Full Product

## Objective

Build a complete, usable, networked Riftbound desktop product from the
existing multiplayer foundation. The product must support two real clients
connecting to an authoritative server, constructing legal decks from the full
catalog, starting a match, resolving player actions through a deterministic
rules engine, preserving hidden information, and recovering from reconnects.

## Repository

- Upstream: `git@github.com:jirrygreen-sketch/riftbound-client-rule-engine.git`
- Working branch: `codex/full-product`
- Pre-full-product baseline: `7280dd8`
- Full-product foundation: `b488d73` (“Build multiplayer full-product foundation”)
- Documentation checkpoint / current snapshot base: `8d3929d`
- Current progress and open work: see `docs/full-product/progress.md`. Do not
  hardcode a local checkout path here; resolve the repository root at runtime.

## Coordination Rules

- The parent task owns shared contracts, dependency changes, package exports,
  integration, commits, pushes, and release decisions.
- Every delegated writer has a disjoint write scope.
- Delegated work must include focused tests and must not commit or push.
- Any official rule or card behavior that is not supported by authoritative
  evidence must be represented as blocked or judge-required, never guessed.
- Delegated work uses the current user-specified `claude-team` local CLI
  executors. Pick `gpt6sol` (xhigh) for critical reasoning work and the DeepSeek
  flash model for routine/general work. Historical `deepseek-v4-flash` /
  `ZHIPU/GLM-5.3` model guidance is obsolete. Do not open new sidebar chats and
  do not spawn nested agents/CLIs.

## Product Gates

1. A fresh checkout installs with the lockfile and starts the server.
2. Two desktop clients can create or join a room and see only their own
   private information.
3. A legal submitted deck can start a match and produce a deterministic
   server event log.
4. Every client action is validated by the server and represented by a
   versioned command/event contract.
5. Disconnect, reconnect, duplicate commands, and missed events recover
   without duplicating or leaking state.
6. The UI exposes the current phase, legal actions, prompts, targets, zones,
   stack/chain, and match result without requiring manual card-trigger clicks.
7. Tests cover the complete vertical slice, and unsupported official rules are
   documented with an explicit implementation status.

## Current Foundation

The baseline already contains a WebSocket server, a Tauri React client, card
catalog and image data, deck legality checks, canonical/printing grouping,
private projections, reconnect/event backfill, a foundation rules slice, and
synthetic-demo tests. The remaining work is to turn those slices into a
coherent playable product with persistent storage, a full action loop, richer
card resolution, and end-to-end UX.

## Current Snapshot

This snapshot records the worktree state on 2026-10-12 at documentation
checkpoint `8d3929d`; it must be refreshed by re-checking HEAD and
`git status` rather than treated as permanent repository metadata. On resume
the user explicitly continued full-product development, so the earlier
“paused / do not resume” guidance no longer applies.

- Committed base: branch `codex/full-product`, documentation checkpoint
  `8d3929d`, whose parent `b488d73` already committed the full-product
  foundation (engine-core `src/full-product/*`, game-server
  `src/full-product/*`, card-dsl `src/full-product/*`, desktop full-product UI,
  and focused tests). `8d3929d` only changed documentation.
- Worktree state at the checkpoint was clean (`git status` empty); the
  assertion of “substantial uncommitted full-product work” in earlier revisions
  of this document was incorrect. The original checkout `codex/full-product`
  stays clean; this round develops in an **isolated git worktree** and makes no
  commit or push.
- Historical passing suites that predate later edits are not current evidence.
  Server lifecycle 5/5, the server regression suite 15/15, the full server
  package at 137/140, the old desktop 37/37, 37/42, 104/109, and a
  typecheck/build-blocked state are all **historical**; none describe the
  current worktree. The current round's real results are in
  `docs/full-product/progress.md` §1.2.

Official copyright catalog/images/PDF stay `.gitignore`-ignored by design;
committing the full copyright dataset is **not** a delivery requirement.
Verifiability means a reproducible local sync manifest (source, hash, counts,
logs) rather than Git-tracked data. The historical 1,381 printings / 1,080
canonical identities belong to another local checkout, and the
official-card-sync run is still in progress, so those counts are not restated
here as current.

## Representative Workstreams

The committed foundation contains the following capabilities. The numbers
below are historical reported runs, not current-worktree results:

- Room lifecycle: `room.ts` and the server expose public rooms, but the public
  path is not wired to the full-product runtime. `GameRoom` accepts only the
  synthetic/foundation rulesets, and `FullProductRoomOrchestrator` plus the
  runtime adapter are not connected to the public WebSocket room. Earlier
  lifecycle/regression/package/typecheck passes predate later changes and must
  not be cited as current validation.
- Engine/runtime: foundation is a narrow CR v1.4 1v1 Duel slice; concede and
  required projection behavior were addressed in the committed foundation. The
  `packages/engine-core/test/full-product/runtime-contracts.test.mjs` test
  exists and is covered by the package test glob; the earlier claim that it was
  deleted is incorrect.
- Card DSL/effects: candidate printings (e.g. Cloud Drake, Watchful Sentry)
  have candidate compilation. Official card-pool sync is still running, so the
  authoritative executable/coverage counts are **pending re-count** and are not
  stated here. Two compiled candidates do not make the full card pool
  executable.
- Replay/persistence: replay envelope and event-log validation are committed;
  the full two-client restart/privacy acceptance has not been run.
- Desktop full-product UI: the full-product board, prompt panel, transport, and
  commands are committed; tests are component-level static rendering, not a
  real dual-client GUI run.
- Deck builder/validation: bounded Constructed validation is committed, with
  known Domain Identity/Champion/Legend/Signature gaps.

No rules implementation may be called the complete official Riftbound rules.
The experimental runtime, adapters, projections, and any partial EffectIR
coverage are integration surfaces only. Official setup, phase progression,
prompt ownership, scoring, and unresolved card effects remain open unless
implemented and verified against authoritative rule and card evidence. In
particular, the public foundation path must not be conflated with the
unwired experimental full-product orchestrator: wiring that orchestrator alone
is not a complete product.

## Current Round Milestone

The action/target loop milestone is **reached**: the server publishes legal
actions and target options in the projection (`GameProjection.actionOptions`,
`contract: "riftbound.action-options.v1"`, `PROTOCOL_VERSION` `0.2.1`) and the
desktop client consumes that metadata. This round's protocol 21 / engine 58 /
server 139 / desktop 117 suites pass, the focused `full-product` run passes 3,
and `typecheck`/`build` exit 0 (see `docs/full-product/progress.md` §1.2). The
UI base classes already exist, but no real dual-client GUI run has happened
yet. A dual-shared-battlefield kernel has only just started and is not
complete. The official rules and the experimental life/health/attack runtime
keep their existing boundaries and must still not be called complete
Riftbound.

## Unfinished Work And Acceptance Boundary

Closing the boundaries below is what closes a product gate. A historical or
isolated focused pass does not close any gate:

1. Wire the full-product room orchestrator and runtime adapter to the public
   WebSocket room lifecycle only behind an explicit ruleset/version boundary.
   Two protocol clients must create, join, submit decks, start, progress, and
   end a match through that actual public path. Merely registering the
   experimental orchestrator is not a complete product and does not implement
   official rules.
2. Keep `packages/engine-core/test/full-product/runtime-contracts.test.mjs`
   covered (it exists; it was not deleted), and rerun the focused engine suite
   after room-integration edits settle.
3. Keep all unsupported card text classified as `judge-required`. Two compiled
   DSL candidates do not establish full-card playability.
4. Rerun replay/persistence focused checks; historical numbers are only a
   baseline.
5. Close the shared canonical copy-limit, Domain Identity, Champion/Legend/
   Signature, and localization gaps in deck builder/validation work.
6. Rerun focused full-product UI coverage and then the complete desktop
   package and typecheck.
7. Rerun server lifecycle, regression, package, and typecheck verification
   only after all room-integration edits settle. Earlier 5/5, 15/15, 137/140,
   and typecheck-passing results are historical. The current round's server
   139 pass and `typecheck`/`build` exit 0 (see `docs/full-product/progress.md`
   §1.2) are the current status.
8. Produce one real two-client GUI run through the public room path with
   private-projection, command, reconnect, replay, and result evidence. Until
   that run and the rules work above exist, the product is not complete and no
   implementation may be described as official complete rules.

The current per-item status, the module table, and the reproducible
verification commands live in `docs/full-product/progress.md`; final
verification numbers are filled in by the coordinating task after integration.
