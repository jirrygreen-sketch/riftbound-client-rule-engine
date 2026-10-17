// Scenario chain-action-spell-rejected-in-closed (CR v1.5 331.1.a, 309.1.a, 338.1.a.2).
//
// While a Chain exists, cards without Reaction cannot be played; the rejected
// play leaves the card in Hand and commits no action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, drawInstruction, damageInstruction } from './support.mjs';

test('chain-action-spell-rejected-in-closed: a plain spell cannot be played into a Closed State', () => {
  const f = chainFixture({
    energy: { A: 3 },
    cards: [
      { id: 's1', owner: 'A', types: ['spell'], energy: 1, power: [] },
      { id: 's2', owner: 'A', types: ['spell'], energy: 1, power: [] },
    ],
    board: builder => builder.unit('u1', { owner: 'A', might: 4, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });

  f.engine.execute(f.spell('s1', [drawInstruction('d1')]));
  assert.equal(f.engine.turnState, 'neutral-closed');
  const eventsBefore = f.engine.pipeline.events.length;

  assert.throws(() => f.engine.execute(f.spell('s2', [damageInstruction('hit', 1, 'u1')])), /legally timed/);

  assert.deepEqual(f.kernel.objectsInZone('A', 'hand').map(ref => ref.id).sort(), ['s2']);
  assert.equal(f.kernel.player('A').energy, 2, 'the rejected play paid nothing');
  assert.equal(f.engine.pipeline.events.length, eventsBefore, 'no Chain event was committed');
  assert.deepEqual(f.engine.items.map(item => item.id), ['s1']);
});
