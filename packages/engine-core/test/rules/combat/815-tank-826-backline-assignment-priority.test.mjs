// Scenarios blocked on the combat-damage assignment priority requirements
// (CR v1.5 467.2.c.6, 467.2.c.7, 467.2.c.8, 467.2.c.9, 815, 815.1, 815.1.b,
//  815.1.c.1, 815.1.c.2, 826, 826.3, 826.4, 826.4.a, 826.4.b):
//   combat-tank-forces-first-assignment
//   combat-negative-bypass-tank-assignment
//   combat-two-tanks-free-order-among-same-priority
//   combat-tank-plus-backline-conflict-choose-one
//
// The merged Tank / Backline keywords already expand to the declarative
// `continuous.combat` static effect (src/effects/keywords/Tank.ts, Backline.ts) and
// the assignment kernel exposes the matching proof flag
// (`DuelBaseCombatSourceEffectProof.keywordPriority === "proven-none"`). What is
// missing is the consumer: no layer branch reads `continuous.combat`
// (src/layers/ops/index.ts persists it as an opaque continuous effect), so the
// kernel can only be told that no assignment priority exists.
import test from 'node:test';

test.todo(
  'combat-tank-forces-first-assignment (467.2.c.6 / 815.1.b): damage must be assigned first to the Tank '
  + 'Unit, then to a Unit without the ability, then to the Backline Unit. Missing: a layer/query consumer '
  + 'for the `continuous.combat` effect kind that Tank and Backline expand to — the assignment kernel '
  + 'requires keywordPriority "proven-none" and has no per-Unit priority basis, so a scene with Tank on '
  + '#d1 and Backline on #d3 cannot be built without inventing the priority order',
);

test.todo(
  'combat-negative-bypass-tank-assignment (467.2.c.6 / 815.1.b): assigning damage to a Unit without Tank '
  + 'while a Tank Unit could still take lethal must be refused. Missing: the same `continuous.combat` '
  + 'consumer; the negative case cannot be distinguished from a plain "no requirement exists" state '
  + 'until the requirement is readable from the layers',
);

test.todo(
  'combat-two-tanks-free-order-among-same-priority (467.2.c.7 / 815.1.c.2): several Tank Units at the same '
  + 'priority may be assigned in any order, but all before the Units without Tank. Missing: the same '
  + '`continuous.combat` consumer plus a same-priority grouping concept in the assignment kernel',
);

test.todo(
  'combat-tank-plus-backline-conflict-choose-one (467.2.c.8): a Unit carrying both Tank and Backline lets '
  + 'the assigning player honour exactly one of the two exclusionary requirements. Missing: the same '
  + '`continuous.combat` consumer plus an exclusionary-requirement resolution step (467.2.c.8 / 467.2.c.9) '
  + 'above the per-Unit priority basis',
);
