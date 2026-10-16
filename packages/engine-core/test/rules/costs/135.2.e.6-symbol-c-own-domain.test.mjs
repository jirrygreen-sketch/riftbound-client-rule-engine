// CR v1.5 135.2.e.6 / 135.2.e.6.a — scenario costs-symbol-c-own-domain.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, spellDraft, constant } from './harness.mjs';

test('costs-symbol-c-own-domain: a numeric [C] on a Calm card requires Calm Power', () => {
  const kernel = world()
    .player('A', { energy: 1, power: ['Calm'] })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 1, power: [] })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  engine.execute(spellDraft(kernel, 'spell', {
    cost: {
      id: 'cost:spell',
      cost: { energy: constant(1), power: constant(1) },
      domains: ['Calm']
    }
  }));

  const item = engine.items[0];
  assert.equal(item.status, 'finalized');
  assert.equal(item.costPlan.total.energy, 1);
  assert.deepEqual(item.costPlan.total.power, [{ amount: 1, allowedDomains: ['Calm'] }]);
  assert.deepEqual(item.payment.actions[0].action.plan.power, ['Calm']);
  assert.equal(kernel.player('A').energy, 0);
});
