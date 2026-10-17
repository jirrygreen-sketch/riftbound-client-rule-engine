// Scenario chain-focus-not-passed-after-trigger-opened-chain (CR v1.5 346.1, 340.2.a).
//
// 346.1 is the exception to 340.2.a: if the Chain opened because a Triggered
// Ability was added, closing it does not pass Focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, addEnergyInstruction, registerTrigger, timings } from './support.mjs';

test('chain-focus-not-passed-after-trigger-opened-chain: a trigger-opened Chain leaves Focus with its holder', () => {
  const f = chainFixture({ energy: { A: 0 } });
  f.engine.openShowdown('A');
  assert.equal(f.engine.focus, 'A');
  registerTrigger(f.engine, f.kernel, {
    id: 'damage-watch', spec: { at: 'damage-dealt', filter: {} }, body: [addEnergyInstruction('add', 'A', 1)],
  });

  // The damage is what Triggers the ability, so the new Chain starts with a
  // rules-generated Triggered Ability rather than a played card (346.1).
  f.engine.commit({ type: 'damage', source: f.kernel.ref('source'), target: f.kernel.ref('enemy'), amount: 1, combat: false });
  assert.equal(f.engine.items[0].kind, 'triggered');
  f.engine.advance();

  f.engine.pass('A');
  f.engine.pass('B');

  assert.equal(f.engine.turnState, 'showdown-open');
  assert.equal(f.engine.focus, 'A', '346.1: Focus is not passed for a trigger-opened Chain');
  assert.equal(f.engine.priority, 'A');
  assert.equal(f.kernel.player('A').energy, 1);
  const focusGrants = f.engine.trace.filter(event => event.step === 'focus-granted').map(event => event.player);
  assert.deepEqual(focusGrants, ['A'], 'no second Focus grant happened while the Showdown reopened');
  assert.deepEqual(
    timings(f.engine).filter(id => id === 'showdown-open' || id === 'showdown-close'),
    ['showdown-open'],
  );
});
