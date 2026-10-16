// CR v1.5 356.4.e — scenario costs-discount-minimum-per-discount.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, constant } from './harness.mjs';

test('costs-discount-minimum-per-discount: a minimum binds only its own discount', () => {
  const kernel = world()
    .player('A', { energy: 0 })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 8, power: [] })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const ctx = withSource(kernel, 'spell');
  const options = {
    id: 'play:spell',
    cost: { kind: 'printed' },
    discounts: [
      { id: 'eager', resource: 'energy', amount: constant(1), minimum: constant(1) },
      { id: 'splitter', resource: 'energy', amount: constant(7) }
    ]
  };

  assert.equal(buildCostPlan(ctx, options).total.energy, 0);
  assert.equal(buildCostPlan(ctx, { ...options, discountOrder: ['splitter', 'eager'] }).total.energy, 1);
});
