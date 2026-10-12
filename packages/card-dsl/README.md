# @riftbound/card-dsl

`@riftbound/card-dsl` is a dependency-free, synthetic-demo data language for
describing automatic triggers and strategy prompts. It is an AST package only:
it validates, normalizes, serializes, and hashes data. It does not implement a
game engine and does not contain Riftbound, Yu-Gi-Oh!, or other official card
text.

The `ruleset` field is intentionally fixed to `synthetic-demo`. The host engine
owns all event matching, target selection, prompt delivery, and effect
execution semantics.

## AST

Every object is strict. Unknown fields are rejected. The supported node set is:

- `effect`: A host-defined operation and JSON arguments. An optional `targetId`
  references a target placeholder in the same document.
- `trigger`: A host-defined event name, optional JSON filter, and child body.
- `choice`: A strategy prompt with two or more options and an optional default.
- `optional`: A strategy prompt with resolve and decline bodies.
- `auto-resolve`: An explicit declaration that the host may resolve the child
  body without asking for a decision.
- `target`: A placeholder slot with a symbolic name and a count range.

The AST deliberately has no link, chain, priority, or pass-order node. Those
concepts are not implied by this DSL and must not be inferred from another
game's rules.

## EffectIR

`EffectIR` is a strict, executable subset of the DSL. Every operation is an
explicit opcode with an argument schema. The current verified opcode set is:

- `draw.cards`: draw an explicit number of cards.
- `damage.target`: deal explicit damage to a selected target.
- `gain.energy`: grant explicit energy to `self` or `opponent`.
- `summon.self`: put this card onto an engine-defined summon surface.

Use `validateEffectIr` for untrusted input and `compileEffectText` for
conservative text compilation. The compiler intentionally recognizes only a
small list of fully verified basic sentences. Unknown, complex, or empty text
returns `judgeRequired`; it is never guessed into an opcode.

## Example

```json
{
  "kind": "card-dsl",
  "schemaVersion": 1,
  "ruleset": "synthetic-demo",
  "id": "demo.signal-beacon",
  "body": [
    {
      "type": "target",
      "id": "demo.target.opponent",
      "placeholder": "opponent-target",
      "minCount": 1,
      "maxCount": 1
    },
    {
      "type": "trigger",
      "id": "demo.trigger.arrival",
      "event": "demo.zone-entered",
      "filter": { "controller": "self" },
      "body": [
        {
          "type": "optional",
          "id": "demo.optional.signal",
          "prompt": "Resolve the demo signal?",
          "body": [
            {
              "type": "effect",
              "id": "demo.effect.pulse",
              "operation": "demo.adjust-counter",
              "arguments": { "counter": "pulse", "amount": 1 },
              "targetId": "demo.target.opponent"
            }
          ],
          "decline": [
            {
              "type": "auto-resolve",
              "id": "demo.auto.decline",
              "body": [
                {
                  "type": "effect",
                  "id": "demo.effect.note",
                  "operation": "demo.record-note",
                  "arguments": { "note": "declined" }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

## API

```ts
import {
  parseCardDsl,
  serializeCardDsl,
  stableHashCardDsl,
  validateCardDsl
} from "@riftbound/card-dsl";

const result = validateCardDsl(input);
if (result.ok) {
  const normalized = serializeCardDsl(input);
  const hash = stableHashCardDsl(input);
}

const document = parseCardDsl(input);
```

`serializeCardDsl` emits compact JSON with recursively sorted object keys and
preserves array order. `stableHashCardDsl` hashes those UTF-8 bytes with a
pure JavaScript FNV-1a 64-bit implementation, so the value is stable across
Node.js and browser runtimes.

## Development

```sh
pnpm --filter @riftbound/card-dsl typecheck
pnpm --filter @riftbound/card-dsl build
pnpm --filter @riftbound/card-dsl test
```
