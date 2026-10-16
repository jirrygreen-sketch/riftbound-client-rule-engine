// Scenario: movement-standard-move-multi-unit-different-destinations-rejected (CR v1.5 144.3.a)
import test from 'node:test';
import assert from 'node:assert/strict';
import { duelWorld, performStandardMove, readinessFor } from './support.mjs';

test('movement-standard-move-multi-unit-different-destinations-rejected: one move action has exactly one Destination', () => {
  const { board, bf1, bf2, baseA, place } = duelWorld();
  const first = place(board, 'u1', 'A', baseA);
  const current = place(first, 'u2', 'A', baseA);
  const before = structuredClone(current);

  assert.throws(
    () => performStandardMove(current, readinessFor(current), 'A', ['u1', 'u2'], [bf1, bf2]),
    /destinationLocationId/,
  );
  assert.deepEqual(current, before, 'a rejected declaration changes nothing');
});
