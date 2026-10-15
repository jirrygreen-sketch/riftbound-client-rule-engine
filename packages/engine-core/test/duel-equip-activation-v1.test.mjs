import test from 'node:test';
import assert from 'node:assert/strict';
import { commitDuelCommandFrameV2, advanceDuelCommandSessionNativeV2 } from '../dist/duel/canonical-session-v2.js';
import { commitDuelPlayingMutationV2, moveDuelUnitV2 } from '../dist/duel/core-v2.js';
import { removeDuelUnit, applyOpenDuelCleanup } from '../dist/duel/battlefields.js';
import {
  createDuelEquipActivationSessionV1, beginDuelEquipActivationV1,
  applyDuelEquipActivationResourceV1, finalizeDuelEquipActivationV1,
  passDuelEquipActivationPriorityV1, resolveDuelEquipActivationV1,
  inspectDuelEquipActivationV1, advanceDuelEquipActivationNativeV1,
  inspectDuelEquipActivationAttemptV1, resumeDuelEquipActivationPaymentV1,
} from '../dist/duel/equip-activation-v1.js';

import { openScene, bringBobUnit, services, start, pay, readyToResolve,
  costAuthority, gearPlayCost, equipCost } from './fixtures/equip-test-fixtures.mjs';

test('on-board Gear Equip keeps the same source on Board and attaches only after payment, double pass and Resolve', () => {
  const h = openScene(); h.session = createDuelEquipActivationSessionV1(h.session, services({ readHead: () => h.session.commandSession?.match ?? h.session.match }));
  const initialVersion = h.session.commandSession.match.stateVersion;
  const sourceEpoch = h.session.commandSession.match.physicalCardsByUID[h.gear.uid].zoneEpoch;
  const initialPool = h.session.commandSession.match.resources.players.find(value => value.playerId === 'alice').runePool.energy;
  const begun = start(h);
  assert.equal(begun.outcome.status, 'pending');
  assert.equal(inspectDuelEquipActivationV1(h.session).fixedCost.energy, equipCost.energy);
  assert.equal(h.session.commandSession.match.gears.some(value => value.uid === h.gear.uid), true);
  assert.equal(h.session.commandSession.match.chainCards?.some(value => value.uid === h.gear.uid) ?? false, false);
  assert.notEqual(h.session.commandSession.match.frame.pendingPayment, null);
  assert.equal(h.session.commandSession.match.frame.stateOpen, false);
  assert.equal(h.session.commandSession.match.resources.players.find(value => value.playerId === 'alice').runePool.energy,
    initialPool);
  assert.equal(h.session.commandSession.match.physicalCardsByUID[h.gear.uid].zoneEpoch, sourceEpoch);
  assert.equal(h.session.commandSession.match.gears.find(value => value.uid === h.gear.uid).attachedToUID, null);
  assert.equal(finalizeDuelEquipActivationV1(h.session, 'alice').outcome.status, 'blocked');
  const paid = pay(h, begun);
  assert.equal(paid.outcome.status, 'paid');
  const duplicatePay = applyDuelEquipActivationResourceV1(h.session, 'alice', {
    commandId: 'pay-equip', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: begun.outcome.paymentId } });
  assert.equal(duplicatePay.duplicate, true);
  assert.equal(duplicatePay.outcome.status, 'paid');
  assert.equal(h.session.commandSession.match.gears.find(value => value.uid === h.gear.uid).attachedToUID, null);
  let result = finalizeDuelEquipActivationV1(h.session, 'alice'); h.session = result.session;
  assert.equal(result.outcome.status, 'pending');
  result = passDuelEquipActivationPriorityV1(h.session, 'alice'); h.session = result.session;
  result = passDuelEquipActivationPriorityV1(h.session, 'bob'); h.session = result.session;
  assert.equal(result.outcome.step, 'resolve');
  result = resolveDuelEquipActivationV1(h.session); h.session = result.session;
  assert.equal(result.outcome.status, 'applied');
  assert.equal(result.outcome.attached, true);
  assert.equal(h.session.commandSession.match.physicalCardsByUID[h.gear.uid].zoneEpoch, sourceEpoch);
  assert.equal(h.session.commandSession.match.gears.find(value => value.uid === h.gear.uid).attachedToUID, h.unit.uid);
  assert.equal(h.session.commandSession.match.frame.stateOpen, true);
  assert.equal(h.session.commandSession.match.frame.priorityPlayerId, 'alice');
  const retried = beginDuelEquipActivationV1(h.session, 'alice', { commandId: 'equip-1',
    expectedVersion: initialVersion,
    command: { gearUID: h.gear.uid, targetUID: h.unit.uid } });
  assert.equal(retried.duplicate, true);
  assert.equal(retried.outcome.status, 'applied');
});

test('Equip rejects enemy/non-Unit targets and foreign priority', () => {
  const h = openScene(); h.session = createDuelEquipActivationSessionV1(h.session, services({ readHead: () => h.session.commandSession?.match ?? h.session.match }));
  const wrong = beginDuelEquipActivationV1(h.session, 'alice', { commandId: 'wrong-target',
    expectedVersion: h.session.commandSession.match.stateVersion,
    command: { gearUID: h.gear.uid, targetUID: 'bob-main-1' } });
  assert.equal(wrong.outcome.status, 'rejected');
  const foreign = beginDuelEquipActivationV1(h.session, 'bob', { commandId: 'foreign-priority',
    expectedVersion: h.session.commandSession.match.stateVersion,
    command: { gearUID: h.gear.uid, targetUID: h.unit.uid } });
  assert.equal(foreign.outcome.status, 'rejected');
});

test('Equip rejects Closed Main, other turn, and a genuine staged Showdown', () => {
  const h = openScene();
  const closed = commitDuelCommandFrameV2(h.session, { ...h.session.match.frame, stateOpen: false }, () => {}).session;
  assert.throws(() => createDuelEquipActivationSessionV1(closed, services({ readHead: () => closed.match })), /open Main/);
  const otherTurn = commitDuelCommandFrameV2(h.session, { ...h.session.match.frame,
    turnPlayerId: 'bob', priorityPlayerId: 'bob' }, () => {}).session;
  const other = createDuelEquipActivationSessionV1(otherTurn, services({ readHead: () => otherTurn.match }));
  assert.equal(beginDuelEquipActivationV1(other, 'alice', { commandId: 'other-turn',
    expectedVersion: otherTurn.match.stateVersion,
    command: { gearUID: h.gear.uid, targetUID: h.unit.uid } }).outcome.status, 'rejected');
  const bob = bringBobUnit(h.session);
  const field = bob.session.match.board.battlefields[0].locationId;
  let session = advanceDuelCommandSessionNativeV2(bob.session,
    moveDuelUnitV2(bob.session.match, h.unit.uid, field)).session;
  session = advanceDuelCommandSessionNativeV2(session, moveDuelUnitV2(session.match, bob.unit.uid, field)).session;
  session = advanceDuelCommandSessionNativeV2(session,
    commitDuelPlayingMutationV2(session.match, draft => ({ match: { ...draft,
      board: applyOpenDuelCleanup(draft.board) }, transitions: [] }))).session;
  assert.equal(session.match.board.battlefields[0].showdown, 'staged');
  const staged = createDuelEquipActivationSessionV1(session, services({ readHead: () => session.match }));
  assert.equal(beginDuelEquipActivationV1(staged, 'alice', { commandId: 'staged',
    expectedVersion: session.match.stateVersion,
    command: { gearUID: h.gear.uid, targetUID: h.unit.uid } }).outcome.status, 'rejected');
});

test('a Gear CardPlay base cost is not accepted as the Equip base cost', () => {
  const h = openScene();
  const service = services({ equip: equipCost, play: gearPlayCost, readHead: () => h.session.commandSession?.match ?? h.session.match });
  service.costForActivation = request => {
    assert.notEqual(request.program.equipCost.energy, gearPlayCost.energy);
    return costAuthority(gearPlayCost);
  };
  h.session = createDuelEquipActivationSessionV1(h.session, service);
  const begun = start(h, 'different-cost');
  assert.equal(begun.outcome.status, 'blocked');
  assert.equal(h.session.commandSession.match.gears.some(value => value.uid === h.gear.uid), true);
  assert.equal(h.session.commandSession.match.chainCards?.some(value => value.uid === h.gear.uid) ?? false, false);
});

test('a target leaving after payment fizzles without refund or retarget', () => {
  const h = openScene(); h.session = createDuelEquipActivationSessionV1(h.session, services({ readHead: () => h.session.commandSession?.match ?? h.session.match }));
  readyToResolve(h);
  const paidPool = h.session.commandSession.match.resources.players.find(value => value.playerId === 'alice').runePool.energy;
  const before = h.session.commandSession.match;
  const departed = commitDuelPlayingMutationV2(before, draft => {
    const unit = draft.board.units.find(value => value.objectId === h.unit.uid);
    const unitMeta = { ...draft.unitMeta };
    delete unitMeta[h.unit.uid];
    return { match: { ...draft, board: removeDuelUnit(draft.board, h.unit.uid), unitMeta,
      players: draft.players.map(player => player.playerId === 'alice'
        ? { ...player, trash: [...player.trash, h.unit] } : player) },
    transitions: [{ uid: h.unit.uid, from: { kind: 'board-base', locationId: unit.locationId },
      to: { kind: 'trash', zonePlayerId: 'alice' } }] };
  });
  const descendant = advanceDuelCommandSessionNativeV2(h.session.commandSession, departed).session;
  h.session = advanceDuelEquipActivationNativeV1(h.session, descendant);
  const resolved = resolveDuelEquipActivationV1(h.session); h.session = resolved.session;
  assert.equal(resolved.outcome.status, 'applied');
  assert.equal(resolved.outcome.attached, false);
  assert.equal(h.session.commandSession.match.gears.find(value => value.uid === h.gear.uid).attachedToUID, null);
  assert.equal(h.session.commandSession.match.resources.players.find(value => value.playerId === 'alice').runePool.energy, paidPool);
  assert.equal(inspectDuelEquipActivationV1(h.session).phase, 'fizzled');
});

test('an attached host exit requires the trusted Unit-exit owner to detach Gear in the same native commit', () => {
  const h = openScene(); h.session = createDuelEquipActivationSessionV1(h.session, services({ readHead: () => h.session.commandSession?.match ?? h.session.match }));
  readyToResolve(h);
  h.session = resolveDuelEquipActivationV1(h.session).session;
  const before = h.session.commandSession.match;
  const exit = detach => commitDuelPlayingMutationV2(before, draft => {
    const unit = draft.board.units.find(value => value.objectId === h.unit.uid);
    const unitMeta = { ...draft.unitMeta };
    delete unitMeta[h.unit.uid];
    return { match: { ...draft, board: removeDuelUnit(draft.board, h.unit.uid), unitMeta,
      gears: detach ? draft.gears.map(value => value.attachedToUID === h.unit.uid
        ? { ...value, attachedToUID: null } : value) : draft.gears,
      players: draft.players.map(player => player.playerId === 'alice'
        ? { ...player, trash: [...player.trash, h.unit] } : player) },
    transitions: [{ uid: h.unit.uid, from: { kind: 'board-base', locationId: unit.locationId },
      to: { kind: 'trash', zonePlayerId: 'alice' } }] };
  });
  assert.throws(() => exit(false), /Gear|host|attachment/);
  const detached = exit(true);
  assert.equal(detached.gears.find(value => value.uid === h.gear.uid).attachedToUID, null);
  assert.equal(detached.gears.find(value => value.uid === h.gear.uid).locationId,
    before.gears.find(value => value.uid === h.gear.uid).locationId);
});

test('Equip moves the on-board Gear to the selected battlefield Unit before attaching', () => {
  const h = openScene();
  const fieldId = h.session.match.board.battlefields[0].locationId;
  h.session = advanceDuelCommandSessionNativeV2(h.session, moveDuelUnitV2(h.session.match, h.unit.uid, fieldId)).session;
  const epoch = h.session.match.physicalCardsByUID[h.gear.uid].zoneEpoch;
  const readied = h.session.match.gears.find(value => value.uid === h.gear.uid).readied;
  h.session = createDuelEquipActivationSessionV1(h.session, services({ readHead: () => h.session.commandSession?.match ?? h.session.match }));
  readyToResolve(h);
  const resolved = resolveDuelEquipActivationV1(h.session);
  assert.equal(resolved.outcome.status, 'applied');
  assert.equal(resolved.outcome.attached, true);
  const gear = resolved.session.commandSession.match.gears.find(value => value.uid === h.gear.uid);
  assert.equal(gear.locationId, fieldId);
  assert.equal(gear.attachedToUID, h.unit.uid);
  assert.equal(gear.readied, readied);
  assert.equal(resolved.session.commandSession.match.physicalCardsByUID[h.gear.uid].zoneEpoch, epoch);
  const nextField = resolved.session.commandSession.match.board.battlefields[1].locationId;
  const moved = moveDuelUnitV2(resolved.session.commandSession.match, h.unit.uid, nextField);
  assert.equal(moved.gears.find(value => value.uid === h.gear.uid).locationId, nextField);
  assert.equal(moved.gears.find(value => value.uid === h.gear.uid).attachedToUID, h.unit.uid);
});

test('cloned sessions and cloned native descendants cannot continue an Equip attempt', () => {
  const h = openScene(); h.session = createDuelEquipActivationSessionV1(h.session, services({ readHead: () => h.session.commandSession?.match ?? h.session.match }));
  assert.throws(() => inspectDuelEquipActivationV1(structuredClone(h.session)), /inactive|unadmitted/);
  readyToResolve(h);
  assert.throws(() => advanceDuelEquipActivationNativeV1(h.session,
    structuredClone(h.session.commandSession)), /unadmitted|foreign|native/);
});

test('one native Gear head admits only one attempt; mismatched same-command payload conflicts', () => {
  const h = openScene();
  const first = createDuelEquipActivationSessionV1(h.session, services({ readHead: () => h.session.commandSession?.match ?? h.session.match }));
  const sibling = createDuelEquipActivationSessionV1(h.session, services({ readHead: () => h.session.commandSession?.match ?? h.session.match }));
  h.session = first;
  const version = first.commandSession.match.stateVersion;
  assert.equal(start(h).outcome.status, 'pending');
  const blocked = beginDuelEquipActivationV1(sibling, 'alice', { commandId: 'sibling', expectedVersion: version,
    command: { gearUID: h.gear.uid, targetUID: h.unit.uid } });
  assert.deepEqual(blocked.outcome, { status: 'blocked', reason: 'outstanding-task-or-session' });
  const conflict = beginDuelEquipActivationV1(h.session, 'alice', { commandId: 'equip-1', expectedVersion: version,
    command: { gearUID: h.gear.uid, targetUID: 'bob-main-1' } });
  assert.deepEqual(conflict.outcome, { status: 'rejected', reason: 'command-conflict' });
  assert.throws(() => inspectDuelEquipActivationV1(first), /inactive/);
});

test('issued required payment retries its own authority after source re-attestation recovers', () => {
  const h = openScene();
  const service = services({ readHead: () => h.session.commandSession?.match ?? h.session.match }); let calls = 0;
  const source = service.sourceAttestor;
  service.sourceAttestor = request => {
    calls += 1;
    if (calls === 2) throw new TypeError('temporary source census gap');
    return source(request);
  };
  h.session = createDuelEquipActivationSessionV1(h.session, service);
  const begun = start(h, 'retry-issued');
  assert.equal(begun.outcome.status, 'blocked');
  assert.equal(inspectDuelEquipActivationV1(h.session).phase, 'issued');
  assert.equal(h.session.commandSession.requiredTasks.filter(task => task.status === 'issued').length, 1);
  const retried = resumeDuelEquipActivationPaymentV1(h.session); h.session = retried.session;
  assert.equal(retried.outcome.status, 'pending');
  assert.equal(retried.outcome.step, 'payment');
  assert.equal(h.session.commandSession.requiredTasks.length, 1);
  assert.equal(h.session.commandSession.requiredTasks[0].status, 'active');
});

test('unknown cost retries on the same closed Chain item without a second attempt', () => {
  const h = openScene();
  const service = services({ readHead: () => h.session.commandSession?.match ?? h.session.match }); let known = false;
  const factory = service.costForActivation;
  service.costForActivation = request => {
    if (!known) throw new TypeError('cost census unknown');
    return factory(request);
  };
  h.session = createDuelEquipActivationSessionV1(h.session, service);
  const blocked = start(h, 'retry-cost');
  assert.equal(blocked.outcome.status, 'blocked');
  assert.equal(inspectDuelEquipActivationV1(h.session).phase, 'chain');
  const itemId = h.session.chain.items[0].id;
  known = true;
  const retried = resumeDuelEquipActivationPaymentV1(h.session); h.session = retried.session;
  assert.equal(retried.outcome.status, 'pending');
  assert.equal(h.session.chain.items.length, 1);
  assert.equal(h.session.chain.items[0].id, itemId);
  assert.equal(h.session.commandSession.match.gears.filter(value => value.uid === h.gear.uid).length, 1);
});

test('invalid command shapes, non-Gear source and reentrant program provider cannot begin', () => {
  const h = openScene();
  const service = services({ readHead: () => h.session.commandSession?.match ?? h.session.match });
  h.session = createDuelEquipActivationSessionV1(h.session, service);
  const version = h.session.commandSession.match.stateVersion;
  const accessor = { commandId: 'accessor', expectedVersion: version, command: { gearUID: h.gear.uid } };
  Object.defineProperty(accessor.command, 'targetUID', { enumerable: true, get: () => h.unit.uid });
  assert.deepEqual(beginDuelEquipActivationV1(h.session, 'alice', accessor).outcome,
    { status: 'rejected', reason: 'invalid-command' });
  assert.deepEqual(beginDuelEquipActivationV1(h.session, 'alice', { commandId: 'wrong-source',
    expectedVersion: version, command: { gearUID: h.unit.uid, targetUID: h.unit.uid } }).outcome.status, 'rejected');
  const original = service.program;
  service.program = request => {
    assert.throws(() => beginDuelEquipActivationV1(h.session, 'alice', { commandId: 'reentered',
      expectedVersion: version, command: { gearUID: h.gear.uid, targetUID: h.unit.uid } }), /reentrant/);
    return original(request);
  };
  const reentered = beginDuelEquipActivationV1(h.session, 'alice', { commandId: 'outer',
    expectedVersion: version, command: { gearUID: h.gear.uid, targetUID: h.unit.uid } });
  assert.equal(reentered.outcome.status, 'rejected');
  assert.equal(h.session.commandSession.match.frame.stateOpen, true);
  assert.equal(h.session.commandSession.match.frame.pendingPayment, null);
});
