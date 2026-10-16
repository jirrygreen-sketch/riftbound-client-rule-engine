// Scenario: targeting-split-over-cap-illegal (CR v1.5 355.14.c)
//
// Split damage cannot choose more targets than the initial damage amount.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, scene } from './harness.mjs';

test('targeting-split-over-cap-illegal: more targets than split damage is rejected at Finalize', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 2, location: atBattlefield('bf1') })
    .unit('t2', { owner: 'B', might: 2, location: atBattlefield('bf1') })
    .unit('t3', { owner: 'B', might: 2, location: atBattlefield('bf1') }));
  const spell = s.draft('spell', {
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: constant(2), target: 'units', divide: true } }],
    targets: [{
      requirement: { id: 'units', filter: { type: 'unit', zone: 'board', controller: 'B' }, selection: 'up-to', max: 2 },
      options: { chosen: ['t1', 't2', 't3'].map(id => s.kernel.ref(id)) }
    }],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });

  assert.throws(() => s.engine.execute(spell), error => error.code === 'invalid-target-choice');
  assert.equal(s.kernel.player('A').energy, 2);
  assert.equal(s.kernel.getObject('spell').zone, 'hand');
  assert.equal(s.engine.items.length, 0);
});
