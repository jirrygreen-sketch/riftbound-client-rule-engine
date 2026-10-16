// Scenario: targeting-negated-linked-still-executes (CR v1.5 359.3.e.14.b, 358.3.a)
//
// Ride the Wind structure: the move is negated because the game action cannot
// be performed, but the ready instruction does not reference that action and
// still executes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, runBody, statuses, reasons } from './harness.mjs';
import { world } from '../../../dist/effects/testing/index.js';

test('targeting-negated-linked-still-executes: a negated move does not stop an unrelated ready', () => {
  const kernel = world()
    .unit('u1', { owner: 'A', exhausted: true, location: atBattlefield('bf1') })
    .build();
  kernel.setTargets('u1', [kernel.ref('u1')]);
  // Vilemaw's Lair stand-in: a move from this battlefield to base is prevented.
  kernel.addReplacement(action => action.type === 'move-location' ? 'prevented' : null);

  const outcome = runBody([
    { id: 'move', op: 'effect.zone', args: { target: 'u1', to: constant('base') } },
    { id: 'ready', op: 'effect.ready', args: { objects: { kind: 'target', id: 'u1' } }, linkedTo: 'move' }
  ], kernel);

  assert.deepEqual(statuses(outcome), { move: 'negated', ready: 'executed' });
  assert.equal(reasons(outcome).move, 'impossible', '359.3.e.6: the impossible move is negated');
  assert.deepEqual(kernel.getObject('u1').location, atBattlefield('bf1'), 'the unit stayed at the battlefield');
  assert.equal(kernel.getObject('u1').exhausted, false, '359.3.e.14.b: the unrelated ready still executed');
});
