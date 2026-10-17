// Scenario chain-simultaneous-triggers-turn-order (CR v1.5 303.2.a, 383.3.d.1).
//
// 383.3.d.1: when several players control abilities Triggered simultaneously, the
// Turn Player orders theirs first and then Turn Order continues; each player
// decides the order of their own items (303.2.a).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, addEnergyInstruction, drawInstruction, registerTrigger, settle, stages } from './support.mjs';

test('chain-simultaneous-triggers-turn-order: the turn player appends first and resolves last', () => {
  const f = chainFixture({
    energy: { A: 0, B: 0 },
    board: builder => builder.unit('b1', { owner: 'B', might: 3, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  registerTrigger(f.engine, f.kernel, {
    id: 'A-draw', controller: 'A', spec: { at: 'damage-dealt', filter: {} }, body: [drawInstruction('a')],
  });
  registerTrigger(f.engine, f.kernel, {
    id: 'B-add', source: 'b1', controller: 'B', spec: { at: 'damage-dealt', filter: {} },
    body: [addEnergyInstruction('b', 'B', 1)],
  });

  f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 1, combat: false });
  assert.deepEqual(
    f.engine.items.map(item => item.id + ':' + item.controller),
    ['trigger:1:A', 'trigger:2:B'],
    '303.2.a: the turn player A appends before B',
  );

  settle(f.engine);

  // 340.1: the last one appended resolves first, so B's Add resolves before A's Draw.
  assert.deepEqual(stages(f.engine), [
    'pending:trigger:1', 'pending:trigger:2',
    'finalized:trigger:1', 'finalized:trigger:2',
    'resolved:trigger:2', 'removed:trigger:2(resolved)',
    'resolved:trigger:1', 'removed:trigger:1(resolved)',
  ]);
  assert.equal(f.kernel.player('B').energy, 1);
  assert.equal(f.kernel.player('A').handSize, 1);
});
