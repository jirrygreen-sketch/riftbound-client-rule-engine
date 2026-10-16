// Scenario: movement-standard-move-battlefield-to-battlefield-rejected (CR v1.5 144.4, 144.4.c.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { duelWorld, performStandardMove, readinessFor } from './support.mjs';

test('movement-standard-move-battlefield-to-battlefield-rejected: without Ganking the Standard Move has no Battlefield-to-Battlefield Destination', () => {
  const { board, bf1, bf2, place } = duelWorld();
  const current = place(board, 'u1', 'A', bf1);

  assert.throws(() => performStandardMove(current, readinessFor(current), 'A', ['u1'], bf2), /needs Ganking/);
  assert.equal(current.units.find(unit => unit.objectId === 'u1').locationId, bf1);
});
