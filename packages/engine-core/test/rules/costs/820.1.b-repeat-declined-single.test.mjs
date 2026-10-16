// CR v1.5 820.1.b — scenario costs-repeat-declined-single.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, resolveAll, spellDraft, printedCost, constant } from './harness.mjs';

test('costs-repeat-declined-single: without Repeat the spell resolves exactly once', () => {
  const kernel = world()
    .player('A', { energy: 4 })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 4, power: [] })
    .unit('e1', { owner: 'B', controller: 'B', might: 3, location: { type: 'battlefield', id: 'bf1' } })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  engine.execute(spellDraft(kernel, 'spell', {
    body: [{
      id: 'hit',
      op: 'effect.damage',
      args: { amount: constant(1), target: constant('victim') },
      targets: [{ id: 'victim', filter: { type: 'unit', controller: 'B', zone: 'board' }, min: 1, max: 1 }]
    }],
    cost: {
      ...printedCost('cost:spell'),
      optionalAdditional: [{ id: 'repeat', kind: 'repeat', cost: { energy: constant(2) }, selected: false }]
    }
  }));

  assert.equal(kernel.player('A').energy, 0);
  assert.deepEqual(engine.items[0].costPlan.declinedAdditional, ['repeat']);
  resolveAll(engine);
  assert.equal(kernel.getObject('e1').damage, 1);
  assert.equal(kernel.getObject('spell').zone, 'trash');
});
