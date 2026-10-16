// Scenario: targeting-restriction-violation-fails-finalize (CR v1.5 355.17.b, 358.1, 358.5)
//
// A play restriction that cannot be satisfied fails Finalize and rolls the
// whole play back: the cost is not paid and the card stays in hand.
import assert from 'node:assert/strict';
import test from 'node:test';
import { constant, scene } from './harness.mjs';

test('targeting-restriction-violation-fails-finalize: a violated play restriction aborts the play', () => {
  const s = scene(builder => builder
    .player('A', { energy: 3 })
    .player('B', { energy: 0 })
    .hand('unit', { owner: 'A', types: ['unit'], might: 2 })
    .battlefield('bf1', { owner: 'A' }));
  // Perched Grimwyrm stand-in: "Play me only to a battlefield you conquered this turn."
  // The placement restriction is unsatisfied in this scene, so Finalize must fail
  // (355.17.b + 358.1/358.5). The conquer tracking itself belongs to scoring.
  const unit = s.draft('unit', {
    kind: 'unit',
    restrictions: [{ kind: 'never' }],
    location: { type: 'battlefield', id: 'bf1' },
    cost: { id: 'cost:unit', cost: { energy: constant(3), power: constant([]) } }
  });

  assert.throws(() => s.engine.execute(unit), /Finalize legality failed/);
  assert.equal(s.kernel.player('A').energy, 3, 'no cost was paid (358.5)');
  assert.equal(s.kernel.getObject('unit').zone, 'hand', 'the card returned to hand (358.1)');
  assert.equal(s.engine.items.length, 0);
  assert.deepEqual(s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target'), []);
});
