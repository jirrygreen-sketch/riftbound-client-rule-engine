// Scenario: targeting-mandatory-must-resolves-not-target (CR v1.5 355.10.f)
//
// "You must recycle one of your runes" does not target: nothing is chosen at
// Finalize and the recycle is decided while the spell resolves.
import assert from 'node:assert/strict';
import test from 'node:test';
import { constant, placeRune, scene, spend } from './harness.mjs';

test('targeting-mandatory-must-resolves-not-target: the must-instruction picks at resolution', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .deck(['d1'], { owner: 'A' }));
  placeRune(s.kernel, 'runes.1');
  const spell = s.draft('spell', {
    body: [
      { id: 'recycle', op: 'effect.recycle', args: { from: constant({ zone: 'rune-zone', owner: 'controller', amount: constant(1) }) } },
      { id: 'draw', op: 'effect.draw', args: { amount: constant(1) } }
    ],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });
  s.engine.execute(spell);

  const item = s.engine.items[0];
  assert.deepEqual(item.targetPlans, [], '355.10.f: a "must" instruction targets nothing');
  assert.equal(item.status, 'finalized');
  assert.equal(s.kernel.getObject('runes.1').zone, 'rune-zone', 'the rune choice has not happened yet');
  assert.deepEqual(s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target'), []);

  spend(s.engine);

  assert.equal(s.kernel.getObject('runes.1').zone, 'rune-deck', '417.1.b: the rune recycled during resolution');
  assert.equal(s.kernel.player('A').handSize, 1, 'the following draw resolved');
  assert.deepEqual(
    s.engine.trace.filter(event => event.step === 'resolved').map(event => event.item),
    ['spell']
  );
});
