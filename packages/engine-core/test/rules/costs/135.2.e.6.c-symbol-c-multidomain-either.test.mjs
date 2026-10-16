// CR v1.5 135.2.e.6.c — scenario costs-symbol-c-multidomain-either.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, spellDraft, constant } from './harness.mjs';

test('costs-symbol-c-multidomain-either: one hybrid symbol stays one requirement', () => {
  const kernel = world()
    .player('A', { energy: 1, power: ['Chaos'] })
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
      domains: ['Calm', 'Chaos']
    }
  }));

  const item = engine.items[0];
  assert.equal(item.status, 'finalized');
  assert.deepEqual(item.costPlan.total.power, [{ amount: 1, allowedDomains: ['Calm', 'Chaos'] }]);
  assert.deepEqual(item.payment.actions[0].action.plan.power, ['Chaos']);
  assert.equal(kernel.player('A').energy, 0);
});
