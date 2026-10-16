// Scenario: movement-standard-move-battlefield-to-base (CR v1.5 144.4.b)
import test from 'node:test';
import assert from 'node:assert/strict';
import { duelWorld, performStandardMove, readinessFor } from './support.mjs';

test('movement-standard-move-battlefield-to-base: a battlefield unit may retreat to its own Base', () => {
  const { board, bf1, baseA, place } = duelWorld();
  const current = place(board, 'u1', 'A', bf1);

  const result = performStandardMove(current, readinessFor(current), 'A', ['u1'], baseA);

  assert.equal(result.board.units.find(unit => unit.objectId === 'u1').locationId, baseA);
  assert.deepEqual(result.group.events, [{ objectId: 'u1', actor: 'A', fromLocationId: bf1, toLocationId: baseA }]);
  assert.equal(result.readiness[0].readied, false);
  assert.equal(result.group.requiresOpenCleanup, true);
});
