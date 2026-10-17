// Scenario chain-unit-gear-resolve-immediately-on-finalize (CR v1.5 337.2, 359.2.c, 359.2.d).
//
// After finalizing, a Unit or (Non-Unit) Gear resolves immediately: the Unit
// enters the Board exhausted (359.2.c) while Gear enters Ready (359.2.d), with no
// reaction window in between.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, stages } from './support.mjs';

test('chain-unit-gear-resolve-immediately-on-finalize: the permanent boards right after Finalize', () => {
  for (const [kind, expectedReady] of [['unit', false], ['gear', true]]) {
    const f = chainFixture({
      energy: { A: 3 },
      cards: [{ id: kind, types: [kind], energy: 2, power: kind === 'gear' ? [] : [], might: 3 }],
    });
    const draft = f.activated(kind, [], {
      source: f.kernel.getObject(kind), kind, speed: 'normal', location: { type: 'base', player: 'A' },
    });
    f.engine.execute(draft);

    assert.equal(f.kernel.getObject(kind).zone, 'board');
    assert.equal(f.kernel.getObject(kind).exhausted, !expectedReady);
    assert.equal(f.kernel.getObject(kind).location.type, 'base');
    assert.equal(f.engine.items.length, 0, 'the permanent left the Chain on Finalize (337.2)');
    assert.deepEqual(stages(f.engine), ['pending:' + kind, 'finalized:' + kind, 'resolved:' + kind, 'removed:' + kind + '(resolved)']);
    assert.equal(f.engine.trace.some(event => event.step === 'pass'), false, 'no reaction window was offered');
    assert.equal(f.kernel.player('A').energy, 1);
  }
});
