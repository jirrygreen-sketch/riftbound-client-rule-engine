# Full Product Card Effect Runtime

This directory provides an independent EffectIR and runtime skeleton for
full-product cards. It does not replace the existing synthetic-demo DSL and is
not a complete card implementation.

## Boundary

The runtime never guesses official card semantics. It executes only the
explicit opcodes below. Unknown or ambiguous card text compiles to
`judgeRequired`, and runtime effects marked as `judge.required` are blocked.

## EffectIR

Each card effect is represented as:

```json
{
  "kind": "full-product-effect-ir",
  "schemaVersion": 1,
  "ruleset": "full-product",
  "id": "card.sample",
  "body": []
}
```

`body` contains `effect`, `target`, or `trigger` nodes. `trigger` nodes
describe the event and contain nested effects, but they do not automatically
resolve or schedule anything.

## Supported opcodes

- `cost.energy` with `{ amount }`
- `draw.cards` with `{ count }`
- `gain.energy` with `{ amount }`
- `gain.score` with `{ amount }`
- `move.zone` with `{ zone: "discard" }`
- `prompt.target` with `{ prompt }` and a target reference
- `chain.create` with `{ count }`
- `judge.required` with `{ reason }`

`chain.create` appends synthetic chain identifiers. It does not resolve chain
semantics, chain cards, or chain outcomes.

## Runtime

The runtime is pure: it receives an explicit state and options, returns a new
state and event list, and never mutates the input state. Failures, blockages,
and target prompts do not partially commit changes.

The runtime expects:

```json
{
  "schemaVersion": 1,
  "players": [
    {
      "playerId": "player.self",
      "energy": 0,
      "score": 0,
      "deck": [],
      "hand": [],
      "discard": [],
      "chain": []
    }
  ],
  "objects": {
    "instance.source": {
      "objectId": "instance.source",
      "ownerPlayerId": "player.self",
      "zone": "hand"
    }
  }
}
```

When `prompt.target` has no selection, the runtime returns
`awaitingPrompt` and stores the remaining node IDs in `state.pending`. After
the caller supplies a selection, `resumeFullProductEffectAfterPrompt` resumes
execution at the first remaining node.

## Card registration

The parent task can create a registry and register each card's IR:

```js
const registry = createFullProductEffectRegistry();
registry.registerCardEffect(cardId, ir);
const result = executeFullProductEffect(ir, runtimeState, {
  sourcePlayerId: activePlayerId,
  sourceObjectId: resolvingObjectId
});
```

The registry only accepts validated EffectIR documents and rejects duplicate
or mismatched registrations. The parent task remains responsible for
mapping card IDs to IRs, calling the runtime, and adapting its state shape.

Package exports remain unchanged. Until the parent task deliberately changes
them, callers can import the compiled module directly:

```js
import {
  createFullProductEffectRegistry,
  executeFullProductEffect
} from "@riftbound/card-dsl/dist/full-product/index.js";
```

## Unsupported boundaries

- Card text beyond the explicitly whitelisted sentences.
- Trigger timing, frequency, and automatic resolution.
- Target legality beyond count and existence checks.
- Zone moves other than to `discard`.
- Chain resolution and actual chain card creation.
- Official damage, conditions, keywords, counters, costs, and timing rules.
- Any effect requiring authoritative official text review.

These remain `judge.required`.
