// Scenario: targeting-pick-is-not-target (CR v1.5 355.7, 383.4.b)
//
// A v1.5 "pick" is a choice, not a target: the picked object does not become a
// target, so targeting effects ("When I become the target ...") do not trigger.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, instruction, scene, spend } from './harness.mjs';

test('targeting-pick-is-not-target: picking an object does not make it a target', () => {
  const s = scene(builder => builder
    .player('A', { energy: 1 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('w1', { owner: 'A', exhausted: true, location: atBattlefield('bf1') }));
  // "When I become the target of a spell or ability" stand-in.
  s.watch('w1-targeting-effect', 'w1', {
    filter: { target: { objectId: 'w1' } },
    body: [instruction('mark', 'effect.exhaust', { self: true })]
  });
  s.kernel.setPicks('chosen', [s.kernel.ref('w1')]);
  const spell = s.draft('spell', {
    body: [{ id: 'ready-pick', op: 'effect.ready', args: { objects: { kind: 'pick', id: 'chosen' } } }],
    cost: { id: 'cost:spell', cost: { energy: constant(1), power: constant([]) } }
  });
  s.engine.execute(spell);

  assert.deepEqual(s.engine.items[0].targetPlans, [], 'pick creates no TargetPlan');
  assert.deepEqual(
    s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target'),
    [],
    'no targeting effect fires for a pick'
  );

  spend(s.engine);
  assert.equal(s.kernel.getObject('w1').exhausted, false, 'the pick still readies the unit');
  assert.equal(s.engine.items.length, 0);
});
