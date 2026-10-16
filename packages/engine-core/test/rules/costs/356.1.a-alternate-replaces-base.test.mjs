// CR v1.5 356.1.a — scenario costs-alternate-replaces-base.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, payCostPlan, constant } from './harness.mjs';

test('costs-alternate-replaces-base: an alternate cost replaces the printed base', () => {
  const kernel = world()
    .player('A', { energy: 0, power: ['Mind'] })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 5, power: ['Mind'], might: 5 })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const ctx = withSource(kernel, 'unit');

  const plan = buildCostPlan(ctx, {
    id: 'play:unit',
    cost: { kind: 'printed' },
    baseModifications: [{
      id: 'alt',
      kind: 'alternate',
      cost: { payments: [{ kind: 'power', amount: constant(1), allowedDomains: ['Mind'] }] }
    }]
  });

  assert.equal(plan.printed.energy, 5);
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ['Mind'] }]);
  const receipt = payCostPlan(ctx, plan);
  assert.deepEqual(receipt.actions[0].action.plan.power, ['Mind']);
});
