# Player state expressions

`evaluateExtendedExpression(expr, environment)` is a read-only extension of the
existing interpreter evaluator. It uses only `ResolveContext` read methods and
the interpreter's existing identity/look-back policies. Arithmetic recurses
through this evaluator, and existing expression kinds retain their semantics.

| Expression | Read |
| --- | --- |
| `player-property` | `player(selector)` for points (`score`), energy, XP and hand/deck/rune-deck sizes; `zoneSlice(player, "trash", "top")` for trash size |
| `turn-number` | `history({ scope: "game", timingPoint: "turn-start" })` |
| `player-turn-count` | The same history query with the selected player |
| `object-designation` | The selected snapshot's `combatRole`, defaulting to null as specified by `ObjectSnapshot` |

`player` defaults to the ability controller. Explicit selectors are `controller`,
`{ id }`, `{ controllerOf: ObjectSelector }`, `{ ownerOf: ObjectSelector }` and
`{ pick }`. Object/player picks must select exactly one identity. Unknown players,
stale references, ignored targets and unavailable facts fail closed. Opponents
are never guessed from the objects currently present in the game. A static
effect that refers to "your points" should select `{ controllerOf: "self" }`
so that a control change is reflected when read again.

Both existing `object-property`/`object-attribute` spellings of `designation` read
`combatRole` through this evaluator. The designation is supplied by the rules
authority (CR v1.5 466.2.c.3, 807.1.d, 814.1.d); this module does not infer it
from location or exhaustion, or produce combat designations itself.

`bindTurnHistory(context, pipeline)` supplies the turn queries from the real
event pipeline using the existing `ResolveContext.history` interface. It reads
the pipeline each time, so rollback and subsequent turns do not leave stale
counts. The pipeline must retain the complete game history from the first
`turn-start`. Counts include the current turn once it has begun and are zero
before it begins. They are not derived by dividing a global turn number by the
number of players. The driver tests traverse full actual turns (CR 301–306).

`resolveLayerEffectExpressions(effect, environment)` resolves the scalar slots
`amount`, `value`, `delta` and `keywordValue` at the time it is called (CR 478.1).
It returns a new effect, retains the original expression IR and never caches a
value. The typed `value: Expr` slot becomes a constant expression; the other
slots become their resolved values. Literal payloads stay literal, including
expression-shaped records and null printed characteristics. Layer ordering,
dependencies, timestamps, durations and invalidation remain with `layers/`.

## Integration boundary

The assigned write scope excludes `interpreter/expr.ts`, `programs/statics.ts`,
`layers/engine.ts`, `layers/rules/registration.ts`, the context adapters and the
frozen P0 contract. The default interpreter and static binder therefore do not
dispatch these extensions yet. This is scoped implementation for coordinator
integration, not evidence that any blocked card has become executable.

The coordinator needs to:

1. Route the four new kinds and the existing `designation` property spellings
   through this evaluator in the main expression dispatch, including conditions
   and primitive-facing `ResolveContext.evaluate` implementations.
2. Supply complete turn-start history, for example with `bindTurnHistory`, in
   the actual resolving/static environments. Existing action-only history
   adapters do not report these rule timings.
3. Invoke layer expression resolution in each applicable layer with a current
   source/controller, the current layer's object resolver and query view. Do not
   materialize once at registration or cache solely by the modified object's
   identity. Player/zone/turn changes must invalidate dependent values. Keep
   object dependency and cyclic layer ordering in the existing layer engine.
   Normalize keyword grants' numeric values into the layer's `keywordValue`
   slot; its current single-keyword consumer reads that raw number rather than
   evaluating the typed `value: Expr` slot.
4. Recognize the new kinds in `layers/rules/registration.ts:isExpression` and
   append the IR revision from `card-dsl/src/ir/REVISIONS.md` to the parent-owned
   P0 contract record.

The layer tests feed freshly materialized effects into the real `LayerEngine`
after committed game actions; they demonstrate this helper's re-evaluation, not
automatic integration of the default binder or its persistent cache. The turn
tests use the real `TurnFlow` and pipeline. All affected cards remain
`judge-required` pending their other dependencies.

Potential beneficiaries confirmed in template reports: Draven, Showboat (points),
Forgotten Monument (per-player third turn), Petal Pixie (dynamic counts, still
needs keyword/relative filters), Repair Specialist and Ancient Warmonger
(dynamic keyword counts and combat designations), Taric, Protector; Needlessly
Large Yordle; Rengar, Pouncing (designation consumers). This module does not
change their programs, keyword expansion, costs, or executable status.
