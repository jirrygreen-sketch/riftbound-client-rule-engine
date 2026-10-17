# RIFT-340 Point production parity

This note records the retirement evidence for the handwritten Point services:

- `apps/game-server/src/duel/point-effect-production-services-v1.ts`
- `apps/game-server/src/duel/point-spell-production-services-v1.ts`
  (the public entry that composes `p4-spell-services.ts`)

The comparison test is
`apps/game-server/tests/parity/point/point-parity.test.ts`. It drives the
new `ChainEngine`, effect primitives, target layer, cost layer, and the four
source-bound card programs. It does not mutate a frame, zone, resource, or
health value by hand.

## Legacy inventory

| Printing | Old service scenario | New-kernel result |
| --- | --- | --- |
| `ogs-003-024` Incinerate | 2 damage to one unit at a battlefield; base cost 2 Energy; nonlethal/lethal cleanup; stale target; pending payment retry | Covered: damage, target restriction, cost, Chain → Trash, lethal cleanup, and stale-target resolution. |
| `ogn-009-298` Hextech Ray | 3 damage to one unit at a battlefield; 1 Energy + 1 Fury Power | `test.todo`: the executable program carries a TargetSpec location shape that the target layer cannot consume as “any battlefield”. This is a shared target-contract/integration gap, not a reason to widen the target. |
| `ogn-085-298` Falling Comet | 6 damage to one unit at a battlefield; printed cost 5 Energy | Damage, target restriction, Chain → Trash, lethal cleanup, and stale-target semantics are covered. `test.todo` records that the executable program does not declare the printed 5-Energy cost, so fee parity is pending catalog-cost binding. |
| `ogs-022-024` Final Spark, Lux | 8 damage to one unit (base or battlefield); base cost 8 Energy | Covered: any-unit targeting, cost, Chain → Trash, and lethal cleanup. |

The old effect test also proved fail-closed source/closure validation and a
nonlethal versus lethal result. The new-kernel tests exercise the resulting
observable behavior rather than duplicating the old callback or proposal DTO.
The old spell test additionally covered native Hand → Chain entry, pending
resource payment, priority, effect resolution, and retirement. The new-kernel
retry test keeps the card on the Chain after an unpayable cost, adds Energy
through a real primitive, retries finalization, and checks the same final
observable state. Exact Rune Pool command/projection parity remains a
`test.todo`.

## Observable parity and rule basis

- A Point card is a targeted Deal. Target choice is made while finalizing the
  spell (CR v1.5 355.5, 355.7–355.9); “unit” means a Board object
  (355.9.a.1), and “at a battlefield” is a targeting restriction (355.9.b and
  355.10.b). The tests therefore reject a Base target for the battlefield-only
  cards and accept a Base target for Final Spark.
- A spell remains on the Chain through priority, resolves its rules text, and
  then goes to its owner's Trash (359.3–359.3.d). The test compares the ordered
  `object-enters-chain`, `chain-item-finalize`, `damage-dealt`,
  `chain-item-resolve`, and `object-enters-trash` timing points.
- If a target changes zone or no longer satisfies the restriction, it is
  illegal at resolution and the instruction is ignored; the spell still
  resolves and retires (359.3.e.1–359.3.e.9). The stale-target case moves the
  unit to Hand through the real primitive, observes no `damage-dealt`, and
  still observes spell retirement.
- Deal marks the specified positive integer Damage on each target, with the
  resolving spell as the source when no source is specified (418.1, 418.1.b,
  418.1.c, 418.1.e, 418.6.a). The card programs and test observations retain
  the printed 2/3/6/8 amounts; no `null` printed cost or Power is coerced to
  zero.
- Printed base cost is determined and paid during card finalization
  (204.1, 356.1.c, 357.1). Deflect is a mandatory additional Power cost and
  may use any Domain (356.2.a.2, 809.1.c–809.1.d). The remaining Deflect and
  native Rune Pool gaps stay explicit pending work.
- `[Action]` grants showdown permission without changing the effect itself
  (806.1–806.3). The focused parity cases run in main phase; showdown timing
  admission still belongs to the shared Chain timing work.

## Deletion preconditions

The handwritten services can be removed only when all of the following are
true:

1. All four printings resolve through source-bound programs and the target layer
   accepts their exact target shapes. The Hextech Ray location representation
   must be consumed without broadening “at a battlefield” into “any unit”.
2. Catalog printed costs are bound for every printing, including Falling Comet,
   while preserving `energy: null` and `power: null` as no printed cost.
3. The new Chain cost window supports the old native Rune Pool
   channel/fund/pay continuation, including insufficient-payment retry and the
   same public/private resource projections.
4. Deflect’s static target tax is discovered from the target permanent and
   appended as the mandatory any-Domain Power cost before finalization.
5. The parity suite has no Point `test.todo` items and checks nonlethal,
   lethal, stale-target, invalid-location, cost-retry, event-order, zone, and
   fee observations for every supported printing.
6. The game-server and integration-test package suites pass after the shared
   target, catalog-cost, Deflect, and Rune Pool adapters are integrated.

No protocol or contract file was changed by this work. The target-shape,
printed-cost, Deflect, and Rune Pool items above are contract/integration
change requests owned by the coordinating task.
