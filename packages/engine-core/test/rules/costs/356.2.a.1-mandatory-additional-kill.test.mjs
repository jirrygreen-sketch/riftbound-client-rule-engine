// CR v1.5 356.2.a.1 / 204.2.a — scenario costs-mandatory-additional-kill.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, unitDraft, printedCost } from './harness.mjs';

test('costs-mandatory-additional-kill: base Energy and the kill fee are both paid', () => {
  const kernel = world()
    .player('A', { energy: 3 })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 3, power: [], might: 5 })
    .unit('t1', { might: 1 })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  engine.execute(unitDraft(kernel, 'unit', {
    cost: {
      ...printedCost('cost:unit'),
      mandatoryAdditional: [{ id: 'sacrifice', cost: { payments: [{ kind: 'kill', object: kernel.ref('t1') }] } }]
    }
  }));

  assert.equal(kernel.player('A').energy, 0);
  assert.equal(kernel.getObject('t1').zone, 'trash');
  assert.equal(kernel.objectsInZone('A', 'trash').length, 1);
  assert.equal(kernel.getObject('unit').zone, 'board');
  assert.ok(engine.trace.some(event => event.step === 'finalized' && event.item === 'unit'));
  assert.deepEqual(kernel.events.map(event => event.action), ['move-zone', 'pay', 'kill', 'exhaust', 'move-zone']);
});

test('costs-mandatory-additional-impossible: a missing kill target rolls back Finalize', () => {
  const kernel = world()
    .player('A', { energy: 3 })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 3, power: [], might: 5 })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  assert.throws(
    () => engine.execute(unitDraft(kernel, 'unit', {
      cost: {
        ...printedCost('cost:unit'),
        mandatoryAdditional: [{ id: 'sacrifice', cost: { payments: [{ kind: 'kill', object: { id: 'missing', zoneEntryId: 1 } }] } }]
      }
    })),
    error => error.reason === 'cannot-pay-cost'
  );

  assert.equal(kernel.player('A').energy, 3);
  assert.equal(kernel.player('A').handSize, 1);
  assert.equal(kernel.getObject('unit').zone, 'hand');
  assert.equal(engine.items.length, 0);
});
