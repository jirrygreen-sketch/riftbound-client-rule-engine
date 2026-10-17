// Scenario chain-optional-trigger-declined-removed (CR v1.5 403.1.a, 383.3.a.2, 383.3.e.2.b, 386.2.b).
//
// A "you may" that opens a Triggered Ability's effect is decided during
// finalization (383.3.a). Declining removes the ability from the Chain (403.1.a)
// and is not a counter (426.1), so a "once each turn" ability was never
// performed and can trigger again (386.2.b).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, drawInstruction, registerTrigger, stages } from './support.mjs';

test('chain-optional-trigger-declined-removed: a declined "you may" trigger leaves the Chain unexecuted', () => {
  const f = chainFixture({ energy: { A: 0 } });
  registerTrigger(f.engine, f.kernel, {
    id: 'may-watch',
    spec: { at: 'card-drawn', filter: {}, once: 'per-turn' },
    body: [drawInstruction('bonus')],
    mayAtFinalize: true,
  });

  f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.equal(f.engine.items.length, 1, 'the "you may" trigger does trigger (383.3.e.2)');
  assert.equal(f.engine.items[0].status, 'pending');

  try { f.engine.advance(); } catch (error) {
    assert.match(String(error.message), /finalize:trigger:1:optional/);
    f.answers.set(f.asked.at(-1).id, false);
    f.engine.advance();
  }

  // 403.1.a / 383.3.a.2: it is removed without executing and without a counter.
  assert.deepEqual(stages(f.engine), ['pending:trigger:1', 'removed:trigger:1(declined)']);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.kernel.player('A').handSize, 1, 'only the ordinary draw happened');
  assert.equal(
    f.engine.trace.some(event => event.reason === 'countered'),
    false,
    '403.1.a: removal by declining is not a counter',
  );

  // 386.2.b: the declined "once each turn" ability was never performed, so the
  // next fulfilment of its condition triggers it again.
  f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.equal(f.engine.items.length, 1, 'the declined once-each-turn ability triggers again');
  assert.equal(f.engine.items[0].id, 'trigger:2');
});
