import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelMatch, resolveDuelMulligan } from '../dist/duel/match-state.js';
import { channelDuelRunes, createDuelGoldToken } from '../dist/duel/resources.js';
import { placeDuelUnit, relocateDuelUnit, removeDuelUnit } from '../dist/duel/battlefields.js';
import {
  initializeDuelPermanentState, restoreDuelPermanentState, assertDuelPermanentState,
  enumerateDuelObjects, referenceDuelPhysicalCard, assertCurrentDuelPhysicalReference,
  advanceDuelPhysicalZoneTransitions, attachDuelGear, followDuelAttachedHostMove,
  detachDuelGearsBeforeHostExit,
} from '../dist/duel/permanent-state.js';

// Explicit tiny TEST-ONLY attested catalog. The production server still needs a
// separately protected genesis journal/catalog proof; snapshot contents are not proof.
function starting() {
  const seats = ['p1', 'p2'].map(id => ({
    playerId: id,
    mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${id}-main-${i}`, cardId: `print-${i}` })),
    champion: { uid: `${id}-champion`, cardId: `champion-${id}` },
    legend: { uid: `${id}-legend`, cardId: `legend-${id}` },
    runeDeck: Array.from({ length: 5 }, (_, i) => ({ uid: `${id}-rune-${i}`, cardId: `rune-${i}`, domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${id}-bf-${i}`, cardId: `field-${i}` })),
  }));
  const metadata = { matchId: 'test-match-1', dataVersion: 'test-catalog-v1', catalogDigest: 'sha256:test-verified',
    roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) };
  const setup = createDuelMatch(seats, metadata, () => 0);
  const selections = setup.setup.selection; // protected genesis evidence in this test, NOT the playing zone
  const first = resolveDuelMulligan(setup, setup.turnOrder[0], []);
  const playing = resolveDuelMulligan(first, setup.turnOrder[1], []);
  const originalPhysicalCards = seats.flatMap(s => [
    ...s.mainDeck.map((c, i) => ({ ...c, uid: c.uid, ownerPlayerId: s.playerId, origin: 'submitted-deck',
      cardType: i === 0 || i === 1 ? 'Gear' : 'Unit' })),
    { ...s.champion, ownerPlayerId: s.playerId, origin: 'submitted-deck', cardType: 'Champion' },
    { ...s.legend, ownerPlayerId: s.playerId, origin: 'submitted-deck', cardType: 'Legend' },
    ...s.runeDeck.map(r => ({ uid: r.uid, cardId: r.cardId, ownerPlayerId: s.playerId,
      origin: 'submitted-deck', cardType: 'Rune' })),
    ...s.battlefields.map(b => ({ uid: b.instanceId, cardId: b.cardId, ownerPlayerId: s.playerId,
      origin: 'submitted-deck', cardType: 'Battlefield' })),
  ]);
  const retiredPhysicalUIDs = selections.removedByPlayer.flatMap(p => p.battlefields.map(b => b.instanceId));
  const proof = { matchId: metadata.matchId, dataVersion: metadata.dataVersion, catalogDigest: metadata.catalogDigest,
    rosterPlayerIds: ['p1', 'p2'], originalPhysicalCards,
    submittedBattlefieldUIDs: seats.flatMap(s => s.battlefields.map(b => b.instanceId)),
    expectedZoneEpochByUID: Object.fromEntries(originalPhysicalCards.map(c => [c.uid, 0])),
    retiredPhysicalUIDs, goldOwnersByUID: {}, unitTokenOwnersByUID: {} };
  const state = initializeDuelPermanentState(playing, proof);
  return { state, proof, playing, seats, setup };
}
const clone = v => structuredClone(v);
const base = (state, player = 'p1') => state.board.bases.find(b => b.ownerPlayerId === player).locationId;
const field = state => state.board.battlefields[0].locationId;
const hand = player => ({ kind: 'hand', zonePlayerId: player });
const deck = player => ({ kind: 'main-deck', zonePlayerId: player });
const trash = player => ({ kind: 'trash', zonePlayerId: player });
const bf = locationId => ({ kind: 'board-battlefield', locationId });
const baseZone = locationId => ({ kind: 'board-base', locationId });
const beforeJSON = value => JSON.stringify(value);
function alter(state, proof, f) {
  const proposed = f(restoreDuelPermanentState(state, proof));
  assertDuelPermanentState(proposed, proof);
  return proposed;
}
function moveCard(state, proof, uid, from, to, zoneList) {
  const proposed = clone(state);
  for (const p of proposed.players) {
    for (const key of ['hand', 'remainingMainDeck', 'trash']) {
      p[key] = p[key].filter(c => c.uid !== uid);
    }
  }
  const card = { uid, cardId: state.physicalCardsByUID[uid].cardId };
  const seat = proposed.players.find(p => p.playerId === ('zonePlayerId' in to ? to.zonePlayerId : 'p1'));
  seat[zoneList] = [...seat[zoneList], card];
  return advanceDuelPhysicalZoneTransitions(state, proposed, proof, [{ uid, from, to }]);
}
function enterGear(state, proof, uid = 'p1-main-1', controller = 'p1', location = base(state, controller)) {
  const c = state.players.flatMap(p => p.hand).find(v => v.uid === uid);
  assert.ok(c, 'fixture gear must start in a hand; use a hand UID with Gear catalog type');
  const p = clone(state);
  p.players = p.players.map(seat => ({ ...seat, hand: seat.hand.filter(item => item.uid !== uid) }));
  p.gears.push({ uid, controllerPlayerId: controller, locationId: location, readied: false, attachedToUID: null });
  const fromPlayer = state.players.find(seat => seat.hand.some(item => item.uid === uid)).playerId;
  return advanceDuelPhysicalZoneTransitions(state, p, proof,
    [{ uid, from: hand(fromPlayer), to: baseZone(location) }]);
}
function enterUnit(state, proof, uid, owner = 'p1', controller = owner, locationId = base(state, controller)) {
  const p = clone(state);
  p.players = p.players.map(seat => ({ ...seat, hand: seat.hand.filter(item => item.uid !== uid) }));
  p.board = placeDuelUnit(p.board, { objectId: uid, controllerPlayerId: controller, locationId });
  p.unitMeta[uid] = { ownerPlayerId: owner, readied: true, damageMarks: [],
    trait: { kind: 'card', cardId: p.physicalCardsByUID[uid].cardId } };
  return advanceDuelPhysicalZoneTransitions(state, p, proof,
    [{ uid, from: hand(state.players.find(seat => seat.hand.some(item => item.uid === uid)).playerId),
      to: baseZone(locationId) }]);
}
function anyGearHand(state) {
  const card = state.players.flatMap(p => p.hand).find(c => c.uid.endsWith('-main-1') || c.uid.endsWith('-main-0'));
  assert.ok(card, 'fixture RNG hands contain the attested Gear printing');
  return card.uid;
}
function anyUnitHand(state, owner = 'p1') {
  const p = state.players.find(p => p.playerId === owner);
  return p.hand.find(c => !c.uid.endsWith('-main-1')).uid;
}

test('actual constructor baseline + independent genesis initializes exactly physical carriers, retired BF and unestablished Legends', () => {
  const { state, proof, playing } = starting();
  assert.equal(playing.schemaVersion, 1); // No pretend V2 production constructor.
  assert.equal(Object.hasOwn(playing, 'physicalCardsByUID'), false);
  const live = enumerateDuelObjects(state, proof);
  assert.equal(new Set(live.map(v => v.uid)).size, live.length);
  assert.equal(live.length, proof.originalPhysicalCards.length - 4);
  assert.deepEqual(state.retiredPhysicalUIDs, proof.retiredPhysicalUIDs);
  assert.deepEqual(state.gears, []);
  assert.deepEqual(state.players.map(p => state.legendStates[p.legend.uid].readiness), ['not-established', 'not-established']);
  assert.deepEqual(state.board.units, []);
  assert.ok(!('physicalCardsByUID' in playing));
});

test('missing / wrong independent inventory rejects; origin cardId, owner, epoch and printed kind cannot be forged from zone', () => {
  const { state, proof, playing } = starting();
  assert.throws(() => initializeDuelPermanentState(playing), /independent trusted inventory/);
  assert.throws(() => restoreDuelPermanentState(state), /independent trusted inventory/);
  assert.throws(() => restoreDuelPermanentState(state, { ...proof, matchId: 'other' }), /independent match\/catalog mismatch/);
  assert.throws(() => restoreDuelPermanentState(state, { ...proof, originalPhysicalCards: [] }), /submitted Battlefield proof/);
  const uid = anyGearHand(state);
  assert.throws(() => assertDuelPermanentState({ ...state, physicalCardsByUID: {
    ...state.physicalCardsByUID, [uid]: { ...state.physicalCardsByUID[uid], cardId: 'forgery' } } }, proof), /not independently proved/);
  assert.throws(() => assertDuelPermanentState({ ...state, physicalCardsByUID: {
    ...state.physicalCardsByUID, [uid]: { ...state.physicalCardsByUID[uid], ownerPlayerId: 'p2' } } }, proof), /not independently proved/);
  assert.throws(() => assertDuelPermanentState({ ...state, physicalCardsByUID: {
    ...state.physicalCardsByUID, [uid]: { ...state.physicalCardsByUID[uid], zoneEpoch: 4 } } }, proof), /epoch lacks trusted history/);
  const unitUid = anyUnitHand(state);
  const forgedType = clone(state);
  forgedType.physicalCardsByUID[unitUid].cardId = proof.originalPhysicalCards.find(c => c.uid === unitUid).cardId + '-forged';
  assert.throws(() => assertDuelPermanentState(forgedType, proof), /not independently proved/);
});

test('real UID aliases are one entity, while carrier double-use, owner/cardId alias mismatches and retire reuse reject', () => {
  const { state, proof } = starting();
  const uid = anyUnitHand(state);
  const { state: entered, nextInventory: attested } = enterUnit(state, proof, uid);
  assertDuelPermanentState(entered, attested);
  assert.equal(enumerateDuelObjects(entered, attested).filter(c => c.uid === uid).length, 1);
  const dup = clone(entered); dup.players[1].hand.push({ uid, cardId: dup.physicalCardsByUID[uid].cardId });
  assert.throws(() => assertDuelPermanentState(dup, attested), /duplicate primary carrier|duplicate UID/);
  const wrong = clone(entered); wrong.unitMeta[uid].ownerPlayerId = 'p2';
  assert.throws(() => assertDuelPermanentState(wrong, attested), /owner alias mismatch/);
  const wrongPrinting = clone(entered); wrongPrinting.unitMeta[uid].trait.cardId = 'wrong';
  assert.throws(() => assertDuelPermanentState(wrongPrinting, attested), /cardId alias mismatch/);
  const retired = clone(entered); retired.retiredPhysicalUIDs.push(uid);
  assert.throws(() => assertDuelPermanentState(retired, attested), /independent proof|submitted\/removed/);
  const duplicates = clone(entered); duplicates.gears.push({ uid: entered.board.battlefields[0].instanceId,
    controllerPlayerId: 'p1', locationId: base(entered), readied: true, attachedToUID: null });
  assert.throws(() => assertDuelPermanentState(duplicates, attested), /duplicate primary carrier|duplicate UID/);
});

test('current controller and current hidden zone never overwrite original owner', () => {
  const { state, proof } = starting();
  const uid = anyGearHand(state);
  const p1 = state.players[0];
  assert.ok(p1.hand.some(c => c.uid === uid));
  const otherHand = clone(state);
  otherHand.players[0].hand = otherHand.players[0].hand.filter(c => c.uid !== uid);
  otherHand.players[1].hand.push({ uid, cardId: state.physicalCardsByUID[uid].cardId });
  const { state: changed, nextInventory } = advanceDuelPhysicalZoneTransitions(state, otherHand, proof,
    [{ uid, from: hand('p1'), to: hand('p2') }]);
  const view = enumerateDuelObjects(changed, nextInventory).find(v => v.uid === uid);
  assert.equal(view.ownerPlayerId, 'p1');
  assert.equal(view.controllerPlayerId, null);
  assert.equal(view.zone.zonePlayerId, 'p2');
  assert.equal(view.zoneEpoch, 1);
});

test('CR124 nonboard to nonboard: hand→deck, hand→trash, trash→deck each invalidates current reference', () => {
  const { state, proof } = starting();
  const uid = anyGearHand(state);
  for (const [from, to, key] of [
    [hand('p1'), deck('p1'), 'remainingMainDeck'],
    [hand('p1'), trash('p1'), 'trash'],
  ]) {
    const ref = referenceDuelPhysicalCard(state, proof, uid);
    const { state: next, nextInventory } = moveCard(state, proof, uid, from, to, key);
    assert.equal(next.physicalCardsByUID[uid].zoneEpoch, 1);
    assert.throws(() => assertCurrentDuelPhysicalReference(next, nextInventory, ref), /stale physical reference/);
    assert.equal(next.physicalCardsByUID[uid].ownerPlayerId, 'p1');
    if (key === 'trash') {
      const result = moveCard(next, nextInventory, uid, trash('p1'), deck('p1'), 'remainingMainDeck');
      assert.equal(result.state.physicalCardsByUID[uid].zoneEpoch, 2);
    }
  }
});

test('ordered hand→deck→hand roundtrip in ONE outer proposal increments twice; before/after alone is not a historical proof', () => {
  const { state, proof } = starting();
  const uid = anyGearHand(state);
  const pre = referenceDuelPhysicalCard(state, proof, uid);
  const fail = clone(state); fail.physicalCardsByUID[uid].zoneEpoch = 2;
  assert.throws(() => assertDuelPermanentState(fail, proof), /epoch lacks trusted history/);
  const trace = [{ uid, from: hand('p1'), to: deck('p1') },
    { uid, from: deck('p1'), to: hand('p1') }];
  const result = advanceDuelPhysicalZoneTransitions(state, clone(state), proof, trace);
  assert.equal(result.state.physicalCardsByUID[uid].zoneEpoch, 2);
  assert.deepEqual(result.state.players[0].hand, state.players[0].hand);
  assert.throws(() => assertCurrentDuelPhysicalReference(result.state, result.nextInventory, pre), /stale physical reference/);
  assert.doesNotThrow(() => assertCurrentDuelPhysicalReference(result.state, result.nextInventory,
    referenceDuelPhysicalCard(result.state, result.nextInventory, uid)));
  assert.throws(() => advanceDuelPhysicalZoneTransitions(state, state, proof,
    [{ uid, from: hand('p1'), to: deck('p1') }]), /missing\/fabricated ordered transfer/);
  assert.throws(() => advanceDuelPhysicalZoneTransitions(state, state, proof,
    [{ uid, from: deck('p1'), to: hand('p1') }]), /out-of-order/);
});

test('board-to-board base/BF transition does not bump epoch; proposed zone must match every ordered step', () => {
  const { state, proof } = starting();
  const uid = anyUnitHand(state);
  const { state: entered, nextInventory: attested } = enterUnit(state, proof, uid);
  const proposed = clone(entered); proposed.board = relocateDuelUnit(proposed.board, uid, field(proposed));
  const result = advanceDuelPhysicalZoneTransitions(entered, proposed, attested,
    [{ uid, from: baseZone(base(entered)), to: bf(field(proposed)) }]);
  assert.equal(result.state.physicalCardsByUID[uid].zoneEpoch, 1);
  assert.doesNotThrow(() => assertCurrentDuelPhysicalReference(result.state, result.nextInventory,
    referenceDuelPhysicalCard(entered, attested, uid)));
});

test('Gear controller, owner and readied are independent of host; host relocation carries attached Gear without Move', () => {
  const { state, proof } = starting();
  const hostUID = anyUnitHand(state);
  const gearUID = anyGearHand(state);
  let { state: entered, nextInventory: p } = enterUnit(state, proof, hostUID);
  ({ state: entered, nextInventory: p } = enterGear(entered, p, gearUID));
  entered = attachDuelGear(entered, p, gearUID, hostUID);
  const control = alter(entered, p, s => ({ ...s,
    gears: s.gears.map(g => ({ ...g, controllerPlayerId: 'p2' })) }));
  const movedBoard = relocateDuelUnit(control.board, hostUID, field(control));
  const followed = followDuelAttachedHostMove(control, p, movedBoard);
  const g = followed.gears[0];
  assert.equal(g.locationId, field(control));
  assert.equal(g.controllerPlayerId, 'p2');
  assert.equal(g.readied, false);
  assert.equal(g.attachedToUID, hostUID);
  assert.equal(followed.physicalCardsByUID[gearUID].ownerPlayerId, 'p1');
  assert.equal(followed.physicalCardsByUID[gearUID].zoneEpoch, control.physicalCardsByUID[gearUID].zoneEpoch);
  assert.equal(followed.board.units[0].locationId, g.locationId);
});

test('valid attachment UID references never count as duplicate; loops, unknown hosts and foreign locations fail', () => {
  const { state, proof } = starting();
  const hostUID = anyUnitHand(state);
  const gearUID = anyGearHand(state);
  let { state: entered, nextInventory: p } = enterUnit(state, proof, hostUID);
  ({ state: entered, nextInventory: p } = enterGear(entered, p, gearUID));
  const attached = attachDuelGear(entered, p, gearUID, hostUID);
  assert.equal(enumerateDuelObjects(attached, p).filter(v => v.uid === hostUID).length, 1);
  assert.throws(() => attachDuelGear(entered, p, gearUID, 'unknown-host'), /unknown\/hidden\/non-card host/);
  assert.throws(() => attachDuelGear(entered, p, gearUID, gearUID), /cycle/);
  assert.throws(() => attachDuelGear(entered, p, gearUID, entered.players[0].legend.uid), /unknown\/hidden\/non-card host/);
  const wrong = clone(attached); wrong.gears[0].locationId = field(attached);
  assert.throws(() => assertDuelPermanentState(wrong, p), /attachment crosses location/);
  const n = clone(attached); n.gears.push({ ...n.gears[0] });
  assert.throws(() => assertDuelPermanentState(n, p), /duplicate primary carrier|duplicate UID/);
});

test('host leaves board: detach Gear first and leave it at old location; host moves to original owner trash', () => {
  const { state, proof } = starting();
  const hostUID = anyUnitHand(state), gearUID = anyGearHand(state);
  let { state: entered, nextInventory: p } = enterUnit(state, proof, hostUID);
  ({ state: entered, nextInventory: p } = enterGear(entered, p, gearUID));
  const attached = attachDuelGear(entered, p, gearUID, hostUID);
  const detached = detachDuelGearsBeforeHostExit(attached, p, hostUID);
  const leaving = clone(detached);
  leaving.board = removeDuelUnit(leaving.board, hostUID);
  delete leaving.unitMeta[hostUID];
  leaving.players[0].trash.push({ uid: hostUID, cardId: state.physicalCardsByUID[hostUID].cardId });
  const exit = advanceDuelPhysicalZoneTransitions(detached, leaving, p,
    [{ uid: hostUID, from: baseZone(base(detached)), to: trash('p1') }]);
  assert.equal(exit.state.gears[0].attachedToUID, null);
  assert.equal(exit.state.gears[0].locationId, base(detached));
  assert.equal(exit.state.physicalCardsByUID[gearUID].zoneEpoch, 1);
  assert.equal(exit.state.physicalCardsByUID[hostUID].zoneEpoch, 2);
  assert.deepEqual(exit.state.retiredPhysicalUIDs, state.retiredPhysicalUIDs);
  assert.throws(() => assertDuelPermanentState({ ...leaving, gears: attached.gears }, p), /unknown\/hidden\/non-card host/);
});

test('Legend is board but not a Location; Champion remains nonboard with no invented readiness; BF readiness unknown', () => {
  const { state, proof } = starting();
  const items = enumerateDuelObjects(state, proof);
  const legend = items.find(v => v.kind === 'legend' && v.zone.zonePlayerId === 'p1');
  const champion = items.find(v => v.kind === 'champion' && v.zone.zonePlayerId === 'p1');
  const battlefield = items.find(v => v.kind === 'battlefield');
  assert.deepEqual(legend.zone, { kind: 'legend-zone', zonePlayerId: 'p1' });
  assert.equal(legend.locationId, null);
  assert.equal(legend.readiness.kind, 'not-established');
  assert.equal(champion.locationId, null);
  assert.equal(champion.readiness.kind, 'not-applicable');
  assert.equal(battlefield.readiness.kind, 'not-modeled');
  assert.notEqual(battlefield.uid, battlefield.locationId);
  const invalid = clone(state);
  invalid.legendStates[legend.uid].readiness = 'ready';
  assertDuelPermanentState(invalid, proof); // only trusted outer Awaken may perform this change
  assert.equal(enumerateDuelObjects(invalid, proof).find(v => v.uid === legend.uid).readiness.kind, 'ready');
});

test('Gold is token, never given a printing; creation owner proof is mandatory, not inferred from base', () => {
  const { state, proof } = starting();
  const created = clone(state);
  created.resources = createDuelGoldToken(created.resources,
    { uid: 'gold-uid-1', playerId: 'p1', locationId: base(created), readied: false });
  assert.throws(() => assertDuelPermanentState(created, proof), /owner lacks independent creation-effect proof/);
  const trusted = { ...proof, goldOwnersByUID: { 'gold-uid-1': 'p1' } };
  assertDuelPermanentState(created, trusted);
  const view = enumerateDuelObjects(created, trusted).find(o => o.uid === 'gold-uid-1');
  assert.equal(view.cardId, null);
  assert.equal(view.ownerPlayerId, 'p1');
  assert.equal(view.readiness.kind, 'exhausted');
  assert.equal(Object.hasOwn(created.physicalCardsByUID, view.uid), false);
  assert.throws(() => assertDuelPermanentState(created,
    { ...proof, goldOwnersByUID: { 'gold-uid-1': 'p2' } }), /owner lacks independent creation-effect proof/);
});

test('Rune resource alias aligns printing/owner: channeling requires ordered rune-deck→base epoch transition', () => {
  const { state, proof } = starting();
  const uid = state.resources.players[0].runeDeck[0].uid;
  const proposal = clone(state);
  proposal.resources = channelDuelRunes(proposal.resources, 'p1', 1, false);
  assert.doesNotThrow(() => assertDuelPermanentState(proposal, proof));
  const result = advanceDuelPhysicalZoneTransitions(state, proposal, proof,
    [{ uid, from: { kind: 'rune-deck', zonePlayerId: 'p1' }, to: baseZone(base(state)) }]);
  assert.equal(result.state.physicalCardsByUID[uid].zoneEpoch, 1);
  assert.equal(enumerateDuelObjects(result.state, result.nextInventory).find(o => o.uid === uid).readiness.kind, 'exhausted');
});

test('strict snapshot input rejects extra fields, sparse/accessor arrays and accessors; restore/view detach and protect original', () => {
  const { state, proof } = starting();
  const original = beforeJSON(state);
  const restored = restoreDuelPermanentState(state, proof);
  restored.players[0].hand[0].uid = 'mutant';
  restored.gears.push({ uid: 'mutant', controllerPlayerId: 'p1', locationId: base(state),
    readied: true, attachedToUID: null });
  restored.physicalCardsByUID[state.players[0].hand[0].uid].ownerPlayerId = 'p2';
  assert.equal(beforeJSON(state), original);
  const view = enumerateDuelObjects(state, proof);
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view[0]) && Object.isFrozen(view[0].zone));
  assert.throws(() => { view[0].zone.kind = 'board-base'; }, TypeError);
  const badKey = clone(state); badKey.forbiddenCursor = true;
  assert.throws(() => restoreDuelPermanentState(badKey, proof), /candidate keys/);
  const sparse = clone(state); sparse.gears.length = 2;
  assert.throws(() => restoreDuelPermanentState(sparse, proof), /gears sparse\/extra/);
  const getter = clone(state);
  Object.defineProperty(getter.physicalCardsByUID, state.players[0].hand[0].uid,
    { get() { throw new Error('must never invoke getter'); }, enumerable: true });
  assert.throws(() => restoreDuelPermanentState(getter, proof), /accessors\/symbols/);
  assert.equal(beforeJSON(state), original);
});
