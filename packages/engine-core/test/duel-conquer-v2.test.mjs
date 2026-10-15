import { test } from 'node:test';
import assert from 'node:assert/strict';

// Standalone source test: from repo root, run DUEL_CONQUER_SOURCE_TEST=1
// node --test packages/engine-core/test/duel-conquer-v2.test.mjs (Node 22+).
// The ordinary suite imports built dist.
const root = process.env.DUEL_CONQUER_SOURCE_TEST ? '../src/duel/' : '../dist/duel/';
const suffix = process.env.DUEL_CONQUER_SOURCE_TEST ? '.ts' : '.js';
const {
  selectDuelBattlefields, createDuelBoard, placeDuelUnit, removeDuelUnit, applyOpenDuelCleanup,
  beginDuelShowdown, endDuelNonCombatShowdown, beginDuelCombat, endDuelCombat,
} = await import(`${root}battlefields${suffix}`);
const { createDuelScoring, beginDuelScoreTurn, gainDuelPoints, scoreDuelBattlefield } =
  await import(`${root}scoring${suffix}`);
const { createDuelConquerAuthorityV2, issueDuelControlEstablishedEventV2, scoreDuelConquerWithEventV2 } =
  await import(`${root}conquer-v2${suffix}`);

const serial = value => JSON.parse(JSON.stringify(value));
const seats = () => [
  { playerId: 'alice', battlefields: [
    { instanceId: 'a-1', cardId: 'printing-a' }, { instanceId: 'a-2', cardId: 'printing-b' },
    { instanceId: 'a-3', cardId: 'printing-c' },
  ] },
  { playerId: 'bob', battlefields: [
    { instanceId: 'b-1', cardId: 'printing-a' }, { instanceId: 'b-2', cardId: 'printing-b' },
    { instanceId: 'b-3', cardId: 'printing-c' },
  ] },
];
function newBoard() {
  const board = createDuelBoard(selectDuelBattlefields(seats(), () => 0));
  return { board, a: board.battlefields[0].locationId, b: board.battlefields[1].locationId };
}
function nonCombat(before, locationId, playerId, objectId) {
  const withUnit = placeDuelUnit(before, { objectId, controllerPlayerId: playerId, locationId });
  const started = beginDuelShowdown(applyOpenDuelCleanup(withUnit), locationId);
  return { before: started, after: endDuelNonCombatShowdown(started, locationId) };
}
function combat(before, locationId) {
  let started = placeDuelUnit(before, { objectId: 'bob-unit', controllerPlayerId: 'bob', locationId });
  started = beginDuelCombat(applyOpenDuelCleanup(started), locationId);
  const cleaned = removeDuelUnit(started, 'alice-unit');
  const ended = endDuelCombat(cleaned, locationId, { recalledAttackersDuringCleanup: false });
  assert.deepEqual(ended.result, { winnerPlayerId: 'bob' });
  return { before: cleaned, after: ended.board };
}
function positions(matchId, version = 2) {
  return { before: { matchId, stateVersion: version - 1, eventSeq: version - 1 },
    after: { matchId, stateVersion: version, eventSeq: version } };
}
function admitted(controlEventId, pair, actor, locationId, matchId, version = 2,
  scoring = turn(pair.after), resolution = { kind: 'non-combat-showdown' }) {
  const clock = positions(matchId, version);
  return { controlEventId, beforeBoard: pair.before, afterBoard: pair.after,
    beforePosition: clock.before, afterPosition: clock.after, actor, locationId,
    resolution, scoring, turnPlayerId: 'alice' };
}
function provider(first) {
  const entries = new Map([[first.controlEventId, first]]);
  const state = { head: { position: first.afterPosition, board: first.afterBoard, scoring: first.scoring } };
  const authority = createDuelConquerAuthorityV2(eventId => {
    const event = entries.get(eventId);
    return event ? { ...event, head: state.head } : null;
  });
  const setHead = entry => { state.head = { position: entry.afterPosition, board: entry.afterBoard, scoring: entry.scoring }; };
  const add = entry => entries.set(entry.controlEventId, entry);
  return { authority, entries, state, setHead, add };
}
function request(entry) {
  return { controlEventId: entry.controlEventId, expectedPosition: entry.afterPosition };
}
function issue(source, entry) { return issueDuelControlEstablishedEventV2(source.authority, request(entry)); }
function score(source, entry, token) { return scoreDuelConquerWithEventV2(source.authority, request(entry), token); }
function turn(board) { return beginDuelScoreTurn(createDuelScoring(board), board, 1); }

test('non-combat admitted transition: opaque token, authority scoring, score once and consumption', () => {
  const { board, a } = newBoard();
  const pair = nonCombat(board, a, 'alice', 'alice-unit');
  const input = serial(pair);
  const entry = admitted('noncombat-control', pair, 'alice', a, 'conquer-noncombat');
  const source = provider(entry);
  const token = issue(source, entry);
  assert.equal(pair.before.battlefields[0].controllerPlayerId, null);
  assert.equal(pair.after.battlefields[0].controllerPlayerId, 'alice');
  assert.deepEqual(Reflect.ownKeys(source.authority), []);
  assert.deepEqual(Reflect.ownKeys(token), []);
  assert.deepEqual(serial(token), {});
  assert.ok(Object.isFrozen(token));
  const beforeScore = serial(entry.scoring);
  const result = score(source, entry, token);
  assert.deepEqual(result.outcome, { playerId: 'alice', locationId: a, method: 'conquer',
    pointsGained: 1, drawRequired: 0, triggerScore: true, triggerMethod: 'conquer' });
  assert.equal(result.state.players[0].points, 1);
  assert.deepEqual(result.state.players[0].scoredBattlefieldLocationIds, [a]);
  assert.deepEqual(result.eventConsumption, { ...entry.afterPosition, controlEventId: entry.controlEventId,
    actor: 'alice', locationId: a, previousControllerPlayerId: null,
    resolution: { kind: 'non-combat-showdown' }, consumed: true });
  assert.deepEqual(serial(pair), input);
  assert.deepEqual(entry.scoring, beforeScore);
  assert.throws(() => score(source, entry, token), /already consumed/);
  assert.throws(() => issue(source, entry), /already issued/);
});

test('distinct event IDs cannot issue or consume the same canonical transition', () => {
  const { board, a } = newBoard();
  const pair = nonCombat(board, a, 'alice', 'alice-unit');
  const first = admitted('control-first', pair, 'alice', a, 'conquer-alias');
  const alias = { ...first, controlEventId: 'control-alias' };
  const source = provider(first);
  source.add(alias);
  const token = issue(source, first);
  assert.throws(() => issue(source, alias), /canonical transition already issued/);
  assert.equal(score(source, first, token).outcome.pointsGained, 1);
  assert.throws(() => issue(source, alias), /canonical transition already issued/);
  assert.throws(() => score(source, first, token), /already consumed/);
});

test('one event ID cannot be rebound to a different admitted transition', () => {
  const { board, a, b } = newBoard();
  const firstPair = nonCombat(board, a, 'alice', 'unit-a');
  const secondPair = nonCombat(board, b, 'alice', 'unit-b');
  const first = admitted('reused-id', firstPair, 'alice', a, 'conquer-rebind');
  const second = admitted('reused-id', secondPair, 'alice', b, 'conquer-rebind');
  const source = provider(first);
  const token = issue(source, first);
  source.add(second);
  source.setHead(second);
  assert.throws(() => score(source, first, token), /canonical event drift/);
  assert.throws(() => issue(source, second), /already issued/);
  source.add(first);
  source.setHead(first);
  assert.equal(score(source, first, token).outcome.pointsGained, 1);
});

test('resolver exceptions hide private message and cause; failed reads can retry', () => {
  const { board, a } = newBoard();
  const pair = nonCombat(board, a, 'alice', 'alice-unit');
  const first = admitted('private-error', pair, 'alice', a, 'conquer-private');
  const alias = { ...first, controlEventId: 'private-alias' };
  let fail = true;
  const authority = createDuelConquerAuthorityV2(eventId => {
    if (fail) throw new Error('private zone: hidden card', { cause: new Error('secret provider detail') });
    return eventId === first.controlEventId || eventId === alias.controlEventId
      ? { ...first, controlEventId: eventId,
        head: { position: first.afterPosition, board: first.afterBoard, scoring: first.scoring } }
      : null;
  });
  const source = { authority };
  const hidden = error => {
    assert.equal(error.constructor, TypeError);
    assert.equal(error.message, 'Duel conquer authority internal error');
    assert.equal('cause' in error, false);
    return true;
  };
  assert.throws(() => issue(source, first), hidden);
  fail = false;
  const token = issue(source, first);
  fail = true;
  assert.throws(() => score(source, first, token), hidden);
  fail = false;
  assert.throws(() => issue(source, alias), /canonical transition already issued/);
  assert.equal(score(source, first, token).outcome.pointsGained, 1);
  assert.throws(() => issue(source, alias), /canonical transition already issued/);
});

test('combat executor supplies recall flag and winner/no-result; replay checks result and board', () => {
  const { board, a } = newBoard();
  const initial = nonCombat(board, a, 'alice', 'alice-unit').after;
  const pair = combat(initial, a);
  const entry = admitted('combat-control', pair, 'bob', a, 'conquer-combat', 9, turn(pair.after),
    { kind: 'combat', recalledAttackersDuringCleanup: false, result: { winnerPlayerId: 'bob' } });
  const source = provider(entry);
  const token = issue(source, entry);
  const result = score(source, entry, token);
  assert.equal(result.state.players[1].points, 1);
  assert.equal(result.eventConsumption.previousControllerPlayerId, 'alice');
  assert.deepEqual(result.eventConsumption.resolution, entry.resolution);

  const recalled = endDuelCombat(pair.before, a, { recalledAttackersDuringCleanup: true });
  assert.equal(recalled.result, 'no-result');
  assert.deepEqual(recalled.board, pair.after); // The board cannot prove whether a recall happened.
  const recall = admitted('recall-control', { before: pair.before, after: recalled.board },
    'bob', a, 'conquer-recall', 3, turn(recalled.board),
    { kind: 'combat', recalledAttackersDuringCleanup: true, result: 'no-result' });
  const recalledSource = provider(recall);
  assert.equal(score(recalledSource, recall, issue(recalledSource, recall)).state.players[1].points, 1);
  for (const forged of [
    { kind: 'combat', recalledAttackersDuringCleanup: true, result: { winnerPlayerId: 'bob' } },
    { kind: 'combat', recalledAttackersDuringCleanup: false, result: 'no-result' },
    { kind: 'combat', recalledAttackersDuringCleanup: false, result: { winnerPlayerId: 'alice' } },
  ]) {
    const bad = { ...recall, resolution: forged };
    assert.throws(() => issue(provider(bad), bad), /combat winner\/no-result/);
  }
});

test('Final Point drawRequired remains an executor obligation; second distinct battlefield scores', () => {
  const { board, a, b } = newBoard();
  const first = nonCombat(board, a, 'alice', 'unit-first');
  const atSeven = gainDuelPoints(createDuelScoring(first.after), first.after, 'alice', 7).state;
  const scoring = beginDuelScoreTurn(atSeven, first.after, 1);
  const initial = admitted('first-control', first, 'alice', a, 'conquer-final', 5, scoring);
  const source = provider(initial);
  const firstScore = score(source, initial, issue(source, initial));
  assert.equal(firstScore.state.players[0].points, 7);
  assert.deepEqual(firstScore.state.players[0].scoredBattlefieldLocationIds, [a]);
  assert.deepEqual(firstScore.outcome, { playerId: 'alice', locationId: a, method: 'conquer',
    pointsGained: 0, drawRequired: 1, triggerScore: true, triggerMethod: 'conquer' });
  assert.equal(firstScore.eventConsumption.consumed, true);
  assert.deepEqual(scoring.players[0].scoredBattlefieldLocationIds, []);
  const firstAlias = { ...initial, controlEventId: 'first-alias' };
  source.add(firstAlias);
  assert.throws(() => issue(source, firstAlias), /canonical transition already issued/);
  // Draw and triggers must be completed atomically by the outer executor.
  const second = nonCombat(first.after, b, 'alice', 'unit-second');
  const next = admitted('second-control', second, 'alice', b, 'conquer-final', 7, firstScore.state);
  source.add(next);
  source.setHead(next);
  const secondScore = score(source, next, issue(source, next));
  assert.equal(secondScore.outcome.pointsGained, 1);
  assert.equal(secondScore.outcome.drawRequired, 0);
  assert.equal(secondScore.state.players[0].points, 8);
  assert.deepEqual(secondScore.state.players[0].scoredBattlefieldLocationIds, [a, b]);
  const secondAlias = { ...next, controlEventId: 'second-alias' };
  source.add(secondAlias);
  assert.throws(() => issue(source, secondAlias), /canonical transition already issued/);
});

test('forged request boards/scoring/clock, cloned authority/token and cross-authority replay fail', () => {
  const { board, a, b } = newBoard();
  const pair = nonCombat(board, a, 'alice', 'alice-unit');
  const entry = admitted('negative-control', pair, 'alice', a, 'conquer-negative');
  const source = provider(entry);
  const token = issue(source, entry);
  const wrongBoard = placeDuelUnit(pair.after,
    { objectId: 'another-alice', controllerPlayerId: 'alice', locationId: a });
  const arbitraryScore = beginDuelScoreTurn(gainDuelPoints(createDuelScoring(pair.after), pair.after, 'alice', 7).state,
    pair.after, 1);
  const rejected = [
    () => scoreDuelConquerWithEventV2(source.authority, request(entry), {}),
    () => scoreDuelConquerWithEventV2(source.authority, request(entry), { ...token }),
    () => scoreDuelConquerWithEventV2(source.authority, request(entry), serial(token)),
    () => scoreDuelConquerWithEventV2(source.authority, request(entry), null),
    () => scoreDuelConquerWithEventV2({ ...source.authority }, request(entry), token),
    () => scoreDuelConquerWithEventV2(serial(source.authority), request(entry), token),
    () => scoreDuelConquerWithEventV2({}, request(entry), token),
    () => scoreDuelConquerWithEventV2(provider(entry).authority, request(entry), token),
    () => scoreDuelConquerWithEventV2(source.authority, { ...request(entry), actor: 'bob' }, token),
    () => scoreDuelConquerWithEventV2(source.authority, { ...request(entry), locationId: b }, token),
    () => scoreDuelConquerWithEventV2(source.authority, { ...request(entry), board: wrongBoard }, token),
    () => scoreDuelConquerWithEventV2(source.authority, { ...request(entry), scoring: arbitraryScore }, token),
    () => scoreDuelConquerWithEventV2(source.authority, { ...request(entry), turnPlayerId: 'bob' }, token),
    () => scoreDuelConquerWithEventV2(source.authority, { ...request(entry), source: { kind: 'combat' } }, token),
    () => scoreDuelConquerWithEventV2(source.authority, { ...request(entry),
      expectedPosition: { ...entry.afterPosition, stateVersion: 999, eventSeq: 999 } }, token),
    () => scoreDuelConquerWithEventV2(source.authority, { ...request(entry),
      expectedPosition: { ...entry.afterPosition, matchId: 'another-match' } }, token),
    () => scoreDuelConquerWithEventV2(source.authority, { ...request(entry),
      expectedPosition: { ...entry.afterPosition, eventSeq: NaN } }, token),
  ];
  for (const call of rejected) assert.throws(call, TypeError);
  assert.equal(score(source, entry, token).state.players[0].points, 1);
  assert.throws(() => score(source, entry, token), /already consumed/);
});

test('only current canonical head can issue; no raw high-water poisoning, doubles or non-control event', () => {
  const { board, a, b } = newBoard();
  const pair = nonCombat(board, a, 'alice', 'alice-unit');
  const entry = admitted('real-control', pair, 'alice', a, 'real-match', 2);
  const source = provider(entry);
  const fake = { ...entry, controlEventId: 'fake-high-version', beforePosition: positions('real-match', 1000).before,
    afterPosition: positions('real-match', 1000).after };
  source.add(fake);
  assert.throws(() => issue(source, fake), /not the current authoritative match head/);
  assert.throws(() => issueDuelControlEstablishedEventV2(source.authority,
    { ...request(entry), beforeBoard: pair.before, afterBoard: pair.after }), /request keys/);
  assert.throws(() => issueDuelControlEstablishedEventV2(source.authority,
    { ...request(entry), expectedPosition: fake.afterPosition }), /expected match\/clock mismatch/);
  const token = issue(source, entry);
  assert.throws(() => issue(source, entry), /already issued/);
  assert.equal(score(source, entry, token).outcome.pointsGained, 1);
  assert.throws(() => issue(source, entry), /already issued/);

  // A truly advanced head (not a caller high-water) retires an unconsumed old event.
  const second = nonCombat(pair.after, b, 'bob', 'bob-unit');
  const later = admitted('later-control', second, 'bob', b, 'real-match', 3);
  const evolving = provider(entry);
  const old = issue(evolving, entry);
  evolving.add(later);
  evolving.setHead(later);
  assert.throws(() => score(evolving, entry, old), /not the current authoritative match head/);
  assert.equal(score(evolving, later, issue(evolving, later)).outcome.pointsGained, 1);
  // Previous token cannot migrate to a newly created authority; persisted receipt is
  // required to prevent same-history reissuance after restart.
  assert.throws(() => scoreDuelConquerWithEventV2(provider(entry).authority, request(entry), old), /another authority/);

  const initial = pair.after;
  let combatStart = placeDuelUnit(initial, { objectId: 'bob-unit', controllerPlayerId: 'bob', locationId: a });
  combatStart = beginDuelCombat(applyOpenDuelCleanup(combatStart), a);
  const cleaned = removeDuelUnit(combatStart, 'bob-unit');
  const ended = endDuelCombat(cleaned, a, { recalledAttackersDuringCleanup: false });
  const noChange = admitted('unchanged', { before: cleaned, after: ended.board }, 'alice', a,
    'conquer-unchanged', 5, turn(ended.board),
    { kind: 'combat', recalledAttackersDuringCleanup: false, result: { winnerPlayerId: 'alice' } });
  assert.throws(() => issue(provider(noChange), noChange), /control must change/);
});

test('invalid provider proof, kernel failure, resolver drift and reentry never spend a token', () => {
  const { board, a } = newBoard();
  const pair = nonCombat(board, a, 'alice', 'alice-unit');
  const zero = admitted('turn-zero', pair, 'alice', a, 'conquer-failure', 2, createDuelScoring(pair.after));
  const source = provider(zero);
  const token = issue(source, zero);
  assert.throws(() => score(source, zero, token), /turn 0/);
  assert.deepEqual(zero.scoring, createDuelScoring(pair.after));
  // A new ledger after issuance is NOT exchangeable for the original Score state.
  const updated = { ...zero, scoring: turn(pair.after) };
  source.add(updated);
  source.setHead(updated);
  assert.throws(() => score(source, zero, token), /canonical event drift/);
  assert.throws(() => issue(source, zero), /already issued/);

  const valid = admitted('kernel-failure', pair, 'alice', a, 'other-match', 3);
  const held = scoreDuelBattlefield(valid.scoring, pair.after, 'alice', a, 'hold', {
    phase: 'beginning-scoring', turnPlayerId: 'alice',
    controlEstablishedForPlayerId: null, controlEstablishedLocationId: null,
  });
  const ledger = { ...valid, scoring: held.state };
  const checked = provider(ledger);
  const heldToken = issue(checked, ledger);
  assert.throws(() => score(checked, ledger, heldToken), /already scored/);
  assert.throws(() => score(checked, ledger, heldToken), /already scored/);

  const max = Number.MAX_SAFE_INTEGER;
  const overflow = { ...valid, controlEventId: 'overflow',
    beforePosition: { matchId: 'overflow', stateVersion: max, eventSeq: max },
    afterPosition: { matchId: 'overflow', stateVersion: max + 1, eventSeq: max + 1 } };
  assert.throws(() => issue(provider(overflow), overflow), /safe integer|overflow/);
  const broken = { ...valid, controlEventId: 'bad-board', afterBoard: { ...pair.after, secret: 'untrusted' } };
  assert.throws(() => issue(provider(broken), broken), /keys/);
  const badScoring = { ...valid, controlEventId: 'bad-scoring',
    scoring: { ...valid.scoring, players: [{ ...valid.scoring.players[0], points: -1 }, valid.scoring.players[1]] } };
  assert.throws(() => issue(provider(badScoring), badScoring), /points must not be negative/);
  const wrongResult = { ...valid, controlEventId: 'wrong-source', resolution: { kind: 'combat',
    recalledAttackersDuringCleanup: false, result: 'no-result' } };
  assert.throws(() => issue(provider(wrongResult), wrongResult), /no active combat/);

  let reentry = true;
  let safe;
  const reentrant = createDuelConquerAuthorityV2(eventId => {
    if (reentry) { reentry = false;
      assert.throws(() => issueDuelControlEstablishedEventV2(safe, request(valid)), /reentry/);
    }
    return eventId === valid.controlEventId ? { ...valid,
      head: { position: valid.afterPosition, board: valid.afterBoard, scoring: valid.scoring } } : null;
  });
  safe = reentrant;
  assert.throws(() => issueDuelControlEstablishedEventV2(safe, request(valid)), /reentry/);
  const reentryToken = issueDuelControlEstablishedEventV2(safe, request(valid));
  assert.equal(scoreDuelConquerWithEventV2(safe, request(valid), reentryToken).outcome.pointsGained, 1);
});
