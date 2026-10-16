# replacement (RIFT-260)

Card-program replacement binding for the event pipeline (RIFT-120). This
module is the registration path card DSL kind-replacement abilities were
waiting for: it turns a card replaces pattern and its with instruction body
into a ReplacementRegistration on the event pipeline, and plans the body
into closed GameActions without executing them.

## Public interface (consumed by the RIFT-257 programs layer)

```ts
import { bindReplacement } from "<engine-core>/replacement/index.js";

const bound = bindReplacement(
  ability,   // ReplacementAbilityInput: { replaces, with, condition? }
  hostRef,   // ObjectRef of the ability host object
  deps       // { host: ReplacementHostAdapter, pipeline: ReplacementPipelineAdapter }
);
bound.cancel(); // stops matching; pipeline removal is used when available
```

- `ability` is contract 3.1 `{ kind: "replacement", replaces: EventPattern,
  with: Instruction[], condition?: Condition }`.
- `deps.host` supplies `object(ref)`, `objects()`, and an ability-scoped
  full `ResolveContext` from `context(source, controller)` (the test kernel
  satisfies this directly).
- `deps.pipeline` supplies `clock.turn` and
  `registerReplacement(registration)`; `unregisterReplacement(id)` is
  optional (RIFT-120 pipelines without removal keep a local cancelled flag).
- The host may live in any zone at bind time (CR 370.3/370.4: replacement
  effects are evaluated from their active zone, including secret zones), so
  registrations stay active across all zones.

## Declared forms in `ability.with`

1. Static replacement (Accelerate, RIFT-257 card programs): no wrapper op.
   `ability.replaces` is the EventPattern and `ability.with` is planned
   directly as the replacement body.
2. `replacement.enter` with `state`: entry-orientation replacement
   (CR 369.3, 805.6). Matches the entry move of the bound permanent; a
   static Accelerate-style body (exactly one self-targeted
   `effect.ready`/`effect.exhaust` for `object-enters-board`) is bound as
   this declaration form. The resolver's chain-zone entry-state action
   lands first; this replacement then applies the declared orientation to
   the chain-zone permanent and lets the move carry it, so no separate
   becomes-ready/exhausted timing happens on Board. Entry filters describe
   the replaced event (CR 370.1.b), so `{ self: true, exhausted: true }`
   replaces only the default exhausted entry.
3. `replacement.event` with `event` (EventPattern constant), optional
   `window` (`"next-time-this-turn"` is one-shot per bound turn; cross-turn
   reuse is never re-armed), optional `optional`, and `instead`
   (instruction body). The body is planned at apply time; an empty planned
   body prevents the event.

## Semantics (Core Rules v1.5)

- Event matching (CR 370.1): `object-enters-board` matches move-zone to
  base/battlefield and reads the post-move orientation (filters on the
  entering state describe the replaced event); `object-killed` kill;
  `object-readied`/`object-exhausted` ready/exhaust on board (chain-zone
  orientation belongs to the entry path); `damage`, `score`,
  `card-played`, `card-revealed`. Unknown event kinds never match.
  Damage patterns are anchored to the affected player (CR 372.1: the player
  being acted on chooses), so "damage would be dealt to me/opponent" binds
  even when no object snapshot exists.
- Chooser (CR 372): the pipeline picks the affected object's controller;
  this layer only supplies registrations.
- Once per event (CR 370.2): the pipeline applied-set enforces one
  application per event chain, and this layer marks its declaration
  consumed on apply, so a rewritten action never re-triggers it.
- Conditions (CR 371.1 context): the ability condition is evaluated in the
  host's ability context at match time; per-instruction conditions gate
  single planned instructions.
- The replaced event object is available to the body as
  `{ linked: "replacement.object" }` (CR 355.10.c "it"); it is a plan-time
  binding and does not become a target.

## Supported planned opcodes

effect.ready, effect.exhaust, effect.move (mode recall is blocked, CR
457-460), effect.zone, effect.damage, effect.draw, effect.heal,
effect.resources, effect.buff (add/spend), effect.counter (adds a named
counter to an object; CR 702 Buff markers keep using effect.buff). Object
selectors accept self/source (the host) and
`{ linked: "replacement.object" }` (the replaced event object) plus the
runtime `{ target: id }` spelling. Everything else throws
BlockedReplacementError at bind time; callers surface that as
judge-required evidence instead of approximating.

## Known gaps (not approximated here)

- cost-payment replacement has no GameAction to intercept; it stays
  judge-required until the cost pipeline exposes it.
- combat-result replacement has no merged combat event; it stays
  judge-required.
- A bind-time id collision (same id registered twice) throws from the
  pipeline; re-binding the same incarnation requires cancelling first.
