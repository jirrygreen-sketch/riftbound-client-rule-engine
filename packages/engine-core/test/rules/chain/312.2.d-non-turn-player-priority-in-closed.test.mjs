// Scenario chain-non-turn-player-priority-in-closed (CR v1.5 312.2.d, 338.1.b.1).
//
// While the turn is Closed the non-turn player receives Priority once the turn
// player has acted or passed, and then may respond in Turn Order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, damageInstruction, resolveAll, timings } from './support.mjs';

test('chain-non-turn-player-priority-in-closed: the opponent receives Priority after the turn player', () => {
  const f = chainFixture({
    energy: { A: 1, B: 1 },
    cards: [
      { id: 's1', owner: 'A', types: ['spell'], energy: 1, power: [] },
      { id: 's2', owner: 'B', types: ['spell'], energy: 1, power: [] },
    ],
    board: builder => builder.unit('u1', { owner: 'B', might: 4, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });

  f.engine.execute(f.spell('s1', [damageInstruction('h1', 1, 'u1')]));
  // 312.2.c: the controller of the newest item has Priority first.
  assert.equal(f.engine.priority, 'A');
  assert.equal(f.engine.canAct('B', 'reaction'), false);
  assert.throws(
    () => f.engine.execute(f.spell('s2', [damageInstruction('h2', 1, 'u1')], { controller: 'B', speed: 'reaction' })),
    /legally timed/,
  );

  // 312.2.d: the next player in Turn Order receives Priority when A passes.
  const marker = f.engine.pipeline.events.length;
  f.engine.pass('A');
  assert.equal(f.engine.priority, 'B');
  assert.equal(f.engine.canAct('B', 'reaction'), true);
  assert.deepEqual(
    timings(f.engine).slice(0, 1),
    ['object-leaves-zone'],
    'the pass committed no new timing of its own',
  );
  assert.equal(f.engine.pipeline.events.length >= marker, true);

  f.engine.execute(f.spell('s2', [damageInstruction('h2', 1, 'u1')], { controller: 'B', speed: 'reaction' }));
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject('u1').damage, 2);
});
