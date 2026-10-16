// CR v1.5 206.1 — scenario costs-ability-base-cost-check-ignores-alteration.
// Determining an ability's cost uses its base cost; the increase affects only
// the total still owed at payment time.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, payCostPlan, constant } from './harness.mjs';

test('costs-ability-base-cost-check-ignores-alteration: base stays [1], total becomes [3]', () => {
  const kernel = world()
    .player('A', { energy: 3 })
    .player('B', { energy: 0 })
    .base('g2', { types: ['gear'], energy: 1, power: [] })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const ctx = withSource(kernel, 'g2');

  const plan = buildCostPlan(ctx, {
    id: 'activate:g2',
    cost: { kind: 'activated', energy: constant(1) },
    increases: [{ id: 'tax', cost: { energy: constant(2) } }]
  });

  assert.equal(plan.base.energy, 1);
  assert.equal(plan.total.energy, 3);
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.actions[0].action.plan.energy, 3);
});
