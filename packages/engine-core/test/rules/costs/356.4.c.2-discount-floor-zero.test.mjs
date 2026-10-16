// CR v1.5 356.4.c.2 / 356.6 — scenario costs-discount-floor-zero.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, payCostPlan, constant } from './harness.mjs';

test('costs-discount-floor-zero: excess discount never creates resources', () => {
  const kernel = world()
    .player('A', { energy: 0 })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 1, power: [] })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const ctx = withSource(kernel, 'spell');

  const plan = buildCostPlan(ctx, {
    id: 'play:spell',
    cost: { kind: 'printed' },
    discounts: [{ id: 'large', resource: 'energy', amount: constant(3) }]
  });

  assert.equal(plan.total.energy, 0);
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.player('A').energy, 0);
});
