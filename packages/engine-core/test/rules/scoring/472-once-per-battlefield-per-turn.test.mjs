// Golden tests for the once-per-Battlefield-per-turn Scoring limit — CR v1.5 472.
//
// Scenario ids covered here (docs/rules/scenarios/scoring.yaml):
//   scoring-once-per-turn-hold-then-conquer-blocked executed (leaf kernel + real driver)
//   scoring-once-per-turn-is-per-player            executed (leaf kernel + real driver)
//   scoring-ledger-resets-next-turn                executed (real driver, two turns)
//
// The ledger lives on the Scoring leaf kernel (src/scoring/scoring.ts) and on the merged
// TurnFlow driver that consumes it. Leaf cases build the board through the canonical board
// module and call the Scoring API directly; driver cases run real turns.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  turnFixture, settle, move, c, newDuelBoard, establishControl, fieldOf, scoringState,
  holdTiming, conquerTiming, scoreDuelBattlefield, eventsAt,
} from './harness.mjs';

test('scoring-once-per-turn-hold-then-conquer-blocked (472): a Battlefield already Scored this turn cannot be Scored again by the same player', () => {
  const { board, f1 } = newDuelBoard();
  const controlled = establishControl(board, f1, 'A', 'u1');
  const state = scoringState(controlled, { points: { A: 3, B: 2 }, ledger: { A: [f1] }, turnNumber: 7 });

  // 471.1/471.2/472: the same player cannot re-score the same Battlefield with either method.
  assert.throws(() => scoreDuelBattlefield(state, controlled, 'A', f1, 'hold', holdTiming('A')),
    /battlefield already scored this turn by this player/);
  assert.throws(() => scoreDuelBattlefield(state, controlled, 'A', f1, 'conquer', conquerTiming('A', 'A', f1)),
    /battlefield already scored this turn by this player/);
});

test('scoring-once-per-turn-is-per-player (472): one player’s ledger entry does not block the other player', () => {
  const { board, f1 } = newDuelBoard();
  const controlled = establishControl(board, f1, 'B', 'ub');
  const state = scoringState(controlled, { points: { A: 4, B: 4 }, ledger: { A: [f1] }, turnNumber: 8 });

  // A's earlier Score on f1 does not disqualify B from Conquering the same Battlefield.
  const result = scoreDuelBattlefield(state, controlled, 'B', f1, 'conquer', conquerTiming('B', 'B', f1));
  assert.equal(result.outcome.pointsGained, 1);
  assert.equal(result.state.players[1].points, 5);
  assert.deepEqual(result.state.players[1].scoredBattlefieldLocationIds, [f1]);
  assert.deepEqual(result.state.players[0].scoredBattlefieldLocationIds, [f1]);
});

test('scoring-ledger-resets-next-turn (472): entering a new turn clears the ledger and keeps the points', () => {
  // Real driver path: A holds bf1 on turn 1, B ends their turn, and A holds it again on turn 3.
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 5, B: 3 },
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 }),
  });
  f.flow.start();
  assert.equal(f.kernel.player('A').score, 6);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);

  f.flow.endTurn('A');
  assert.equal(f.flow.turnPlayer, 'B');
  assert.deepEqual(f.flow.scored('A'), []);
  assert.deepEqual(f.flow.scored('B'), []);

  // The turn-number advance itself clears the ledger (472); points survive (194).
  f.flow.endTurn('B');
  assert.equal(f.flow.turnPlayer, 'A');
  assert.equal(f.kernel.player('A').score, 7);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.equal(eventsAt(f, 'hold').length, 2);
  assert.equal(eventsAt(f, 'points-gained').length, 2);
});

test('scoring-once-per-turn-hold-then-conquer-blocked (472): re-establishing control in the same turn does not Score again', () => {
  // Real driver path. A holds bf1 for point 4, steps off (control is lost in the Open
  // cleanup), and steps back on, re-establishing control. 472 still blocks the second
  // Score on bf1, so a control-established event occurs but no second point.
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 3, B: 2 },
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 }),
  });
  f.flow.start();
  assert.equal(f.kernel.player('A').score, 4);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);

  f.flow.execute(f.activated('leave', [move('m1', { type: 'base', player: 'A' })], 'A', 'u1'));
  settle(f);
  assert.equal(f.flow.battlefields[0].controller, null);

  f.flow.execute(f.activated('return', [move('m2', { type: 'battlefield', id: 'bf1' })], 'A', 'u1'));
  settle(f);
  assert.equal(f.flow.battlefields[0].controller, 'A');
  assert.equal(f.kernel.player('A').score, 4);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.equal(eventsAt(f, 'hold').length, 1);
  assert.equal(eventsAt(f, 'points-gained').length, 1);
  // Control was re-established inside the same turn (one control-established event; the
  // fixture's starting control is not an event), but the Score did not happen again.
  assert.equal(eventsAt(f, 'control-established').length, 1);
  assert.equal(eventsAt(f, 'conquer').length, 0);
});

test('scoring-once-per-turn-is-per-player (472): a same-turn takeover by the other player still Scores', () => {
  // Real driver path. A holds bf1 (ledger: A×bf1). A leaves; A's ability then drags B's Unit
  // in; B establishes control and Conquers the same Battlefield in the same turn, because the
  // ledger is per player (472) and B has not Scored bf1 yet.
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 3, B: 2 },
    setup: w => {
      w.unit('ua', { location: { type: 'battlefield', id: 'bf1' }, might: 2 });
      w.unit('ub', { owner: 'B', location: { type: 'base', player: 'B' }, might: 2 });
    },
  });
  f.flow.start();
  assert.equal(f.kernel.player('A').score, 4);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);

  f.flow.execute(f.activated('leave', [move('m1', { type: 'base', player: 'A' })], 'A', 'ua'));
  settle(f);
  assert.equal(f.flow.battlefields[0].controller, null);

  f.flow.execute(f.activated('drag', [{ id: 'move-ub', op: 'effect.move', args: {
    objects: c({ kind: 'choose', id: 'drag-pick', filter: { type: 'unit', zone: 'board', controller: 'B' } }),
    to: c({ type: 'battlefield', id: 'bf1' }) } }], 'A', 'source'));
  settle(f);

  assert.equal(f.flow.battlefields[0].controller, 'B');
  assert.equal(f.kernel.player('B').score, 3);
  assert.deepEqual(f.flow.scored('B'), ['bf1']);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.equal(eventsAt(f, 'conquer').length, 1);
  assert.equal(eventsAt(f, 'points-gained').length, 2);
});
