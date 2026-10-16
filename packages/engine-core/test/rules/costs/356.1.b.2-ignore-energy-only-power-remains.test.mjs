// CR v1.5 356.1.b.2 — scenario costs-ignore-energy-only-power-remains.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, payCostPlan } from './harness.mjs';

test('costs-ignore-energy-only-power-remains: the Power component is still due', () => {
  const kernel = world()
    .player('A', { energy: 0, power: ['Order'] })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 3, power: ['Order'], might: 3 })
    .build();
  const ctx = withSource(kernel, 'unit');

  const plan = buildCostPlan(ctx, {
    id: 'play:unit',
    cost: { kind: 'printed' },
    baseModifications: [{ kind: 'ignore-base', ignore: 'energy' }]
  });

  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ['Order'] }]);
  const receipt = payCostPlan(ctx, plan);
  assert.deepEqual(receipt.actions[0].action.plan.power, ['Order']);
  assert.deepEqual(receipt.actions[0].action.plan.energy, 0);
});
