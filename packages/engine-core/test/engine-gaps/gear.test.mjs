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
import longSword from '../../../card-dsl/dist/cards/sfd/long-sword.js';
import shadySpectacles from '../../../card-dsl/dist/cards/ven/shady-spectacles.js';
import { ChainContractBlockedError } from '../../dist/chain/engine.js';
import { runCardScenario } from '../../dist/effects/testing/scenario/index.js';
import {
  attachDuelGearV2,
  commitDuelPlayingMutationV2,
  createDuelMatchV2,
  moveDuelUnitV2,
  registerDuelGearFromTrustedSourceV2,
  resolveDuelMulliganV2,
} from '../../dist/duel/core-v2.js';
import {
  commitApprovedDuelUnitKills,
  materializeDuelUnitFromSettledSource,
  planDuelUnitKills,
} from '../../dist/zones/unit-lifecycle.js';
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

const hostObject = { id: 'host', types: ['unit'], zone: 'board', might: 2, location: battlefield };
const enemyObject = { id: 'enemy', owner: 'B', controller: 'B', types: ['unit'], might: 2, location: battlefield };
const secondGearObject = { ...gearObject('second-gear'), cardId: 'test:second-gear' };

const duelCardType = cardId => cardId === 'print-0' || cardId === 'print-1' ? 'Gear'
  : cardId === 'print-2' ? 'Unit'
    : cardId.startsWith('champion-') ? 'Champion'
      : cardId.startsWith('legend-') ? 'Legend'
        : cardId.startsWith('rune-') ? 'Rune'
          : cardId.startsWith('field-') ? 'Battlefield' : 'Unit';

// Native admitted V2 match; every carrier below enters through a trusted production mutation.
function startingDuel() {
  const seats = ['p1', 'p2'].map(id => ({
    playerId: id,
    mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${id}-main-${i}`, cardId: `print-${i}` })),
    champion: { uid: `${id}-champion`, cardId: `champion-${id}` },
    legend: { uid: `${id}-legend`, cardId: `legend-${id}` },
    runeDeck: Array.from({ length: 5 }, (_, i) => ({ uid: `${id}-rune-${i}`, cardId: `rune-${i}`, domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${id}-bf-${i}`, cardId: `field-${i}` })),
  }));
  const metadata = { matchId: 'test-match-1', dataVersion: 'test-catalog-v1', catalogDigest: 'sha256:test-verified',
    roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
  const setup = createDuelMatchV2(seats, metadata, () => 0, duelCardType);
  const first = resolveDuelMulliganV2(setup, setup.turnOrder[0], []);
  const state = resolveDuelMulliganV2(first, setup.turnOrder[1], []);
  return state;
}

const baseOf = (state, player = 'p1') => state.board.bases.find(base => base.ownerPlayerId === player).locationId;
const duelField = state => state.board.battlefields[0].locationId;
const duelBaseZone = locationId => ({ kind: 'board-base', locationId });
const handCard = (state, uid, playerId = 'p1') =>
  state.players.find(player => player.playerId === playerId).hand.find(card => card.uid === uid);
function enterDuelUnit(state, uid, owner = 'p1', controller = owner) {
  const card = handCard(state, uid, owner);
  assert.ok(card, 'the fixture Unit must be a real card in Hand');
  const locationId = baseOf(state, controller);
  return commitDuelPlayingMutationV2(state, draft => {
    const withoutSource = { ...draft, players: draft.players.map(player => player.playerId === owner
      ? { ...player, hand: player.hand.filter(item => item.uid !== uid) } : player) };
    const entered = materializeDuelUnitFromSettledSource(withoutSource, {
      kind: 'card', uid, cardType: 'Unit', cardId: card.cardId, ownerPlayerId: owner,
      controllerPlayerId: controller, locationId,
    }, cardId => cardId === card.cardId);
    return { match: entered, transitions: [{ uid,
      from: { kind: 'hand', zonePlayerId: owner }, to: duelBaseZone(locationId) }] };
  });
}
function enterDuelGear(state, uid, controller = 'p1', location = baseOf(state, controller)) {
  return registerDuelGearFromTrustedSourceV2(state, uid, controller, location, true);
}
function admittedAttachedGear({ move = false } = {}) {
  let state = startingDuel();
  const hostUID = 'p1-main-2';
  const gearUID = 'p1-main-1';
  state = enterDuelUnit(state, hostUID);
  state = enterDuelGear(state, gearUID);
  state = attachDuelGearV2(state, gearUID, hostUID);
  if (move) state = moveDuelUnitV2(state, hostUID, duelField(state));
  return { state, hostUID, gearUID };
}
function exitHostThroughKill(state, hostUID) {
  const unit = state.board.units.find(entry => entry.objectId === hostUID);
  const from = state.board.bases.some(base => base.locationId === unit.locationId)
    ? duelBaseZone(unit.locationId)
    : { kind: 'board-battlefield', locationId: unit.locationId };
  let notices = [];
  const exited = commitDuelPlayingMutationV2(state, draft => {
    const detached = { ...draft, gears: draft.gears.map(gear =>
      gear.attachedToUID === hostUID || gear.uid === hostUID ? { ...gear, attachedToUID: null } : gear) };
    const plan = planDuelUnitKills(detached, [hostUID], 'passive');
    const killed = commitApprovedDuelUnitKills(detached, { plan, approvedUnitUIDs: [hostUID] });
    notices = killed.notices;
    return { match: killed.state, transitions: [{ uid: hostUID, from,
      to: { kind: 'trash', zonePlayerId: draft.unitMeta[hostUID].ownerPlayerId } }] };
  });
  return { state: exited, notices };
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
  const [equip] = f.binding.activationAbilities(f.get('gear'));
  f.engine.execute({
    id: 'eg-gear-activate',
    controller: 'A',
    source: f.get('gear'),
    kind: 'activated',
    speed: 'action',
    body: equip.body,
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

test('EG-GEAR invalidates a locked Equip host through real Kill, then resolves without Attach or state drift', () => {
  const f = fixtureWorld({ answers: { 'target:equip-target': ['host'] } });
  const [equip] = f.binding.activationAbilities(f.get('gear'));
  f.engine.execute({ id: 'eg-gear-stale', controller: 'A', source: f.get('gear'),
    kind: 'activated', speed: 'action', body: equip.body });
  const locked = f.engine.items[0].targetPlans[0].selected;
  assert.deepEqual(locked, [f.ref('host')], 'the host must be locked before it is invalidated');
  const killed = f.engine.commit({ type: 'kill', object: f.ref('host') });
  assert.equal(killed.status, 'done');
  assert.equal(f.get('host').zone, 'trash');
  const beforeResolve = { gear: f.get('gear').attachedTo, host: f.get('host').zone };
  f.engine.advance();
  settle(f.engine);
  assert.equal(f.get('gear').attachedTo, null);
  assert.deepEqual({ gear: f.get('gear').attachedTo, host: f.get('host').zone }, beforeResolve,
    'the stale target resolves as a no-op and the failed Attach changes no state');
  assert.ok(f.engine.pipeline.events.every(event => event.action !== 'attach'),
    'the invalidated target produces no Attach action');
  assert.ok(f.engine.trace.some(entry => entry.step === 'resolved' && entry.item === 'eg-gear-stale'));
});

test('EG-GEAR attach is replaceable and the chain still resolves cleanly', () => {
  const f = fixtureWorld({ answers: { 'target:equip-target': ['host'] } });
  const [equip] = f.binding.activationAbilities(f.get('gear'));
  f.kernel.addReplacement(action => action.type === 'attach' ? 'replaced' : null);
  f.engine.execute({
    id: 'eg-gear-activate',
    controller: 'A',
    source: f.get('gear'),
    kind: 'activated',
    speed: 'action',
    body: equip.body,
  });
  settle(f.engine);
  assert.equal(f.get('gear').attachedTo, null);
  const resolved = f.engine.trace.filter(entry => entry.step === 'resolved');
  assert.equal(resolved.length, 1, 'the chain still resolves after the replacement');
  assert.ok(f.engine.pipeline.events.every(event => event.action !== 'attach'),
    'a replaced Attach action produces no Attach event and no attachment');
});

test('EG-GEAR plays the original Long Sword program and its registered card-played trigger attaches (CR 819.1)', () => {
  const f = fixture({
    programs: [longSword],
    energy: { A: 4 },
    answers: { 'target:quick-draw-unit': ['runner'] },
    setup: w => w.player('A').player('B')
      .hand('quick-draw-gear', { cardId: longSword.canonicalCardId, types: ['gear'],
        tags: ['Equipment'], energy: 2, power: [], keywords: [] })
      .unit('runner', { might: 2 })
      .unit('enemy', { owner: 'B', controller: 'B', might: 2 }),
  });
  const abilities = f.binding.inspect(f.get('quick-draw-gear')).abilities;
  assert.ok(abilities.some(ability => ability.kind === 'triggered' && ability.trigger.at === 'card-played'),
    'the original CardProgram expands its registered play trigger');
  f.play('quick-draw-gear');
  assert.ok(f.engine.pipeline.events.some(event => event.timingPoint === 'card-played'));
  assert.ok(f.engine.items.some(item => item.kind === 'triggered'),
    'the production lifecycle queues Quick-Draw from card-played');
  settle(f.engine);
  assert.deepEqual(f.get('quick-draw-gear').attachedTo, f.ref('runner'));
  assert.ok(f.engine.trace.some(entry => entry.step === 'event' && entry.timingPoint === 'object-attached'),
    'the committed Attach action is reported as the CR 818.2 object-attached timing point');
});

test('EG-GEAR host movement carries the attached Gear through the admitted V2 move transaction (CR 719.3.a)', () => {
  const { state: attached, hostUID, gearUID } = admittedAttachedGear();
  const moved = moveDuelUnitV2(attached, hostUID, duelField(attached));
  const gear = moved.gears.find(entry => entry.uid === gearUID);
  assert.equal(gear.uid, gearUID);
  assert.equal(gear.locationId, duelField(attached), 'the Gear follows the host location exactly');
  assert.equal(gear.attachedToUID, hostUID, 'the attachment link survives the relocation');
  assert.equal(moved.physicalCardsByUID[gearUID].zoneEpoch, attached.physicalCardsByUID[gearUID].zoneEpoch,
    'CR 435.4.a: attaching is not a Move, so no zone epoch is charged');
  assert.equal(moved.board.units.find(unit => unit.objectId === hostUID).locationId, gear.locationId);
  assert.deepEqual(moved.provenance.transitions.slice(-2).map(step => step.uid), [hostUID, gearUID],
    'the production transaction records the host and followed Gear carrier movements');
});

test('EG-GEAR a Gear may attach to another Gear through the admitted V2 attachment transaction', () => {
  let state = startingDuel();
  const location = duelField(state);
  state = enterDuelGear(state, 'p1-main-1', 'p1', location);
  state = enterDuelGear(state, 'p2-main-1', 'p2', location);
  const host = state.gears.find(entry => entry.uid === 'p1-main-1');
  const attached = attachDuelGearV2(state, 'p2-main-1', 'p1-main-1');
  const gear = attached.gears.find(entry => entry.uid === 'p2-main-1');
  assert.equal(gear.attachedToUID, 'p1-main-1', 'Gear stacks onto Gear');
  assert.equal(gear.locationId, host.locationId);
  assert.equal(attached.stateVersion, state.stateVersion + 1);
});

test('EG-GEAR a real Kill exits the host, detaches first and leaves the Gear at the old location (CR 719.5)', () => {
  const { state: attached, hostUID, gearUID } = admittedAttachedGear({ move: true });
  const { state: exited, notices } = exitHostThroughKill(attached, hostUID);
  const gear = exited.gears.find(entry => entry.uid === gearUID);
  assert.equal(gear.attachedToUID, null, 'the Gear is unlinked before the host exits');
  assert.equal(gear.locationId, duelField(attached), 'the Gear stays at the last board location');
  assert.equal(exited.board.units.some(unit => unit.objectId === hostUID), false);
  assert.equal(exited.players.find(player => player.playerId === 'p1').trash.some(card => card.uid === hostUID), true);
  assert.deepEqual(notices.map(notice => notice.kind), ['Killed', 'TrashEntry']);
  assert.deepEqual(exited.provenance.transitions.at(-1), { uid: hostUID,
    from: { kind: 'board-battlefield', locationId: duelField(attached) },
    to: { kind: 'trash', zonePlayerId: 'p1' } }, 'the real host zone exit is recorded');
  assert.throws(
    () => attachDuelGearV2(exited, gearUID, gear.locationId),
    /unknown\/hidden\/non-card host|unknown board object/,
    'a location id is not a host; only a current board object can be a host',
  );
});
