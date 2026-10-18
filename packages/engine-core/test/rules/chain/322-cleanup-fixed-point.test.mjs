// Scenario chain-cleanup-fixed-point (CR v1.5 322, 322.1).
//
// If a Cleanup itself qualifies for another Cleanup, that new Cleanup is an
// Outstanding Task that runs immediately afterwards (322 / 322.1). Here the
// lethal damage Kill generates a death Trigger that becomes Pending, and the
// Pending item in turn needs its own Cleanup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, drawInstruction, registerTrigger, timings } from './support.mjs';

test('chain-cleanup-fixed-point: a Cleanup that changes state chains into another Cleanup', () => {
  const f = chainFixture({
    energy: { A: 0, B: 0 },
    board: builder => {
      builder.unit('u1', { owner: 'B', might: 3, damage: 3, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } });
      builder.unit('u2', { owner: 'B', might: 2, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } });
    },
  });
  registerTrigger(f.engine, f.kernel, {
    id: 'death-watch', source: 'u2', controller: 'B', spec: { at: 'object-killed', filter: {} },
    body: [drawInstruction('d')],
  });

  // Ask for one Cleanup; the lethal damage then forces the fixed-point loop.
  f.engine.requestCleanup('probe');
  f.engine.advance();

  // 323.4: the damage caused the Kill inside the first Cleanup.
  assert.deepEqual(f.kernel.objectsInZone('B', 'trash').map(ref => ref.id), ['u1']);
  assert.equal(f.kernel.getObject('u2').zone, 'board', 'only the lethal-damage unit died');
  // 322: the Kill Triggered u2, and the new Pending item needed its own Cleanup (319.3).
  assert.equal(f.engine.items[0].kind, 'triggered');
  const order = timings(f.engine);
  const killed = order.indexOf('object-killed');
  const pending = order.indexOf('chain-item-pending');
  const cleanupEnd = order.indexOf('cleanup-end', killed);
  assert.ok(killed < pending && pending < cleanupEnd, 'the trigger became Pending inside the first Cleanup');
  assert.ok(
    order.indexOf('cleanup-start', cleanupEnd) > cleanupEnd,
    '322.1: the new Cleanup ran as its own Outstanding Task',
  );
  assert.equal(order.filter(id => id === 'cleanup-start').length >= 3, true);
  assert.equal(f.kernel.player('B').handSize, 0, 'u2 only draws when its own trigger resolves');
});
