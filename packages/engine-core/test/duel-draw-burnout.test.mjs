// Focused CR v1.4 tests for the staged trusted Draw/Burn Out continuation kernel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectDuelBattlefields, createDuelBoard,
} from '../dist/duel/battlefields.js';
import {
  createDuelScoring, gainDuelPoints,
} from '../dist/duel/scoring.js';
import {
  startDuelDraw, resumeDuelDraw,
} from '../dist/duel/draw-burnout.js';

const serial = value => JSON.parse(JSON.stringify(value));
const seats = () => [
  { playerId: 'alice', battlefields: [
    { instanceId: 'a-1', cardId: 'field-a-1' },
    { instanceId: 'a-2', cardId: 'field-a-2' },
    { instanceId: 'a-3', cardId: 'field-a-3' },
  ] },
  { playerId: 'bob', battlefields: [
    { instanceId: 'b-1', cardId: 'field-b-1' },
    { instanceId: 'b-2', cardId: 'field-b-2' },
    { instanceId: 'b-3', cardId: 'field-b-3' },
  ] },
];
function newBoard() {
  return createDuelBoard(selectDuelBattlefields(seats(), () => 0));
}
function card(uid) {
  return { uid, cardId: `card-${uid}` };
}
function zones({ hand = [], mainDeck = [], trash = [] } = {}) {
  return {
    hand: hand.map(card), mainDeck: mainDeck.map(card), trash: trash.map(card),
  };
}
function score(board, { alice = 0, bob = 0, victoryScore = 8 } = {}) {
  const state = createDuelScoring(board, victoryScore);
  return {
    ...state,
    players: [
      { ...state.players[0], points: alice },
      { ...state.players[1], points: bob },
    ],
  };
}
function addPoint(board, state, playerId, amount = 1) {
  return gainDuelPoints(state, board, playerId, amount).state;
}
function noRandom() {
  throw new Error('RNG must not be consumed');
}
function firstResume(scoring, kind = 'prevented') {
  return { firstBurnoutResolution: { kind, scoring } };
}
function intervention() {
  return { interventionComplete: true };
}
function keys(value) {
  return Object.keys(value).sort();
}

test('normal Draw is top-first, detached, and does not consume RNG', () => {
  const board = newBoard();
  const scoring = createDuelScoring(board);
  const input = zones({ hand: ['h'], mainDeck: ['d1', 'd2'] });
  const before = serial(input);
  const result = startDuelDraw(input, board, scoring, 'alice', 1, noRandom);

  assert.equal(result.status, 'complete');
  assert.equal(result.cursor, null);
  assert.deepEqual(result.zones.hand.map(value => value.uid), ['h', 'd1']);
  assert.deepEqual(result.zones.mainDeck.map(value => value.uid), ['d2']);
  assert.deepEqual(result.zones.trash, []);
  assert.deepEqual(serial(input), before);
  assert.notStrictEqual(result.zones.hand, input.hand);
  assert.notStrictEqual(result.zones.hand[0], input.hand[0]);
  assert.deepEqual(result.scoring, scoring);
});

test('Draw beyond the deck draws available cards, Recycles trash once, then continues after first point', () => {
  const board = newBoard();
  const scoring = createDuelScoring(board);
  const input = zones({ mainDeck: ['d1'], trash: ['t1', 't2'] });
  const randomBounds = [];
  const first = startDuelDraw(input, board, scoring, 'alice', 3, bound => {
    randomBounds.push(bound);
    return 0;
  });

  assert.equal(first.status, 'awaiting-first-resolution');
  assert.deepEqual(first.task, {
    kind: 'burnout-point', actor: 'alice', opponentPlayerId: 'bob', burnoutIndex: 1,
    remainingCount: 2, canPreventOrReplace: true,
  });
  assert.deepEqual(first.cursor, {
    actor: 'alice', remainingCount: 2, burnoutIndex: 1, step: 'awaiting-first-resolution',
  });
  assert.deepEqual(first.zones.hand.map(value => value.uid), ['d1']);
  assert.deepEqual(first.zones.mainDeck.map(value => value.uid), ['t2', 't1']);
  assert.deepEqual(first.zones.trash, []);
  assert.deepEqual(randomBounds, [2]);

  const afterFirst = resumeDuelDraw(
    first.zones, board, scoring, first.cursor,
    firstResume(addPoint(board, scoring, 'bob')), noRandom,
  );
  assert.equal(afterFirst.status, 'awaiting-intervention');
  assert.deepEqual(afterFirst.intervention, {
    kind: 'burnout-intervention', actor: 'alice', burnoutIndex: 1, remainingCount: 2,
  });
  assert.equal(afterFirst.scoring.players[1].points, 1);

  const complete = resumeDuelDraw(
    afterFirst.zones, board, afterFirst.scoring, afterFirst.cursor, intervention(), noRandom,
  );
  assert.equal(complete.status, 'complete');
  assert.equal(complete.cursor, null);
  assert.deepEqual(complete.zones.hand.map(value => value.uid), ['d1', 't2', 't1']);
  assert.deepEqual(complete.zones.mainDeck, []);
  assert.equal(complete.scoring.players[1].points, 1);
});

test('the first Burn Out can be prevented, while the next point rejects prevention/replacement flags', () => {
  const board = newBoard();
  const scoring = createDuelScoring(board);
  const first = startDuelDraw(zones(), board, scoring, 'alice', 1, noRandom);
  assert.equal(first.status, 'awaiting-first-resolution');

  const afterPrevention = resumeDuelDraw(
    first.zones, board, scoring, first.cursor, firstResume(scoring, 'prevented'), noRandom,
  );
  assert.equal(afterPrevention.status, 'awaiting-intervention');
  assert.equal(afterPrevention.intervention.kind, 'burnout-intervention');
  assert.equal(afterPrevention.scoring.players[1].points, 0);

  const second = resumeDuelDraw(
    afterPrevention.zones, board, afterPrevention.scoring, afterPrevention.cursor, intervention(), noRandom,
  );
  assert.equal(second.status, 'awaiting-intervention');
  assert.equal(second.task.canPreventOrReplace, false);
  assert.equal(second.task.burnoutIndex, 2);
  assert.equal(second.scoring.players[1].points, 1);
  assert.throws(() => resumeDuelDraw(
    second.zones, board, second.scoring, second.cursor,
    { interventionComplete: true, prevented: true }, noRandom,
  ), /intervention resume options keys/);
});

test('the trusted first-point replacement returns actual scoring, not a guessed default point', () => {
  const board = newBoard();
  const initial = createDuelScoring(board);
  const pending = startDuelDraw(zones(), board, initial, 'alice', 1, noRandom);
  const replacedScore = addPoint(board, initial, 'alice', 2);
  const replaced = resumeDuelDraw(
    pending.zones, board, initial, pending.cursor,
    firstResume(replacedScore, 'replaced'), noRandom,
  );
  assert.equal(replaced.status, 'awaiting-intervention');
  assert.equal(replaced.scoring.players[0].points, 2);
  assert.equal(replaced.scoring.players[1].points, 0);
  assert.equal(replaced.task, null);
});

test('one-card Recycle never calls RNG', () => {
  const board = newBoard();
  const scoring = createDuelScoring(board);
  const first = startDuelDraw(zones({ trash: ['only'] }), board, scoring, 'alice', 1, noRandom);
  assert.equal(first.status, 'awaiting-first-resolution');
  assert.deepEqual(first.zones.mainDeck.map(value => value.uid), ['only']);
  assert.deepEqual(first.zones.trash, []);
});

test('empty Main Deck plus empty Trash repeats one fixed point per resume and wins immediately at 8', () => {
  const board = newBoard();
  const initial = createDuelScoring(board);
  const first = startDuelDraw(zones(), board, initial, 'alice', 1, noRandom);
  const firstResolved = resumeDuelDraw(
    first.zones, board, initial, first.cursor,
    firstResume(addPoint(board, initial, 'bob'), 'scored'), noRandom,
  );
  assert.equal(firstResolved.scoring.players[1].points, 1);
  let current = firstResolved;
  for (let point = 2; point <= 8; point += 1) {
    const next = resumeDuelDraw(
      current.zones, board, current.scoring, current.cursor, intervention(), noRandom,
    );
    assert.equal(next.task.burnoutIndex, point);
    assert.equal(next.scoring.players[1].points, point);
    if (point < 8) {
      assert.equal(next.status, 'awaiting-intervention');
      assert.ok(next.cursor);
    } else {
      assert.equal(next.status, 'winner');
      assert.equal(next.winner, 'bob');
      assert.equal(next.cursor, null);
    }
    current = next;
  }
});

test('first point reaching Victory Score does not use immediate winner; the next fixed point wins at 9', () => {
  const board = newBoard();
  const initial = score(board, { bob: 7 });
  const first = startDuelDraw(zones(), board, initial, 'alice', 1, noRandom);
  const firstScored = addPoint(board, initial, 'bob');
  const afterFirst = resumeDuelDraw(
    first.zones, board, initial, first.cursor, firstResume(firstScored, 'scored'), noRandom,
  );
  assert.equal(afterFirst.status, 'awaiting-intervention');
  assert.equal(afterFirst.scoring.players[1].points, 8);
  assert.equal(afterFirst.winner, null);

  const second = resumeDuelDraw(
    afterFirst.zones, board, afterFirst.scoring, afterFirst.cursor, intervention(), noRandom,
  );
  assert.equal(second.status, 'winner');
  assert.equal(second.winner, 'bob');
  assert.equal(second.scoring.players[1].points, 9);
  assert.equal(second.cursor, null);
});

test('a fixed point reaching 8 at a tie is not immediate; the next sole-leader point is', () => {
  const board = newBoard();
  const initial = score(board, { alice: 8, bob: 6 });
  const first = startDuelDraw(zones(), board, initial, 'alice', 1, noRandom);
  const afterFirst = resumeDuelDraw(
    first.zones, board, initial, first.cursor,
    firstResume(addPoint(board, initial, 'bob'), 'scored'), noRandom,
  );
  assert.equal(afterFirst.status, 'awaiting-intervention');
  assert.equal(afterFirst.scoring.players[1].points, 7);

  const tiedNext = resumeDuelDraw(
    afterFirst.zones, board, afterFirst.scoring, afterFirst.cursor, intervention(), noRandom,
  );
  assert.equal(tiedNext.status, 'awaiting-intervention');
  assert.equal(tiedNext.winner, null);
  assert.equal(tiedNext.scoring.players[1].points, 8);
  assert.equal(tiedNext.cursor.remainingCount, 1);
  assert.equal(tiedNext.task.burnoutIndex, 2);

  const soleLeader = resumeDuelDraw(
    tiedNext.zones, board, tiedNext.scoring, tiedNext.cursor, intervention(), noRandom,
  );
  assert.equal(soleLeader.status, 'winner');
  assert.equal(soleLeader.winner, 'bob');
  assert.equal(soleLeader.scoring.players[1].points, 9);
  assert.equal(soleLeader.cursor, null);
});

test('an effect can refill Main Deck at the event boundary and stop repeated Burn Out', () => {
  const board = newBoard();
  const scoring = createDuelScoring(board);
  const first = startDuelDraw(zones(), board, scoring, 'alice', 2, noRandom);
  const afterFirst = resumeDuelDraw(
    first.zones, board, scoring, first.cursor, firstResume(scoring), noRandom,
  );
  const afterSecondPoint = resumeDuelDraw(
    afterFirst.zones, board, afterFirst.scoring, afterFirst.cursor, intervention(), noRandom,
  );
  assert.equal(afterSecondPoint.status, 'awaiting-intervention');
  assert.equal(afterSecondPoint.intervention.burnoutIndex, 2);
  assert.equal(afterSecondPoint.task.burnoutIndex, 2);
  assert.equal(afterSecondPoint.scoring.players[1].points, 1);

  // Outer effect/event processing occurs between this point and the next attempt.
  const refilled = {
    ...afterSecondPoint.zones,
    mainDeck: [card('effect-card-1'), card('effect-card-2')],
  };
  const complete = resumeDuelDraw(
    refilled, board, afterSecondPoint.scoring, afterSecondPoint.cursor, intervention(), noRandom,
  );
  assert.equal(complete.status, 'complete');
  assert.deepEqual(complete.zones.hand.map(value => value.uid), ['effect-card-1', 'effect-card-2']);
  assert.deepEqual(complete.zones.mainDeck, []);
  assert.equal(complete.scoring.players[1].points, 1);
});

test('a missing first-point resolution stays pending; no default/no-replacement assumption', () => {
  const board = newBoard();
  const scoring = createDuelScoring(board);
  const first = startDuelDraw(zones(), board, scoring, 'alice', 1, noRandom);
  const before = serial(first.zones);
  assert.throws(() => resumeDuelDraw(first.zones, board, scoring, first.cursor, {}, noRandom),
    /first Draw resume options keys/);
  assert.throws(() => resumeDuelDraw(
    first.zones, board, scoring, first.cursor, { interventionComplete: true }, noRandom,
  ), /first Draw resume options keys/);
  assert.deepEqual(serial(first.zones), before);
  assert.equal(first.task.canPreventOrReplace, true);
});

test('validation rejects duplicate/aliased cards and malformed cursors atomically', () => {
  const board = newBoard();
  const scoring = createDuelScoring(board);
  const shared = card('shared');
  const aliased = { hand: [shared], mainDeck: [shared], trash: [] };
  assert.throws(() => startDuelDraw(aliased, board, scoring, 'alice', 1), /aliases another card record/);

  const duplicate = zones({ hand: ['same'], mainDeck: ['same'] });
  const duplicateBefore = serial(duplicate);
  assert.throws(() => startDuelDraw(duplicate, board, scoring, 'alice', 1), /zone card UID duplicate/);
  assert.deepEqual(serial(duplicate), duplicateBefore);

  const pending = startDuelDraw(zones(), board, scoring, 'alice', 1);
  const cursorBefore = serial(pending.cursor);
  assert.throws(() => resumeDuelDraw(
    pending.zones, board, scoring,
    { ...pending.cursor, burnoutIndex: 2 }, firstResume(scoring),
  ), /only Burn Out point one/);
  assert.deepEqual(serial(pending.cursor), cursorBefore);
});

test('cursor and task never contain private card payloads and have the narrow persisted shape', () => {
  const board = newBoard();
  const scoring = createDuelScoring(board);
  const result = startDuelDraw(zones({ mainDeck: ['secret'] }), board, scoring, 'alice', 2, noRandom);
  assert.deepEqual(keys(result.cursor), ['actor', 'burnoutIndex', 'remainingCount', 'step']);
  assert.equal(result.intervention, null);
  assert.deepEqual(keys(result.task), [
    'actor', 'burnoutIndex', 'canPreventOrReplace', 'kind', 'opponentPlayerId', 'remainingCount',
  ]);
  assert.equal(JSON.stringify(result.cursor).includes('secret'), false);
  assert.equal(JSON.stringify(result.task).includes('secret'), false);
});
