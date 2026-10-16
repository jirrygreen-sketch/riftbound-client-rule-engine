// Scenario: targeting-split-damage-multi-target (CR v1.5 355.14, .14.c, .14.d, .14.e)
//
// Split damage targets each chosen unit individually (each one fires targeting
// effects), the count is capped by the initial damage, and the per-target split
// is chosen at resolution with every share at least 1.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, scene, spend } from './harness.mjs';

test('targeting-split-damage-multi-target: per-target shares are chosen as the spell resolves', () => {
  const s = scene(builder => builder
    .player('A', { energy: 4 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 5, location: atBattlefield('bf1') })
    .unit('t2', { owner: 'B', might: 5, location: atBattlefield('bf1') })
    .unit('t3', { owner: 'B', might: 5, location: atBattlefield('bf1') }));
  s.watch('t1-targeting-effect', 't1', { filter: { target: { objectId: 't1' } } });
  const spell = s.draft('spell', {
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: constant(4), target: 'units', divide: true } }],
    targets: [{ requirement: { id: 'units', filter: { type: 'unit', zone: 'board', controller: 'B' }, selection: 'up-to', max: 4 } }],
    cost: { id: 'cost:spell', cost: { energy: constant(4), power: constant([]) } }
  });
  s.answers.set('target:units', ['t1', 't2', 't3'].map(id => s.kernel.ref(id)));
  s.engine.execute(spell);

  // 355.14.a/.d: every chosen unit is a target and contributes to targeting effects individually.
  assert.deepEqual(s.engine.items[0].targetPlans[0].selected.map(ref => ref.id), ['t1', 't2', 't3']);
  assert.deepEqual(s.engine.items.map(item => item.kind), ['spell', 'triggered']);
  assert.deepEqual(
    s.engine.pipeline.events.filter(event => event.timingPoint === 'became-target').map(event => event.target.ref.id),
    ['t1', 't2', 't3']
  );

  // 355.14.e/.f/.g: the split is decided on resolution; every share must be a positive integer.
  s.answers.set('hit/effect.damage%3Adivide%3A0', 1);
  s.answers.set('hit/effect.damage%3Adivide%3A1', 1);
  s.answers.set('hit/effect.damage%3Adivide%3A2', 2);
  spend(s.engine);

  assert.deepEqual(['t1', 't2', 't3'].map(id => s.kernel.getObject(id).damage), [1, 1, 2]);
  assert.deepEqual(
    s.asked.filter(request => String(request.id).includes('divide')).map(request => request.id),
    ['hit/effect.damage%3Adivide%3A0', 'hit/effect.damage%3Adivide%3A1', 'hit/effect.damage%3Adivide%3A2'],
    '355.14.e: the shares were requested while the spell resolved'
  );
});
