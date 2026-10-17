// Scenario chain-finalize-does-not-pass-priority (CR v1.5 337.1.a, 312.2.c).
//
// Finalizing an item does not pass Priority (337.1.a); while items are still
// Pending nobody may act (312.2.c). The Priority holder only regains Priority
// once everything is Finalized.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, registerTrigger, c, stages } from './support.mjs';

test('chain-finalize-does-not-pass-priority: Priority is not granted while items are Pending', () => {
  const f = chainFixture({
    energy: { A: 3 },
    cards: [{ id: 'unit', owner: 'A', types: ['unit'], energy: 2, power: [], might: 2 }],
  });
  // The unit's Play Effect becomes a second Pending item right after it boards
  // (383.4.a.2), so the FEPR Finalizes two items without an intervening Priority.
  registerTrigger(f.engine, f.kernel, {
    id: 'play-effect', source: 'unit', controller: 'A',
    spec: { at: 'object-enters-board', filter: { objectId: 'unit' } },
    body: [{ id: 'tail', op: 'effect.draw', args: { amount: c(1) } }],
  });

  f.engine.execute(f.unit('unit', []));
  assert.equal(f.kernel.getObject('unit').zone, 'board');

  const trace = f.engine.trace;
  const first = trace.findIndex(event => event.step === 'finalized' && event.item === 'unit');
  const second = trace.findIndex(event => event.step === 'finalized' && event.item === 'trigger:1');
  assert.ok(first >= 0 && second > first, 'the permanent and its Play Effect both Finalized');
  assert.equal(
    trace.slice(first, second + 1).some(event => event.step === 'priority-granted'),
    false,
    '337.1.a: Finalizing does not pass Priority',
  );
  assert.ok(stages(f.engine).includes('finalized:trigger:1'));
  assert.equal(f.engine.priority, 'A', '312.2.c: Priority returns only with no Pending item');
  assert.equal(f.kernel.player('A').energy, 1, 'the unit paid its printed cost');
});
