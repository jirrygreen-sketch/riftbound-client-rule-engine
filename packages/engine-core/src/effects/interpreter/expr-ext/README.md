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

The main `evaluateExpression` dispatcher now routes these expressions and the
designation aliases here. Recursive conditions and the interpreter's scoped
primitive context therefore use the same leaves. `condition.ts` also dispatches
the merged `relation` and `event-it` predicates. Unknown condition kinds raise
`MissingInformation`, including inside `not`; they cannot become permission by
negating a false fallback. Null printed costs retain their original values.

The existing `count(subject: "controller-xp")` spelling reads player XP, and
`self-in-combat` reads the current host's Attacker/Defender designation. These
are read aliases for existing authored IR, not new card programs.

## Event history

`bindEventHistory(context, pipeline)` binds timing-point queries to the live
authoritative event log. Game, turn and combat windows, event player, exact
zone-bound object references, excluded card identities and captured object
characteristics are evaluated without consulting current object collections.
Relative object-controller/owner filters use the resolving ability's captured
controller; a later control change does not change who "you" was in that
ability. Static callers instead create a fresh context for the current source.
Unknown historical filter fields fail closed. Action-only queries retain the
host's action journal; queries combining an action and a timing also remain
with that journal. The complete game event log is required.

The main count dispatcher recognizes these existing authored subjects:

| Subject | Authoritative timing |
| --- | --- |
| `cards-discarded-this-turn` | `card-discarded`, selected player |
| `cards-drawn-this-turn` | `card-drawn`, selected player |
| `controller-xp-gained-this-turn` | `xp-gained`, selected player |
| `units-died-this-turn` | `object-killed`, unit snapshot |
| `friendly-unit-or-gear-died-this-turn` | `object-killed`, friendly unit/gear snapshot |
| `moves-this-turn`, `self-moves-this-turn` | `object-moved`, exact selected object |

Unsupported historical/receipt/amount subjects raise `MissingInformation`.
In particular, `cards-finalized-this-turn` and `cards-played-this-turn` cannot
use the current `card-played` event: Chain emits it after resolution, whereas
CR 812.1.c refers to Finalize. `chain-item-finalize` includes both cards and
abilities and has no kind discriminator. Until the producer supplies a
trustworthy card-finalization fact, these subjects remain blocked rather than
counting resolved plays, all abilities, or the objects still on the Board.

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

## Remaining coordinator integration (outside EG-EXPR's write scope)

The default static binder's existing condition environment already reads its
current source through the current layer resolver, so designation conditions
now reach the main dispatcher automatically. That does not connect dynamic
layer scalar amounts or replace the production hosts' history methods.

The owning workstreams still need to:

1. Bind complete event history in resolving, triggering, replacement and static
   contexts (`chain/engine.ts`, `events/pipeline.ts`, `programs/statics.ts`,
   `replacement/bind.ts`, and the game-server runtime host). Use
   `bindEventHistory(baseContext, pipeline)` after binding the source and the
   correct captured/current controller. The game-server host currently returns
   zero for every history query. Do not infer event history from live sets.
2. Invoke layer expression resolution in each applicable layer with a current
   source/controller, the current layer's object resolver and query view. Do not
   materialize once at registration or cache solely by the modified object's
   identity. Player/zone/turn changes must invalidate dependent values. Keep
   object dependency and cyclic layer ordering in the existing layer engine.
   Normalize keyword grants' numeric values into the layer's `keywordValue`
   slot; its current single-keyword consumer reads that raw number rather than
   evaluating the typed `value: Expr` slot.
3. Recognize all merged Expr kinds in primitive argument validators and in
   `layers/rules/registration.ts:isExpression`. Some primitive schemas still
   accept the old list only, even though nested arithmetic and the scoped
   `ResolveContext.evaluate` now reach these leaves.
4. Contract request to EG-CONTRACT/EG-EVENTS/EG-FINALIZE: append a distinct
   `card-finalized` timing emitted once after a card finalizes successfully,
   carrying its captured source, player and pre-action characteristics. Emit
   neither for abilities nor failed/rolled-back finalization. This fits the
   existing HistoryQuery timingPoint/objectFilter/exclude read shape; no
   profile/schema or historical journal rewrite is needed. Paid-Energy/Power
   amount aggregation and source/phase-qualified historical facts still need
   separate reviewed query contracts; a count cannot represent these amounts.

The planning inventory lists `ogn/dangerous-duo` and `ogn/darius-trifarian` as
the two cards blocked only on EG-EXPR (plus EG-CONTRACT). Both specifically need
the truthful card-Finalize history above, so this scoped patch does not yet
unlock either whole program. Daring Poro, Stalwart Poro, Wily Newtfish and Raging
Soul have verified expression consumers here, while combat designation
production, granted-keyword expansion and movement consumers remain separate
gates. No whole-card executable promotion is claimed.

`test/engine-gaps/expr.test.mjs` executes the original Daring Poro and Stalwart
Poro IR through `runCardScenario` and the default lifecycle/binder, with declared
initial combat designations. The role producer remains a combat gap. Wily
Newtfish and Raging Soul retain their original abilities and use the default
program lifecycle/binder with an explicit real-event history host adapter.
These tests cover opponent-only history, prevention, resource spending,
recycling, control changes and Chain choice suspension/rollback. The test-only
registry changes admission metadata, never the original abilities or production
program status. All four production programs remain `judge-required`.

The existing layer helper tests demonstrate fresh materialization, not automatic
scalar integration or cache invalidation. Real `TurnFlow` tests traverse full
turns to verify global/per-player counts and historical window resets. No
replay profiles, schemas or old logs are changed by this module.

Potential beneficiaries confirmed in template reports: Draven, Showboat (points),
Forgotten Monument (per-player third turn), Petal Pixie (dynamic counts, still
needs keyword/relative filters), Repair Specialist and Ancient Warmonger
(dynamic keyword counts and combat designations), Taric, Protector; Needlessly
Large Yordle; Rengar, Pouncing (designation consumers). This module does not
change their programs, keyword expansion, costs, or executable status.
