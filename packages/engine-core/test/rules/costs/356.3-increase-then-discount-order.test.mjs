// CR v1.5 356.3 / 356.4 — scenario costs-increase-then-discount-order.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, payCostPlan, constant } from './harness.mjs';

test('costs-increase-then-discount-order: [2] + [1] - [1] = [2]', () => {
  const kernel = world()
    .player('A', { energy: 4 })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 2, power: [] })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const ctx = withSource(kernel, 'spell');

  const plan = buildCostPlan(ctx, {
    id: 'play:spell',
    cost: { kind: 'printed' },
    increases: [{ id: 'tax', cost: { energy: constant(1) } }],
    discounts: [{ id: 'discount', resource: 'energy', amount: constant(1) }]
  });

  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.stages, ['base', 'alternate', 'optional-additional', 'mandatory-additional', 'increase', 'discount', 'total']);
  assert.equal(payCostPlan(ctx, plan).actions[0].action.plan.energy, 2);
});
