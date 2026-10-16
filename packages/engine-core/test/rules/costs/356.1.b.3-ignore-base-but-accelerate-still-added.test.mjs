// CR v1.5 356.1.b.1 / 356.1.b.3 — scenario costs-ignore-base-but-accelerate-still-added.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, payCostPlan } from './harness.mjs';

test('costs-ignore-base-but-accelerate-still-added: ignoring the base still adds Accelerate', () => {
  const kernel = world()
    .player('A', { energy: 1, power: ['Fury'] })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 2, power: [], might: 3 })
    .build();
  const ctx = withSource(kernel, 'unit');

  const plan = buildCostPlan(ctx, {
    id: 'play:unit',
    cost: { kind: 'printed' },
    domains: ['Fury'],
    baseModifications: [{ kind: 'ignore-base', ignore: 'resources' }],
    optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: true }]
  });

  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ['Fury'] }]);
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.actions[0].action.plan.energy, 1);
  assert.deepEqual(receipt.actions[0].action.plan.power, ['Fury']);
});
