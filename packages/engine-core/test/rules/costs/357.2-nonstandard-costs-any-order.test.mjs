// CR v1.5 357.2 — scenario costs-nonstandard-costs-any-order.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, withSource, buildCostPlan, payCostPlan } from './harness.mjs';

test('costs-nonstandard-costs-any-order: the controller locks an exact nonstandard order', () => {
  const kernel = world()
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 2, power: [], might: 4 })
    .hand('fuel', { types: ['unit'], energy: 1, power: [], might: 1 })
    .unit('t1', { might: 1 })
    .build();
  const ctx = withSource(kernel, 'unit');

  const plan = buildCostPlan(ctx, {
    id: 'play:unit',
    cost: { kind: 'printed' },
    mandatoryAdditional: [
      { id: 'discard', cost: { payments: [{ kind: 'discard', object: kernel.ref('fuel') }] } },
      { id: 'kill', cost: { payments: [{ kind: 'kill', object: kernel.ref('t1') }] } }
    ]
  });

  const killFirst = payCostPlan(ctx, plan, { nonstandardOrder: ['kill:payment:0:0', 'discard:payment:0:0'] });
  assert.deepEqual(killFirst.actions.map(entry => entry.action.type), ['pay', 'kill', 'discard']);
  assert.equal(ctx.getObject('t1').zone, 'trash');
  assert.equal(ctx.getObject('fuel').zone, 'trash');

  const second = world()
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 2, power: [], might: 4 })
    .hand('fuel', { types: ['unit'], energy: 1, power: [], might: 1 })
    .unit('t1', { might: 1 })
    .build();
  const secondCtx = withSource(second, 'unit');
  const secondPlan = buildCostPlan(secondCtx, {
    id: 'play:unit',
    cost: { kind: 'printed' },
    mandatoryAdditional: [
      { id: 'discard', cost: { payments: [{ kind: 'discard', object: second.ref('fuel') }] } },
      { id: 'kill', cost: { payments: [{ kind: 'kill', object: second.ref('t1') }] } }
    ]
  });
  const discardFirst = payCostPlan(secondCtx, secondPlan, { nonstandardOrder: ['discard:payment:0:0', 'kill:payment:0:0'] });
  assert.deepEqual(discardFirst.actions.map(entry => entry.action.type), ['pay', 'discard', 'kill']);

  // 357.2 allows any order, but never allows dropping or duplicating one.
  assert.throws(
    () => payCostPlan(withSource(second, 'unit'), secondPlan, { nonstandardOrder: [] }),
    error => error.reason === 'invalid-cost-plan'
  );
});
