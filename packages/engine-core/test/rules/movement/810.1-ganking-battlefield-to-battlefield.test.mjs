// Scenario: movement-ganking-battlefield-to-battlefield (CR v1.5 810.1.b, 810.1.c, 144.4.c.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { duelWorld, performStandardMove, readinessFor } from './support.mjs';

test('movement-ganking-battlefield-to-battlefield: Ganking adds the Battlefield destination without a second Exhaust cost', () => {
  const { board, bf1, bf2, place } = duelWorld();
  const current = place(board, 'u1', 'A', bf1);
  const readiness = readinessFor(current, { ganking: ['u1'] });

  const result = performStandardMove(current, readiness, 'A', ['u1'], bf2);

  assert.equal(result.board.units.find(unit => unit.objectId === 'u1').locationId, bf2);
  assert.deepEqual(result.group.events, [{ objectId: 'u1', actor: 'A', fromLocationId: bf1, toLocationId: bf2 }]);
  assert.equal(result.group.exhaustedCount, 1, '810.1.c.3: Ganking grants no extra Standard Move');
  assert.deepEqual(result.readiness, [{ objectId: 'u1', readied: false, hasGanking: true }]);
});
