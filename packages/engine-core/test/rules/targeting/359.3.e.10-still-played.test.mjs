// Scenario: targeting-still-played-when-all-ignored (CR v1.5 359.3.e.10)
//
// A spell whose only instruction lost its target has no effect but is still
// considered played: "when you play a spell" abilities still trigger.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, instruction, passTo, scene, spend } from './harness.mjs';

test('targeting-still-played-when-all-ignored: the played spell still fires its play effect', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .deck(['w1-draw'], { owner: 'A' })
    .base('w1', { owner: 'A', might: 2 })
    .unit('t1', { owner: 'B', might: 2, location: atBattlefield('bf1') }));
  // "When you play a spell" play effect (383.4.a); the draw stands in for its +1 Might.
  s.watch('w1-play-effect', 'w1', {
    spec: { at: 'card-played', filter: {} },
    body: [instruction('play-draw', 'effect.draw', { amount: constant(1) })]
  });
  const spell = s.draft('spell', {
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: constant(2), target: 't1' } }],
    targets: [{ requirement: { id: 't1', filter: { type: 'unit', zone: 'board', controller: 'B', location: 'battlefield' } } }],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });
  s.engine.execute(spell);
  assert.deepEqual(s.engine.items.map(item => item.kind), ['spell']);

  // Reaction: the only target leaves its battlefield, so the damage instruction is ignored.
  passTo(s.engine, 'B');
  s.kernel.perform({ type: 'move-location', object: s.kernel.ref('t1'), to: { type: 'base', player: 'B' } });

  spend(s.engine);

  assert.equal(s.kernel.getObject('t1').damage, 0, '359.3.e.5: the illegal target is unaffected');
  assert.equal(s.kernel.getObject('t1').zone, 'board');
  assert.equal(s.kernel.getObject('w1-draw').zone, 'hand', '359.3.e.10: the play effect still resolved');
  assert.deepEqual(s.engine.trace.filter(event => event.step === 'pending').map(event => event.item), ['spell', 'trigger:1']);
});
