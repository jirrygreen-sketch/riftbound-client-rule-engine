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

## Active Workstreams

- Rules runtime and deterministic turn/action loop
- Server room lifecycle and authoritative match orchestration
- Desktop board and prompt-driven card interaction
- Versioned protocol contracts and projections
- Card effect IR/runtime and coverage
- Replay/persistence/reconnect storage
