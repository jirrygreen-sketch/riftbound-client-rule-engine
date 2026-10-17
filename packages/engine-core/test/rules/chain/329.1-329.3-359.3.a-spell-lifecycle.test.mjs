// Scenario chain-spell-lifecycle-pending-finalize-resolve (CR v1.5 329.1, 329.3, 359.3.a, 340.1).
//
// A spell played from Hand is Pending, becomes a Finalized item on the Chain (it
// stays there, 359.3.a), and only leaves to its owner's Trash when the newest
// Finalized item resolves after both players pass (340.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, damageInstruction, stages, resolveAll, assertSubsequence } from './support.mjs';

test('chain-spell-lifecycle-pending-finalize-resolve: the spell passes Pending -> Finalized -> Resolve into Trash', () => {
  const f = chainFixture({
    energy: { A: 2 },
    cards: [{ id: 'spell', types: ['spell'], energy: 1, power: [] }],
    board: builder => builder.unit('u1', { owner: 'B', might: 2, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.engine.execute(f.spell('spell', [damageInstruction('hit', 2, 'u1')]));

  // 329.1/329.3: the card is on the Chain as a Finalized Item, not yet resolved.
  assert.deepEqual(stages(f.engine), ['pending:spell', 'finalized:spell']);
  assert.equal(f.kernel.getObject('spell').zone, 'chain');
  assert.equal(f.kernel.getObject('u1').damage, 0);
  assert.equal(f.kernel.player('A').energy, 1);

  resolveAll(f.engine);

  assert.equal(f.kernel.getObject('u1').damage, 2);
  assert.equal(f.kernel.getObject('spell').zone, 'trash');
  assert.deepEqual(f.kernel.objectsInZone('A', 'trash').map(ref => ref.id), ['spell']);
  assert.deepEqual(stages(f.engine), ['pending:spell', 'finalized:spell', 'resolved:spell', 'removed:spell(resolved)']);
  // 340.1: the committed timing sequence is Pending -> Finalize -> Resolve.
  assertSubsequence(
    f.engine.pipeline.events.map(event => event.details?.item ? event.timingPoint + ':' + event.details.item : event.timingPoint),
    ['chain-item-pending:spell', 'chain-item-finalize:spell', 'chain-item-resolve:spell'],
  );
});
