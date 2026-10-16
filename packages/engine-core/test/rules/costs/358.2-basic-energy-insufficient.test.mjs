// CR v1.5 358.2 / 358.5 / 166.2 — scenario costs-basic-energy-insufficient.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, unitDraft, printedCost, CostPlanError } from './harness.mjs';

test('costs-basic-energy-insufficient: Finalize rejects and rolls the play back', () => {
  const kernel = world()
    .player('A', { energy: 1 })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 2, power: [], might: 3 })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  assert.throws(
    () => engine.execute(unitDraft(kernel, 'unit', { cost: printedCost('cost:unit') })),
    error => error instanceof CostPlanError && error.reason === 'cannot-pay-cost'
  );

  assert.equal(kernel.player('A').energy, 1);
  assert.equal(kernel.player('A').handSize, 1);
  assert.equal(kernel.getObject('unit').zone, 'hand');
  assert.equal(engine.items.length, 0);
  assert.equal(engine.turnState, 'neutral-open');
});
