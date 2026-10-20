// Scenarios `turn-draw-burnout-recycles-trash-and-gives-point` (CR v1.5 315.4.b.1 /
// 414.4 / 432.2) and `turn-burnout-repeated-until-opponent-wins` (CR v1.5 432.3 /
// 432.3.c.1).
//
// Burn Out is a multi-step structural rule task: recycle the whole Trash into the
// Main Deck (randomized, 432.2.b), the burned-out player chooses an opponent to gain
// 1 point (432.2.c), then the remaining draws complete (432.2.d); on an empty Deck
// and Trash the process repeats and the points become unreplaceable, with an
// immediate win at the Victory Score (432.3.c.1). The merged TurnFlow executes these
// steps through real recycle, shuffle, point-gain and continued-draw actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../../turn/helpers.mjs';

test('turn-draw-burnout-recycles-trash-and-gives-point: real Burn Out recycles, scores opponent, and draws', () => {
  const f = fixture({ deck: false, score: { B: 3 }, setup: w => w.card('trash-1', { zone: 'trash' }) });
  f.flow.start();
  assert.equal(f.flow.phase, 'main');
  assert.equal(f.kernel.player('B').score, 4);
  assert.equal(f.kernel.player('A').handCount, 1);
  assert.ok(f.flow.chain.pipeline.events.some(event => event.timingPoint === 'card-drawn'));
});

test('turn-burnout-repeated-until-opponent-wins: repeated empty-deck Burn Out ends immediately at threshold', () => {
  const f = fixture({ deck: false });
  f.flow.start();
  assert.equal(f.kernel.player('B').score, 8);
  assert.equal(f.flow.winner, 'B');
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'points-gained').length, 8);
});
