// Scenario: targeting-counters-not-targeted (CR v1.5 742.1)
//
// Counters are never targeted: the two Units are locked at Finalize and the
// specific counter is chosen when the instruction executes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBase, constant, instruction, scene, spend } from './harness.mjs';

test('targeting-counters-not-targeted: counters move between units and are never targeted', () => {
  const s = scene(builder => builder
    .player('A', { energy: 1 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('u1', { owner: 'A', might: 2, location: atBase('A') })
    .unit('u2', { owner: 'A', might: 2, location: atBase('A') }));
  // 702.2.a: a Buff is placed on u1 before the spell is played.
  s.kernel.perform({ type: 'buff', object: s.kernel.ref('u1'), amount: 1 });
  assert.equal(s.kernel.getObject('u1').buffs, 1);

  // "Move a buff from a unit you control to another unit you control":
  // both Units are targets; 742.1 postpones the counter choice to execution.
  const spell = s.draft('spell', {
    body: [
      instruction('take', 'effect.buff', { mode: 'spend', target: 'from' }, { targets: [{ id: 'from', filter: { type: 'unit', zone: 'board', controller: 'A' } }] }),
      instruction('give', 'effect.buff', { mode: 'buff', target: 'into' }, { targets: [{ id: 'into', filter: { type: 'unit', zone: 'board', controller: 'A' } }], linkedTo: 'take' })
    ],
    cost: { id: 'cost:spell', cost: { energy: constant(1), power: constant([]) } }
  });
  s.answers.set('target:from', [s.kernel.ref('u1')]);
  s.answers.set('target:into', [s.kernel.ref('u2')]);
  s.engine.execute(spell);

  assert.deepEqual(
    s.engine.items[0].targetPlans.map(plan => plan.selected.map(ref => ref.id)),
    [['u1'], ['u2']],
    '742.1: the targets are the two Units'
  );
  assert.deepEqual(
    s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target').map(event => event.target.ref.id),
    ['u1', 'u2'],
    'no targeting event exists for the counter itself'
  );

  spend(s.engine);
  assert.equal(s.kernel.getObject('u1').buffs, 0, 'the buff left u1 while the spell resolved');
  assert.equal(s.kernel.getObject('u2').buffs, 1, 'the buff landed on u2');
  assert.deepEqual(s.engine.trace.filter(event => event.step === 'resolved').map(event => event.item), ['spell']);
});
