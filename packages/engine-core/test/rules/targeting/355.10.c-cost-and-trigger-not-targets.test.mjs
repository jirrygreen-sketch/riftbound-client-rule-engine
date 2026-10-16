// Scenario: targeting-cost-and-trigger-not-targets (CR v1.5 355.10.c, 355.10.c.1)
//
// An object named only by a cost (or a trigger condition / replacement effect)
// is not a target: the sacrificed unit's targeting trigger does not fire while
// the instruction's target does.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, instruction, scene, spend } from './harness.mjs';

test('targeting-cost-and-trigger-not-targets: only the instruction target is a target', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .base('c1', { owner: 'A', might: 1 })
    .unit('t1', { owner: 'B', might: 4, location: atBattlefield('bf1') }));
  s.watch('c1-targeting-effect', 'c1', {
    filter: { target: { objectId: 'c1' } },
    body: [instruction('mark', 'effect.exhaust', { self: true })]
  });
  const spell = s.draft('spell', {
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: constant(3), target: 't1' } }],
    targets: [{ requirement: { id: 't1', filter: { type: 'unit', zone: 'board', controller: 'B' } } }],
    cost: {
      id: 'cost:spell',
      cost: { energy: constant(2), power: constant([]) },
      payments: [],
      // 355.10.c/.c.1: an additional cost that kills a friendly unit is not a target.
      mandatoryAdditional: [{ id: 'sacrifice', cost: { energy: constant(0), power: constant([]), payments: [{ kind: 'kill', object: s.kernel.ref('c1') }] } }]
    }
  });
  s.engine.execute(spell);

  assert.equal(s.kernel.getObject('c1').zone, 'trash', 'the additional cost was paid at Finalize');
  assert.deepEqual(s.engine.items[0].targetPlans.map(plan => plan.requirement.id), ['t1']);
  assert.deepEqual(
    s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target').map(event => event.target.ref.id),
    ['t1'],
    'the sacrificed unit never became a target'
  );

  spend(s.engine);
  assert.equal(s.kernel.getObject('t1').damage, 3);
});
