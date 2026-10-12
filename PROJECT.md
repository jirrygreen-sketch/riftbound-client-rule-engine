# Riftbound Full Product

## Objective

Build a complete, usable, networked Riftbound desktop product from the
existing multiplayer foundation. The product must support two real clients
connecting to an authoritative server, constructing legal decks from the full
catalog, starting a match, resolving player actions through a deterministic
rules engine, preserving hidden information, and recovering from reconnects.

## Repository

- Upstream: `git@github.com:jirrygreen-sketch/riftbound-client-rule-engine.git`
- Baseline: `7280dd8`
- Working branch: `codex/full-product`
- Local project root: `C:\Users\11216\Documents\Codex\2026-10-12\riftbound-full-product`

## Coordination Rules

- The parent task owns shared contracts, dependency changes, package exports,
  integration, commits, pushes, and release decisions.
- Every delegated writer has a disjoint write scope.
- Delegated work must include focused tests and must not commit or push.
- Any official rule or card behavior that is not supported by authoritative
  evidence must be represented as blocked or judge-required, never guessed.
- Prefer `deepseek-v4-flash` for delegated work. The current subtask scheduler
  does not expose that model, so this phase uses `ZHIPU/GLM-5.3` and records
  that fallback explicitly.

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

This snapshot records the paused worktree on 2026-10-12; it must be refreshed
on resume rather than treated as permanent repository metadata. At the time of
this documentation update, the branch is `codex/full-product`, the committed
HEAD is `b488d73`, and the worktree contains substantial uncommitted
implementation and test edits across the desktop client, game server, protocol
contracts, card DSL, replay package, and card-data tests. The next command
should re-check HEAD and `git status`; those identifiers are not a claim that
later integration or review did not move the repository.

The committed base and the local implementation work must not be conflated:

- Committed base `b488d73`: the repository point from which the active work
  was branched.
- Local uncommitted implementation work: current-worktree changes to room
  types, full-product orchestration, runtime adapters, desktop board and
  transport behavior, deck validation, protocol/replay contracts, and focused
  tests. This work is paused and is not integrated, accepted, or committed.
- Historical passing suites that predate later edits are not evidence that the
  current worktree passes. In particular, server lifecycle 5/5, the server
  regression suite 15/15, the full server package at 137/140, and typecheck all
  passed before subsequent room changes; they are not current-worktree results.

The persisted card-data boundary remains 1,381 printings grouped into 1,080
official canonical identities. This is a data and identity result, not a
playable-card or complete-rules result.

## Representative Workflows

The following workstreams were active when implementation paused. Their latest
reported verification states are deliberately conservative:

- Room lifecycle (Banach): `room.ts` currently contains full-product imports
  and type definitions, but the public room path is not wired to the new
  runtime. `GameRoom` still accepts only the old synthetic/foundation rulesets,
  `create-room` constructs that old room, and `FullProductRoomOrchestrator` and
  the runtime adapter are not connected to the public WebSocket room. Older
  lifecycle, regression, package, and typecheck passes predate these room
  edits and must not be cited as current validation.
- Engine/runtime (Heisenberg): focused work reached 37/42. Subsequent
  intermediate edits have not been retested. Concede and the required
  projection behavior are not implemented. The deleted
  `packages/engine-core/test/full-product/runtime-contracts.test.mjs` is still
  pending review and must not be assumed obsolete.
- Card DSL/effects (Socrates): two candidate printings, Cloud Drake and
  Watchful Sentry, have exact candidate compilation. The broader persisted
  classification is 1,346 judge-required and 33 empty-text printings. The
  candidate work is untested, covers only two cards, and is not a claim that
  the full card pool is executable.
- Replay/persistence (Kepler): focused replay work reached 17/21. The fixes
  made after that run have not been retested.
- Desktop full-product UI (Halley): focused full-product UI coverage reached
  37/37, while the desktop package was 104/109 overall and its typecheck
  failed. These numbers describe the last reported run, not a resumed result.
- Deck builder/validation (Aristotle): focused deck coverage is 37/42, with
  known shared canonical copy-limit and localization gaps.

No rules implementation may be called the complete official Riftbound rules.
The experimental runtime, adapters, projections, and any partial EffectIR
coverage are integration surfaces only. Official setup, phase progression,
prompt ownership, scoring, and unresolved card effects remain open unless
implemented and verified against authoritative rule and card evidence.

## Unfinished Work And Acceptance Boundary

Resume work by preserving the uncommitted implementation and closing the
boundaries below. A historical or isolated focused pass does not close any
product gate:

1. Connect the full-product room orchestrator and runtime adapter to the
   public WebSocket room lifecycle behind an explicit ruleset/version boundary.
   Two protocol clients must create, join, submit decks, start, progress, and
   end a match through that actual public path.
2. Restore or explicitly supersede the deleted engine runtime-contract test,
   implement concede and projection behavior, and rerun the focused engine
   suite. A result after intermediate edits must replace 37/42 as the current
   number.
3. Add focused tests for the two exact DSL candidates and keep all unsupported
   text classified as judge-required. Two compiled cards do not establish
   full-card playability.
4. Retest the replay fixes. The pre-fix 17/21 result is only a baseline.
5. Close the shared canonical copy-limit and localization gaps in deck
   builder/validation work, then rerun focused deck coverage; the current
   37/42 result is not acceptable.
6. Re-run focused full-product UI coverage and then the complete desktop
   package and typecheck. Focused 37/37 does not override the package-level
   104/109 or the failed typecheck.
7. Re-run server lifecycle, regression, package, and typecheck verification
   only after all room-integration edits settle. Earlier 5/5, 15/15, 137/140,
   and typecheck-passing results predate later room edits and cannot be used as
   current acceptance evidence.
8. Produce one real two-client GUI run through the public room path with
   private-projection, command, reconnect, replay, and result evidence. Until
   that run and the rules work above exist, the product is not complete and no
   implementation may be described as official complete rules.
