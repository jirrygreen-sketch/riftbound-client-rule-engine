// Scenario chain-trigger-cost-declined-not-countered (CR v1.5 405.2, 405.2.a, 404.1.b.1).
//
// A Triggered Ability's leading cost is its base cost (404.1.b.1) and must be
// paid to finalize it. Declining at the Pay Costs step leaves the ability on the
// Chain but unsolved, and it is explicitly not a counter (405.2.a).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, drawInstruction, registerTrigger, c, stages } from './support.mjs';

test('chain-trigger-cost-declined-not-countered: declining the pay step never executes the ability', () => {
  const f = chainFixture({ energy: { A: 2 } });
  registerTrigger(f.engine, f.kernel, {
    id: 'paid-trigger',
    spec: { at: 'card-drawn', filter: {} },
    body: [drawInstruction('reward')],
    mayAtFinalize: true,
    cost: { id: 'cost', cost: { energy: c(1) } },
  });

  f.engine.commit({ type: 'draw', player: 'A', amount: 1 });
  try { f.engine.advance(); } catch (error) {
    assert.match(String(error.message), /finalize:trigger:1:optional/);
    f.answers.set(f.asked.at(-1).id, false);
    f.engine.advance();
  }

  assert.equal(f.kernel.player('A').energy, 2, '405.2: declining pays nothing');
  assert.equal(f.kernel.player('A').handSize, 1, 'the effect never executed');
  assert.equal(f.engine.items.length, 0);
  assert.deepEqual(stages(f.engine), ['pending:trigger:1', 'removed:trigger:1(declined)']);
  assert.deepEqual(f.engine.trace.filter(event => event.step === 'removed').map(event => event.reason), ['declined']);
  assert.equal(f.engine.trace.some(event => event.reason === 'countered'), false, '405.2.a: not a counter');
});
