// Scenario chain-action-spell-allowed-in-showdown-open (CR v1.5 308.1.a, 347.1, 806.1.c.1).
//
// The player with Focus may play an Action (347.1); playing it closes the State
// (354.1) and the Showdown reopens once the Chain is empty, passing Focus on
// (347.1.b / 340.2.a).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, damageInstruction, resolveAll } from './support.mjs';

test('chain-action-spell-allowed-in-showdown-open: an Action spell plays and the Showdown reopens', () => {
  // The scenario's given: B is the turn player, A holds Focus and Priority.
  const f = chainFixture({
    energy: { A: 2 },
    turnPlayer: 'B',
    cards: [{ id: 's1', owner: 'A', types: ['spell'], energy: 1, power: [] }],
    board: builder => builder.unit('b1', { owner: 'B', might: 3, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.engine.openShowdown('A');
  assert.equal(f.engine.canAct('A', 'action'), true);
  assert.equal(f.engine.canAct('A', 'normal'), false);

  f.engine.execute(f.spell('s1', [damageInstruction('hit', 2, 'b1')], { speed: 'action' }));
  assert.equal(f.engine.turnState, 'showdown-closed');

  resolveAll(f.engine);
  assert.equal(f.engine.turnState, 'showdown-open', '354.1/340.2: the Showdown resumes after the Chain');
  assert.equal(f.kernel.getObject('b1').damage, 2);
  assert.equal(f.kernel.getObject('s1').zone, 'trash');
  assert.equal(f.engine.focus, 'B', '347.1.b: Focus passes to the next player in Turn Order');
  assert.equal(f.engine.priority, 'B');
});
