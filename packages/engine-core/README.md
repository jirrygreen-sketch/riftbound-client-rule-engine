# engine-core

`engine-core` is the authoritative, pure-function game-state package for two
distinct rulesets:

- `synthetic-demo` is the legacy compatibility path used by the original
  synthetic Trigger Conquer demo.
- `riftbound-foundation` is a deliberately narrow, playable vertical slice. It
  is not a complete implementation of the official Riftbound rules.

## Public API

- `createInitialGame(options)` creates the synthetic demo game.
- `createConfiguredGame(options)` creates either ruleset. The default ruleset
  is `riftbound-foundation`.
- `submitCommand(state, command)` returns a new state and the events emitted
  by that command, or the original state plus an error.
- `projectGame(state, viewerPlayerId)` produces a protocol projection.
- `projectZones(state, playerId)` and `projectObject(state, objectId)` are
  engine-level helpers; they are not viewer-safe projections.
- `getHotFeprStep(state)` reports the next HOT FEPR step for server
  orchestration.
- `createRoomSnapshot(state, roomId, viewerPlayerId)` provides the current
  placeholder snapshot used by existing integration code.

## Foundation model

Foundation models two players with unique game-object identity and these zones:
`deck`, `hand`, `board`, `base`, `battlefield`, `champion`, `legend`, `rune`,
`rune-deck`,
`discard`, `banish`, and `chain`.

Foundation resources are `score`, `energy`, and `power`. The default target
score is 8, not the synthetic 20-point life model. `damage` adds damage to a
targeted game object; it does not subtract score. These resources and the
victory rule form a finite playable model, not a claim of full official
resource semantics. Reaching `targetPoints` as the sole leader at a task-free
checkpoint ends the game.

Units enter `board`. Battlefields, champions, legends, and public runes enter
their respective zones. The opening rune deck is supplied as `runeDeck` and
uses the private `rune-deck` zone; it is separate from the public `rune`
battle zone. Spells enter `chain` while resolving and move to `discard`
after resolution.

## Effects and prompts

Configured cards may use three bounded effect kinds:

- `damage` targets a selected game object.
- `gain-points` increases a player's score.
- `judge-required` blocks progression until an authoritative ruling is applied.

Effects with fixed definition targets resolve automatically. Effects that need
target selection create a prompt with `target:object:<objectId>` options. A
player pressing the judge-required prompt option does not apply a ruling; the
command returns `judge_required` and leaves the spell in `chain`.

## Projection

Foundation projections use protocol projection v1. They include
`rulesetId`, `priority`, public `objects`, and per-player `score`, `energy`,
`power`, `zoneCounts`, and `playableInstanceIds`. They expose the viewer's
hand and only public zones; `rune` is public while deck and rune-deck
identities are not exposed.

Synthetic projections keep the legacy wire shape with `life` and `mana`.

## Current limits

This slice intentionally does not implement official combat or showdown,
battlefield capacity enforcement, champion and legend restrictions, rune-deck
draw/channel mechanics, death or destruction cleanup, replacement or
simultaneous effects, official card-text parsing, or authoritative judge
rulings. Unknown card text must be represented by a `judge-required` effect
rather than inferred behavior.
