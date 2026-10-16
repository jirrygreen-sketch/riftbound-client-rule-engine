// CR v1.5 356.5.a — scenario costs-ignore-all-costs-includes-nonstandard.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, payCostPlan } from './harness.mjs';

test('costs-ignore-all-costs-includes-nonstandard: total cost [0] waives the kill fee', () => {
  const kernel = world()
    .player('A', { energy: 0 })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 4, power: [], might: 4 })
    .unit('t1', { might: 1 })
    .build();
  const ctx = withSource(kernel, 'unit');

  const plan = buildCostPlan(ctx, {
    id: 'play:unit',
    cost: { kind: 'printed' },
    ignoreAllCosts: true,
    mandatoryAdditional: [{ id: 'sacrifice', cost: { payments: [{ kind: 'kill', object: kernel.ref('t1') }] } }]
  });

  assert.deepEqual(plan.total, { energy: 0, power: [], xp: 0, actions: [] });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject('t1').zone, 'board');
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ['pay']);
});
