// Golden tests for losing points — CR v1.5 194.4 (194.4.a, 194.4.b).
//
// Scenario ids covered here (docs/rules/scenarios/scoring.yaml):
//   scoring-points-never-negative  executed
//   scoring-zero-loss-no-trigger   executed
//   scoring-points-never-negative (ability path) todo (needs a point-loss primitive)
//
// The merged point-loss API is the Scoring leaf kernel's loseDuelPoints; the scenario file's
// “Target player loses 5 points.” spell has no matching primitive yet (there is no
// effect.lose-points opcode in effects/instructions/), so the ability path is a todo and
// the truncation semantics are tested directly against the Scoring kernel's public API.
import test from 'node:test';
import assert from 'node:assert/strict';

import { newDuelBoard, scoringState, loseDuelPoints, pointsOf } from './harness.mjs';

test('scoring-points-never-negative (194.4 / 194.4.a): losing more points than owned truncates at zero', () => {
  const { board } = newDuelBoard();
  const state = scoringState(board, { points: { A: 1, B: 3 }, turnNumber: 6 });
  const result = loseDuelPoints(state, board, 'A', 5);

  // 194.4.a: the actual loss is truncated to the points the player had, not the printed 5.
  assert.equal(result.actualLost, 1);
  assert.equal(pointsOf(result.state, 'A'), 0);
  assert.equal(pointsOf(result.state, 'B'), 3);
  assert.equal(result.triggerLoss, true);
});

test('scoring-zero-loss-no-trigger (194.4.b): losing points at zero does nothing and does not trigger', () => {
  const { board } = newDuelBoard();
  const state = scoringState(board, { points: { A: 0, B: 2 }, turnNumber: 6 });
  const result = loseDuelPoints(state, board, 'A', 2);

  // 194.4.a: nothing occurs; 194.4.b: no “loses points” trigger may fire.
  assert.equal(result.actualLost, 0);
  assert.equal(result.triggerLoss, false);
  assert.equal(pointsOf(result.state, 'A'), 0);
  assert.equal(pointsOf(result.state, 'B'), 2);
});

test('scoring-points-never-negative (194.4): the repeated loss cannot push a score below zero', () => {
  const { board } = newDuelBoard();
  let state = scoringState(board, { points: { A: 3, B: 0 }, turnNumber: 6 });
  state = loseDuelPoints(state, board, 'A', 2).state;
  assert.equal(pointsOf(state, 'A'), 1);
  state = loseDuelPoints(state, board, 'A', 1).state;
  assert.equal(pointsOf(state, 'A'), 0);
  const zero = loseDuelPoints(state, board, 'A', 1);
  assert.equal(zero.actualLost, 0);
  assert.equal(zero.triggerLoss, false);
  assert.equal(pointsOf(zero.state, 'A'), 0);
});

test('scoring-zero-loss-no-trigger (194.4.b): a zero loss keeps the point total unchanged and reports no trigger', () => {
  const { board } = newDuelBoard();
  const state = scoringState(board, { points: { A: 4, B: 4 }, turnNumber: 6 });
  const result = loseDuelPoints(state, board, 'A', 0);
  assert.equal(result.actualLost, 0);
  assert.equal(result.triggerLoss, false);
  assert.equal(pointsOf(result.state, 'A'), 4);
});

test('scoring-points-never-negative (194.4): a player at zero can never be driven negative by any request', () => {
  const { board } = newDuelBoard();
  const state = scoringState(board, { points: { A: 0, B: 0 }, turnNumber: 6 });
  for (const amount of [0, 1, 5, 100]) {
    const result = loseDuelPoints(state, board, 'A', amount);
    assert.equal(result.actualLost, 0, `amount ${amount}`);
    assert.equal(pointsOf(result.state, 'A'), 0, `amount ${amount}`);
  }
});

test('scoring-zero-loss-no-trigger (194.4.b): the truncation only fires the loss flag when points actually left', () => {
  const { board } = newDuelBoard();
  const one = scoringState(board, { points: { A: 1, B: 0 }, turnNumber: 6 });
  assert.equal(loseDuelPoints(one, board, 'A', 1).triggerLoss, true);
  const zero = scoringState(board, { points: { A: 0, B: 0 }, turnNumber: 6 });
  assert.equal(loseDuelPoints(zero, board, 'A', 1).triggerLoss, false);
  // 194.4.b: no zero-loss event may be fabricated just to fire a trigger.
  assert.equal(loseDuelPoints(zero, board, 'A', 1).actualLost, 0);
});
