// Scenario chain-play-creates-closed-state (CR v1.5 331.1, 354.1, 309.1).
//
// Playing the first card of an Open State Closes it (354.1). While a Chain
// exists the turn is in a Closed State (331.1), in which only Reaction-speed
// cards may be played (309.1.a).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, damageInstruction, stages, resolveAll } from './support.mjs';

test('chain-play-creates-closed-state: the first play Closes the State and only Reaction may respond', () => {
  const f = chainFixture({
    energy: { A: 2, B: 1 },
    cards: [
      { id: 's1', owner: 'A', types: ['spell'], energy: 1, power: [] },
      { id: 's2', owner: 'B', types: ['spell'], energy: 1, power: [] },
    ],
    board: builder => builder.unit('u1', { owner: 'A', might: 4, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });

  f.engine.execute(f.spell('s1', [damageInstruction('hit-1', 1, 'u1')]));

  // 331.1 / 354.1: the Chain exists, so the turn is Closed and A may no longer act normally.
  assert.equal(f.engine.turnState, 'neutral-closed');
  assert.equal(f.engine.canAct('A', 'normal'), false);

  // 312.2.d: the responding player only acts after the turn player passes.
  assert.equal(f.engine.canAct('B', 'reaction'), false);
  f.engine.pass('A');
  assert.equal(f.engine.canAct('B', 'reaction'), true);
  assert.equal(f.engine.canAct('B', 'normal'), false);

  // 309.1.a: only Reaction is admitted; a plain-speed play cannot respond.
  assert.throws(
    () => f.engine.execute(f.spell('s2', [damageInstruction('hit-2', 1, 'u1')], { controller: 'B' })),
    /legally timed/,
  );
  assert.equal(f.kernel.getObject('s2').zone, 'hand', 'the rejected play left the card in Hand');

  f.engine.execute(f.spell('s2', [damageInstruction('hit-2', 1, 'u1')], { controller: 'B', speed: 'reaction' }));
  resolveAll(f.engine);

  // 340.1: B's Reaction resolves before the spell it responded to, so u1 keeps both hits.
  assert.deepEqual(stages(f.engine), [
    'pending:s1', 'finalized:s1', 'pending:s2', 'finalized:s2',
    'resolved:s2', 'removed:s2(resolved)', 'resolved:s1', 'removed:s1(resolved)',
  ]);
  assert.equal(f.kernel.getObject('u1').damage, 2);
  assert.deepEqual(f.kernel.objectsInZone('A', 'trash').map(ref => ref.id), ['s1']);
  assert.deepEqual(f.kernel.objectsInZone('B', 'trash').map(ref => ref.id), ['s2']);
  assert.equal(f.engine.turnState, 'neutral-open');
});
