// Scenario chain-lifo-resolution-order (CR v1.5 340.1, 340.4, 339.1).
//
// Once every player passes in a row (339.1) the newest Finalized Chain Item
// resolves first (340.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, damageInstruction, stages, resolveAll, timings } from './support.mjs';

test('chain-lifo-resolution-order: the newest Finalized item resolves first', () => {
  const f = chainFixture({
    energy: { A: 3, B: 1 },
    cards: [
      { id: 's1', types: ['spell'], energy: 2, power: [] },
      { id: 's2', types: ['spell'], energy: 1, power: [] },
    ],
    board: builder => builder.unit('u1', { owner: 'B', might: 3, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });

  f.engine.execute(f.spell('s1', [damageInstruction('big', 3, 'u1')]));
  f.engine.pass('A');
  f.engine.execute(f.spell('s2', [damageInstruction('small', 1, 'u1')], { controller: 'B', speed: 'reaction' }));
  assert.equal(f.engine.items.length, 2);
  resolveAll(f.engine);

  assert.deepEqual(
    stages(f.engine).filter(stage => stage.startsWith('resolved')),
    ['resolved:s2', 'resolved:s1'],
    '340.1: last in, first out',
  );
  // Both spells resolved: the later 3 damage is not lost to the earlier 1 damage.
  assert.equal(f.kernel.getObject('u1').damage, 4);
  assert.equal(f.kernel.getObject('u1').zone, 'trash', 'four damage is lethal to a 3-Might Unit');
  // 339.1: resolution happens after consecutive passes, so Resolve follows Finalize.
  const order = timings(f.engine);
  assert.ok(order.indexOf('chain-item-resolve') > order.indexOf('chain-item-finalize'));
});
