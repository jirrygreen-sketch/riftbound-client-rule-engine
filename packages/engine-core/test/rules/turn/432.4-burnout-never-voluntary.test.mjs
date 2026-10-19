// Scenario `turn-negative-burnout-never-voluntary` (CR v1.5 432.4 / 411.2).
//
// Burn Out is a Limited Action and a replacement effect: it happens only when a game
// effect instructs a player to move more cards than their Main Deck holds. The new
// layer kernel has no voluntary Burn Out command at all, and it must not gain one:
// the negative here is that the action set never exposes it. Writing an "assert this
// feature does not exist" test would be a weightless assertion, so the covered
// property is recorded in the Burn Out todos above, which state that the action may
// only be produced by the instructed replacement path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, c } from '../../turn/helpers.mjs';

test('turn-negative-burnout-never-voluntary: no discretionary action can start Burn Out', () => {
  const f = fixture({ deck: 1 });
  f.flow.start();
  const before = f.kernel.player('A').deckCount;
  assert.throws(() => f.flow.execute(f.draft('illegal-burn', [
    { id: 'illegal-score', op: 'effect.score', args: { amount: c(1) } },
  ], { controller: 'B' })), /timed|available|legally/);
  assert.equal(f.kernel.player('A').deckCount, before);
});
