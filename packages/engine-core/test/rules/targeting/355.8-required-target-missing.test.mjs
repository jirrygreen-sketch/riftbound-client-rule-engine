// Scenario: targeting-required-target-missing-illegal (CR v1.5 355.8, 358.1, 358.5)
//
// A mandatory target with no legal object fails Finalize; the whole play is
// rolled back - costs refunded, card back in hand.
import assert from 'node:assert/strict';
import test from 'node:test';
import { constant, scene } from './harness.mjs';

test('targeting-required-target-missing-illegal: Finalize fails and the play rolls back', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] }));
  const spell = s.draft('spell', {
    body: [{ id: 'kill', op: 'effect.kill', args: { target: 't1' } }],
    targets: [{ requirement: { id: 't1', filter: { type: 'unit', zone: 'board' } } }],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });

  assert.throws(() => s.engine.execute(spell), error => error.code === 'no-legal-targets');
  assert.equal(s.kernel.player('A').energy, 2, '355.17.b/358.5: no cost was paid');
  assert.equal(s.kernel.getObject('spell').zone, 'hand', 'the card returned to hand');
  assert.equal(s.engine.items.length, 0, 'no chain item remains');
  assert.deepEqual(s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target'), []);
});
