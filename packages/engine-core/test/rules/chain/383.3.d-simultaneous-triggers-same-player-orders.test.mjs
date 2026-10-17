// Scenario chain-simultaneous-triggers-same-player-orders (CR v1.5 383.3.d, 340.1).
//
// 383.3.d: when one player controls several abilities Triggered simultaneously,
// that player chooses the order they are put on the Chain. 340.1 then resolves
// them in the opposite order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, addEnergyInstruction, drawInstruction, registerTrigger, settle, stages } from './support.mjs';

test('chain-simultaneous-triggers-same-player-orders: the controller picks the append order and LIFO resolves it', () => {
  // The ChoiceRequest offers the remaining abilities; the fixture answers the last one,
  // i.e. the controller appends the Draw ability before the Add ability.
  const f = chainFixture({ energy: { A: 0 }, choose: request => request.type === 'mode' ? request.options.at(-1) : undefined });
  registerTrigger(f.engine, f.kernel, { id: 'draw-one', spec: { at: 'damage-dealt', filter: {} }, body: [drawInstruction('d')] });
  registerTrigger(f.engine, f.kernel, { id: 'add-one', spec: { at: 'damage-dealt', filter: {} }, body: [addEnergyInstruction('a', 'A', 1)] });

  f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 1, combat: false });
  assert.deepEqual(f.engine.items.map(item => item.id + ':' + item.controller), ['trigger:1:A', 'trigger:2:A']);
  assert.equal(f.asked.filter(request => request.type === 'mode').length >= 1, true, '383.3.d: the controller was asked for the order');

  settle(f.engine);

  assert.deepEqual(stages(f.engine), [
    'pending:trigger:1', 'pending:trigger:2',
    'finalized:trigger:1', 'finalized:trigger:2',
    'resolved:trigger:2', 'removed:trigger:2(resolved)',
    'resolved:trigger:1', 'removed:trigger:1(resolved)',
  ]);
  assert.equal(f.kernel.player('A').energy, 1);
  assert.equal(f.kernel.player('A').handSize, 1);
});
