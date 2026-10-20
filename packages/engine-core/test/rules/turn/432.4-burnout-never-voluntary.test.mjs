// Scenario `turn-negative-burnout-never-voluntary` (CR v1.5 432.4 / 411.2).
//
// Burn Out is a Limited Action and a replacement effect: it happens only when a
// game effect instructs a player to move more cards than their Main Deck holds.
// The legal Main-Phase actor may submit ordinary abilities, but there is no
// Kill/Exhaust-style Burn Out primitive it can invoke voluntarily. The generic
// interpreter must therefore reject the scenario's `do: burnout` command before
// changing any game state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, c } from '../../turn/helpers.mjs';

test('turn-negative-burnout-never-voluntary: no discretionary action can start Burn Out', () => {
  const f = fixture({ deck: 1 });
  f.flow.start();
  const before = f.kernel.snapshot();
  // A is the legal Main-Phase actor with Priority. A voluntary Burn Out cannot
  // exist merely because that actor can submit an ordinary instruction.
  assert.equal(f.flow.turnPlayer, 'A');
  assert.equal(f.flow.chain.priority, 'A');
  assert.throws(() => {
    f.flow.execute(f.draft('illegal-burn', [
      { id: 'illegal-burn.take', op: 'effect.burn-out', args: { player: c('A') } },
    ]));
    while (f.flow.chain.items.length) f.flow.pass(f.flow.chain.priority);
  }, /Unregistered instruction opcode: effect\.burn-out/);
  assert.deepEqual(f.kernel.snapshot(), before);
});
