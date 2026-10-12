# Desktop Client Agent Guide

## Scope

This package is the React/Tauri desktop client for Riftbound. Work here covers:

- The prompt-driven board, legal-action controls, target selection, reconnect
  state, command confirmation, errors, and match result UI.
- Projection and room-state rendering without inventing hidden or server-owned
  state.
- The six-zone deck builder, localized search, printing identity grouping,
  canonical copy limits, catalog loading, deck persistence, and deck validation
  UI.
- Client transport, adapters, hooks, components, styling, and desktop-client
  tests.

Keep changes inside `apps/desktop-client` unless the user explicitly authorizes
a wider scope. Shared protocol/contract changes, package exports, dependency
updates, integration, commits, and pushes are coordinated by the parent task.

## Current State

- `PlayableMatchBoard`, `PromptActionPanel`, `MatchStatusBar`, `commands.ts`, and
  `transport.ts` implement the full-product interaction model: server-derived
  legal actions, prompt options, target selection, command construction,
  read-only connection/pending states, command errors, concede, and match
  result display.
- `App` selects the playable board for the foundation/full-product ruleset and
  submits commands through `useGameClient`/`submitPlayerCommand`.
- `GameClient` provides versioned commands, idempotent retries, request results,
  session resume, reconnect, event cursors, and replacement-socket safety.
- The deck builder groups ordinary (`standard`) and alternate (`alternate`)
  printings under the server-owned `canonicalCardId`, stores deck entries with
  `DeckEntry.cardId`, and enforces the canonical copy pool across printings and
  the main/champion/sideboard zones.
- Localized search covers `localizedFullName`, `localizedAbility`, English
  fallbacks, identities, card numbers, set codes, types, domains, tags, and
  printing variant filters. `localizedFullName` and `localizedAbility` are
  optional server fields; code must fall back to `fullName` and `ability`.

## Real Gaps

- The full-product server adapter is not connected to the common public room
  path. The existing playable client components are ready to consume that
  contract, but production room creation/join/start still goes through the
  current public room flow rather than the full-product orchestrator.
- `App` does not currently pass server target options or target requirements
  into `buildPlayableMatchView`, so production target UI cannot yet rely on a
  complete server-derived target contract. Do not fabricate targets to make the
  UI appear complete.
- `useCardCatalog` computes `localValidation`, but `App` does not destructure or
  render it. Local pre-submission issues are therefore not visible to users.
- Local deck validation currently derives every canonical copy limit through a
  global main-deck limit of 3. This is wrong for zone-specific policy such as
  runes and battlefields and must be fixed to use server-owned zone policy.
- Recorded current status:
  - Desktop full-product tests: 37/37 passing.
  - Deck/catalog focused tests: 37/42 passing.
  - Full desktop package tests: 104/109 passing.
  - `typecheck` and `build` are blocked by existing errors in `DeckBuilder` and
    `App`.

Do not mark these gaps closed without the relevant focused tests and an
explicit statement of typecheck/build status.

## Work Rules

- Treat the server as authoritative. Consume only legal actions, prompt options,
  target options, projections, command receipts, and results supplied by the
  server. Never fabricate a command, derive hidden state, guess card rules, or
  optimistically mutate game state.
- Gate actions on connection state, command-pending state, prompt ownership,
  prompt state version, target validity, phase, priority, and server-provided
  playable instance IDs. Disable invalid actions and show the server or
  adapter's blocked reason.
- Preserve command identity and idempotency across retries and reconnects.
  Clear a pending command only from a matching result, a matching error, or an
  explicit disconnect.
- Preserve privacy and reconnect invariants: keep the last safe projection,
  resume with the stored session and cursors, accept only forward backfill, and
  prevent old sockets or timers from affecting a replacement connection.
- Use the existing printing data shape exactly. There is no `printingId` field:
  a printing identity is represented by `CatalogCard.id` and persisted in
  `DeckEntry.cardId`. Use "printing identity" conceptually when discussing
  variants, but do not invent a new field.
- Treat `localizedFullName` and `localizedAbility` as optional. Never require
  them or assume every catalog record contains localized text.
- Trust server canonical IDs, printing availability, allowed zones, and copy
  policy. Validate wire shapes before rendering. Local validation may improve
  feedback but must not replace server validation.
- Add focused tests for changed behavior. Useful commands are:

  ```bash
  pnpm --filter @riftbound/desktop-client test
  pnpm --filter @riftbound/desktop-client typecheck
  pnpm --filter @riftbound/desktop-client build
  ```

## Coordination

- For substantial multi-file development, create visible Codex workstream chats
  early, with bounded, disjoint write scopes. Reuse suitable existing chats
  rather than duplicating work.
- Prefer `deepseek-v4-flash` for delegated chats and subagents. If unavailable,
  use `ZHIPU/GLM-5.3` and record the fallback explicitly. Do not silently choose
  an unrelated model.
- Delegated chats may use the user's existing authorization for task-scoped
  execution. With `approval_policy: never`, do not request escalation or bypass
  platform restrictions.
- The parent task owns shared contracts, integration, commits, pushes, and
  conflict resolution. Delegated writers must not commit or push.
- A single-file documentation task does not require delegation.
