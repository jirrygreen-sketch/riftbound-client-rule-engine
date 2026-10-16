// CR v1.5 426.1.c / 426.1.c.1 — scenario costs-countered-no-refund.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, spellDraft, printedCost, constant } from './harness.mjs';

test('costs-countered-no-refund: countering refunds neither the base nor the Repeat fee', () => {
  const kernel = world()
    .player('A', { energy: 5 })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 3, power: [] })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  engine.execute(spellDraft(kernel, 'spell', {
    cost: {
      ...printedCost('cost:spell'),
      optionalAdditional: [{ id: 'repeat', kind: 'repeat', cost: { energy: constant(2) }, selected: true }]
    }
  }));
  const item = engine.items[0];
  assert.equal(kernel.player('A').energy, 0);
  assert.equal(item.payment.total.energy, 5);

  assert.equal(engine.commit({ type: 'counter', object: item.object }).status, 'done');
  assert.equal(kernel.player('A').energy, 0);
  assert.equal(kernel.getObject('spell').zone, 'trash');
  assert.equal(kernel.objectsInZone('A', 'trash').length, 1);
  assert.equal(engine.items.length, 0);
});
