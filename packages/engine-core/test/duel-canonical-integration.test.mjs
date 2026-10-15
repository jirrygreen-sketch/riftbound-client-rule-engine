import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelMatch, resolveDuelMulligan, projectDuelMatch } from '../dist/duel/match-state.js';
import { projectCanonicalDuelMatch, applyDuelResourceCommand,
  issueDuelRequiredCostTask, prepareDuelRequiredCostPayment } from '../dist/duel/canonical-session.js';
import { commitDuelPlayingMutation, detachedDuelPlaying } from '../dist/duel/canonical-transaction.js';
import { materializeDuelUnitFromSettledSource, planDuelUnitKills, commitApprovedDuelUnitKills,
  readyDuelUnits, recordResolvedDuelDamage, moveDuelUnitsWithMetadata } from '../dist/duel/unit-lifecycle.js';
import { channelDuelRunes } from '../dist/duel/resources.js';

const seats = ['alice', 'bob'].map(id => ({ playerId: id,
  mainDeck: Array.from({ length: 8 }, (_, n) => ({ uid: `${id}-main-${n}`, cardId: `unit:${id}:${n}` })),
  champion: { uid: `${id}-champion`, cardId: `unit:${id}:champion` },
  legend: { uid: `${id}-legend`, cardId: `legend:${id}` },
  runeDeck: Array.from({ length: 5 }, (_, n) => ({ uid: `${id}-rune-${n}`, cardId: `rune:${id}:${n}`, domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, n) => ({ instanceId: `${id}-field-${n}`, cardId: `field:${id}:${n}` })),
}));
function playing() {
  let state = createDuelMatch(seats, { matchId: 'canonical', dataVersion: 'v1', catalogDigest: 'digest',
    roster: ['alice', 'bob'].map(id => ({ playerId: id, displayName: id })) }, () => 0);
  state = resolveDuelMulligan(state, state.turnOrder[0], []);
  state = resolveDuelMulligan(state, state.turnOrder[1], []);
  assert.equal(state.stage, 'playing');
  return state;
}
const unit = (uid, cardId, owner, controller, locationId) => ({
  kind: 'card', uid, cardId, cardType: 'Unit', ownerPlayerId: owner,
  controllerPlayerId: controller, locationId,
});
const token = (uid, owner, controller, locationId) => ({
  kind: 'token', unitType: 'Unit', uid, name: 'Recruit', baseMight: 1, tags: ['Recruit'],
  ownerPlayerId: owner, controllerPlayerId: controller, locationId,
});
const settle = (draft, source) => materializeDuelUnitFromSettledSource(draft, source, () => true);
const commit = (match, mutate) => commitDuelPlayingMutation(match, mutate);
const base = (match, owner) => match.board.bases.find(b => b.ownerPlayerId === owner).locationId;

test('constructor metadata, nullable Champion settled from origin, projections for three viewers and full detachment', () => {
  const start = playing();
  assert.deepEqual(start.unitMeta, {});
  assert.deepEqual(start.retiredUnitTokenUIDs, []);
  const champion = start.players[0].champion;
  const before = structuredClone(start);
  const board = commit(start, draft => {
    const players = draft.players.map(player => player.playerId === 'alice'
      ? { ...player, champion: null } : player);
    return settle({ ...draft, players }, unit(champion.uid, champion.cardId, 'alice', 'alice', base(draft, 'alice')));
  });
  assert.equal(board.stateVersion, start.stateVersion + 1);
  assert.equal(board.eventSeq, start.eventSeq + 1);
  assert.deepEqual(start, before);
  assert.equal(board.players[0].champion, null);
  assert.deepEqual(board.board.units.map(entry => entry.objectId), [champion.uid]);
  assert.equal(board.unitMeta[champion.uid].readied, false);
  assert.notStrictEqual(board.frame, start.frame);
  assert.notStrictEqual(board.scoring, start.scoring);
  assert.notStrictEqual(board.resources, start.resources);
  assert.notStrictEqual(board.players[1], start.players[1]);
  assert.notStrictEqual(board.board, start.board);
  for (const viewer of [null, 'alice', 'bob']) {
    for (const project of [projectDuelMatch, projectCanonicalDuelMatch]) {
      const view = project(board, viewer);
      assert.equal(view.players[0].champion, null);
      assert.equal(view.board.units.length, 1);
      assert.deepEqual(Object.keys(view.board.units[0]).sort(),
        ['objectId', 'controllerPlayerId', 'locationId', 'ownerPlayerId', 'readied',
          'trait', 'totalDamage', 'damageMarks'].sort());
      assert.equal(view.board.units[0].objectId, champion.uid);
      assert.equal(view.board.units[0].ownerPlayerId, 'alice');
      assert.equal(view.board.units[0].locationId, base(board, 'alice'));
      const bytes = JSON.stringify(view);
      assert.equal(bytes.includes('retiredUnitTokenUIDs'), false);
      assert.equal(bytes.includes('unitMeta'), false);
    }
  }
  const projection = projectCanonicalDuelMatch(board, null);
  projection.board.units[0].trait.cardId = 'mutated';
  assert.equal(board.unitMeta[champion.uid].trait.cardId, champion.cardId);
});

test('one outer clock for actual lifecycle materialize, ready/noop, resolved damage, move, Kill and token retire', () => {
  let match = playing();
  const card = match.players[0].hand[0];
  match = commit(match, draft => settle({ ...draft, players: draft.players.map(player =>
    player.playerId === 'alice' ? { ...player, hand: player.hand.slice(1) } : player) },
  unit(card.uid, card.cardId, 'alice', 'alice', base(draft, 'alice'))));
  const afterEntry = match;
  assert.equal(match.stateVersion, 3);
  assert.equal(match.eventSeq, 3);
  match = commit(match, draft => readyDuelUnits(draft, [card.uid]).state);
  assert.equal(match.stateVersion, 4);
  const unchanged = commit(match, draft => readyDuelUnits(draft, [card.uid]).state);
  assert.strictEqual(unchanged, match);
  assert.equal(unchanged.stateVersion, 4);
  match = commit(match, draft => recordResolvedDuelDamage(draft, card.uid, {
    amount: 2, responsiblePlayerId: 'bob', sourceObjectIds: ['hidden-source-uid'],
  }));
  assert.equal(match.stateVersion, 5);
  const preMove = match;
  const moved = [];
  match = commit(match, draft => {
    const move = moveDuelUnitsWithMetadata(draft,
      { actor: 'alice', unitUIDs: [card.uid], destinationLocationId: draft.board.battlefields[0].locationId,
        timing: { phase: 'main', stateOpen: true, turnPlayerId: 'alice', priorityPlayerId: 'alice' } }, () => false);
    moved.push(move.group);
    return move.state;
  });
  assert.equal(match.stateVersion, 6);
  assert.equal(match.eventSeq, 6);
  assert.deepEqual(moved[0].objectIds, [card.uid]);
  assert.equal(match.board.units[0].locationId, match.board.battlefields[0].locationId);
  assert.equal(match.unitMeta[card.uid].ownerPlayerId, 'alice');
  assert.equal(match.unitMeta[card.uid].readied, false);
  assert.equal(match.unitMeta[card.uid].damageMarks[0].amount, 2);
  assert.equal(projectCanonicalDuelMatch(match, 'alice').board.units[0].totalDamage, 2);
  assert.equal(JSON.stringify(projectCanonicalDuelMatch(match, 'bob')).includes('hidden-source-uid'), false);
  assert.equal(preMove.board.units[0].locationId, base(match, 'alice'));
  const snapshot = structuredClone(match);
  assert.throws(() => commit(match, draft => ({ ...draft, unitMeta: {} })), /metadata/);
  assert.throws(() => commit(match, draft => ({ ...draft, players: draft.players.map((player, i) =>
    i ? player : { ...player, trash: [...player.trash, { uid: card.uid, cardId: card.cardId }] }) })), /duplicate UID/);
  assert.equal(JSON.stringify(match), JSON.stringify(snapshot));
  const plan = planDuelUnitKills(match, [card.uid], 'active');
  const beforeCancel = match;
  match = commit(match, draft => commitApprovedDuelUnitKills(draft, { plan, approvedUnitUIDs: [] }).state);
  assert.strictEqual(match, beforeCancel);
  assert.equal(match.stateVersion, 6);
  const notices = [];
  match = commit(match, draft => {
    const result = commitApprovedDuelUnitKills(draft, { plan, approvedUnitUIDs: [card.uid] });
    notices.push(...result.notices);
    return result.state;
  });
  assert.equal(match.stateVersion, 7);
  assert.equal(match.eventSeq, 7);
  assert.equal(match.board.units.length, 0);
  assert.deepEqual(match.players[0].trash.at(-1), card);
  assert.equal(notices[0].snapshot.totalDamage, 2);
  assert.equal(notices[1].destinationPlayerId, 'alice');
  assert.equal(match.board.battlefields[0].contested, true);
  const tokenUID = 'token:retire';
  match = commit(match, draft => settle(draft, token(tokenUID, 'alice', 'alice', base(draft, 'alice'))));
  assert.equal(match.stateVersion, 8);
  const tokenPlan = planDuelUnitKills(match, [tokenUID], 'passive');
  match = commit(match, draft => commitApprovedDuelUnitKills(draft,
    { plan: tokenPlan, approvedUnitUIDs: [tokenUID] }).state);
  assert.equal(match.stateVersion, 9);
  assert.equal(match.eventSeq, 9);
  assert.deepEqual(match.retiredUnitTokenUIDs, [tokenUID]);
  assert.equal(match.players[0].trash.length, 1);
  assert.throws(() => commit(match, draft => settle(draft, token(tokenUID, 'alice', 'alice', base(draft, 'alice')))),
    /still in physical zone/);
  assert.notStrictEqual(afterEntry.frame, match.frame);
});

test('transaction rejects rollback, injected common fields, collisions and inconsistent frame without changing old state', () => {
  const match = playing(), saved = structuredClone(match);
  assert.throws(() => commit(match, draft => ({ ...draft, stateVersion: draft.stateVersion + 2,
    resources: channelDuelRunes(draft.resources, 'alice', 1) })), /helper clock drift/);
  assert.throws(() => commit(match, draft => ({ ...draft, eventSeq: draft.eventSeq + 1 })), /event clock/);
  assert.throws(() => commit(match, draft => ({ ...draft, matchId: 'foreign' })), /match\/catalog/);
  assert.throws(() => commit(match, draft => ({ ...draft, roster: [...draft.roster].reverse() })), /roster/);
  assert.throws(() => commit(match, draft => ({ ...draft, frame: { ...draft.frame, pendingPayment: { fake: true } } })), /pending payment/);
  assert.throws(() => commit(match, draft => ({ ...draft, resources: { ...draft.resources,
    retiredGoldUids: [draft.players[0].champion.uid] } })), /duplicate UID/);
  assert.throws(() => commit(match, draft => ({ ...draft, scoring: { ...draft.scoring, playerIds: ['bob', 'alice'] } })), /board seats/);
  const originalJSON = JSON.stringify(match);
  let mutationAttempt;
  assert.throws(() => commit(match, draft => {
    try { match.roster[0].displayName = 'changed'; }
    catch (error) { mutationAttempt = error; throw error; }
    return draft;
  }), /read only|frozen/);
  assert.equal(mutationAttempt?.name, 'TypeError');
  assert.equal(JSON.stringify(match), originalJSON);
  assert.deepEqual(match, saved);
  const copy = detachedDuelPlaying(match);
  assert.notStrictEqual(copy.board, match.board);
  assert.notStrictEqual(copy.scoring, match.scoring);
  assert.notStrictEqual(copy.frame, match.frame);
});

test('active required task plus unit mutation: duplicate receipt always returns latest unit/champion/resource state', () => {
  let s = { match: playing(), receipts: [] };
  s = { ...s, match: commit(s.match, draft => ({ ...draft,
    frame: { ...draft.frame, phase: 'main', priorityPlayerId: null, stateOpen: false },
    resources: channelDuelRunes(draft.resources, 'alice', 2) })) };
  const task = { matchId: s.match.matchId, expectedVersion: s.match.stateVersion, taskId: 'must-pay',
    paymentId: 'pay-1', actor: 'alice', finalResolvedCost: { energy: 1, power: [] },
    opaqueSource: { kind: 'card', referenceId: 'SECRET-TASK' }, continuationId: 'SECRET-CONT' };
  const issued = issueDuelRequiredCostTask(s, task);
  s = prepareDuelRequiredCostPayment(issued.session, issued.authority).session;
  const runeUID = s.match.resources.bases[0].baseRunes[0].uid;
  const paymentInput = { commandId: 'energy', expectedVersion: s.match.stateVersion,
    command: { type: 'rune-energy', uid: runeUID } };
  let response = applyDuelResourceCommand(s, 'alice', paymentInput);
  assert.equal(response.outcome.status, 'applied');
  s = response.session;
  response = applyDuelResourceCommand(s, 'alice', { commandId: 'pay', expectedVersion: s.match.stateVersion,
    command: { type: 'pay-pending', paymentId: 'pay-1' } });
  assert.equal(response.outcome.status, 'applied');
  s = response.session;
  assert.equal(s.match.stateVersion, 6);
  const champion = s.match.players[0].champion;
  s = { ...s, match: commit(s.match, draft => settle({ ...draft, players: draft.players.map((player, i) =>
    i ? player : { ...player, champion: null }) }, unit(champion.uid, champion.cardId,
  'alice', 'alice', base(draft, 'alice')))) };
  assert.equal(s.match.stateVersion, 7);
  for (const old of [paymentInput, { commandId: 'pay', expectedVersion: 5,
    command: { type: 'pay-pending', paymentId: 'pay-1' } }]) {
    const result = applyDuelResourceCommand(s, 'alice', old);
    assert.equal(result.duplicate, true);
    assert.strictEqual(result.match, s.match);
    assert.equal(result.match.players[0].champion, null);
    assert.equal(result.match.board.units[0].objectId, champion.uid);
    assert.equal(result.match.resources.players[0].runePool.energy, 0);
    assert.equal(result.persistRequired, false);
  }
});
