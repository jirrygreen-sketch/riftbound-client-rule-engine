// Scenario chain-multiple-pending-finalized-oldest-first (CR v1.5 337.1, 337.1.b, 383.3.d).
//
// With several Pending items the controller of the oldest one Finalizes first,
// and Finalization strictly follows the order items were appended to the Chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, addEnergyInstruction, drawInstruction, registerTrigger, resolveAll } from './support.mjs';

test('chain-multiple-pending-finalized-oldest-first: Pending items Finalize oldest-first and resolve newest-first', () => {
  // 383.3.d: the controller orders the simultaneous triggers; the fixture answers
  // the order ChoiceRequest with the first remaining option each time.
  const f = chainFixture({ energy: { A: 0 }, choose: request => request.type === 'mode' ? request.options[0] : undefined });
  registerTrigger(f.engine, f.kernel, { id: 'first', spec: { at: 'damage-dealt', filter: {} }, body: [addEnergyInstruction('a', 'A', 1)] });
  registerTrigger(f.engine, f.kernel, { id: 'second', spec: { at: 'damage-dealt', filter: {} }, body: [drawInstruction('b')] });
  registerTrigger(f.engine, f.kernel, { id: 'third', spec: { at: 'damage-dealt', filter: {} }, body: [addEnergyInstruction('c', 'A', 1)] });

  // One physical damage event Triggers all three abilities of the same controller.
  f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 1, combat: false });
  assert.deepEqual(
    f.engine.items.map(item => item.id + ':' + item.status),
    ['trigger:1:pending', 'trigger:2:pending', 'trigger:3:pending'],
  );

  f.engine.advance();
  assert.deepEqual(
    f.engine.trace.filter(event => event.step === 'finalized').map(event => event.item),
    ['trigger:1', 'trigger:2', 'trigger:3'],
    '337.1.b: Finalize in the order the items were appended',
  );

  resolveAll(f.engine);
  assert.deepEqual(
    f.engine.trace.filter(event => event.step === 'resolved').map(event => event.item),
    ['trigger:3', 'trigger:2', 'trigger:1'],
    '340.1: the newest Finalized item resolves first',
  );
  assert.equal(f.kernel.player('A').energy, 2, 'the two Add triggers resolved');
  assert.equal(f.kernel.player('A').handSize, 1, 'the one Draw trigger resolved');
  assert.equal(f.engine.items.length, 0);
});
