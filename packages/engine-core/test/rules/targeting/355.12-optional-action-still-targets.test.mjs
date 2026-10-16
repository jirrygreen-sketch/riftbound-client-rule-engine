// Scenario: targeting-optional-action-still-targets (CR v1.5 355.12, 383.4.b)
//
// "You may move ..." still targets the object; the decision to perform the
// action is independent, so the targeting effect fires even when declined.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, scene, spend } from './harness.mjs';

test('targeting-optional-action-still-targets: declining the action keeps the target and its effect', () => {
  const s = scene(builder => builder
    .player('A', { energy: 1 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .deck(['d1'], { owner: 'B' })
    .unit('t1', { owner: 'B', might: 3, location: atBattlefield('bf1') }));
  s.watch('t1-targeting-effect', 't1', { filter: { target: { objectId: 't1' } } });
  const spell = s.draft('spell', {
    body: [{
      id: 'may',
      op: 'choice.optional',
      args: { body: constant([{ id: 'move', op: 'effect.zone', args: { target: 't1', to: constant('base') } }]) }
    }],
    targets: [{ requirement: { id: 't1', filter: { type: 'unit', zone: 'board', controller: 'B' } } }],
    cost: { id: 'cost:spell', cost: { energy: constant(1), power: constant([]) } }
  });
  s.engine.execute(spell);

  assert.deepEqual(s.engine.items[0].targetPlans[0].selected.map(ref => ref.id), ['t1'], 'the object was targeted');
  assert.deepEqual(s.engine.items.map(item => item.kind), ['spell', 'triggered'], 'the targeting effect entered the chain');

  s.answers.set('may/optional', false);
  spend(s.engine);

  assert.deepEqual(s.kernel.getObject('t1').location, { type: 'battlefield', id: 'bf1' }, 'the movement was declined');
  assert.equal(s.kernel.player('B').handSize, 1, 'the targeting effect still resolved');
  assert.deepEqual(s.engine.items.length, 0);
});
