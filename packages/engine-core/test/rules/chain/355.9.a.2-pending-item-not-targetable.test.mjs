// Scenario chain-pending-item-not-targetable (CR v1.5 355.9.a, 355.9.a.2).
//
// "Spell" and "ability" name Finalized objects on the Chain unless the card says
// otherwise, so a Pending item is never a legal target for one. When a counter is
// the only Pending item and the target set is still Pending, Finalize finds no
// legal choice and the ability is removed (403.4) without paying its cost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, counterInstruction, c, stages } from './support.mjs';

test('chain-pending-item-not-targetable: a Pending Chain Item is not a legal spell target', () => {
  const f = chainFixture({ energy: { A: 1 } });

  // A rules-generated ability waits on the Chain as Pending (329.1).
  f.engine.enqueue(f.activated('first', [], { kind: 'triggered' }));
  const pending = f.engine.items[0];
  assert.equal(pending.status, 'pending');
  assert.equal(f.engine.isPending(pending.object), true);

  // A counter that may only target a spell on the Chain waits behind it. While
  // both are Pending, 355.9.a.2 gives the counter no legal object.
  f.engine.enqueue(f.activated('counter', [counterInstruction('cnt', 'first', 'chain')], {
    kind: 'triggered',
    targets: [{ requirement: { id: 'chain', filter: { type: 'spell', zone: 'chain' }, max: 1 } }],
    cost: { id: 'cost:counter', cost: { energy: c(1), power: c([]) } },
  }));
  assert.deepEqual(f.engine.items.map(item => item.id + ':' + item.status), ['first:pending', 'counter:pending']);

  f.engine.advance();

  assert.deepEqual(stages(f.engine), [
    'pending:first', 'pending:counter',
    'finalized:first',
    'removed:counter(unperformable-trigger)',
  ]);
  assert.equal(f.engine.trace.find(event => event.step === 'removed').reason, 'unperformable-trigger');
  assert.equal(f.kernel.player('A').energy, 1, 'the removed ability paid nothing');
  assert.deepEqual(f.engine.items.map(item => item.id + ':' + item.status), ['first:finalized']);
});
