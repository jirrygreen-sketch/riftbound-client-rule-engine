// Scenario: targeting-trigger-fires-on-becoming-target (CR v1.5 383.4.b, 355.7)
//
// A targeting effect enters the chain as a Pending item right after the object
// becomes a target; HOT FEPR resolves it before the original spell.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, scene, spend } from './harness.mjs';

const openedChain = engine => engine.pipeline.events
  .filter(event => ['chain-item-pending', 'became-target', 'chain-item-finalize'].includes(event.timingPoint))
  .map(event => [event.timingPoint, event.details?.item ?? event.target?.ref.id]);

test('targeting-trigger-fires-on-becoming-target: the targeting effect resolves before the spell', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .deck(['d1'], { owner: 'B' })
    .unit('t1', { owner: 'B', might: 3, location: atBattlefield('bf1') }));
  s.watch('t1-targeting-effect', 't1', { filter: { target: { objectId: 't1' } } });
  const spell = s.draft('spell', {
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: constant(1), target: 't1' } }],
    targets: [{ requirement: { id: 't1', filter: { type: 'unit', zone: 'board', controller: 'B' } } }],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });
  s.engine.execute(spell);

  assert.deepEqual(s.engine.items.map(item => item.kind), ['spell', 'triggered']);
  assert.deepEqual(openedChain(s.engine), [
    ['chain-item-pending', 'spell'],
    ['became-target', 't1'],
    ['chain-item-pending', 'trigger:1'],
    ['chain-item-finalize', 'spell'],
    ['chain-item-finalize', 'trigger:1']
  ]);

  spend(s.engine);
  assert.equal(s.kernel.player('B').handSize, 1, 'the targeting effect resolved');
  assert.equal(s.kernel.getObject('t1').damage, 1);
  assert.deepEqual(s.engine.trace.filter(event => event.step === 'resolved').map(event => event.item), ['trigger:1', 'spell']);
});
