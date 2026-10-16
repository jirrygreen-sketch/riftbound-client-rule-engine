// Scenario: targeting-up-to-partial-count (CR v1.5 355.13)
//
// "up to 2" lets the controller lock fewer targets; unselected objects are untouched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, scene, spend } from './harness.mjs';

test('targeting-up-to-partial-count: locking one of the two allowed targets', () => {
  const s = scene(builder => builder
    .player('A', { energy: 3 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 2, location: atBattlefield('bf1') })
    .unit('t2', { owner: 'B', might: 2, location: atBattlefield('bf1') }));
  const spell = s.draft('spell', {
    body: [{ id: 'kill', op: 'effect.kill', args: { target: 'units' } }],
    targets: [{ requirement: { id: 'units', filter: { type: 'unit', zone: 'board', controller: 'B' }, selection: 'up-to', max: 2 } }],
    cost: { id: 'cost:spell', cost: { energy: constant(3), power: constant([]) } }
  });
  s.answers.set('target:units', [s.kernel.ref('t1')]);
  s.engine.execute(spell);

  assert.deepEqual(s.engine.items[0].targetPlans[0].selected, [s.kernel.ref('t1')]);
  spend(s.engine);
  assert.equal(s.kernel.getObject('t1').zone, 'trash');
  assert.equal(s.kernel.getObject('t2').zone, 'board', 'the unselected unit is unaffected');
});
