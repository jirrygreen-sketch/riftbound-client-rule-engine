// Scenario: targeting-nonboard-zone-breaks-identity (CR v1.5 359.3.e.4, 124)
//
// A target that leaves the Board and comes back is a new object, so the locked
// reference is illegal at resolution.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, passTo, scene, spend } from './harness.mjs';

test('targeting-nonboard-zone-breaks-identity: returning from a non-board zone is a new object', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 3, location: atBattlefield('bf1') }));
  const spell = s.draft('spell', {
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: constant(3), target: 't1' } }],
    targets: [{ requirement: { id: 't1', filter: { type: 'unit', zone: 'board', location: 'battlefield' } } }],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });
  s.engine.execute(spell);
  const locked = s.engine.items[0].targetPlans[0].selected[0];

  passTo(s.engine, 'B');
  // Return to hand (a non-board zone) and play it back to the same battlefield.
  s.kernel.perform({ type: 'return-to-hand', object: s.kernel.ref('t1') });
  s.kernel.perform({ type: 'move-zone', object: s.kernel.ref('t1'), to: 'battlefield', location: atBattlefield('bf1') });

  spend(s.engine);

  assert.notEqual(s.kernel.ref('t1').zoneEntryId, locked.zoneEntryId, '124: the identity changed');
  assert.equal(s.kernel.getObject('t1').damage, 0, '359.3.e.4: the locked reference is no longer a legal target');
  assert.equal(s.kernel.getObject('t1').zone, 'board');
  assert.equal(s.kernel.getObject('spell').zone, 'trash', 'the spell still resolved');
});
