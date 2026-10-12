# Game Server Agent Instructions

## Scope

Own only `apps/game-server`: the HTTP catalog/image/deck-validation API, the
authoritative WebSocket room service, room persistence adapters, the foundation
adapter, and the experimental full-product orchestrator/runtime adapter.
Shared protocol and card-data contracts, dependency changes, cross-app
integration, commits, and pushes belong to the coordinating parent task.

## Current State

- The public server exposes `/health`, `/api/cards`, `/api/card-images/*`,
  `POST /api/decks/validate`, and one shared `/ws` endpoint.
- The foundation WebSocket room is still the public lifecycle path. It supports
  create/join, deck submission, ready checks, commands, reconnect, and room/game
  event sync.
- `GameRoom` owns authoritative room/engine state, viewer-specific projections,
  current-connection checks, command and room-request idempotency, optimistic
  versions, and server-private archives.
- `FullProductRoomOrchestrator` and `FullProductEngineRuntimeAdapter` exist under
  `src/full-product`, with focused orchestration and runtime tests.
- `src/room.ts` currently contains partial full-product imports and type/archive
  changes, but still rejects the full-product ruleset and has no completed
  public lifecycle wiring. A previous server lifecycle 5/5 and typecheck pass is
  historical evidence only; it does not establish current typecheck status.

## Real Gaps

1. The foundation WebSocket room remains the only public room path and shares
   `/ws` with the existing lifecycle.
2. The full-product orchestrator/runtime adapter is not connected to the public
   room lifecycle. It is currently server-internal and tested in isolation.
3. The server catalog projection omits `localizedFullName` and
   `localizedAbility`. It currently projects only `localizedName` and
   `localizedSubtitle`; the missing projection requires a shared catalog and
   protocol contract change owned by the parent task.

## Required Boundaries

- Keep all legality, policy, deck, room, command, and match decisions
  server-authoritative. Never trust client catalog data, projections, command
  effects, replay cursors, or completeness claims.
- Do not expose private zones, private object ids, another viewer's hand,
  resume tokens, or server archives in projections, snapshots, room views,
  event replay, receipts, or transport payloads.
- Preserve idempotency and determinism: stable request/command ids, payload
  conflict detection, exact expected versions, stable event sequences, seeded
  setup, and deterministic replay from validated cursors.
- Preserve the judge-required boundary. Do not parse unverified ability text or
  invent official rune, gear, opening, shuffle, mulligan, or
  battlefield-selection semantics. Unmodeled abilities and card types must stay
  explicitly judge-required.
- Treat the experimental full-product runtime as non-official until its shared
  contracts and authoritative lifecycle integration are approved by the parent
  task.

## Work Rules

- Documentation-only turns do not run implementation, tests, commits, pushes,
  or worktree/subtask delegation.
- Do not revert or overwrite unrelated existing changes.
- Request parent-task coordination for shared protocol types, catalog schema,
  public API contracts, dependencies, cross-app integration, commits, and pushes.
- Prefer focused server tests when implementation resumes, but do not claim a
  current typecheck or test pass without running it against the current worktree.
