// Scenario: targeting-invalid-then-valid-again (CR v1.5 359.3.e.3)
//
// Legality is checked as the spell resolves: a target that was momentarily
// illegal but is legal again is still a legal target.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, passTo, scene, spend } from './harness.mjs';

test('targeting-invalid-then-valid-again: a target that returns to the battlefield is legal', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 2 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 3, location: atBattlefield('bf1') }));
  const spell = s.draft('spell', {
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: constant(2), target: 't1' } }],
    targets: [{ requirement: { id: 't1', filter: { type: 'unit', zone: 'board', location: 'battlefield' } } }],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });
  s.engine.execute(spell);

  passTo(s.engine, 'B');
  // Two reactions: move to base, then back to the same battlefield.
  s.kernel.perform({ type: 'move-location', object: s.kernel.ref('t1'), to: { type: 'base', player: 'B' } });
  s.kernel.perform({ type: 'move-location', object: s.kernel.ref('t1'), to: { type: 'battlefield', id: 'bf1' } });

  spend(s.engine);

  assert.equal(s.kernel.ref('t1').zoneEntryId, 1, '359.3.e.3: moving between Board locations keeps the identity');
  assert.equal(s.kernel.getObject('t1').damage, 2, 'the target is legal again at resolution');
  assert.deepEqual(s.kernel.getObject('t1').location, atBattlefield('bf1'));
});
