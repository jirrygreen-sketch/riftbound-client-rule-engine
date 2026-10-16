// Scenario: targeting-lookback-after-zone-change (CR v1.5 359.3.e.13, 832.1.d.1)
//
// Primordial Roar / Strike Down structure: an instruction that moves an object
// may still look back at the characteristics it had before the zone change.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, property, runBody, statuses } from './harness.mjs';
import { world } from '../../../dist/effects/testing/index.js';

test('targeting-lookback-after-zone-change: an instruction may read the pre-move characteristics', () => {
  const kernel = world()
    .player('A', {})
    .player('B', {})
    .unit('t1', { owner: 'B', might: 4, location: atBattlefield('bf1') })
    .unit('lg', { owner: 'B', types: ['legend'], might: null, location: { type: 'base', player: 'B' } })
    .build();
  kernel.setTargets('t1', [kernel.ref('t1')]);
  kernel.setTargets('lg', [kernel.ref('lg')]);

  // "Banish a unit, then deal damage equal to its Might" - the referenced characteristics
  // come from before the object changed zones (359.3.e.13).
  const outcome = runBody([
    { id: 'bounce', op: 'effect.zone', args: { target: 't1', to: constant('hand') } },
    { id: 'strike', op: 'effect.damage', args: { amount: property({ target: 't1' }, 'might'), target: 'lg' }, targets: [{ id: 'lg', filter: { type: 'legend', zone: 'board' } }] }
  ], kernel);

  assert.deepEqual(statuses(outcome), { bounce: 'executed', strike: 'executed' });
  assert.equal(kernel.getObject('t1').zone, 'hand');
  assert.equal(kernel.getObject('lg').damage, 4, 'the pre-move Might (4) was used');
});

test.todo('targeting-lookback-after-zone-change (Show Off half): blocked on 832.1.d.1 Show Off snapshot locking — the keyword expansion is merged as a cost.reveal declaration, but no merged Finalize pipeline consumes it or freezes the shown characteristics');
