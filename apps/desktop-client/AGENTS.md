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
- `App` has three top-level entries (`deck-builder` / `room` / `game-table`):
  the room page hosts `RoomDeckPicker` (current deck, named deck library,
  submit/ready gating) and `ConnectionPanel`, while the game-table entry selects
  the playable board for the foundation/full-product ruleset and submits
  commands through `useGameClient`/`submitPlayerCommand`.
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
  path. The playable client components already consume the server's
  `actionOptions` contract, but production room creation/join/start still goes
  through the current public room flow rather than the full-product
  orchestrator.
- The UI base classes exist and consume server `actionOptions`. The coordinator
  has since run a **real two-independent-browser-client Foundation-room room/deck
  GUI on one host** (client A on `:4173` + client B on `:4174` against one `:8793`
  server; 13 room/deck checks + 5 service-address checks,
  `outputs/coordination/full-product-20261012/gui-room-proof/`). This verifies
  **only the same-host two-client Foundation room/deck GUI** — it is **not an
  official Duel**, and **no full official Duel match and no dual-Tauri
  acceptance** has been run. Do not present the component-level SSR tests (or
  this same-host two-client GUI) as an official Duel or a dual-Tauri run.
- The room page (three-entry `AppTab`: `deck-builder` / `room` / `game-table`)
  plus the named deck library, the real room deck selector, `requestId` +
  session/socket tracking, and the room submit/ready gating were added by
  `real-room-deck-ui` and refined by the confirmation-witness fix and the
  connection-address restoration fix (desktop tests currently **210** across 19
  files + typecheck + build).
- `SharedBattlefields` groups on-board units by the current
  `object.controllerId` (owner kept only as a data attribute) and gates on an
  explicit on-board zone whitelist (`board`/`base`/`battlefield`, still requiring
  `faceUp`); hand/deck/rune-deck never leak even when face-up, and
  discard/legend/champion/rune/banish/chain degrade to `MISSING_UNIT_NOTICE`
  (isolated snapshot: 13 scoped tests). The `shared-battlefields-tabletop-layout`
  task added the top opponent base / two central fields / bottom self base layout
  (`resolveBasePlacement` resolves bands from `ownerPlayerId`, not `board.bases`
  order; spectator uses a stable seat order and fails closed), +3 cases. It is
  **not yet wired into `App`'s formal Duel component**.
- `ConnectionPanel` received an optional, read-only `activeServerUrl` prop and
  pure helpers (`initialConnectionServerUrl`, `backgroundServerUrlUpdate`);
  `GameClient` exposes a read-only `activeServerUrl` getter (the current/recent
  normalized URL, no credentials) surfaced through `useGameClient`. A late-mounted
  panel now shows the real connected URL instead of the `8787` default, and a
  background status change never overwrites a user-edited address. No deck
  confirmation logic was touched.
- `useCardCatalog` no longer exposes a `localValidation` field, and `App` never
  rendered one. The hook instead offers `setDeckFromSnapshot` (atomic six-zone
  load), and every edit (including a load) clears the previous validation result;
  async validation is discarded if the deck fingerprint or server URL changed.
  Server validation is still the only authoritative pre-submission check.
- Local deck limits now use zone-specific policy: `limitFor` returns
  runes `12`, battlefields `1`, legend `1`, and `3` for other zones (still capped
  by server `maxCopies`). This is no longer a global main-deck limit of 3.
- Current round status (real, current worktree):
  - Desktop package tests: **210 passing** across 19 files
    (`pnpm --filter @riftbound/desktop-client test`) + `typecheck` exit 0 +
    `build` exit 0 (fresh dist `dist/assets/index-Bx6ry0KG.js`), from actual
    logs (not the older 163/165/195 snapshots). The confirmation-witness fix
    (`room-deck-confirmation-witness-fix`) contributed 23 of these: a
    `set-ready` receipt that arrives without `roomVersion`, or on failure /
    disconnect, can no longer complete a deck switch (`evaluateDeckSwitch`
    requires a matching receipt + context + version catchup). The
    connection-address restoration fix contributed 12 more (GameClient 4,
    ConnectionPanel 8). **A GUI run and a `pnpm build` have now been performed**
    (the earlier "no GUI run / no `pnpm build`" statement is obsolete).
  - The former `room-deck-receipt-core` (wave-27) task was **cancelled by the
    coordinator**; its source is retained and the `GameClientAPI` core is already
    partial. The coordinator has now exercised the **Foundation-room room/deck
    real GUI** (13 + 5 checks, `gui-room-proof/`) — this proves the same-host
    two-client Foundation room/deck GUI only, **not** an official Duel, a full
    match, or a dual-Tauri run.
  - Historical (obsolete) numbers 37/37, 37/42, 104/109, 117, 163 and 165 and a
    typecheck/build-blocked state are **not** current.

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

- For substantial multi-file development, use the current user-specified
  `claude-team` local CLI executors with bounded, disjoint write scopes. Do not
  open new sidebar chats and do not spawn nested agents/CLIs.
- Delegation model guidance: `gpt6sol` (xhigh) for critical reasoning work, the
  DeepSeek flash model for routine/general work. The historical
  `deepseek-v4-flash` / `ZHIPU/GLM-5.3` guidance is obsolete.
- Delegated work uses the user's existing authorization for task-scoped
  execution. With `approval_policy: never`, do not request escalation or bypass
  platform restrictions.
- The parent task owns shared contracts, integration, commits, pushes, and
  conflict resolution. Delegated writers must not commit or push.
- A single-file documentation task does not require delegation.
