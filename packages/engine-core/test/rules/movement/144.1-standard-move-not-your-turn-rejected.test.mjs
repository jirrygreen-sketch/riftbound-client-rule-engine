// Scenario: movement-standard-move-not-your-turn-rejected (CR v1.5 144.1.a, 421.3, 312.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { duelWorld, mainTiming, performStandardMove, readinessFor } from './support.mjs';

test('movement-standard-move-not-your-turn-rejected: a non-turn player holds no Standard Move Discretionary Action', () => {
  const { board, bf1, baseA, baseB, place } = duelWorld();
  const current = place(board, 'v1', 'B', baseB);
  const timing = mainTiming('B', { turnPlayerId: 'A', priorityPlayerId: 'A' });

  assert.throws(() => performStandardMove(current, readinessFor(current), 'B', ['v1'], bf1, timing), /not the turn player/);
  assert.equal(current.units.find(unit => unit.objectId === 'v1').locationId, baseB);

  const nailed = mainTiming('A', { priorityPlayerId: null });
  const aUnit = place(board, 'u1', 'A', baseA);
  assert.throws(() => performStandardMove(aUnit, readinessFor(aUnit), 'A', ['u1'], bf1, nailed), /does not hold Priority/);
});
