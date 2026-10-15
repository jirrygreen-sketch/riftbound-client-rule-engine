import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelMatchV2, resolveDuelMulliganV2, enumerateDuelObjectsV2,
  commitDuelPlayingMutationV2, channelDuelRunesV2,
  referenceDuelPhysicalCardV2, assertCurrentDuelPhysicalReferenceV2,
  registerDuelGearFromTrustedSourceV2, attachDuelGearV2, moveDuelUnitV2,
  removeDuelGearToOwnerTrashV2, restoreDuelPlayingStateV2,
  assertDuelPlayingStateV2,
} from '../dist/duel/core-v2.js';
import { placeDuelUnit, removeDuelUnit } from '../dist/duel/battlefields.js';
import { createDuelMatch, resolveDuelMulligan } from '../dist/duel/match-state.js';
import { detachedDuelPlaying } from '../dist/duel/canonical-transaction.js';

const clone = structuredClone;
const hand = player => ({ kind: 'hand', zonePlayerId: player });
const deck = player => ({ kind: 'main-deck', zonePlayerId: player });
const trash = player => ({ kind: 'trash', zonePlayerId: player });
const base = locationId => ({ kind: 'board-base', locationId });
function fixture(randomIndex = () => 0) {
  const seats = ['a', 'b'].map(playerId => ({
    playerId,
    mainDeck: Array.from({ length: 9 }, (_, i) => ({ uid: `${playerId}-card-${i}`, cardId: `print-${i}` })),
    champion: { uid: `${playerId}-champ`, cardId: 'champ' },
    legend: { uid: `${playerId}-legend`, cardId: 'legend' },
    runeDeck: Array.from({ length: 4 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'rune', domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-bf-${i}`, cardId: `bf-${i}` })),
  }));
  const metadata = { matchId: 'new-v2', dataVersion: 'fixture-v1', catalogDigest: 'sha256:fixture',
    roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) };
  const types = cardId => ({ champ: 'Champion', legend: 'Legend', rune: 'Rune',
    'print-0': 'Gear', 'print-1': 'Gear', 'print-2': 'Unit' })[cardId] ??
    (cardId.startsWith('bf-') ? 'Battlefield' : 'Unit');
  return { seats, metadata, types,
    setup: createDuelMatchV2(seats, metadata, randomIndex, types) };
}
function playing() {
  const { setup, ...fixtureData } = fixture();
  const first = resolveDuelMulliganV2(setup, setup.turnOrder[0], []);
  return { ...fixtureData, setup, first,
    state: resolveDuelMulliganV2(first, setup.turnOrder[1], []) };
}
function zoneUID(state, player, uid) {
  const card = state.players.find(p => p.playerId === player).hand.find(c => c.uid === uid);
  assert.ok(card);
  return card;
}

// Official V1 constructor/transaction remains EXACT V1; this test intentionally never routes
// the new match through the old public room/session or V1 archive.
test('explicit V2 creates four-domain origin at setup, V1 unchanged, and playing one board/resources', () => {
  const { seats, metadata, types, setup } = fixture();
  const v1 = createDuelMatch(seats, metadata, () => 0);
  assert.equal(v1.schemaVersion, 1);
  assert.equal(setup.schemaVersion, 2);
  assert.deepEqual(Object.keys(setup).sort(), [...Object.keys(v1), 'provenance'].sort());
  assert.equal(setup.provenance.originalPhysicalCards.length, seats.length * (9 + 1 + 1 + 4 + 3));
  assert.equal(setup.provenance.initialZonesByUID['a-champ'].kind, 'champion-zone');
  assert.equal(setup.provenance.initialZonesByUID['a-legend'].kind, 'legend-zone');
  assert.equal(setup.provenance.initialZonesByUID['a-rune-0'].kind, 'rune-deck');
  assert.equal(setup.provenance.originalPhysicalCards.find(c => c.uid === 'b-card-0').ownerPlayerId, 'b');
  assert.throws(() => createDuelMatchV2(seats, metadata, () => 0, () => 'Unit'), /catalog printing kind/);
  const { state } = playing();
  const v1First = resolveDuelMulligan(v1, v1.turnOrder[0], []);
  const v1Playing = resolveDuelMulligan(v1First, v1.turnOrder[1], []);
  assert.equal(v1Playing.schemaVersion, 1);
  assert.equal(Object.hasOwn(v1Playing, 'physicalCardsByUID'), false);
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.board, v1Playing.board);
  assert.deepEqual(state.resources, v1Playing.resources);
  assert.equal(state.stateVersion, 2);
  assert.deepEqual(state.players.map(p => state.legendStates[p.legend.uid].readiness),
    ['not-established', 'not-established']);
  assert.equal(enumerateDuelObjectsV2(state).filter(x => x.kind === 'battlefield').length, 2);
  assert.equal(enumerateDuelObjectsV2(state).find(x => x.kind === 'battlefield').readiness.kind, 'not-modeled');
  assert.equal(enumerateDuelObjectsV2(state).find(x => x.kind === 'legend').locationId, null);
  assert.throws(() => detachedDuelPlaying(state), /playing state keys/);
  assert.throws(() => assertDuelPlayingStateV2(v1Playing, {}), /attestation|V2 playing/);
  assert.throws(() => restoreDuelPlayingStateV2(clone(state)), /independent|trusted/);
});

function retiredFrom(setup) {
  return setup.setup.selection.removedByPlayer.flatMap(p => p.battlefields.map(b => b.instanceId));
}
// This source is deliberately taken from the constructor-produced setup, not from a candidate
// archive. A real caller must supply the equivalent protected factory/journal context.
function restoreAttestation(setup, state, transitions = []) {
  return {
    matchId: state.matchId, dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    rosterPlayerIds: setup.roster.map(p => p.playerId),
    originalPhysicalCards: setup.provenance.originalPhysicalCards.map(c => ({ ...c })),
    submittedBattlefieldUIDs: [...setup.provenance.submittedBattlefieldUIDs],
    retiredPhysicalUIDs: retiredFrom(setup),
    initialZonesByUID: Object.fromEntries(Object.entries(setup.provenance.initialZonesByUID)
      .map(([uid, value]) => [uid, { ...value }])),
    transitions: transitions.map(step => ({ uid: step.uid,
      from: { ...step.from }, to: { ...step.to } })),
  };
}
function inventoryForState(setup, state, epochOverrides = {}) {
  const expectedZoneEpochByUID = Object.fromEntries(setup.provenance.originalPhysicalCards.map(card => [
    card.uid, epochOverrides[card.uid] ?? 0,
  ]));
  return {
    matchId: state.matchId, dataVersion: state.dataVersion, catalogDigest: state.catalogDigest,
    rosterPlayerIds: setup.roster.map(p => p.playerId),
    originalPhysicalCards: setup.provenance.originalPhysicalCards.map(c => ({ ...c })),
    submittedBattlefieldUIDs: [...setup.provenance.submittedBattlefieldUIDs], expectedZoneEpochByUID,
    retiredPhysicalUIDs: retiredFrom(setup), goldOwnersByUID: {}, unitTokenOwnersByUID: {},
  };
}

test('restored object reads still validate a mutable independent inventory after earlier enumeration', () => {
  const { setup, state } = playing();
  const proof = inventoryForState(setup, state);
  const restored = restoreDuelPlayingStateV2(clone(state), proof, restoreAttestation(setup, state));
  const views = enumerateDuelObjectsV2(restored);
  assert.ok(views.length > 0);
  assert.equal(Object.isFrozen(proof), false);
  const uid = restored.players[0].hand[0].uid;
  proof.expectedZoneEpochByUID[uid]++;
  assert.throws(() => enumerateDuelObjectsV2(restored), /epoch/);
});

test('restore accepts only an independent genesis + exact ordered-history attestation', () => {
  const { setup, state } = playing();
  const proof = inventoryForState(setup, state);
  const restored = restoreDuelPlayingStateV2(clone(state), proof, restoreAttestation(setup, state));
  assert.deepEqual(restored.provenance, state.provenance);
  const attack = clone(state);
  attack.provenance.initialZonesByUID = { ...attack.provenance.initialZonesByUID };
  const handUID = attack.players[0].hand[0].uid;
  const deckUID = attack.players[0].remainingMainDeck[0].uid;
  attack.provenance.initialZonesByUID[handUID] = deck(attack.players[0].playerId);
  attack.provenance.initialZonesByUID[deckUID] = hand(attack.players[0].playerId);
  attack.players = attack.players.map(p => p.playerId === attack.players[0].playerId ? {
    ...p,
    hand: [...p.hand.filter(c => c.uid !== handUID), p.remainingMainDeck.find(c => c.uid === deckUID)],
    remainingMainDeck: [...p.remainingMainDeck.filter(c => c.uid !== deckUID), p.hand.find(c => c.uid === handUID)],
  } : p);
  assert.throws(() => restoreDuelPlayingStateV2(attack, proof, restoreAttestation(setup, state)), /provenance|history|genesis/);
});

test('same epoch alternative history and initial hand/deck swap remain rejected with true source context', () => {
  const { setup, state } = playing();
  const uid = state.players[0].hand[0].uid;
  const proof = inventoryForState(setup, state);
  const attack = clone(state);
  attack.provenance.transitions = [
    { uid, from: hand('a'), to: trash('a') },
    { uid, from: trash('a'), to: hand('a') },
  ];
  attack.physicalCardsByUID[uid] = { ...attack.physicalCardsByUID[uid], zoneEpoch: 2 };
  // Keep the protected source context genuine; do not derive it from the attack snapshot.
  const independent = restoreAttestation(setup, state);
  assert.throws(() => restoreDuelPlayingStateV2(attack, proof, independent), /history|provenance|epoch/);
  assert.throws(() => restoreDuelPlayingStateV2(clone(state), proof), /attestation/);
});

test('trusted commit appends its real trace to protected capability history without mutating the old state', () => {
  const { setup, state } = playing();
  const uid = state.players[0].hand[0].uid;
  const trace = [
    { uid, from: hand('a'), to: deck('a') }, { uid, from: deck('a'), to: hand('a') },
  ];
  const next = commitDuelPlayingMutationV2(state, draft => ({ match: draft, transitions: trace }));
  assert.equal(next.provenance.transitions.length, 2);
  assert.equal(state.provenance.transitions.length, 0);
  const nextEpochs = { [uid]: 2 };
  assert.throws(() => restoreDuelPlayingStateV2(clone(next), inventoryForState(setup, next, nextEpochs)), /attestation/);
  const restored = restoreDuelPlayingStateV2(clone(next), inventoryForState(setup, next, nextEpochs),
    restoreAttestation(setup, next, trace));
  assert.equal(restored.physicalCardsByUID[uid].zoneEpoch, 2);
});

test('genuine nonzero mulligan records UID hand→deck AND replacement deck→hand in turn order', () => {
  const { setup } = fixture();
  const actor = setup.turnOrder[0];
  const original = setup.setup.players.find(p => p.playerId === actor);
  const selected = original.hand.slice(0, 2).map(c => c.uid);
  const replacements = original.remainingMainDeck.slice(0, 2).map(c => c.uid);
  const rngBounds = [];
  const first = resolveDuelMulliganV2(setup, actor, selected, bound => {
    rngBounds.push(bound); return bound - 1;
  });
  assert.deepEqual(rngBounds, [2]);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.provenance.transitions.length, 4);
  assert.deepEqual(first.provenance.transitions.map(s => s.uid), [...selected, ...replacements]);
  assert.deepEqual(first.provenance.transitions.map(s => [s.from.kind, s.to.kind]), [
    ['hand', 'main-deck'], ['hand', 'main-deck'], ['main-deck', 'hand'], ['main-deck', 'hand'],
  ]);
  const result = resolveDuelMulliganV2(first, setup.turnOrder[1], []);
  for (const uid of [...selected, ...replacements]) assert.equal(result.physicalCardsByUID[uid].zoneEpoch, 1);
  assert.equal(result.physicalCardsByUID['a-legend'].zoneEpoch, 0);
  assert.equal(result.physicalCardsByUID[selected[0]].ownerPlayerId, actor);
  assert.equal(result.stateVersion, 2);
  assert.deepEqual(result.provenance.transitions, first.provenance.transitions);
  assert.throws(() => resolveDuelMulliganV2(first, actor, []), /actor is not current mulligan owner/);
  assert.throws(() => { result.players[0].hand.push({ uid: 'forged' }); }, TypeError);
});

test('one trusted transaction records hand→deck→hand even with unchanged final zones; stale reference and noop/rollback clocks', () => {
  const { state } = playing();
  const p = state.players[0], uid = p.hand[0].uid;
  const ref = referenceDuelPhysicalCardV2(state, uid);
  const steps = [ { uid, from: hand(p.playerId), to: deck(p.playerId) },
    { uid, from: deck(p.playerId), to: hand(p.playerId) } ];
  const next = commitDuelPlayingMutationV2(state, draft => ({ match: draft, transitions: steps }));
  assert.equal(next.physicalCardsByUID[uid].zoneEpoch, state.physicalCardsByUID[uid].zoneEpoch + 2);
  assert.equal(next.stateVersion, state.stateVersion + 1);
  assert.equal(next.eventSeq, state.eventSeq + 1);
  assert.deepEqual(next.players, state.players);
  assert.throws(() => assertCurrentDuelPhysicalReferenceV2(next, ref), /stale physical reference/);
  assert.equal(commitDuelPlayingMutationV2(next, draft => ({ match: draft, transitions: [] })), next);
  assert.throws(() => commitDuelPlayingMutationV2(next, draft => ({ match: {
    ...draft, physicalCardsByUID: { ...draft.physicalCardsByUID,
      [uid]: { ...draft.physicalCardsByUID[uid], ownerPlayerId: 'b' } } }, transitions: [] })),
  /identity|independently proved/);
  assert.throws(() => commitDuelPlayingMutationV2(next, draft => ({ match: draft,
    transitions: [{ uid, from: hand(p.playerId), to: deck(p.playerId) }] })), /missing\/fabricated/);
  assert.equal(next.stateVersion, state.stateVersion + 1);
  assert.equal(state.physicalCardsByUID[uid].zoneEpoch, 0);
});

test('Rune channel + board Unit/Gear entries, host-follow, detach/owner trash use actual carriers', () => {
  const { state } = playing();
  const p = state.players[0], baseId = state.board.bases[0].locationId;
  const runeUid = state.resources.players[0].runeDeck[0].uid;
  let next = channelDuelRunesV2(state, p.playerId, 1, false);
  assert.equal(next.physicalCardsByUID[runeUid].zoneEpoch, 1);
  assert.equal(enumerateDuelObjectsV2(next).find(o => o.uid === runeUid).readiness.kind, 'exhausted');
  assert.equal(next.stateVersion, state.stateVersion + 1);
  const unitUID = p.hand.find(c => c.cardId === 'print-2').uid;
  next = commitDuelPlayingMutationV2(next, draft => {
    const board = placeDuelUnit(draft.board, { objectId: unitUID, controllerPlayerId: p.playerId, locationId: baseId });
    return { match: { ...draft, board,
      players: draft.players.map(s => ({ ...s, hand: s.hand.filter(c => c.uid !== unitUID) })),
      unitMeta: { ...draft.unitMeta, [unitUID]: { ownerPlayerId: p.playerId, readied: false,
        damageMarks: [], trait: { kind: 'card', cardId: 'print-2' } } } },
    transitions: [{ uid: unitUID, from: hand(p.playerId), to: base(baseId) }] };
  });
  const gearUID = p.hand.find(c => c.cardId === 'print-1' || c.cardId === 'print-0').uid;
  next = registerDuelGearFromTrustedSourceV2(next, gearUID, p.playerId, baseId);
  assert.equal(next.physicalCardsByUID[gearUID].zoneEpoch, 1);
  next = attachDuelGearV2(next, gearUID, unitUID);
  assert.equal(next.gears[0].attachedToUID, unitUID);
  const field = next.board.battlefields[0].locationId;
  next = moveDuelUnitV2(next, unitUID, field);
  assert.equal(next.gears[0].locationId, field);
  assert.equal(next.gears[0].controllerPlayerId, p.playerId);
  assert.equal(next.gears[0].readied, true);
  assert.equal(next.physicalCardsByUID[gearUID].zoneEpoch, 1);
  const external = commitDuelPlayingMutationV2(next, draft => {
    const owner = draft.players.find(s => s.playerId === p.playerId);
    return { match: { ...draft, board: removeDuelUnit(draft.board, unitUID),
      unitMeta: Object.fromEntries(Object.entries(draft.unitMeta).filter(([id]) => id !== unitUID)),
      gears: draft.gears.map(g => ({ ...g, attachedToUID: null })),
      players: draft.players.map(s => s.playerId === owner.playerId
        ? { ...s, trash: [...s.trash, { uid: unitUID, cardId: 'print-2' }] } : s) },
    transitions: [{ uid: unitUID, from: { kind: 'board-battlefield', locationId: field },
      to: trash(p.playerId) }] };
  });
  assert.equal(external.gears[0].attachedToUID, null);
  assert.equal(external.gears[0].locationId, field);
  const ended = removeDuelGearToOwnerTrashV2(external, gearUID);
  assert.equal(ended.gears.length, 0);
  assert.equal(ended.physicalCardsByUID[gearUID].zoneEpoch, 2);
  assert.ok(ended.players.find(s => s.playerId === p.playerId).trash.some(c => c.uid === gearUID));
});

test('nonzero restore requires complete source trace: truncation, reorder, and repeated crossings reject', () => {
  const { setup, state } = playing();
  const uid = state.players[0].hand[0].uid;
  const trace = [
    { uid, from: hand('a'), to: deck('a') },
    { uid, from: deck('a'), to: hand('a') },
  ];
  const next = commitDuelPlayingMutationV2(state, draft => ({ match: draft, transitions: trace }));
  const proof = inventoryForState(setup, next, { [uid]: 2 });
  assert.equal(restoreDuelPlayingStateV2(clone(next), proof,
    restoreAttestation(setup, next, trace)).physicalCardsByUID[uid].zoneEpoch, 2);
  assert.throws(() => restoreDuelPlayingStateV2(clone(next), proof,
    restoreAttestation(setup, next, trace.slice(0, 1))), /history|epoch/);
  assert.throws(() => restoreDuelPlayingStateV2(clone(next), proof,
    restoreAttestation(setup, next, [trace[1], trace[0]])), /history|out-of-order|provenance/);
  assert.throws(() => restoreDuelPlayingStateV2(clone(next), proof,
    restoreAttestation(setup, next, [...trace, { uid, from: hand('a'), to: deck('a') }])), /history|epoch|zone/);
});

test('foreign restore metadata and candidate provenance modification reject without changing input bytes', () => {
  const { setup, state } = playing();
  const proof = inventoryForState(setup, state);
  const foreign = restoreAttestation(setup, state);
  foreign.catalogDigest = 'sha256:foreign';
  assert.throws(() => restoreDuelPlayingStateV2(clone(state), proof, foreign), /binding|metadata|catalog/);
  const attack = clone(state);
  attack.provenance.initialZonesByUID = { ...attack.provenance.initialZonesByUID };
  const uid = attack.players[0].hand[0].uid;
  attack.provenance.initialZonesByUID[uid] = deck('a');
  const before = JSON.stringify(attack);
  assert.throws(() => restoreDuelPlayingStateV2(attack, proof, restoreAttestation(setup, state)), /history|provenance|genesis/);
  assert.equal(JSON.stringify(attack), before);
});

test('old admitted capability remains unpolluted after a later committed trace', () => {
  const { setup, state } = playing();
  const uid = state.players[0].hand[0].uid;
  const trace = [
    { uid, from: hand('a'), to: deck('a') },
    { uid, from: deck('a'), to: hand('a') },
  ];
  const next = commitDuelPlayingMutationV2(state, draft => ({ match: draft, transitions: trace }));
  assert.equal(state.provenance.transitions.length, 0);
  assert.equal(commitDuelPlayingMutationV2(state, draft => ({ match: draft, transitions: [] })), state);
  assert.equal(next.provenance.transitions.length, 2);
  assert.equal(restoreDuelPlayingStateV2(clone(next), inventoryForState(setup, next, { [uid]: 2 }),
    restoreAttestation(setup, next, trace)).provenance.transitions.length, 2);
});
