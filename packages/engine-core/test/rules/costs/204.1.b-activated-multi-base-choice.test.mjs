// CR v1.5 204.1.b / 203.1 — scenario costs-activated-multi-base-choice.
// The activated ability separates its base cost from the Empower effect; the
// controller selects one candidate base cost in Finalize.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, resolveAll, constant } from './harness.mjs';

test('costs-activated-multi-base-choice: choosing the Power base cost empowers the source', () => {
  const kernel = world()
    .player('A', { energy: 0, power: ['Fury'] })
    .player('B', { energy: 0 })
    .base('m1', { types: ['unit'], energy: 1, power: ['Fury'], might: 2 })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  engine.execute({
    id: 'A:m1:empower',
    controller: 'A',
    kind: 'activated',
    speed: 'reaction',
    source: kernel.getObject('m1'),
    body: [{ id: 'empower', op: 'effect.empower', args: {} }],
    cost: {
      id: 'cost:m1',
      cost: { kind: 'activated' },
      baseChoices: [
        { id: 'energy', cost: { energy: constant(1) } },
        { id: 'power', cost: { payments: [{ kind: 'power', allowedDomains: ['Fury'] }] } }
      ],
      baseChoice: 'power'
    }
  });

  const item = engine.items[0];
  assert.equal(item.status, 'finalized');
  assert.equal(item.costPlan.total.energy, 0);
  assert.deepEqual(item.payment.actions[0].action.plan.power, ['Fury']);
  assert.equal(kernel.player('A').energy, 0);
  resolveAll(engine);
  assert.equal(kernel.getObject('m1').empowered, 1);
  assert.equal(engine.items.length, 0);
});
