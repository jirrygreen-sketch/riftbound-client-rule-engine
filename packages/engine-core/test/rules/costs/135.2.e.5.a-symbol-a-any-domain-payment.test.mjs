// CR v1.5 135.2.e.5.a — scenario costs-symbol-a-any-domain-payment.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, spellDraft, constant } from './harness.mjs';

test('costs-symbol-a-any-domain-payment: [A] accepts Body Power', () => {
  const kernel = world()
    .player('A', { energy: 0, power: ['Body'] })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 0, power: [] })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  engine.execute(spellDraft(kernel, 'spell', {
    cost: {
      id: 'cost:spell',
      cost: { payments: [{ kind: 'power', amount: constant(1), allowedDomains: ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] }] }
    }
  }));

  const item = engine.items[0];
  assert.equal(item.status, 'finalized');
  assert.deepEqual(item.costPlan.total.power, [{
    amount: 1,
    allowedDomains: ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order']
  }]);
  assert.deepEqual(item.payment.actions[0].action.plan.power, ['Body']);
});
