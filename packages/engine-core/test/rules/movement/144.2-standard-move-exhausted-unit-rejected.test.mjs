// Scenario: movement-standard-move-exhausted-unit-rejected (CR v1.5 144.2, 421.3.a)
import test from 'node:test';
import assert from 'node:assert/strict';
import { duelWorld, performStandardMove, readinessFor } from './support.mjs';

test('movement-standard-move-exhausted-unit-rejected: an Exhausted unit cannot pay the Standard Move cost', () => {
  const { board, bf1, baseA, place } = duelWorld();
  const current = place(board, 'u1', 'A', baseA);
  const readiness = readinessFor(current, { exhausted: ['u1'] });

  assert.throws(() => performStandardMove(current, readiness, 'A', ['u1'], bf1), /not readied to move/);
  assert.equal(current.units.find(unit => unit.objectId === 'u1').locationId, baseA);
  assert.equal(readiness[0].readied, false, 'the failed attempt pays no other cost');
});
