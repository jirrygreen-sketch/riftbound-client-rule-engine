// Scenario chain-no-cleanup-during-resolution (CR v1.5 321, 321.1, 323.4).
//
// 321 forbids Cleanups while a Chain Item resolves, so every instruction of the
// resolving effect completes first; the lethal-damage Kill (323.4) is only
// applied by the Cleanup after the item left the Chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, damageInstruction, drawInstruction, resolveAll, timings } from './support.mjs';

test('chain-no-cleanup-during-resolution: the whole effect resolves before the lethal Cleanup', () => {
  const f = chainFixture({
    energy: { A: 2 },
    cards: [{ id: 'spell', owner: 'A', types: ['spell'], energy: 2, power: [] }],
    board: builder => builder.unit('u1', { owner: 'B', might: 3, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  // "Deal 3 to a unit, then draw 1" - two separate instructions of one effect.
  f.engine.execute(f.spell('spell', [damageInstruction('kill', 3, 'u1'), drawInstruction('after')]));
  resolveAll(f.engine);

  const order = timings(f.engine);
  const damage = order.indexOf('damage-dealt');
  const draw = order.indexOf('card-drawn');
  const resolved = order.indexOf('chain-item-resolve');
  const killed = order.indexOf('object-killed');
  assert.ok(damage < draw && draw < resolved, 'both instructions finished before the item Resolved');
  assert.ok(
    killed > resolved,
    '321: the lethal-damage Kill is deferred to the Cleanup after the Resolve',
  );
  assert.equal(order.slice(damage, resolved).includes('object-killed'), false);
  assert.deepEqual(f.kernel.objectsInZone('B', 'trash').map(ref => ref.id), ['u1']);
  assert.equal(f.kernel.player('A').handSize, 1, 'the draw still happened before the Cleanup');
});
