# AGENTS.md
## Scope

- This file applies to the entire `riftbound-full-product` pnpm monorepo.
- Treat `b488d73` as the 2026-10-12 pause checkpoint, not as a permanent HEAD.
  Always re-check the current branch, commit, and dirty worktree before acting.
- Preserve every existing uncommitted change. Do not revert, delete, reset, or
  discard work unless the user explicitly requests that operation.
- The user resumed full-product development on 2026-10-12. Implementation and
  verification within the assigned scope are authorized. Commit, push, and
  release work still follow the user's actual request.

## Project Snapshot

- Branch: `codex/full-product`.
- Resume baseline: `8d3929d`, after foundation commit `b488d73`.
- That baseline contains the committed full-product experiments. It was clean
  when resumed; always inspect the actual current worktree before acting.
- The pnpm monorepo contains an authoritative game server, a standalone
  React/Vite + Tauri 2 desktop client, and shared protocol, rules, card-data,
  DSL, replay, judge, and integration-test packages.
- Official catalogs and images are gitignored and absent in a fresh checkout.
  Historical 1,381-printing coverage is not a current local-data observation.
  Do not claim that the official rules engine is complete.
- Rooms default to memory. Configuring `RIFTBOUND_STORAGE_DIRECTORY` enables
  the existing foundation/synthetic room store; durability claims require
  relevant restart and recovery verification.
- Current progress and remaining product gates are tracked in
  `docs/full-product/progress.md`; historical test numbers are not current passes.

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
- Follow the collaboration workflow explicitly requested by the user. When
  `claude-team` is invoked, delegate through its managed local Claude CLI
  runner. Do not replace those tasks with Codex subagents or new sidebar chats.
- Create visible Codex chats only when the user explicitly requests new chats.
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
- Explicitly invoked skill routing takes precedence over historical model
  preferences. `claude-team` uses `gpt-6-sol` with `xhigh` for critical engine,
  contract, and security work, and `deepseek-flash` for general tasks.
- If the requested model is unavailable, preserve the failure evidence and
  report it instead of silently selecting an unrelated model.
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
