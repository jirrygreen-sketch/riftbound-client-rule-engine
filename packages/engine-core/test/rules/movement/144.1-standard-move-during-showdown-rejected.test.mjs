// Scenario: movement-standard-move-during-showdown-rejected (CR v1.5 144.1.c)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOpenDuelCleanup, beginDuelShowdown, duelWorld, performStandardMove, readinessFor,
} from './support.mjs';

test('movement-standard-move-during-showdown-rejected: no Standard Move while a Showdown is ongoing', () => {
  const { board, bf1, bf2, baseA, place } = duelWorld();
  let current = place(board, 'u1', 'A', baseA);
  current = place(current, 'guard', 'A', bf1);
  current = applyOpenDuelCleanup(current);
  current = beginDuelShowdown(current, bf1);
  assert.equal(current.battlefields[0].showdown, 'active');

  assert.throws(() => performStandardMove(current, readinessFor(current), 'A', ['u1'], bf2), /active Showdown or Combat/);
  assert.equal(current.units.find(unit => unit.objectId === 'u1').locationId, baseA);
});
