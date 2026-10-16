// Scenario: targeting-ignored-earlier-ignores-linked (CR v1.5 359.3.e.14.a)
//
// Hidden Blade structure: an ignored kill instruction also ignores the linked
// instruction that references it, so the opponent draws nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, linked, runBody, statuses, reasons } from './harness.mjs';
import { world } from '../../../dist/effects/testing/index.js';

test('targeting-ignored-earlier-ignores-linked: an ignored link suppresses the linked instruction', () => {
  const kernel = world()
    .player('A', {})
    .player('B', {})
    .deck(['d1', 'd2'], { owner: 'B' })
    .unit('t1', { owner: 'B', might: 2, location: atBattlefield('bf1') })
    .build();
  const locked = kernel.ref('t1');
  kernel.setTargets('t1', [locked]);
  // The target leaves its battlefield after the lock but stays on the board.
  kernel.perform({ type: 'move-location', object: locked, to: { type: 'base', player: 'B' } });

  const outcome = runBody([
    { id: 'kill', op: 'effect.kill', args: { target: 't1' }, targets: [{ id: 't1', filter: { type: 'unit', zone: 'board', location: 'battlefield' } }] },
    { id: 'draw', op: 'effect.draw', args: { amount: constant(2), player: 'B' }, linkedTo: 'kill' }
  ], kernel);

  assert.deepEqual(statuses(outcome), { kill: 'ignored', draw: 'ignored' });
  assert.deepEqual(reasons(outcome), { kill: 'mistargeted', draw: 'linked-ignored' });
  assert.equal(kernel.player('B').handSize, 0, '359.3.e.14.a: the linked draw never executes');
  assert.equal(kernel.getObject('t1').zone, 'board');
});
