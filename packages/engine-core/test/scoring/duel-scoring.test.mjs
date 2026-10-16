import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectDuelBattlefields, createDuelBoard, placeDuelUnit, removeDuelUnit, applyOpenDuelCleanup,
  beginDuelShowdown, beginDuelCombat, endDuelNonCombatShowdown, endDuelCombat,
} from '../../dist/duel/battlefields.js';
import {
  createDuelScoring, restoreDuelScoring, beginDuelScoreTurn, scoreDuelBattlefield, gainDuelPoints,
  loseDuelPoints, setDuelVictoryScoreForEffect, getDuelWinnerAtCleanup, projectPublicDuelScoring,
} from '../../dist/scoring/scoring.js';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const serial = value => JSON.parse(JSON.stringify(value));
const seats = () => [
  { playerId: 'alice', battlefields: [
    { instanceId: 'a-1', cardId: 'printing-x' }, { instanceId: 'a-2', cardId: 'printing-y' },
    { instanceId: 'a-3', cardId: 'printing-z' },
  ] },
  { playerId: 'bob', battlefields: [
    { instanceId: 'b-1', cardId: 'printing-x' }, { instanceId: 'b-2', cardId: 'printing-y' },
    { instanceId: 'b-3', cardId: 'printing-z' },
  ] },
];
/** Real factory: 485.4–5 selection plus createDuelBoard; a different index yields other locations. */
function newBoard(index = 0) {
  const board = createDuelBoard(selectDuelBattlefields(seats(), () => index));
  return { board, f1: board.battlefields[0].locationId, f2: board.battlefields[1].locationId };
}
const fieldOf = (board, locationId) => board.battlefields.find(field => field.locationId === locationId);
/** 190.4/348.2 real chain: place → Open cleanup → non-combat Showdown → close establishes control. */
function establishControl(board, locationId, owner, objectId) {
  let current = placeDuelUnit(board, { objectId, controllerPlayerId: owner, locationId });
  current = applyOpenDuelCleanup(current);
  current = beginDuelShowdown(current, locationId);
  current = endDuelNonCombatShowdown(current, locationId);
  assert.equal(fieldOf(current, locationId).controllerPlayerId, owner);
  return current;
}
function boardControlledByAlice() {
  const { board, f1, f2 } = newBoard();
  return { board: establishControl(board, f1, 'alice', 'u-a1'), f1, f2 };
}
function boardBothControlledByAlice() {
  const { board, f1, f2 } = newBoard();
  const first = establishControl(board, f1, 'alice', 'u-a1');
  return { board: establishControl(first, f2, 'alice', 'u-a2'), f1, f2 };
}
function boardSplitControl() {
  const { board, f1, f2 } = newBoard();
  const alice = establishControl(board, f1, 'alice', 'u-a1');
  return { board: establishControl(alice, f2, 'bob', 'u-b1'), f1, f2 };
}
/** Real combat takeover: Bob's unit wins at f1 and 466.5 hands him control. */
function bobTakesF1ByCombat(board, f1) {
  let current = placeDuelUnit(board, { objectId: 'u-bob', controllerPlayerId: 'bob', locationId: f1 });
  current = applyOpenDuelCleanup(current);
  assert.equal(fieldOf(current, f1).showdown, 'staged');
  assert.equal(fieldOf(current, f1).combat, 'staged');
  current = beginDuelCombat(current, f1);
  current = removeDuelUnit(current, 'u-a1'); // caller's Combat Cleanup removed the losing unit
  const resolution = endDuelCombat(current, f1, { recalledAttackersDuringCleanup: false });
  assert.deepEqual(resolution.result, { winnerPlayerId: 'bob' });
  assert.equal(fieldOf(resolution.board, f1).controllerPlayerId, 'bob');
  return resolution.board;
}
const holdStep = turnPlayerId => ({ phase: 'beginning-scoring', turnPlayerId,
  controlEstablishedForPlayerId: null, controlEstablishedLocationId: null });
const otherPhase = turnPlayerId => ({ phase: 'other', turnPlayerId,
  controlEstablishedForPlayerId: null, controlEstablishedLocationId: null });
const conquerEvent = (turnPlayerId, playerId, locationId) => ({ phase: 'other', turnPlayerId,
  controlEstablishedForPlayerId: playerId, controlEstablishedLocationId: locationId });
function legalState(board, options = {}) {
  const { alicePoints = 0, bobPoints = 0, aliceLedger = [], bobLedger = [], turnNumber = 0,
    victoryScore = 8 } = options;
  return {
    playerIds: [...board.playerIds],
    battlefieldLocationIds: board.battlefields.map(field => field.locationId),
    victoryScore, turnNumber,
    players: [
      { playerId: board.playerIds[0], points: alicePoints, scoredBattlefieldLocationIds: [...aliceLedger] },
      { playerId: board.playerIds[1], points: bobPoints, scoredBattlefieldLocationIds: [...bobLedger] },
    ],
  };
}

test('createDuelScoring takes the validated real board: seat/field order, zero scores, turn 0, default 8', () => {
  const { board, f1, f2 } = boardControlledByAlice();
  const before = serial(board);
  const state = createDuelScoring(board);
  assert.deepEqual(Object.keys(state),
    ['playerIds', 'battlefieldLocationIds', 'victoryScore', 'turnNumber', 'players']);
  assert.deepEqual(state.playerIds, ['alice', 'bob']);
  assert.deepEqual(state.battlefieldLocationIds, [f1, f2]);
  assert.equal(state.victoryScore, 8); // 194.3
  assert.equal(state.turnNumber, 0);
  assert.deepEqual(state.players, [
    { playerId: 'alice', points: 0, scoredBattlefieldLocationIds: [] },
    { playerId: 'bob', points: 0, scoredBattlefieldLocationIds: [] },
  ]);
  assert.equal(createDuelScoring(board, 12).victoryScore, 12);
  assert.deepEqual(serial(board), before); // the board is never touched
  assert.deepEqual(createDuelScoring(board), state); // deterministic, no RNG
  for (const [ErrorType, bad] of [[RangeError, 0], [RangeError, -1], [TypeError, 1.5], [TypeError, '8'],
    [TypeError, null], [TypeError, NaN], [TypeError, MAX_SAFE + 1]]) {
    assert.throws(() => createDuelScoring(board, bad), ErrorType);
  }
  for (const bad of [null, {}, [], { ...board, extra: 1 }, serial(board).battlefields]) {
    assert.throws(() => createDuelScoring(bad), TypeError);
  }
});

test('restoreDuelScoring round-trips, deep-clones and rejects corrupt or unknown state', () => {
  const { board, f1, f2 } = boardBothControlledByAlice();
  const raw = legalState(board, { alicePoints: 3, bobPoints: 2, aliceLedger: [f1], bobLedger: [f2],
    turnNumber: 4, victoryScore: 9 });
  const restored = restoreDuelScoring(raw, board);
  assert.deepEqual(restored, raw);
  assert.notStrictEqual(restored, raw);
  assert.notStrictEqual(restored.players, raw.players);
  assert.notStrictEqual(restored.players[0].scoredBattlefieldLocationIds, raw.players[0].scoredBattlefieldLocationIds);
  restored.players[0].scoredBattlefieldLocationIds.push(f2);
  restored.players[1].points = 99;
  restored.playerIds.push('mallory');
  assert.deepEqual(raw.players[0].scoredBattlefieldLocationIds, [f1]);
  assert.equal(raw.players[1].points, 2);
  assert.equal(raw.playerIds.length, 2);
  raw.battlefieldLocationIds[0] = 'mutated after restore';
  assert.deepEqual(restored.battlefieldLocationIds, [f1, f2]);
  const fresh = legalState(board, { alicePoints: 3, bobPoints: 2, aliceLedger: [f1], bobLedger: [f2],
    turnNumber: 4, victoryScore: 9 });
  const corruptions = [
    [TypeError, value => { delete value.turnNumber; }],
    [TypeError, value => { value.deck = ['private deck']; }],
    [TypeError, value => { value.playerIds = [value.playerIds[1], value.playerIds[0]]; }],
    [TypeError, value => { value.players = [value.players[1], value.players[0]]; }],
    [TypeError, value => { value.battlefieldLocationIds = [value.battlefieldLocationIds[1], value.battlefieldLocationIds[0]]; }],
    [TypeError, value => { value.battlefieldLocationIds[1] = 'printing-x'; }], // instance/printing is not a location
    [TypeError, value => { value.players[0].scoredBattlefieldLocationIds = [f1, f1]; }],
    [TypeError, value => { value.players[0].scoredBattlefieldLocationIds = ['unknown-field']; }],
    [TypeError, value => { value.players[0].hand = ['private hand']; }],
    [TypeError, value => { value.players[0].playerId = value.players[1].playerId; }],
    [TypeError, value => { value.players[0].points = '3'; }],
    [TypeError, value => { value.players[0].points = 1.5; }],
    [TypeError, value => { value.victoryScore = '9'; }],
    [TypeError, value => { value.players.push({ playerId: 'mallory', points: 0, scoredBattlefieldLocationIds: [] }); }],
    [TypeError, value => { value.players.pop(); }],
    [RangeError, value => { value.victoryScore = 0; }],
    [RangeError, value => { value.victoryScore = -3; }],
    [RangeError, value => { value.turnNumber = -1; }],
    [RangeError, value => { value.players[0].points = -1; }],
  ];
  for (const [ErrorType, breakIt] of corruptions) {
    const bad = serial(fresh);
    breakIt(bad);
    const frozen = serial(bad);
    assert.throws(() => restoreDuelScoring(bad, board), ErrorType);
    assert.deepEqual(bad, frozen, 'rejected input must not be partially rewritten');
  }
  const getter = serial(fresh);
  Object.defineProperty(getter.players[0], 'points', { enumerable: true, get: () => 3 });
  assert.throws(() => restoreDuelScoring(getter, board), TypeError);
  const arrayGetter = serial(fresh);
  Object.defineProperty(arrayGetter.players[0].scoredBattlefieldLocationIds, 0,
    { enumerable: true, get: () => f1 });
  assert.throws(() => restoreDuelScoring(arrayGetter, board), TypeError);
  const sparse = serial(fresh);
  delete sparse.players[0].scoredBattlefieldLocationIds[0];
  assert.throws(() => restoreDuelScoring(sparse, board), TypeError);
  assert.doesNotThrow(() => restoreDuelScoring(fresh, board));
});

test('restore rejects a state built against another board or other UIDs (UID board mapping)', () => {
  const first = boardBothControlledByAlice();
  const second = newBoard(1); // different instanceIds => different battlefield locations
  assert.notDeepEqual(second.board.battlefields[0].locationId, first.board.battlefields[0].locationId);
  assert.throws(() => restoreDuelScoring(createDuelScoring(second.board), first.board), TypeError);
  assert.throws(() => restoreDuelScoring(legalState(second.board), first.board), TypeError);
  const swapped = legalState(first.board);
  swapped.battlefieldLocationIds = [swapped.battlefieldLocationIds[1], swapped.battlefieldLocationIds[0]];
  assert.throws(() => restoreDuelScoring(swapped, first.board), TypeError);
  const instanceId = legalState(first.board);
  instanceId.battlefieldLocationIds = first.board.battlefields.map(field => field.instanceId);
  assert.throws(() => restoreDuelScoring(instanceId, first.board), TypeError);
  assert.doesNotThrow(() => restoreDuelScoring(legalState(first.board), first.board));
});

test('a new turn clears both Score ledgers and keeps points, the Victory Score and the counter', () => {
  const { board, f1, f2 } = boardBothControlledByAlice();
  const state = restoreDuelScoring(legalState(board, { alicePoints: 3, bobPoints: 2, aliceLedger: [f1],
    bobLedger: [f2], turnNumber: 4, victoryScore: 12 }), board);
  const next = beginDuelScoreTurn(state, board, 5);
  assert.deepEqual(next.players, [
    { playerId: 'alice', points: 3, scoredBattlefieldLocationIds: [] },
    { playerId: 'bob', points: 2, scoredBattlefieldLocationIds: [] },
  ]);
  assert.equal(next.turnNumber, 5);
  assert.equal(next.victoryScore, 12);
  assert.deepEqual(state.players[0].scoredBattlefieldLocationIds, [f1]); // input untouched
  const frozen = serial(state);
  for (const [ErrorType, value] of [[RangeError, 4], [RangeError, 6], [RangeError, 3], [RangeError, 0],
    [TypeError, 5.5], [TypeError, '5'], [TypeError, null], [TypeError, MAX_SAFE + 1]]) {
    assert.throws(() => beginDuelScoreTurn(state, board, value), ErrorType);
    assert.deepEqual(serial(state), frozen);
  }
  const overflow = restoreDuelScoring(legalState(board, { turnNumber: MAX_SAFE }), board);
  assert.throws(() => beginDuelScoreTurn(overflow, board, MAX_SAFE + 1), TypeError);
  assert.throws(() => beginDuelScoreTurn(overflow, board, MAX_SAFE), RangeError);
});

test('Hold requires the canonical beginning-scoring step and the controlling turn player', () => {
  const { board, f1, f2 } = boardSplitControl();
  const base = beginDuelScoreTurn(createDuelScoring(board), board, 1);
  const before = serial(base);
  const scored = scoreDuelBattlefield(base, board, 'alice', f1, 'hold', holdStep('alice'));
  assert.deepEqual(scored.outcome, { playerId: 'alice', locationId: f1, method: 'hold',
    pointsGained: 1, drawRequired: 0, triggerScore: true, triggerMethod: 'hold' });
  assert.equal(scored.state.players[0].points, 1); // 468.1 / 315.2.b.2
  assert.deepEqual(scored.state.players[0].scoredBattlefieldLocationIds, [f1]);
  assert.deepEqual(scored.state.players[1].scoredBattlefieldLocationIds, []);
  const bobScored = scoreDuelBattlefield(base, board, 'bob', f2, 'hold', holdStep('bob'));
  assert.equal(bobScored.state.players[1].points, 1);
  assert.deepEqual(bobScored.state.players[1].scoredBattlefieldLocationIds, [f2]);
  assert.deepEqual(bobScored.state.players[0].scoredBattlefieldLocationIds, []);
  for (const call of [
    () => scoreDuelBattlefield(base, board, 'bob', f2, 'hold', holdStep('alice')), // not the turn player
    () => scoreDuelBattlefield(base, board, 'alice', f1, 'hold', otherPhase('alice')), // not the Scoring Step
    () => scoreDuelBattlefield(base, board, 'alice', f2, 'hold', holdStep('alice')), // Bob's field
    () => scoreDuelBattlefield(base, board, 'bob', f1, 'hold', holdStep('bob')), // Alice's field
    () => scoreDuelBattlefield(base, board, 'alice', 'unknown', 'hold', holdStep('alice')),
    () => scoreDuelBattlefield(base, board, 'alice', f1, 'steal', holdStep('alice')),
    () => scoreDuelBattlefield(base, board, 'eve', f1, 'hold', holdStep('alice')),
    () => scoreDuelBattlefield(base, board, 'alice', f1, 'hold', { ...holdStep('alice'), phase: 'other' }),
    () => scoreDuelBattlefield(base, board, 'alice', f1, 'hold', { ...holdStep('alice'), turnPlayerId: 'eve' }),
    () => scoreDuelBattlefield(base, board, 'alice', f1, 'hold', { ...holdStep('alice'), priority: 'alice' }),
  ]) {
    assert.throws(call, TypeError);
    assert.deepEqual(serial(base), before);
  }
  assert.doesNotThrow(() => scoreDuelBattlefield(base, board, 'alice', f1, 'conquer', conquerEvent('alice', 'alice', f1)));
  // turn 0 can never score
  assert.throws(() => scoreDuelBattlefield(createDuelScoring(board), board, 'alice', f1, 'hold', holdStep('alice')), TypeError);
  assert.throws(() => scoreDuelBattlefield(createDuelScoring(board), board, 'alice', f1, 'conquer', conquerEvent('alice', 'alice', f1)), TypeError);
});

test('one Score per battlefield per turn across both methods, with independent per-player ledgers', () => {
  const { board, f1 } = boardControlledByAlice();
  const base = beginDuelScoreTurn(createDuelScoring(board), board, 1);
  const first = scoreDuelBattlefield(base, board, 'alice', f1, 'hold', holdStep('alice'));
  assert.equal(first.state.players[0].points, 1);
  const after = serial(first.state);
  for (const call of [
    () => scoreDuelBattlefield(first.state, board, 'alice', f1, 'hold', holdStep('alice')),
    () => scoreDuelBattlefield(first.state, board, 'alice', f1, 'conquer', conquerEvent('alice', 'alice', f1)),
  ]) {
    assert.throws(call, TypeError); // 470: both methods share the once-per-turn limit
    assert.deepEqual(serial(first.state), after);
  }
  const taken = bobTakesF1ByCombat(board, f1);
  const bobScored = scoreDuelBattlefield(first.state, taken, 'bob', f1, 'conquer', conquerEvent('alice', 'bob', f1));
  assert.equal(bobScored.state.players[1].points, 1); // Bob's own ledger is independent
  assert.deepEqual(bobScored.state.players[1].scoredBattlefieldLocationIds, [f1]);
  assert.equal(bobScored.state.players[0].points, 1);
  for (const call of [
    () => scoreDuelBattlefield(first.state, taken, 'bob', f1, 'conquer', otherPhase('alice')), // raw null pair
    () => scoreDuelBattlefield(first.state, taken, 'bob', f1, 'conquer',
      { ...otherPhase('alice'), controlEstablishedForPlayerId: 'bob' }), // incomplete pair
    () => scoreDuelBattlefield(first.state, taken, 'bob', f1, 'conquer', conquerEvent('alice', 'alice', f1)),
    () => scoreDuelBattlefield(first.state, taken, 'bob', f1, 'conquer',
      { ...conquerEvent('alice', 'bob', f1), controlEstablishedLocationId: null }), // incomplete pair
    () => scoreDuelBattlefield(first.state, taken, 'bob', f1, 'conquer',
      { ...conquerEvent('alice', 'bob', f1), controlEstablished: true }), // a raw client boolean is not enough
  ]) assert.throws(call, TypeError);
  const elsewhere = conquerEvent('alice', 'bob', f1);
  elsewhere.controlEstablishedLocationId = 'unknown-field';
  assert.throws(() => scoreDuelBattlefield(first.state, taken, 'bob', f1, 'conquer', elsewhere), TypeError);
});

test('the Final Point draw hits only Conquer, and the ledger is written before the all-fields check', () => {
  const { board, f1, f2 } = boardBothControlledByAlice();
  const atSeven = gainDuelPoints(createDuelScoring(board), board, 'alice', 7).state;
  const turn = beginDuelScoreTurn(atSeven, board, 1);
  const first = scoreDuelBattlefield(turn, board, 'alice', f1, 'conquer', conquerEvent('alice', 'alice', f1));
  assert.deepEqual(first.outcome, { playerId: 'alice', locationId: f1, method: 'conquer',
    pointsGained: 0, drawRequired: 1, triggerScore: true, triggerMethod: 'conquer' });
  assert.equal(first.state.players[0].points, 7);
  assert.deepEqual(first.state.players[0].scoredBattlefieldLocationIds, [f1]); // still marked as Scored
  assert.deepEqual(turn.players[0].scoredBattlefieldLocationIds, []);
  for (const call of [
    () => scoreDuelBattlefield(first.state, board, 'alice', f1, 'conquer', conquerEvent('alice', 'alice', f1)),
    () => scoreDuelBattlefield(first.state, board, 'alice', f1, 'hold', holdStep('alice')),
  ]) assert.throws(call, TypeError); // no second draw and no second Score at that battlefield
  const second = scoreDuelBattlefield(first.state, board, 'alice', f2, 'conquer', conquerEvent('alice', 'alice', f2));
  assert.deepEqual(second.outcome, { playerId: 'alice', locationId: f2, method: 'conquer',
    pointsGained: 1, drawRequired: 0, triggerScore: true, triggerMethod: 'conquer' });
  assert.equal(second.state.players[0].points, 8); // 471.1.b.1 the Final Point itself
  assert.deepEqual(second.state.players[0].scoredBattlefieldLocationIds, [f1, f2]);
});

test('Hold always gains one point, even at the Final Point threshold or above the Victory Score', () => {
  const { board, f1 } = boardControlledByAlice();
  const atSeven = gainDuelPoints(createDuelScoring(board), board, 'alice', 7).state;
  const held = scoreDuelBattlefield(beginDuelScoreTurn(atSeven, board, 1), board, 'alice', f1, 'hold', holdStep('alice'));
  assert.equal(held.outcome.pointsGained, 1); // 469.2 / 471.1.a.1: Hold is not a Conquer
  assert.equal(held.outcome.drawRequired, 0);
  assert.equal(held.outcome.triggerMethod, 'hold');
  assert.equal(held.state.players[0].points, 8);
  const gained = gainDuelPoints(held.state, board, 'alice', 1); // a non-Conquer point source
  assert.equal(gained.actualGained, 1);
  assert.equal(gained.state.players[0].points, 9);
  assert.deepEqual(gained.state.players[0].scoredBattlefieldLocationIds, [f1]); // no ledger entry
  const none = gainDuelPoints(gained.state, board, 'bob', 0);
  assert.equal(none.actualGained, 0);
  assert.equal(none.state.players[1].points, 0);
  const heldAgain = scoreDuelBattlefield(beginDuelScoreTurn(gained.state, board, 2), board,
    'alice', f1, 'hold', holdStep('alice'));
  assert.equal(heldAgain.state.players[0].points, 10);
});

test('a Conquer at or above the Victory Score still uses the Final Point condition', () => {
  const { board, f1, f2 } = boardBothControlledByAlice();
  const atEight = gainDuelPoints(createDuelScoring(board), board, 'alice', 8).state;
  const turn = beginDuelScoreTurn(atEight, board, 1);
  const first = scoreDuelBattlefield(turn, board, 'alice', f1, 'conquer', conquerEvent('alice', 'alice', f1));
  assert.equal(first.outcome.pointsGained, 0);
  assert.equal(first.outcome.drawRequired, 1);
  assert.equal(first.state.players[0].points, 8);
  const second = scoreDuelBattlefield(first.state, board, 'alice', f2, 'conquer', conquerEvent('alice', 'alice', f2));
  assert.equal(second.outcome.pointsGained, 1);
  assert.equal(second.state.players[0].points, 9);
});

test('the cleanup winner query is pure and only reports a unique leader at or above the Victory Score', () => {
  const { board } = boardControlledByAlice();
  const fresh = createDuelScoring(board);
  const withPoints = (alice, bob, victoryScore = 8) => {
    let state = fresh;
    if (alice) state = gainDuelPoints(state, board, 'alice', alice).state;
    if (bob) state = gainDuelPoints(state, board, 'bob', bob).state;
    if (victoryScore !== 8) state = setDuelVictoryScoreForEffect(state, board, victoryScore);
    return state;
  };
  assert.equal(getDuelWinnerAtCleanup(withPoints(0, 0), board), null);
  assert.equal(getDuelWinnerAtCleanup(withPoints(7, 7), board), null);
  assert.equal(getDuelWinnerAtCleanup(withPoints(8, 7), board), 'alice');
  assert.equal(getDuelWinnerAtCleanup(withPoints(7, 8), board), 'bob');
  assert.equal(getDuelWinnerAtCleanup(withPoints(8, 8), board), null); // 194.2.b continues
  assert.equal(getDuelWinnerAtCleanup(withPoints(9, 8), board), 'alice'); // 194.2.a
  assert.equal(getDuelWinnerAtCleanup(withPoints(8, 9), board), 'bob');
  assert.equal(getDuelWinnerAtCleanup(withPoints(9, 8, 10), board), null); // 194.3.a mode alteration
  assert.equal(getDuelWinnerAtCleanup(withPoints(10, 8, 10), board), 'alice');
  assert.equal(getDuelWinnerAtCleanup(withPoints(4, 1, 4), board), 'alice'); // a lowered mode threshold
  const state = withPoints(9, 8);
  const snapshot = serial(state);
  assert.equal(getDuelWinnerAtCleanup(state, board), 'alice');
  assert.equal(getDuelWinnerAtCleanup(state, board), 'alice');
  assert.deepEqual(serial(state), snapshot); // no match-ended write, no chain termination
});

test('losing points clamps at zero and never triggers a zero loss (194.4)', () => {
  const { board, f1 } = boardControlledByAlice();
  const scored = scoreDuelBattlefield(beginDuelScoreTurn(createDuelScoring(board), board, 1),
    board, 'alice', f1, 'hold', holdStep('alice')).state;
  assert.equal(scored.players[0].points, 1);
  const lost = loseDuelPoints(scored, board, 'alice', 5);
  assert.equal(lost.actualLost, 1);
  assert.equal(lost.triggerLoss, true);
  assert.equal(lost.state.players[0].points, 0);
  assert.deepEqual(lost.state.players[0].scoredBattlefieldLocationIds, [f1]); // ledger untouched
  const nothing = loseDuelPoints(lost.state, board, 'alice', 3);
  assert.equal(nothing.actualLost, 0); // 194.4.a
  assert.equal(nothing.triggerLoss, false); // 194.4.b
  assert.deepEqual(nothing.state, lost.state);
  assert.notStrictEqual(nothing.state, lost.state);
  assert.deepEqual(scored.players[0].scoredBattlefieldLocationIds, [f1]);
  assert.throws(() => loseDuelPoints(lost.state, board, 'alice', -1), RangeError);
  assert.throws(() => loseDuelPoints(lost.state, board, 'alice', 0.5), TypeError);
  assert.throws(() => loseDuelPoints(lost.state, board, 'eve', 1), TypeError);
});

test('safe-integer overflow and unsafe values are rejected atomically', () => {
  const { board, f1 } = boardBothControlledByAlice();
  const huge = restoreDuelScoring(legalState(board, { alicePoints: MAX_SAFE, bobPoints: 1, turnNumber: 3 }), board);
  const snapshot = serial(huge);
  assert.throws(() => gainDuelPoints(huge, board, 'alice', 1), RangeError);
  assert.throws(() => gainDuelPoints(huge, board, 'bob', MAX_SAFE), RangeError);
  assert.throws(() => gainDuelPoints(huge, board, 'alice', MAX_SAFE + 1), TypeError);
  assert.throws(() => gainDuelPoints(huge, board, 'alice', -1), RangeError);
  assert.throws(() => loseDuelPoints(huge, board, 'alice', 1.5), TypeError);
  assert.throws(() => scoreDuelBattlefield(huge, board, 'alice', f1, 'hold', holdStep('alice')), RangeError);
  assert.deepEqual(serial(huge), snapshot);
  assert.equal(getDuelWinnerAtCleanup(huge, board), 'alice');
  const state = beginDuelScoreTurn(createDuelScoring(board), board, 1);
  const raised = setDuelVictoryScoreForEffect(state, board, 20);
  assert.equal(raised.victoryScore, 20);
  assert.deepEqual(raised.players, state.players); // the Score ledger survives
  assert.notStrictEqual(raised, state);
  for (const bad of [0, -1]) assert.throws(() => setDuelVictoryScoreForEffect(state, board, bad), RangeError);
  for (const bad of [1.5, '8', null, MAX_SAFE + 1]) {
    assert.throws(() => setDuelVictoryScoreForEffect(state, board, bad), TypeError);
  }
  assert.deepEqual(serial(state), serial(beginDuelScoreTurn(createDuelScoring(board), board, 1)));
});

test('no operation consumes randomness', () => {
  const { board, f1 } = boardControlledByAlice();
  const original = Math.random;
  Math.random = () => { throw new Error('RNG must not be used'); };
  try {
    const created = createDuelScoring(board, 9);
    const restored = restoreDuelScoring(legalState(board, { alicePoints: 2 }), board);
    const turn = beginDuelScoreTurn(created, board, 1);
    const scored = scoreDuelBattlefield(turn, board, 'alice', f1, 'hold', holdStep('alice'));
    assert.equal(gainDuelPoints(scored.state, board, 'bob', 2).actualGained, 2);
    assert.equal(loseDuelPoints(scored.state, board, 'bob', 2).actualLost, 0);
    assert.equal(getDuelWinnerAtCleanup(restored, board), null);
    assert.equal(projectPublicDuelScoring(restored, board).victoryScore, 8);
    assert.deepEqual(createDuelScoring(board, 9), createDuelScoring(board, 9));
  } finally {
    Math.random = original;
  }
});

test('the public projection whitelists scoring fields, deep-clones and leaks nothing', () => {
  const { board, f1 } = boardBothControlledByAlice();
  const state = restoreDuelScoring(legalState(board, { alicePoints: 4, bobPoints: 1, aliceLedger: [f1],
    turnNumber: 2 }), board);
  const projected = projectPublicDuelScoring(state, board);
  assert.deepEqual(Object.keys(projected),
    ['playerIds', 'battlefieldLocationIds', 'victoryScore', 'turnNumber', 'players']);
  assert.deepEqual(Object.keys(projected.players[0]), ['playerId', 'points', 'scoredBattlefieldLocationIds']);
  assert.deepEqual(projected, state);
  assert.notStrictEqual(projected, state);
  assert.notStrictEqual(projected.players, state.players);
  assert.notStrictEqual(projected.players[0].scoredBattlefieldLocationIds,
    state.players[0].scoredBattlefieldLocationIds);
  projected.players[0].scoredBattlefieldLocationIds.push('fake');
  projected.playerIds.push('mallory');
  assert.deepEqual(state.players[0].scoredBattlefieldLocationIds, [f1]);
  assert.equal(state.playerIds.length, 2);
  const leaky = legalState(board, { alicePoints: 4 });
  leaky.deck = ['private deck'];
  leaky.players[0].hand = ['private hand'];
  const frozen = serial(leaky);
  assert.throws(() => projectPublicDuelScoring(leaky, board), TypeError);
  assert.deepEqual(leaky, frozen);
  assert.ok(!JSON.stringify(projected).includes('private'));
});
