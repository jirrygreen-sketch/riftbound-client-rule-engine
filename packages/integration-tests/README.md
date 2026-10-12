# Integration tests

These tests exercise the real `@riftbound/protocol`, `@riftbound/engine-core`,
and `apps/game-server` source through the aliases in `vitest.config.ts`. They
do not stub or skip an upstream contract; an unresolved load or contract
failure is a test failure.

Run:

```sh
pnpm --filter @riftbound/integration-tests typecheck
pnpm --filter @riftbound/integration-tests test
```

## Ruleset boundaries

The suite deliberately keeps two rulesets distinct:

- `synthetic-demo` is the only path that uses the legacy optional projection
  fields `life` and `mana`. Its engine tests exercise the automatic
  `trigger-conquer` prompt, transactional answer and skip behavior, prompt-owner
  privacy, command rejection, and replayable ordered events. The WebSocket
  synthetic suite explicitly sends this ruleset in `create-room`.
- `riftbound-foundation` is the deck-based ruleset used by room readiness and
  the main multiplayer flow. It must start from both players' submitted decks,
  use Foundation projection schema v1, expose `score`, `energy`, `power`,
  `zoneCounts`, `playableInstanceIds`, and safe public objects, and must not
  emit synthetic `life` and `mana` fields.

`protocol.validator.test.ts` checks that the two projection shapes are not
interchangeable: synthetic projections require `life` and `mana` and reject
Foundation extensions; Foundation projections require the Foundation extension
set and reject legacy `life` and `mana`. The validator must also reject a
projection that leaks an opponent hand and reject a pending prompt whose owner
does not match `waitingForPlayerId`.

## Real multiplayer slice

`multiplayer-flow.integration.test.ts` starts a real WebSocket server on an
ephemeral port and exercises the shared 0.2.0 protocol:

- create room, join room, room metadata (`version`, `roomVersion`,
  `roomEventSeq`, `ready`, and `deckSubmitted`)
- ready gating on submitted decks and automatic start only after both seats are
  ready
- canonical-card copy pools shared across alternate printings and deck zones
- room and game version conflicts
- resume-token reconnect with game and room event replay
- command-id idempotent replay and `idempotency-conflict`
- active-connection replacement and `session-replaced` rejection of the old
  socket
- deck resubmission clearing that player's ready state
- owner-only hand and prompt projections
- prompt authorization and result propagation
- `sync-events` replay that removes another player's prompt events while
  preserving the owner's prompt events and public prompt outcomes
- Foundation start from the submitted printing IDs, including the concrete
  `integration.flame-warden.standard` card in its owner's opening hand

Room mutations are versioned independently of game commands. Successful
`submit-deck` and `set-ready` receipts return the next `roomVersion`; the next
mutation must use that value. Game commands use `expectedVersion` separately.

## Current integration status

The suite currently reports 34 tests, with 27 passing and 7 failures. The
failures are intentional discriminating assertions around the following current
gaps; they are not hidden by constructing engine state directly or by weakening
protocol validation.

- `isGameProjection` accepts a Foundation projection that leaks another
  player's hand. The privacy assertion stays red until the protocol validator
  has enough viewer information to enforce owner visibility.
- `isGameProjection` accepts a pending prompt whose owner differs from
  `waitingForPlayerId`.
- Foundation `turn-started` events are emitted without the Foundation `energy`
  field required by protocol 0.2.0. As a result, even structurally complete
  Foundation room projections are rejected as invalid server messages.
- The Foundation room adapter starts with both players' hands empty and all
  submitted instances in their decks. The room test therefore cannot observe
  the required concrete `integration.flame-warden.standard` printing in the
  owner's opening hand.
- When two clients join a `synthetic-demo` room, the server starts the game
  and sends a projection only to the joiner's socket. The first player never
  receives the initial projection, which currently blocks the prompt-privacy
  and replay-privacy room tests.

The synthetic engine, synthetic WebSocket, card catalog, canonical copy-pool,
ready-gating, deck-resubmission, and `sync-events` prompt-filter cases are
currently passing.

## Historical gaps now resolved

Earlier fixture failures around `points` state drift, missing room-view
metadata, readiness response, and `visibleFoundationObjects` scope have been
resolved. The suite now uses `points` for synthetic internal assertions,
checks room `version`/`roomVersion`/`roomEventSeq` metadata, verifies that deck
resubmission clears readiness, and keeps synthetic prompt behavior explicitly
on the `synthetic-demo` path.
