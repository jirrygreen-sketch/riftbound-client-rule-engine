// CR v1.5 163.2 / 358.2 — scenario costs-basic-power-wrong-domain.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, spellDraft, printedCost, CostPlanError } from './harness.mjs';

test('costs-basic-power-wrong-domain: Fury Power cannot pay a Calm requirement', () => {
  const kernel = world()
    .player('A', { energy: 0, power: ['Fury'] })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 0, power: ['Calm'] })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  assert.throws(
    () => engine.execute(spellDraft(kernel, 'spell', { cost: printedCost('cost:spell') })),
    error => error instanceof CostPlanError && error.reason === 'cannot-pay-cost'
  );

  assert.deepEqual(kernel.player('A').power, ['Fury']);
  assert.equal(kernel.player('A').handSize, 1);
  assert.equal(kernel.getObject('spell').zone, 'hand');
  assert.equal(engine.items.length, 0);
});
