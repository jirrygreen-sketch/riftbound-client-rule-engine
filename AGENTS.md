# AGENTS.md
## Scope

- This file applies to the entire `riftbound-full-product` pnpm monorepo.
- Treat `b488d73` as the 2026-10-12 pause checkpoint, not as a permanent HEAD.
  Always re-check the current branch, commit, and dirty worktree before acting.
- Preserve every existing uncommitted change. Do not revert, delete, reset, or
  discard work unless the user explicitly requests that operation.
- As of 2026-10-12, development is paused for this documentation-only turn.
  Do not resume implementation, delegate implementation work, commit, push, or
  run long verification unless the user explicitly changes that instruction.

## Project Snapshot

- Branch: `codex/full-product`.
- Pause checkpoint: `b488d73` ("Build multiplayer full-product foundation").
- Worktree state: substantial uncommitted full-product implementation work is
  present across the desktop client, game server, and shared packages.
- The pnpm monorepo contains an authoritative game server, a standalone
  React/Vite + Tauri 2 desktop client, and shared protocol, rules, card-data,
  DSL, replay, judge, and integration-test packages.
- Card data contains 1,381 printings. Persisted effect coverage is currently
  0 executable, 1,348 `judge-required`, and 33 no-ability printings. Do not
  claim that the official rules engine is complete.
- The game server currently keeps rooms in memory. Restarting it can lose rooms
  and event history; do not claim durable room persistence.

## Responsibility Boundaries

- The parent/coordinating task owns shared contracts, dependency and lockfile
  updates, full-workspace integration and verification, commit/push/release
  coordination, and interface-mismatch resolution.
- `apps/game-server` owns authoritative game state, room and session handling,
  WebSocket command/event processing, hidden-information projections, deck
  validation, match orchestration, and HTTP catalog/image APIs.
- `apps/desktop-client` owns the React UI, local interaction state, transport
  adapters, and the Tauri desktop shell. Client state is a server projection
  plus temporary UI state; it must not become authoritative game state.
- `packages/protocol` owns wire contracts and versioning.
- `packages/engine-core` owns authoritative rules and engine semantics.
- `packages/card-data` owns versioned source data, generated catalogs, image
  manifests, and synchronization/audit scripts.
- `packages/card-dsl` owns effect definitions, IR, and runtime validation.
- `packages/replay-core` owns replay encoding, decoding, projections, and
  contracts.
- `packages/judge-tools` owns rulings, prompts, and judge workflow tooling.
- `packages/integration-tests` owns cross-package behavior and contracts.
- A workstream must not change files outside its explicitly assigned disjoint
  write scope. Shared-contract changes belong to the parent task.

## Engineering Rules
- Use Node.js `^22.12.0 || ^24.0.0 || >=26.0.0` and pnpm 11.9.0.
- Install with `pnpm install --frozen-lockfile`.
- Prefer scoped commands such as
  `pnpm --filter @riftbound/<package> <script>`.
- Use `pnpm typecheck`, `pnpm test`, and `pnpm build` for full verification.
- Match verification depth to risk: focused tests for focused changes and
  full-workspace verification before integration, commit, or push.
- Do not modify generated card-data outputs merely to make checks pass. Regenerate
  them only through their intended scripts when the task requires it.
- Official rules or effects without source evidence must remain `judge-required`
  or be explicitly marked `blocked`. Never invent plausible semantics or silently
  turn unsupported behavior into executable behavior.
- Never perform destructive Git operations, including `git reset --hard`,
  `git checkout --`, force pushes, or broad deletion/reversion commands.

## Parallel Development
- For substantial development, create visible Codex workstream chats in the
  sidebar as early as useful; do not wait for the parent task to exhaust its
  subagent capacity.
- Reuse an existing suitable visible chat and recover its actual state before
  creating a replacement, especially after interruption or context compaction.
  Create a new chat only when no suitable chat exists or reuse is unsafe.
- Give every workstream a bounded assignment and an explicit, disjoint file or
  module write scope. Avoid overlapping ownership between chats.
- Every workstream's initial instructions must include:
  - its assigned write scope;
  - authorization to execute work in that scope without routine confirmation;
  - this collaboration policy, including parent-owned integration and commits;
  - the required model preference and fallback described below;
  - permission to delegate useful bounded subtasks to its own subagents.
- Workstream sub-delegation must remain bounded. Do not create unbounded
  delegation trees or try to bypass platform, tool, or permission limits.
- Keep visible workstream chats available in the sidebar while the parent task
  is active. Do not archive or hide them unless the user explicitly asks.
- Report each visible chat's actual title, assigned scope, and confirmed status
  or outcome. Do not claim parallel work, chat creation, or model selection
  without a successful tool result.
- The parent task collects and reviews workstream results, resolves mismatches,
  verifies the integrated result, and owns commits and pushes.

## Model Selection
- Prefer `deepseek-v4-flash` for delegated chats and subagents.
- If that exact model is unavailable, use configured `ZHIPU/GLM-5.3`; its
  availability is confirmed.
- If neither configured model is available, report the unavailability instead of
  silently selecting an unrelated model.
- Only report a selected model or active chat after the corresponding creation
  or delegation tool call succeeds.

## Approvals
- The user authorizes ordinary project work, reversible edits, local
  verification, and already-coordinated integration within the assigned scope
  without repeated routine confirmation.
- When `approval_policy` is `never`, do not request escalation or permission
  prompts and do not claim approval that was not granted.
- Do not approve on the user's behalf or attempt to bypass a platform refusal.
  Report the actual block and use an available authorized alternative.
