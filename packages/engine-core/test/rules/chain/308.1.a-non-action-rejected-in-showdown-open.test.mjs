// Scenario chain-non-action-rejected-in-showdown-open (CR v1.5 308.1.a, 313.1.a, 358.4).
//
// In a Showdown State only cards with Action or Reaction may be played (308.1.a).
// Holding Focus is necessary but not sufficient (313.1.a), and a rejected play is
// undone during Check Legality (358.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, drawInstruction, stages } from './support.mjs';

test('chain-non-action-rejected-in-showdown-open: a plain spell cannot be played in a Showdown', () => {
  // The scenario's given: B is the turn player, A holds Focus and Priority.
  const f = chainFixture({
    energy: { A: 2 },
    turnPlayer: 'B',
    cards: [{ id: 's1', owner: 'A', types: ['spell'], energy: 1, power: [] }],
    board: builder => builder.unit('a1', { owner: 'A', might: 2, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.engine.openShowdown('A');
  assert.equal(f.engine.turnState, 'showdown-open');
  assert.equal(f.engine.focus, 'A');
  assert.equal(f.engine.priority, 'A');

  assert.throws(() => f.engine.execute(f.spell('s1', [drawInstruction('d')])), /legally timed/);

  assert.equal(f.kernel.getObject('s1').zone, 'hand');
  assert.equal(f.kernel.player('A').energy, 2);
  assert.deepEqual(stages(f.engine), [], 'the rejected play left no Chain trace');
  assert.equal(f.engine.turnState, 'showdown-open');
});
