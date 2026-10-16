// Golden tests for Victory at Cleanup — CR v1.5 474 / 194.2 and 194.3.
//
// Scenario ids covered here (docs/rules/scenarios/scoring.yaml):
//   scoring-victory-unique-leader-at-cleanup        executed
//   scoring-victory-tie-at-victory-score-continues  executed
//   scoring-victory-not-checked-midturn             executed
//   scoring-ability-point-past-victory-wins-at-cleanup executed
//   scoring-v15-victory-check-moved-to-cleanup      executed
//   scoring-duel-victory-score-eight-two-battlefields executed
//
// The driver checks the Victory Score inside the real Cleanup (src/turn/flow.ts
// cleanup), never at the moment a point is gained. Leaf cases use the Scoring
// query getDuelWinnerAtCleanup.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  turnFixture, settle, eventsAt, timings, newDuelBoard, selectDuelBattlefields, createDuelBoard,
  getDuelWinnerAtCleanup, scoringState, gainDuelPoints, gainPoints, draw,
} from './harness.mjs';

test('scoring-victory-unique-leader-at-cleanup (474 / 194.2): the unique leader at or above the Victory Score wins in the Cleanup', () => {
  const f = turnFixture({
    score: { A: 8, B: 6 },
    setup: w => w.unit('u1', { location: { type: 'base', player: 'A' } }),
  });
  f.flow.start();

  assert.equal(f.flow.winner, 'A');
  // 323.1/474 is a Cleanup task; at least one cleanup-start must have been emitted.
  assert.ok(timings(f).includes('cleanup-start'));
  const history = f.kernel.stateForTest().history.map(entry => entry.action.type);
  assert.ok(history.includes('win'));
  assert.throws(() => f.flow.endTurn('A'), /Cannot end turn now/);
});

test('scoring-victory-tie-at-victory-score-continues (194.2.b / 474): an 8/8 tie produces no winner and play continues', () => {
  // The given is already the cleanup position: both players stand at 8 with no Scoring
  // step left in reach, so the Cleanup checks the tie and play continues.
  const f = turnFixture({ score: { A: 8, B: 8 } });
  f.flow.start();

  const history = f.kernel.stateForTest().history.map(entry => entry.action.type);
  assert.equal(history.includes('win'), false);
  assert.equal(f.flow.winner, null);
  assert.equal(f.flow.phase, 'main');
  // Play is live: the turn can be ended normally and the next turn begins.
  assert.doesNotThrow(() => f.flow.endTurn('A'));
  assert.equal(f.flow.turnPlayer, 'B');
});

test('scoring-victory-not-checked-midturn (474 / 194.2): the game does not end while the action that may win is still in progress', () => {
  const f = turnFixture({
    score: { A: 7, B: 6 },
    setup: w => w.hand('s1', { types: ['spell'], energy: 0, power: [] }),
  });
  f.flow.start();
  f.flow.execute(f.spell('point-spell', [gainPoints('p1', 1)], 'A', 's1', 'action'));

  // The item is pending and the point has not even been gained; nobody has won yet.
  assert.equal(f.kernel.player('A').score, 7);
  assert.equal(f.flow.winner, null);
  assert.equal(eventsAt(f, 'points-gained').length, 0);

  // B receives Priority after A passes; the result is still open.
  f.flow.pass('A');
  assert.equal(f.flow.chain.priority, 'B');
  assert.equal(f.flow.winner, null);

  settle(f);
  assert.equal(f.kernel.player('A').score, 8);
  // The win lands after the Score action, committed by the following Cleanup (474).
  const history = f.kernel.stateForTest().history.map(entry => entry.action.type);
  assert.ok(history.indexOf('score') >= 0);
  assert.ok(history.indexOf('score') < history.indexOf('win'));
  assert.equal(f.flow.winner, 'A');
});

test('scoring-ability-point-past-victory-wins-at-cleanup (194.1.c / 474): points above the Victory Score still win at the Cleanup', () => {
  const f = turnFixture({
    score: { A: 9, B: 6 },
    setup: w => w.unit('u1', { location: { type: 'base', player: 'A' } }),
  });
  f.flow.start();
  assert.equal(f.flow.winner, 'A');
  assert.equal(f.kernel.player('A').score, 9);
});

test('scoring-v15-victory-check-moved-to-cleanup (474): a player at the score who is tied in the Cleanup does not win', () => {
  // Both players sit at 8/8 when the Cleanup runs: no unique leader, so no win.
  const f = turnFixture({ score: { A: 8, B: 8 } });
  f.flow.start();
  assert.equal(f.flow.winner, null);
  assert.equal(f.kernel.player('A').score, 8);
  assert.equal(f.kernel.player('B').score, 8);
  assert.equal(f.kernel.stateForTest().history.some(entry => entry.action.type === 'win'), false);
});

test('scoring-victory-unique-leader-at-cleanup (474): the leaf query returns only a strictly unique leader', () => {
  const { board } = newDuelBoard();
  const tie = scoringState(board, { points: { A: 8, B: 8 }, turnNumber: 11 });
  assert.equal(getDuelWinnerAtCleanup(tie, board), null);
  const leader = gainDuelPoints(tie, board, 'A', 1).state;
  assert.equal(getDuelWinnerAtCleanup(leader, board), 'A');
  const below = scoringState(board, { points: { A: 7, B: 3 }, turnNumber: 11 });
  assert.equal(getDuelWinnerAtCleanup(below, board), null);
});

test('scoring-duel-victory-score-eight-two-battlefields (487.3 / 487.4): the 1v1 Duel configuration is the assumed premise', () => {
  // CR v1.5 487.3/487.4 (renumbered v1.4 485.3/485.4): Victory Score 8, two Battlefields,
  // each player providing three and selecting one. The merged setup primitive is the seam.
  const seats = [
    { playerId: 'A', battlefields: [
      { instanceId: 'a-1', cardId: 'printing-x' }, { instanceId: 'a-2', cardId: 'printing-y' },
      { instanceId: 'a-3', cardId: 'printing-z' }] },
    { playerId: 'B', battlefields: [
      { instanceId: 'b-1', cardId: 'printing-x' }, { instanceId: 'b-2', cardId: 'printing-y' },
      { instanceId: 'b-3', cardId: 'printing-z' }] },
  ];
  const selection = selectDuelBattlefields(seats, () => 1);
  // 487.5: the selected seats are simultaneous and the other two are removed.
  assert.deepEqual(selection.selected.map(entry => entry.instanceId), ['a-2', 'b-2']);
  assert.deepEqual(selection.removedByPlayer.map(seat => seat.battlefields.map(entry => entry.instanceId)),
    [['a-1', 'a-3'], ['b-1', 'b-3']]);
  const board = createDuelBoard(selection);
  assert.equal(board.battlefields.length, 2);
  // 194.3: the default Victory Score is 8.
  const state = scoringState(board, { points: { A: 0, B: 0 } });
  assert.equal(state.victoryScore, 8);

  // The “all Battlefields” exception of 473.1.b.1 therefore means both of them.
  const f = turnFixture({
    score: { A: 8, B: 3 },
    setup: w => w.unit('u1', { location: { type: 'base', player: 'A' } }),
  });
  f.flow.start();
  assert.equal(f.flow.winner, 'A');
  assert.throws(() => f.flow.execute(f.activated('late', [draw('late')])), /Discretionary action is not available/);
});
