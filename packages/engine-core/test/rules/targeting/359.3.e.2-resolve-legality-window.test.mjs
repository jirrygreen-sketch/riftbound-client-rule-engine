// Scenario: targeting-resolve-legality-window (CR v1.5 359.3.e.2, 359.3.e.2.a)
//
// Legality is re-checked at resolution under the current restrictions. The
// spell locks a unit on a specific battlefield; when a reaction moves it to a
// second battlefield the added placement restriction no longer holds and the
// instruction is ignored.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, passTo, scene, spend } from './harness.mjs';

test('targeting-resolve-legality-window: a target outside the applied restriction is ignored at resolution', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 1 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 2, location: atBattlefield('bf1') }));
  const spell = s.draft('spell', {
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: constant(2), target: 't1' } }],
    targets: [{
      requirement: {
        id: 't1',
        filter: { type: 'unit', zone: 'board', controller: 'B' },
        // 359.3.e.2.a: the restriction applied by the play location keeps the target tied to bf1.
        location: atBattlefield('bf1')
      }
    }],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });
  s.engine.execute(spell);
  assert.deepEqual(s.engine.items[0].targetPlans[0].selected.map(ref => ref.id), ['t1']);

  // Reaction moves the target to another battlefield: the placement restriction no longer holds.
  passTo(s.engine, 'B');
  s.kernel.perform({ type: 'move-location', object: s.kernel.ref('t1'), to: atBattlefield('bf2') });

  spend(s.engine);

  assert.equal(s.kernel.getObject('t1').damage, 0, '359.3.e.2: the illegal target is unaffected');
  assert.deepEqual(s.kernel.getObject('t1').location, atBattlefield('bf2'), 'the target stayed where the reaction put it');
  assert.equal(s.kernel.getObject('spell').zone, 'trash');
});
