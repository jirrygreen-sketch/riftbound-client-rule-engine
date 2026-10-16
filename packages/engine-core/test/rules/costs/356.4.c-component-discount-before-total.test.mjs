// CR v1.5 356.4.c / 356.4.d — scenario costs-component-discount-before-total.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, constant } from './harness.mjs';

test('costs-component-discount-before-total: component discount is consumed before the total discount', () => {
  const kernel = world()
    .player('A', { energy: 5 })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 4, power: [] })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const ctx = withSource(kernel, 'spell');

  const plan = buildCostPlan(ctx, {
    id: 'play:spell',
    cost: { kind: 'printed' },
    discounts: [
      { id: 'global', resource: 'energy', amount: constant(1) },
      { id: 'component', resource: 'energy', amount: constant(1), component: 'base' }
    ]
  });

  assert.deepEqual(plan.discounts.map(discount => discount.id), ['component', 'global']);
  assert.equal(plan.components[0].original.energy, 4);
  assert.equal(plan.components[0].cost.energy, 3);
  assert.equal(plan.total.energy, 2);
});
