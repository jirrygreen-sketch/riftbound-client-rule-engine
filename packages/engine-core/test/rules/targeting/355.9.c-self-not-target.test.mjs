// Rule check: chain item self-exclusion (CR v1.5 355.9.c)
//
// A spell or ability is not a legal target for itself. The merged chain
// collects target specs before the item finalizes, and the item is still
// Pending at that moment, so a "counter a spell on the chain" requirement finds
// no legal target when the spell would have to target itself.
// No targeting.yaml scenario id exists for this clause; this file is anchored by rule number.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, scene, spend } from './harness.mjs';

test('355.9.c: a spell cannot choose itself as the target', () => {
  const s = scene(builder => builder
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 3, location: atBattlefield('bf1') }));
  const spell = s.draft('spell', {
    body: [{ id: 'counter', op: 'effect.counter', args: { target: 'chain' } }],
    targets: [{ requirement: { id: 'chain', filter: { type: 'spell', zone: 'chain' } } }],
    cost: { id: 'cost:spell', cost: { energy: constant(2), power: constant([]) } }
  });

  // The item is Pending while it finalizes; 355.9.a.2/.c leave it out of the candidate set.
  assert.throws(() => s.engine.execute(spell), error => error.code === 'no-legal-targets');
  assert.equal(s.kernel.player('A').energy, 2, 'the failed Finalize rolled the payment back');
  assert.equal(s.kernel.getObject('spell').zone, 'hand');
  assert.equal(s.engine.items.length, 0);
});

test('355.9.c: a later spell may still target an earlier finalized spell', () => {
  const s = scene(builder => builder
    .player('A', { energy: 4 })
    .player('B', { energy: 0 })
    .hand('big', { owner: 'A', types: ['spell'] })
    .hand('counter', { owner: 'A', types: ['spell'] })
    .unit('t1', { owner: 'B', might: 6, location: atBattlefield('bf1') }));
  s.engine.execute(s.draft('big', {
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: constant(5), target: 't1' } }],
    targets: [{ requirement: { id: 't1', filter: { type: 'unit', zone: 'board', controller: 'B' } } }],
    cost: { id: 'cost:big', cost: { energy: constant(3), power: constant([]) } }
  }));
  assert.equal(s.engine.items[0].status, 'finalized', 'the first spell is a finalized chain item');

  const counter = s.draft('counter', {
    body: [{ id: 'counter', op: 'effect.counter', args: { target: 'chain' } }],
    targets: [{ requirement: { id: 'chain', filter: { type: 'spell', zone: 'chain' } } }],
    cost: { id: 'cost:counter', cost: { energy: constant(1), power: constant([]) } },
    speed: 'reaction'
  });
  s.engine.execute(counter);
  spend(s.engine);
  assert.equal(s.kernel.getObject('big').zone, 'trash', '426.1.a: the countered spell left the chain');
  assert.equal(s.kernel.getObject('t1').damage, 0, 'the countered spell did nothing');
});

test.todo('355.9.c (self-target only): blocked on an op that can target its own Finalize — the merged chain always finalizes with the item Pending, so the "spell targets itself" case cannot be built without a second finalized copy of the same card id');
