// Scenario: movement-standard-move-during-enemy-showdown-unaffected (CR v1.5 144.1.c, 343.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOpenDuelCleanup, beginDuelShowdown, duelWorld, mainTiming, performStandardMove, readinessFor,
} from './support.mjs';

test('movement-standard-move-during-enemy-showdown-unaffected: the Showdown State gate is global and ignores who holds Focus', () => {
  const { board, bf1, bf2, baseA, baseB, place } = duelWorld();
  let current = place(board, 'guard', 'A', bf1);
  current = place(current, 'u1', 'A', baseA);
  current = place(current, 'v1', 'B', baseB);
  current = applyOpenDuelCleanup(current);
  current = beginDuelShowdown(current, bf1);
  assert.equal(current.battlefields[0].showdown, 'active');

  // The scene's own command: A attempts the move. The Showdown State gate (144.1.c / 343.1)
  // is checked before the Main-Phase ownership gate, so this is the reported failure.
  assert.throws(
    () => performStandardMove(current, readinessFor(current), 'A', ['u1'], bf2),
    /active Showdown or Combat/,
    '144.1.c / 343.1: the ongoing Showdown forbids it regardless of Focus',
  );
  // Even the turn player holding Priority cannot do it while the Showdown is ongoing.
  assert.throws(
    () => performStandardMove(current, readinessFor(current), 'B', ['v1'], bf2, mainTiming('B')),
    /active Showdown or Combat/,
  );
  assert.equal(current.units.find(unit => unit.objectId === 'u1').locationId, baseA);
  assert.equal(current.units.find(unit => unit.objectId === 'v1').locationId, baseB);
});
