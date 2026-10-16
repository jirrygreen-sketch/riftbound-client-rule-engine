// Scenario: targeting-choose-locks-at-finalize (CR v1.5 355.5, 355.7, 355.15, 383.4.b)
//
// "Deal 2 to a unit at a battlefield" names one object, so it is a target:
// the choice locks at chain-item-finalize and cannot change afterwards.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, scene, spend } from './harness.mjs';

test('targeting-choose-locks-at-finalize: the target locks when the spell finalizes', () => {
  const s = scene(builder => builder
    .player('A', { energy: 3 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 2, location: atBattlefield('bf1') }));
  const spell = s.draft('spell', {
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: constant(2), target: 't1' } }],
    targets: [{ requirement: { id: 't1', filter: { type: 'unit', zone: 'board', controller: 'B' } } }],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });
  s.engine.execute(spell);

  // Finalize locked the target and emitted the targeting timing (355.15, 383.4.b).
  const item = s.engine.items[0];
  assert.equal(item.status, 'finalized');
  assert.deepEqual(item.targetPlans.map(plan => [plan.lockedAt, plan.retestAtResolve]), [['finalize', true]]);
  assert.deepEqual(item.targetPlans[0].selected, [s.kernel.ref('t1')]);
  assert.equal(s.kernel.player('A').energy, 1);
  assert.deepEqual(
    s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target').map(event => event.target.ref.id),
    ['t1']
  );

  // Resolution uses the locked reference; the plan cannot drift to another object.
  spend(s.engine);
  assert.equal(s.kernel.getObject('t1').damage, 2);
  assert.equal(s.kernel.getObject('spell').zone, 'trash');
  assert.deepEqual(
    s.engine.pipeline.events.filter(event => event.timingPoint === 'chain-item-finalize').map(event => event.details.item),
    ['spell']
  );
});
