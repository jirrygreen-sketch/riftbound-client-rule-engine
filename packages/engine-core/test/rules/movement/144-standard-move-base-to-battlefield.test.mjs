// Scenario: movement-standard-move-base-to-battlefield (CR v1.5 144, 144.2, 144.4.a, 455)
// Subject: merged zones Standard Move kernel (src/zones/movement.ts). The DuelBoard
// factory is `given` construction only; the kernel owns legality, the simultaneous
// Exhaust cost and the relocation, and reports the Move-trigger / Open-cleanup
// obligations back to its caller.
import test from 'node:test';
import assert from 'node:assert/strict';
import { duelWorld, performStandardMove, readinessFor } from './support.mjs';

test('movement-standard-move-base-to-battlefield: Exhaust is the cost and the unit relocates in one group action', () => {
  const { board, bf1, baseA, place } = duelWorld();
  const current = place(board, 'u1', 'A', baseA);
  const readiness = readinessFor(current);
  const before = structuredClone(current);

  const result = performStandardMove(current, readiness, 'A', ['u1'], bf1);

  assert.equal(result.board.units.find(unit => unit.objectId === 'u1').locationId, bf1);
  assert.equal(result.board.units.find(unit => unit.objectId === 'u1').controllerPlayerId, 'A');
  assert.deepEqual(result.group, {
    kind: 'standard-move',
    actor: 'A',
    destinationLocationId: bf1,
    objectIds: ['u1'],
    exhaustedCount: 1,
    events: [{ objectId: 'u1', actor: 'A', fromLocationId: baseA, toLocationId: bf1 }],
    requiresMoveTriggers: true,
    requiresOpenCleanup: true,
  });
  const [entry] = result.readiness;
  assert.equal(entry.objectId, 'u1');
  assert.equal(entry.readied, false);
  assert.equal(result.readiness.length, 1);
  assert.deepEqual(current, before, 'the input board is never mutated');
});
