// Golden tests for the Final Point restriction — CR v1.5 473.1.b.1 (and 194.3/474).
//
// Scenario ids covered here (docs/rules/scenarios/scoring.yaml):
//   scoring-final-point-conquer-single-battlefield-draws executed
//   scoring-final-point-above-victory-still-restricted   executed
//   scoring-final-point-second-conquer-after-hold-scores executed (driver; leaf in 472-*.test.mjs)
//   scoring-victory-score-altered-by-effect              executed (leaf kernel + driver)
//
// The replacement draw is driven by the real TurnFlow score wave, so the draw event,
// the ledger write and the final-point timing point all come from the merged kernel.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  turnFixture, settle, move, eventsAt, newDuelBoard, scoringState, conquerTiming,
  scoreDuelBattlefield, setDuelVictoryScoreForEffect, getDuelWinnerAtCleanup, pointsOf, establishControl,
} from './harness.mjs';

test('scoring-final-point-conquer-single-battlefield-draws (473.1.b.1): one point below the Victory Score a Conquer draws instead of scoring', () => {
  const f = turnFixture({
    score: { A: 7, B: 5 },
    setup: w => w.unit('u1', { location: { type: 'base', player: 'A' }, might: 4 }),
  });
  f.flow.start();
  const handBefore = f.kernel.player('A').handCount;

  f.flow.execute(f.activated('enter', [move('m1', { type: 'battlefield', id: 'bf1' })], 'A', 'u1'));
  settle(f);

  // The Conquer still happened (473.1.b); the point was replaced by exactly one draw.
  assert.equal(eventsAt(f, 'conquer').length, 1);
  assert.equal(eventsAt(f, 'final-point').length, 1);
  assert.equal(eventsAt(f, 'points-gained').length, 0);
  assert.equal(f.kernel.player('A').handCount, handBefore + 1);
  assert.equal(f.kernel.player('A').score, 7);
  // The ledger is written for this Score even though the point was replaced.
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.equal(f.flow.winner, null);
});

test('scoring-final-point-above-victory-still-restricted (473.1.b.1): the restriction also applies when already at the Victory Score', () => {
  const f = turnFixture({
    score: { A: 8, B: 8 },
    setup: w => w.unit('u1', { location: { type: 'base', player: 'A' }, might: 4 }),
  });
  f.flow.start();
  const handBefore = f.kernel.player('A').handCount;

  f.flow.execute(f.activated('enter', [move('m1', { type: 'battlefield', id: 'bf1' })], 'A', 'u1'));
  settle(f);

  assert.equal(eventsAt(f, 'final-point').length, 1);
  assert.equal(eventsAt(f, 'points-gained').length, 0);
  assert.equal(f.kernel.player('A').handCount, handBefore + 1);
  assert.equal(f.kernel.player('A').score, 8);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.equal(f.flow.winner, null);
});

test('scoring-final-point-second-conquer-after-hold-scores (473.1.b.1): the Final Point is granted once every Battlefield is Scored', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 6, B: 6 },
    setup: w => {
      w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 });
      w.unit('u2', { location: { type: 'base', player: 'A' }, might: 4 });
    },
  });
  f.flow.start();
  // Hold brought A to 7 and wrote bf1 to the ledger; the game is still live (7 < 8).
  assert.equal(f.kernel.player('A').score, 7);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.equal(f.flow.winner, null);

  f.flow.execute(f.activated('enter-bf2', [move('m2', { type: 'battlefield', id: 'bf2' })], 'A', 'u2'));
  settle(f);
  // Every Battlefield is now in the ledger, so 473.1.b.1 grants the Final Point instead of
  // the replacement draw; the Cleanup then finds the unique leader.
  assert.equal(f.kernel.player('A').score, 8);
  assert.equal(eventsAt(f, 'final-point').length, 0);
  assert.equal(eventsAt(f, 'points-gained').length, 2);
  assert.deepEqual(f.flow.scored('A').slice().sort(), ['bf1', 'bf2']);
  assert.equal(f.flow.winner, 'A');
});

test('scoring-victory-score-altered-by-effect (194.3.a / 474): a raised Victory Score stops the eighth point from winning', () => {
  // Leaf: 9 points no longer satisfies a Victory Score of 10.
  const { board } = newDuelBoard();
  const base = scoringState(board, { points: { A: 9, B: 5 }, victoryScore: 8, turnNumber: 11 });
  assert.equal(getDuelWinnerAtCleanup(base, board), 'A');
  const altered = setDuelVictoryScoreForEffect(base, board, 10);
  assert.equal(altered.victoryScore, 10);
  assert.equal(getDuelWinnerAtCleanup(altered, board), null);
  assert.equal(pointsOf(altered, 'A'), 9);
  // A mode may lower it too; the check always compares against the current value.
  const lowered = setDuelVictoryScoreForEffect(altered, board, 6);
  assert.equal(getDuelWinnerAtCleanup(lowered, board), 'A');
});

test('scoring-victory-score-altered-by-effect (194.3.a / 474): the real driver uses its configured Victory Score', () => {
  const f = turnFixture({
    score: { A: 9, B: 5 },
    victoryScore: 10,
    setup: w => w.unit('u1', { location: { type: 'base', player: 'A' } }),
  });
  f.flow.start();
  // 9 < 10, so no winner is recorded and play continues into the Main Phase.
  assert.equal(f.flow.winner, null);
  assert.equal(f.flow.phase, 'main');
  assert.equal(f.kernel.player('A').score, 9);
});

test('scoring-burnout-draw-empty-grants-point (194.1.d / 432.2): Burn Out replaces an empty final-point draw', () => {
  const f = turnFixture({ score: { A: 7 }, deck: 0,
    setup: w => w.card('trash-card', { zone: 'trash', owner: 'A' }) });
  f.flow.start();
  assert.equal(f.kernel.player('B').score, 1);
  assert.equal(f.kernel.player('A').score, 7);
  assert.equal(f.kernel.player('A').handCount, 1);
});

test('scoring-final-point-second-conquer-after-hold-scores (473.1.b.1): the leaf kernel grants the Final Point when the ledger covers every Battlefield', () => {
  const { board, f1, f2 } = newDuelBoard();
  let controlled = establishControl(board, f1, 'A', 'u1');
  controlled = establishControl(controlled, f2, 'A', 'u2');
  const state = scoringState(controlled, { points: { A: 7, B: 5 }, ledger: { A: [f1] }, turnNumber: 11 });
  const result = scoreDuelBattlefield(state, controlled, 'A', f2, 'conquer', conquerTiming('A', 'A', f2));
  assert.equal(result.outcome.pointsGained, 1);
  assert.equal(result.outcome.drawRequired, 0);
  assert.equal(result.state.players[0].points, 8);
  assert.deepEqual(result.state.players[0].scoredBattlefieldLocationIds.slice().sort(), [f1, f2].sort());
});
