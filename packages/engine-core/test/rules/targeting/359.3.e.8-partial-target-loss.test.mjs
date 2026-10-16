// Scenario: targeting-partial-target-loss-executes-rest (CR v1.5 359.3.e.8)
//
// Singularity structure: losing one of two locked targets does not stop the
// other target from being processed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, passTo, scene, spend } from './harness.mjs';

test('targeting-partial-target-loss-executes-rest: the remaining target still takes its damage', () => {
  const s = scene(builder => builder
    .player('A', { energy: 6 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 7, location: atBattlefield('bf1') })
    .unit('t2', { owner: 'B', might: 7, location: atBattlefield('bf1') }));
  const spell = s.draft('spell', {
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: constant(6), target: 'units' } }],
    targets: [{ requirement: { id: 'units', filter: { type: 'unit', zone: 'board', controller: 'B', location: 'battlefield' }, selection: 'up-to', max: 2 } }],
    cost: { id: 'cost:spell', cost: { energy: constant(6), power: constant([]) } }
  });
  s.answers.set('target:units', ['t1', 't2'].map(id => s.kernel.ref(id)));
  s.engine.execute(spell);

  passTo(s.engine, 'B');
  // Only one of the two targets leaves the battlefield.
  s.kernel.perform({ type: 'move-location', object: s.kernel.ref('t2'), to: { type: 'base', player: 'B' } });

  spend(s.engine);

  assert.equal(s.kernel.getObject('t1').damage, 6, '359.3.e.8: the still-legal target is processed');
  assert.equal(s.kernel.getObject('t2').damage, 0, 'the lost target is unaffected');
});
