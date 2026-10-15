import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelMatchV2,
  resolveDuelMulliganV2,
  commitDuelPlayingMutationV2,
  enumerateDuelObjectsV2,
  attestDuelTokenSourceV2,
  createDuelGoldTokenV2,
  activateDuelGoldPowerV2,
  createDuelRecruitUnitV2,
  killRetireDuelUnitTokenV2,
  restoreDuelPlayingStateV2,
} from '../dist/duel/core-v2.js';

const clone = structuredClone;
const hand = playerId => ({ kind: 'hand', zonePlayerId: playerId });
const deck = playerId => ({ kind: 'main-deck', zonePlayerId: playerId });

function fixture() {
  const seats = ['a', 'b'].map(playerId => ({
    playerId,
    mainDeck: Array.from({ length: 9 }, (_, i) => ({
      uid: `${playerId}-card-${i}`, cardId: `print-${i}`,
    })),
    champion: { uid: `${playerId}-champ`, cardId: 'champ' },
    legend: { uid: `${playerId}-legend`, cardId: 'legend' },
    runeDeck: Array.from({ length: 4 }, (_, i) => ({
      uid: `${playerId}-rune-${i}`, cardId: 'rune', domain: 'Fury',
    })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({
      instanceId: `${playerId}-bf-${i}`, cardId: `bf-${i}`,
    })),
  }));
  const metadata = {
    matchId: 'token-lifecycle-test',
    dataVersion: 'fixture-v1',
    catalogDigest: 'sha256:fixture',
    roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })),
  };
  const cardTypes = cardId => ({
    champ: 'Champion', legend: 'Legend', rune: 'Rune',
    'print-0': 'Gear', 'print-1': 'Gear', 'print-2': 'Unit',
  })[cardId] ?? (cardId.startsWith('bf-') ? 'Battlefield' : 'Unit');
  return { seats, metadata, cardTypes,
    setup: createDuelMatchV2(seats, metadata, () => 0, cardTypes) };
}

function playing() {
  const { setup, ...rest } = fixture();
  const first = resolveDuelMulliganV2(setup, 'a', []);
  return { ...rest, setup, first,
    state: resolveDuelMulliganV2(first, 'b', []) };
}

// This is a test oracle for the internal kernel only. It is deliberately not a production source
// provider and is not used to claim that IR/session source resolution is implemented.
function sourceOracle({ match, request }) {
  return {
    ...request,
    matchId: match.matchId,
    dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest,
    sourceProofId: `oracle-proof:${request.sourceEffectId}`,
  };
}

function requestFor(state, kind, tokenUID, sourceEffectId, overrides = {}) {
  const sourceZoneEpoch = state.physicalCardsByUID['a-card-1'].zoneEpoch;
  const locationId = state.board.bases.find(base => base.ownerPlayerId === 'a').locationId;
  const request = {
    kind,
    tokenUID,
    sourceEffectId,
    eventId: `event:${sourceEffectId}`,
    sourceUID: 'a-card-1',
    sourceZoneEpoch,
    sourceMode: 'current',
    effectControllerPlayerId: 'a',
    controllerPlayerId: 'a',
    locationId,
    readied: true,
    ...(kind === 'recruit' ? { name: 'Recruit', baseMight: 1, tags: ['Recruit'] } : {}),
    ...overrides,
  };
  return request;
}

function timing(actor = 'a') {
  return { stateOpen: true, priorityPlayerId: actor, resourcePaymentPlayerId: null };
}

function retiredPhysicalUIDs(setup) {
  return setup.setup.selection.removedByPlayer.flatMap(seat =>
    seat.battlefields.map(field => field.instanceId));
}

function restoreHistory(setup, state, transitions = []) {
  return {
    matchId: state.matchId,
    dataVersion: state.dataVersion,
    catalogDigest: state.catalogDigest,
    rosterPlayerIds: setup.roster.map(seat => seat.playerId),
    originalPhysicalCards: setup.provenance.originalPhysicalCards.map(card => ({ ...card })),
    submittedBattlefieldUIDs: [...setup.provenance.submittedBattlefieldUIDs],
    retiredPhysicalUIDs: retiredPhysicalUIDs(setup),
    initialZonesByUID: Object.fromEntries(Object.entries(setup.provenance.initialZonesByUID)
      .map(([uid, zone]) => [uid, { ...zone }])),
    transitions: transitions.map(step => ({ uid: step.uid, from: { ...step.from }, to: { ...step.to } })),
  };
}

function inventory(setup, state, { gold = {}, recruits = {}, epochs = {} } = {}) {
  const expectedZoneEpochByUID = Object.fromEntries(
    setup.provenance.originalPhysicalCards.map(card => [card.uid, epochs[card.uid] ?? 0]),
  );
  return {
    matchId: state.matchId,
    dataVersion: state.dataVersion,
    catalogDigest: state.catalogDigest,
    rosterPlayerIds: setup.roster.map(seat => seat.playerId),
    originalPhysicalCards: setup.provenance.originalPhysicalCards.map(card => ({ ...card })),
    submittedBattlefieldUIDs: [...setup.provenance.submittedBattlefieldUIDs],
    expectedZoneEpochByUID,
    retiredPhysicalUIDs: retiredPhysicalUIDs(setup),
    goldOwnersByUID: { ...gold },
    unitTokenOwnersByUID: { ...recruits },
  };
}

test('constructor/mulligan plus attested exhausted Gold creates one owned Base carrier', () => {
  const { state } = playing();
  const request = requestFor(state, 'gold', 'gold-exhausted', 'effect-gold-exhausted', { readied: false });
  assert.throws(() => createDuelGoldTokenV2(state, request), /authority|attestor|unissued/);
  const next = createDuelGoldTokenV2(state, request, sourceOracle);
  const gold = next.resources.bases[0].goldTokens[0];
  assert.equal(next.stateVersion, state.stateVersion + 1);
  assert.deepEqual(gold, {
    uid: 'gold-exhausted', readied: false, ownerPlayerId: 'a', controllerPlayerId: 'a',
    locationId: next.resources.bases[0].locationId,
  });
  const view = enumerateDuelObjectsV2(next).find(object => object.uid === 'gold-exhausted');
  assert.equal(view.cardId, null);
  assert.equal(view.ownerPlayerId, 'a');
  assert.equal(view.controllerPlayerId, 'a');
});

test('real Gold kernel rejects unready activation atomically, then ready activation adds Any and retires Gold', () => {
  const { state } = playing();
  const exhausted = createDuelGoldTokenV2(state,
    requestFor(state, 'gold', 'gold-exhausted', 'effect-exhausted', { readied: false }), sourceOracle);
  const beforeFailed = JSON.stringify(exhausted);
  assert.throws(() => activateDuelGoldPowerV2(exhausted, 'a', 'gold-exhausted', timing()), /exhausted/);
  assert.equal(JSON.stringify(exhausted), beforeFailed);
  assert.equal(exhausted.stateVersion, state.stateVersion + 1);

  const ready = createDuelGoldTokenV2(exhausted,
    requestFor(exhausted, 'gold', 'gold-ready', 'effect-ready'), sourceOracle);
  const consumed = activateDuelGoldPowerV2(ready, 'a', 'gold-ready', timing());
  assert.equal(consumed.stateVersion, ready.stateVersion + 1);
  assert.equal(consumed.resources.players[0].runePool.power.any, 1);
  assert.equal(consumed.resources.players[0].runePool.energy, 0);
  assert.equal(consumed.resources.retiredGoldUids.includes('gold-ready'), true);
  assert.equal(consumed.resources.bases[0].goldTokens.some(gold => gold.uid === 'gold-ready'), false);
  assert.equal(consumed.resources.bases[0].goldTokens.some(gold => gold.uid === 'gold-exhausted'), true);
});

test('Gold timing and actor authorization are delegated to the real resource kernel', () => {
  const { state } = playing();
  const ready = createDuelGoldTokenV2(state,
    requestFor(state, 'gold', 'gold-actor', 'effect-actor'), sourceOracle);
  const before = JSON.stringify(ready);
  assert.throws(() => activateDuelGoldPowerV2(ready, 'b', 'gold-actor', timing('b')), /own|timing|Gold/);
  assert.throws(() => activateDuelGoldPowerV2(ready, 'a', 'gold-actor', {
    stateOpen: true, priorityPlayerId: 'b', resourcePaymentPlayerId: null,
  }), /timing/);
  assert.equal(JSON.stringify(ready), before);
  assert.equal(ready.stateVersion, state.stateVersion + 1);
});

test('opaque source authority survives neither clone nor replay and is consumed once', () => {
  const { state } = playing();
  const request = requestFor(state, 'gold', 'gold-authority', 'effect-authority');
  const { authority, attestation } = attestDuelTokenSourceV2(state, request, sourceOracle);
  assert.equal(attestation.sourceProofId, 'oracle-proof:effect-authority');
  assert.throws(() => createDuelGoldTokenV2(state, request, clone(authority)), /unissued|foreign|spent/);
  const next = createDuelGoldTokenV2(state, request, authority);
  assert.equal(next.resources.bases[0].goldTokens[0].uid, 'gold-authority');
  assert.throws(() => createDuelGoldTokenV2(state, request, authority), /unissued|foreign|spent/);
});

test('foreign/default/forged source tuples, duplicate effects, and physical UID collisions fail closed', () => {
  const { state } = playing();
  const baseRequest = requestFor(state, 'gold', 'gold-source', 'effect-source');
  assert.throws(() => createDuelGoldTokenV2(state, baseRequest, {}), /unissued|foreign|spent/);
  assert.throws(() => createDuelGoldTokenV2(state, {
    ...baseRequest, tokenUID: 'a-card-0', sourceEffectId: 'effect-collision', eventId: 'event-collision',
  }, sourceOracle), /carried|physical|collides/);
  assert.throws(() => createDuelGoldTokenV2(state, {
    ...baseRequest, effectControllerPlayerId: 'b', sourceEffectId: 'effect-foreign', eventId: 'event-foreign',
  }, sourceOracle), /creating-effect controller|owner/);
  assert.throws(() => createDuelGoldTokenV2(state, {
    ...baseRequest, sourceEffectId: 'effect-wrong-match', eventId: 'event-wrong-match',
  }, ({ request }) => ({ ...request, matchId: 'other-match', dataVersion: state.dataVersion,
    catalogDigest: state.catalogDigest, sourceProofId: 'forged' })), /match\/catalog/);
  const next = createDuelGoldTokenV2(state, baseRequest, sourceOracle);
  assert.throws(() => createDuelGoldTokenV2(next, {
    ...baseRequest, tokenUID: 'gold-other', eventId: 'event-other',
  }, sourceOracle), /source effect already/);
});

test('current epoch is checked while independently attested pre-exit source uses its own mode', () => {
  const { state } = playing();
  const sourceEpoch = state.physicalCardsByUID['a-card-1'].zoneEpoch;
  const moved = commitDuelPlayingMutationV2(state, draft => ({
    match: { ...draft, players: draft.players.map(player => player.playerId === 'a' ? {
      ...player,
      hand: player.hand.filter(card => card.uid !== 'a-card-1'),
      remainingMainDeck: [...player.remainingMainDeck, player.hand.find(card => card.uid === 'a-card-1')],
    } : player) },
    transitions: [{ uid: 'a-card-1', from: hand('a'), to: deck('a') }],
  }));
  assert.equal(moved.physicalCardsByUID['a-card-1'].zoneEpoch, sourceEpoch + 1);
  assert.throws(() => createDuelGoldTokenV2(moved, {
    ...requestFor(moved, 'gold', 'gold-stale', 'effect-stale'), sourceZoneEpoch: sourceEpoch,
  }, sourceOracle), /stale physical reference/);

  // The positive pre-exit case is an internal attestor oracle only. Production event-journal
  // verification is intentionally outside this slice and must supply the independent evidence.
  const preExit = createDuelGoldTokenV2(moved, {
    ...requestFor(moved, 'gold', 'gold-pre-exit', 'effect-pre-exit'),
    sourceMode: 'pre-exit', sourceZoneEpoch: sourceEpoch,
  }, sourceOracle);
  assert.equal(preExit.resources.bases[0].goldTokens[0].uid, 'gold-pre-exit');
});

test('Recruit is a 1-Might domainless token with independent owner and kill-retire has no physical Trash', () => {
  const { state } = playing();
  const recruited = createDuelRecruitUnitV2(state,
    requestFor(state, 'recruit', 'recruit-1', 'effect-recruit', { readied: false }), sourceOracle);
  const meta = recruited.unitMeta['recruit-1'];
  assert.deepEqual(meta.trait, { kind: 'token', name: 'Recruit', baseMight: 1, tags: ['Recruit'] });
  assert.equal(meta.ownerPlayerId, 'a');
  assert.equal(recruited.board.units.find(unit => unit.objectId === 'recruit-1').controllerPlayerId, 'a');
  assert.equal(recruited.players.every(player => player.trash.every(card => card.uid !== 'recruit-1')), true);
  assert.equal(Object.hasOwn(recruited.physicalCardsByUID, 'recruit-1'), false);
  const killed = killRetireDuelUnitTokenV2(recruited, 'recruit-1');
  assert.equal(killed.stateVersion, recruited.stateVersion + 1);
  assert.equal(killed.board.units.some(unit => unit.objectId === 'recruit-1'), false);
  assert.equal(Object.hasOwn(killed.unitMeta, 'recruit-1'), false);
  assert.deepEqual(killed.retiredUnitTokenUIDs, ['recruit-1']);
  assert.equal(killed.players.every(player => player.trash.every(card => card.uid !== 'recruit-1')), true);
  assert.throws(() => killRetireDuelUnitTokenV2(killed, 'recruit-1'), /birth|live|retired/);
  assert.throws(() => createDuelRecruitUnitV2(killed,
    requestFor(killed, 'recruit', 'recruit-1', 'effect-recruit-reuse'), sourceOracle), /already|retired|exists/);
});

test('Recruit field invariants and controller/owner binding reject malformed source attestations', () => {
  const { state } = playing();
  const badMight = requestFor(state, 'recruit', 'recruit-bad-might', 'effect-bad-might', { baseMight: 2 });
  assert.throws(() => createDuelRecruitUnitV2(state, badMight, sourceOracle), /baseMight/);
  const badTags = requestFor(state, 'recruit', 'recruit-bad-tags', 'effect-bad-tags', { tags: ['Scout'] });
  assert.throws(() => createDuelRecruitUnitV2(state, badTags, sourceOracle), /Recruit/);
  const mismatch = requestFor(state, 'recruit', 'recruit-mismatch', 'effect-mismatch', {
    effectControllerPlayerId: 'a', controllerPlayerId: 'b',
  });
  assert.throws(() => createDuelRecruitUnitV2(state, mismatch, sourceOracle), /controller|owner/);
});

test('failure, exception, and no-op preserve input bytes and clocks', () => {
  const { state } = playing();
  const before = JSON.stringify(state);
  const version = state.stateVersion;
  assert.throws(() => createDuelGoldTokenV2(state,
    requestFor(state, 'gold', 'gold-throw', 'effect-throw'), () => { throw new Error('attestor failed'); }), /attestor failed/);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.stateVersion, version);
  assert.throws(() => commitDuelPlayingMutationV2(state, draft => {
    draft.players[0].hand.push({ uid: 'would-fail', cardId: 'bad' });
    throw new Error('trusted executor failed');
  }), /trusted executor failed|object is not extensible/);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.stateVersion, version);
  const noop = commitDuelPlayingMutationV2(state, draft => ({ match: draft, transitions: [] }));
  assert.equal(noop, state);
  assert.equal(JSON.stringify(noop), before);
  assert.equal(noop.stateVersion, version);
  assert.equal(noop.eventSeq, state.eventSeq);
});

test('ordered physical trace remains separate from token proof and increments epoch once per crossing', () => {
  const { state } = playing();
  const uid = 'a-card-1';
  const next = commitDuelPlayingMutationV2(state, draft => ({
    match: draft,
    transitions: [
      { uid, from: hand('a'), to: deck('a') },
      { uid, from: deck('a'), to: hand('a') },
    ],
  }));
  assert.equal(next.physicalCardsByUID[uid].zoneEpoch, state.physicalCardsByUID[uid].zoneEpoch + 2);
  assert.equal(next.stateVersion, state.stateVersion + 1);
  assert.equal(next.eventSeq, state.eventSeq + 1);
  assert.equal(state.physicalCardsByUID[uid].zoneEpoch, 0);
  assert.throws(() => commitDuelPlayingMutationV2(next, draft => ({
    match: { ...draft, physicalCardsByUID: { ...draft.physicalCardsByUID,
      [uid]: { ...draft.physicalCardsByUID[uid], ownerPlayerId: 'b' } } }, transitions: [],
  })), /identity|independently proved/);
});

test('independent token lifecycle history is accepted on restore and remains required for token snapshots', () => {
  const { setup, state } = playing();
  const request = requestFor(state, 'gold', 'gold-archive', 'effect-archive');
  const { authority, attestation } = attestDuelTokenSourceV2(state, request, sourceOracle);
  const live = createDuelGoldTokenV2(state, request, authority);
  const tokenHistory = {
    births: [{ ...attestation, createdAtStateVersion: live.stateVersion }],
    retirements: [],
  };
  const proof = inventory(setup, live, { gold: { 'gold-archive': 'a' } });
  const restored = restoreDuelPlayingStateV2(clone(live), proof, restoreHistory(setup, live), tokenHistory);
  assert.equal(restored.resources.bases[0].goldTokens[0].uid, 'gold-archive');
  const consumed = activateDuelGoldPowerV2(restored, 'a', 'gold-archive', timing());
  assert.equal(consumed.resources.players[0].runePool.power.any, 1);
  assert.throws(() => restoreDuelPlayingStateV2(clone(live), proof,
    restoreHistory(setup, live)), /token|attestation|proof/);
});
