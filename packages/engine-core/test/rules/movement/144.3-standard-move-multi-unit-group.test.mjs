// Scenario: movement-standard-move-multi-unit-same-destination (CR v1.5 144.3, 144.3.a-c)
import test from 'node:test';
import assert from 'node:assert/strict';
import { duelWorld, performStandardMove, readinessFor } from './support.mjs';

test('movement-standard-move-multi-unit-same-destination: different Origins, one Destination, one simultaneous Exhaust cost', () => {
  const { board, bf1, bf2, baseA, place } = duelWorld();
  const first = place(board, 'u1', 'A', baseA);
  const second = place(first, 'u2', 'A', bf1);
  const third = place(second, 'u3', 'A', baseA);
  const readiness = readinessFor(third, { ganking: ['u2'] });

  const result = performStandardMove(third, readiness, 'A', ['u1', 'u2'], bf2);

  const units = new Map(result.board.units.map(unit => [unit.objectId, unit]));
  assert.equal(units.get('u1').locationId, bf2);
  assert.equal(units.get('u2').locationId, bf2);
  assert.equal(units.get('u3').locationId, baseA, 'an unselected unit keeps its location');
  assert.equal(result.group.destinationLocationId, bf2);
  assert.equal(result.group.exhaustedCount, 2);
  assert.deepEqual(result.group.events.map(event => [event.objectId, event.fromLocationId, event.toLocationId]), [
    ['u1', baseA, bf2],
    ['u2', bf1, bf2],
  ]);
  const after = new Map(result.readiness.map(entry => [entry.objectId, entry]));
  assert.equal(after.get('u1').readied, false, '144.3.c: both Exhaust costs are paid together');
  assert.equal(after.get('u2').readied, false);
  assert.equal(after.get('u3').readied, true);
});
