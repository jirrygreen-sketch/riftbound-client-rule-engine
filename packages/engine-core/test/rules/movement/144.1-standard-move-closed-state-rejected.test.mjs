// Scenario: movement-standard-move-during-closed-state-rejected (CR v1.5 144.1.b)
import test from 'node:test';
import assert from 'node:assert/strict';
import { duelWorld, mainTiming, performStandardMove, readinessFor } from './support.mjs';

test('movement-standard-move-during-closed-state-rejected: a Closed State forbids the Standard Move', () => {
  const { board, bf1, baseA, place } = duelWorld();
  const current = place(board, 'u1', 'A', baseA);
  const closed = mainTiming('A', { stateOpen: false });

  assert.throws(() => performStandardMove(current, readinessFor(current), 'A', ['u1'], bf1, closed), /must be Open/);
  assert.equal(current.units.find(unit => unit.objectId === 'u1').locationId, baseA);
});
