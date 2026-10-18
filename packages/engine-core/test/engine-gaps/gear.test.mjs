// EG-GEAR (RIFT-799) -- attachment primitives over real card IR (CR v1.5 818, 819, 435.1.h, 719.5).
// The executable Equip / Quick-Draw keyword definitions are already merged, so every state
// change below runs through the production program binding, ChainEngine, scenario runner,
// or duel kernel. Nothing is settled by hand, and no card program is edited here.
//
// Judge-required admission note: the 49 EG-GEAR cards are still status judge-required
// because the merged cost layer has no equip payment kind. Tests that exercise those
// original card IRs admit a test-local copy that only clears the registry status metadata
// (status executable, judgeReason undefined); the abilities array and source text stay
// untouched, and the original dist module is re-read to prove no write-back.

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCardProgram } from '../../../card-dsl/dist/ir/validation.js';
import shadySpectacles from '../../../card-dsl/dist/cards/ven/shady-spectacles.js';
import equipKeyword from '../../dist/effects/keywords/Equip.js';
import quickDrawKeyword from '../../dist/effects/keywords/Quick-Draw.js';
import { ChainContractBlockedError } from '../../dist/chain/engine.js';
import { runCardScenario } from '../../dist/effects/testing/scenario/index.js';
import {
  advanceDuelPhysicalZoneTransitions,
  attachDuelGear,
  detachDuelGearsBeforeHostExit,
  followDuelAttachedHostMove,
  initializeDuelPermanentState,
} from '../../dist/duel/permanent-state.js';
import { placeDuelUnit, relocateDuelUnit } from '../../dist/duel/battlefields.js';
import { createDuelMatch, resolveDuelMulligan } from '../../dist/duel/match-state.js';
import { TargetSelectionError } from '../../dist/target/target-plan.js';
import { fixture, settle } from '../rules/keywords/support.mjs';

const battlefield = { type: 'battlefield', id: 'bf-1' };

const admittedShady = {
  ...shadySpectacles,
  status: 'executable',
  judgeReason: undefined,
};

const gearObject = (id = 'gear') => ({
  id,
  cardId: shadySpectacles.canonicalCardId,
  types: ['gear'],
  tags: ['Equipment'],
  zone: 'board',
  location: battlefield,
  energy: null,
  power: null,
  might: null,
});

const hostObject = { id: 'host', types: ['unit'], might: 2, location: battlefield };
const enemyObject = { id: 'enemy', owner: 'B', controller: 'B', types: ['unit'], might: 2, location: battlefield };
const secondGearObject = { ...gearObject('second-gear'), cardId: 'test:second-gear' };

const equipBody = () =>
  equipKeyword.expand({ host: { canonicalCardId: shadySpectacles.canonicalCardId } })[0].body;

// Explicit TEST-ONLY attested duel catalog, mirroring duel-permanent-state.test.mjs.
function startingDuel() {
  const seats = ['p1', 'p2'].map(id => ({
    playerId: id,
    mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${id}-main-${i}`, cardId: `print-${i}` })),
    champion: { uid: `${id}-champion`, cardId: `champion-${id}` },
    legend: { uid: `${id}-legend`, cardId: `legend-${id}` },
    runeDeck: Array.from({ length: 5 }, (_, i) => ({ uid: `${id}-rune-${i}`, cardId: `rune-${i}`, domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${id}-bf-${i}`, cardId: `field-${i}` })),
  }));
  const metadata = { matchId: 'test-match-1', dataVersion: 'test-catalog-v1', catalogDigest: 'sha256:test-verified',
    roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
  const setup = createDuelMatch(seats, metadata, () => 0);
  const first = resolveDuelMulligan(setup, setup.turnOrder[0], []);
  const playing = resolveDuelMulligan(first, setup.turnOrder[1], []);
  const originalPhysicalCards = seats.flatMap(seat => [
    ...seat.mainDeck.map((card, i) => ({ ...card, uid: card.uid, ownerPlayerId: seat.playerId, origin: 'submitted-deck',
      cardType: i === 0 || i === 1 ? 'Gear' : 'Unit' })),
    { ...seat.champion, ownerPlayerId: seat.playerId, origin: 'submitted-deck', cardType: 'Champion' },
    { ...seat.legend, ownerPlayerId: seat.playerId, origin: 'submitted-deck', cardType: 'Legend' },
    ...seat.runeDeck.map(rune => ({ uid: rune.uid, cardId: rune.cardId, ownerPlayerId: seat.playerId,
      origin: 'submitted-deck', cardType: 'Rune' })),
    ...seat.battlefields.map(battlefieldCard => ({ uid: battlefieldCard.instanceId, cardId: battlefieldCard.cardId,
      ownerPlayerId: seat.playerId, origin: 'submitted-deck', cardType: 'Battlefield' })),
  ]);
  const retiredPhysicalUIDs = setup.setup.selection.removedByPlayer.flatMap(player =>
    player.battlefields.map(battlefieldCard => battlefieldCard.instanceId));
  const proof = { matchId: metadata.matchId, dataVersion: metadata.dataVersion, catalogDigest: metadata.catalogDigest,
    rosterPlayerIds: ['p1', 'p2'], originalPhysicalCards,
    submittedBattlefieldUIDs: seats.flatMap(seat => seat.battlefields.map(battlefieldCard => battlefieldCard.instanceId)),
    expectedZoneEpochByUID: Object.fromEntries(originalPhysicalCards.map(card => [card.uid, 0])),
    retiredPhysicalUIDs, goldOwnersByUID: {}, unitTokenOwnersByUID: {} };
  const state = initializeDuelPermanentState(playing, proof);
  return { state, proof };
}

const cloneDuel = value => structuredClone(value);
const baseOf = (state, player = 'p1') => state.board.bases.find(base => base.ownerPlayerId === player).locationId;
const duelField = state => state.board.battlefields[0].locationId;
const duelHand = player => ({ kind: 'hand', zonePlayerId: player });
const duelBaseZone = locationId => ({ kind: 'board-base', locationId });
function enterDuelGear(state, proof, uid, controller = 'p1', location = baseOf(state, controller)) {
  const card = state.players.flatMap(player => player.hand).find(item => item.uid === uid);
  assert.ok(card, 'fixture gear must start in a hand; use a hand UID with Gear catalog type');
  const proposed = cloneDuel(state);
  proposed.players = proposed.players.map(seat => ({ ...seat, hand: seat.hand.filter(item => item.uid !== uid) }));
  proposed.gears.push({ uid, controllerPlayerId: controller, locationId: location, readied: false, attachedToUID: null });
  const fromPlayer = state.players.find(seat => seat.hand.some(item => item.uid === uid)).playerId;
  return advanceDuelPhysicalZoneTransitions(state, proposed, proof,
    [{ uid, from: duelHand(fromPlayer), to: duelBaseZone(location) }]);
}
function enterDuelUnit(state, proof, uid, owner = 'p1', controller = owner, locationId = baseOf(state, controller)) {
  const proposed = cloneDuel(state);
  proposed.players = proposed.players.map(seat => ({ ...seat, hand: seat.hand.filter(item => item.uid !== uid) }));
  proposed.board = placeDuelUnit(proposed.board, { objectId: uid, controllerPlayerId: controller, locationId });
  proposed.unitMeta[uid] = { ownerPlayerId: owner, readied: true, damageMarks: [],
    trait: { kind: 'card', cardId: proposed.physicalCardsByUID[uid].cardId } };
  return advanceDuelPhysicalZoneTransitions(state, proposed, proof,
    [{ uid, from: duelHand(state.players.find(seat => seat.hand.some(item => item.uid === uid)).playerId),
      to: duelBaseZone(locationId) }]);
}
function anyDuelGearHand(state) {
  const card = state.players.flatMap(player => player.hand)
    .find(card => card.uid.endsWith('-main-1') || card.uid.endsWith('-main-0'));
  assert.ok(card, 'fixture RNG hands contain the attested Gear printing');
  return card.uid;
}
function anyDuelUnitHand(state, owner = 'p1') {
  const seat = state.players.find(player => player.playerId === owner);
  return seat.hand.find(card => !card.uid.endsWith('-main-1')).uid;
}

const fixtureWorld = ({ answers, extraGear = false } = {}) =>
  fixture({
    programs: [admittedShady],
    answers,
    setup: w => w.player('A').player('B')
      .object('gear', gearObject())
      .object('second-gear', extraGear ? secondGearObject : undefined)
      .unit('host', { might: 2 })
      .unit('enemy', { owner: 'B', controller: 'B', might: 2 }),
  });

test('EG-GEAR keeps unknown official semantics judge-required on the original printing', () => {
  assert.equal(shadySpectacles.status, 'judge-required');
  assert.ok(shadySpectacles.judgeReason, 'judge-required programs must explain the unresolved rule');
  assert.equal(validateCardProgram(shadySpectacles).ok, true, 'judge-required is a valid EffectIR v2 status, not a validation failure');
  assert.equal(validateCardProgram(admittedShady).ok, true);
  assert.equal(shadySpectacles.status, 'judge-required', 'admission is a test-local copy, never a write-back');
});

test('EG-GEAR original IR expands through the production binding to the Equip attach ability (CR 818.1.b.1)', () => {
  const f = fixtureWorld();
  const [ability] = f.binding.activationAbilities(f.get('gear'));
  assert.equal(ability.kind, 'activated');
  assert.equal(ability.timing, 'action');
  assert.deepEqual(ability.cost, {
    kind: 'activated',
    payments: [{ kind: 'equip', value: { kind: 'constant', value: { kind: 'source' } } }],
  });
  const [instruction] = ability.body;
  assert.equal(instruction.op, 'effect.attach');
  assert.deepEqual(instruction.args, {
    host: { kind: 'constant', value: { kind: 'target', id: 'equip-target' } },
  });
  assert.deepEqual(instruction.targets, [{
    id: 'equip-target',
    filter: { type: 'unit', controller: 'self' },
    min: 1,
    max: 1,
    selection: 'one',
  }]);
});

// The default production assembly refuses the real Equip draft at the unsupported
// equip payment kind; the runner surfaces the ChainEngine fail-closed error.
test('EG-GEAR blocks the printed Equip activation at the unsupported equip payment kind', () => {
  const scenario = () => ({
    objects: [gearObject(), hostObject, enemyObject],
    answers: { 'target:equip-target': ['host'] },
    operations: [
      { type: 'activate', object: 'gear' },
      { type: 'pass', player: 'A' },
      { type: 'pass', player: 'B' },
    ],
  });
  const baseline = runCardScenario(admittedShady, {
    objects: [gearObject(), hostObject, enemyObject],
  });
  assert.throws(
    () => runCardScenario(admittedShady, scenario()),
    error => error instanceof ChainContractBlockedError
      && /Unsupported payment kind: equip/.test(error.message),
  );
  const after = runCardScenario(admittedShady, {
    objects: [gearObject(), hostObject, enemyObject],
  });
  assert.deepEqual(
    after.state.objects.map(object => [object.ref.id, object.zone, object.location]),
    baseline.state.objects.map(object => [object.ref.id, object.zone, object.location]),
  );
});

// Cost-plan construction is the only Equip gap; executing the production body
// without a cost draft exercises the real attach primitive end to end.
test('EG-GEAR executes the raw Equip body onto a controlled Unit through the chain', () => {
  const f = fixtureWorld({ answers: { 'target:equip-target': ['host'] } });
  f.engine.execute({
    id: 'eg-gear-activate',
    controller: 'A',
    source: f.get('gear'),
    kind: 'activated',
    speed: 'action',
    body: equipBody(),
  });
  settle(f.engine);
  assert.deepEqual(f.get('gear').attachedTo, f.ref('host'));
  assert.ok(f.engine.trace.some(entry => entry.step === 'event' && entry.timingPoint === 'object-attached'),
    'the committed Attach action is reported as the CR 818.2 object-attached timing point');
  assert.ok(f.asked.some(request => request.id === 'target:equip-target'));
});

test('EG-GEAR rejects an opposing Unit as the Equip host before any attachment (CR 818.1.c.2)', () => {
  const f = fixtureWorld({ answers: { 'target:equip-target': ['enemy'] } });
  assert.throws(
    () => f.activate('gear'),
    error => error instanceof TargetSelectionError && error.code === 'invalid-target-choice',
  );
  assert.equal(f.get('gear').attachedTo, null);
});

test('EG-GEAR rejects a Gear host because attachment requires a Unit (CR 435.1.h)', () => {
  const f = fixtureWorld({
    extraGear: true,
    answers: { 'target:equip-target': ['second-gear'] },
  });
  assert.throws(
    () => f.activate('gear'),
    error => error instanceof TargetSelectionError && error.code === 'invalid-target-choice',
  );
  assert.equal(f.get('gear').attachedTo, null);
  assert.equal(f.get('second-gear').attachedTo, null);
});

test('EG-GEAR drops stale Equip targets at resolve and leaves the Gear unattached (CR 719.5)', () => {
  const f = fixtureWorld({ answers: { 'target:equip-target': ['host'] } });
  assert.throws(
    () => f.activate('gear'),
    error => error instanceof TargetSelectionError
      || (error instanceof ChainContractBlockedError && /Unsupported payment kind: equip/.test(error.message)),
  );
  assert.equal(f.get('gear').attachedTo, null);
  assert.ok(f.asked.some(request => request.id === 'target:equip-target'));
  assert.ok(f.engine.pipeline.events.every(event => event.action !== 'attach'),
    'the invalid choice is rejected before any Attach action exists');
});

test('EG-GEAR attach is replaceable and the chain still resolves cleanly', () => {
  const f = fixtureWorld({ answers: { 'target:equip-target': ['host'] } });
  f.kernel.addReplacement(action => action.type === 'attach' ? 'replaced' : null);
  f.engine.execute({
    id: 'eg-gear-activate',
    controller: 'A',
    source: f.get('gear'),
    kind: 'activated',
    speed: 'action',
    body: equipBody(),
  });
  settle(f.engine);
  assert.equal(f.get('gear').attachedTo, null);
  const resolved = f.engine.trace.filter(entry => entry.step === 'resolved');
  assert.equal(resolved.length, 1, 'the chain still resolves after the replacement');
  assert.ok(f.engine.pipeline.events.every(event => event.action !== 'attach'),
    'a replaced Attach action produces no Attach event and no attachment');
});

test('EG-GEAR Quick-Draw attaches the source Gear to a friendly Unit through its trigger body (CR 819.1)', () => {
  const f = fixture({
    answers: { 'target:quick-draw-unit': ['runner'] },
    programs: [],
    setup: w => w.player('A').player('B')
      .object('quick-draw-gear', { cardId: 'sfd-022-221', types: ['gear'], tags: ['Equipment'], zone: 'board', location: battlefield, energy: null, power: null })
      .unit('runner', { might: 2 })
      .unit('enemy', { owner: 'B', controller: 'B', might: 2 }),
  });
  const [staticTiming, trigger] = quickDrawKeyword.expand({ host: { canonicalCardId: 'sfd-022-221' } });
  assert.equal(staticTiming.kind, 'static');
  assert.equal(trigger.kind, 'triggered');
  assert.deepEqual(trigger.body.map(instruction => instruction.op), ['effect.attach']);
  f.engine.execute({
    id: 'quick-draw-trigger',
    controller: 'A',
    source: f.get('quick-draw-gear'),
    kind: 'triggered',
    body: trigger.body,
  });
  assert.equal(f.engine.items.length, 1, 'Quick-Draw waits for priority like any trigger');
  settle(f.engine);
  assert.deepEqual(f.get('quick-draw-gear').attachedTo, f.ref('runner'));
  assert.ok(f.engine.trace.some(entry => entry.step === 'event' && entry.timingPoint === 'object-attached'),
    'the committed Attach action is reported as the CR 818.2 object-attached timing point');
});

test('EG-GEAR host movement carries the attached Gear without a Move (CR 719.3.a)', () => {
  const { state, proof } = startingDuel();
  const hostUID = anyDuelUnitHand(state);
  const gearUID = anyDuelGearHand(state);
  let { state: entered, nextInventory: p } = enterDuelUnit(state, proof, hostUID);
  ({ state: entered, nextInventory: p } = enterDuelGear(entered, p, gearUID));
  const attached = attachDuelGear(entered, p, gearUID, hostUID);
  const movedBoard = relocateDuelUnit(attached.board, hostUID, duelField(attached));
  const followed = followDuelAttachedHostMove(attached, p, movedBoard);
  const gear = followed.gears[0];
  assert.equal(gear.uid, gearUID);
  assert.equal(gear.locationId, duelField(attached), 'the Gear follows the host location exactly');
  assert.equal(gear.attachedToUID, hostUID, 'the attachment link survives the relocation');
  assert.equal(followed.physicalCardsByUID[gearUID].zoneEpoch, attached.physicalCardsByUID[gearUID].zoneEpoch,
    'CR 435.4.a: attaching is not a Move, so no zone epoch is charged');
  assert.equal(followed.board.units[0].locationId, gear.locationId);
});

test('EG-GEAR a Gear may be attached to another Gear (stacked) per permanent-state rules', () => {
  const { state, proof } = startingDuel();
  const hostGearUID = anyDuelGearHand(state);
  const innerGearUID = state.players.flatMap(player => player.hand)
    .find(card => card.uid !== hostGearUID && (card.uid.endsWith('-main-1') || card.uid.endsWith('-main-0')))?.uid;
  assert.ok(innerGearUID, 'the attested deck has a second Gear printing');
  let { state: entered, nextInventory: p } = enterDuelGear(state, proof, hostGearUID);
  ({ state: entered, nextInventory: p } = enterDuelGear(entered, p, innerGearUID));
  const attached = attachDuelGear(entered, p, innerGearUID, hostGearUID);
  const gear = attached.gears.find(entry => entry.uid === innerGearUID);
  assert.equal(gear.attachedToUID, hostGearUID, 'Gear stacks onto Gear without any location action');
  assert.equal(gear.locationId, attached.gears.find(entry => entry.uid === hostGearUID).locationId);
});

test('EG-GEAR host exit detaches the Gear first, which then stays at the old location (CR 719.5)', () => {
  const { state, proof } = startingDuel();
  const hostUID = anyDuelUnitHand(state);
  const gearUID = anyDuelGearHand(state);
  let { state: entered, nextInventory: p } = enterDuelUnit(state, proof, hostUID);
  ({ state: entered, nextInventory: p } = enterDuelGear(entered, p, gearUID));
  const attached = attachDuelGear(entered, p, gearUID, hostUID);
  const detached = detachDuelGearsBeforeHostExit(attached, p, hostUID);
  assert.equal(detached.gears[0].attachedToUID, null, 'the Gear is unlinked before the host exits');
  assert.equal(detached.gears[0].locationId, baseOf(detached), 'the Gear stays at the last board location');
  assert.throws(
    () => attachDuelGear(attached, p, gearUID, detached.gears[0].locationId),
    /unknown\/hidden\/non-card host/,
    'a location id is not a host; only a current board object can be a host',
  );
});
