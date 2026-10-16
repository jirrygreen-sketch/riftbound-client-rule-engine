// Scenario: targeting-group-subset-after-move (CR v1.5 355.11.b, 355.11.b.1)
//
// When the locked group stops satisfying the requirement because some targets
// left the group's location, only the still-legal original targets execute.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, passTo, scene, spend } from './harness.mjs';

test('targeting-group-subset-after-move: resolution keeps the still-legal original targets', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 1 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('u1', { owner: 'B', might: 2, location: atBattlefield('bf1') })
    .unit('u2', { owner: 'B', might: 2, location: atBattlefield('bf1') })
    .unit('u3', { owner: 'B', might: 2, location: atBattlefield('bf1') }));
  const spell = s.draft('spell', {
    body: [{ id: 'kill', op: 'effect.kill', args: { target: 'units' } }],
    targets: [{
      requirement: { id: 'units', filter: { type: 'unit', zone: 'board', controller: 'B', location: 'battlefield' }, selection: 'up-to', max: 3, group: true }
    }],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });
  s.answers.set('target:units', ['u1', 'u2', 'u3'].map(id => s.kernel.ref(id)));
  s.engine.execute(spell);
  assert.deepEqual(s.engine.items[0].targetPlans[0].selected.map(ref => ref.id), ['u1', 'u2', 'u3']);

  // Reaction: two of the three targets leave the chosen location.
  passTo(s.engine, 'B');
  s.kernel.perform({ type: 'move-location', object: s.kernel.ref('u1'), to: { type: 'base', player: 'B' } });
  s.kernel.perform({ type: 'move-location', object: s.kernel.ref('u2'), to: { type: 'base', player: 'B' } });

  spend(s.engine);
  assert.equal(s.kernel.getObject('u1').zone, 'board', '359.3.e.5: a target that left the location is unaffected');
  assert.equal(s.kernel.getObject('u2').zone, 'board');
  assert.equal(s.kernel.getObject('u3').zone, 'trash', '355.11.b: the still-legal subset executes');
});

test.todo('targeting-group-subset-after-move (355.11.b.1 maximum-subset half): blocked on a group requirement evaluator — TargetRequirement.group is only a marker; no merged code scores a candidate subset (total Might / same-location maxima), so "must include the maximum number of legal targets" cannot be asserted');
