import assert from 'node:assert/strict';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2,
  commitDuelCommandFrameV2, advanceDuelCommandSessionNativeV2 } from '../../dist/duel/canonical-session-v2.js';
import { channelDuelRunesV2, commitDuelPlayingMutationV2,
  moveDuelPhysicalCardToChainV2, finalizeDuelPhysicalUnitFromChainV2,
  registerDuelGearFromTrustedSourceV2 } from '../../dist/duel/core-v2.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2 } from '../../dist/duel/cost-resolver-v2.js';
import {
  beginDuelEquipActivationV1,
  applyDuelEquipActivationResourceV1, finalizeDuelEquipActivationV1,
  passDuelEquipActivationPriorityV1, resolveDuelEquipActivationV1,
  inspectDuelEquipActivationAttemptV1,
} from '../../dist/duel/equip-activation-v1.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`,
    cardId: i % 2 === 0 ? 'fixture-equip' : 'fixture-unit' })),
  champion: { uid: `${playerId}-champion`, cardId: 'fixture-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'fixture-legend' },
  runeDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
    cardId: 'fixture-rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
    cardId: `fixture-field-${playerId}-${i}` })),
}));
const metadata = { matchId: 'equip-activation-v1-fixture', dataVersion: 'fixture-v1',
  catalogDigest: 'fixture-digest', roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const cardType = cardId => cardId === 'fixture-champion' ? 'Champion' : cardId === 'fixture-legend' ? 'Legend' :
  cardId === 'fixture-rune' ? 'Rune' : cardId.startsWith('fixture-field-') ? 'Battlefield' :
  cardId === 'fixture-unit' ? 'Unit' : 'Gear';
const equipCost = { energy: 1, power: [] };
const gearPlayCost = { energy: 4, power: [] };

function costAuthority(baseCost, callbacks = {}) {
  const snapshot = request => {
    callbacks.verifier?.(request);
    return { registryRevision: 'fixture-registry', catalogRevision: 'fixture-catalog',
    nonResourceCosts: 'none', base: { sourceUid: `base:${request.subjectId}`, sourceEpoch: 0, cost: baseCost },
    candidates: [], orderedModifiers: [] };
  };
  const service = request => {
    callbacks.service?.(request);
    const verified = snapshot(request);
    const coverage = { request, status: 'complete', proofId: `coverage:${request.transactionId}`,
      allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: 'none',
      registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision,
      ...fingerprintDuelCostCoverageV2(verified) };
    return { request, base: { request, status: 'complete', proofId: `base:${request.transactionId}`,
      cost: baseCost, sourceUid: verified.base.sourceUid, sourceEpoch: verified.base.sourceEpoch,
      registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision },
      coverage, proofs: [], modifiers: [] };
  };
  return createDuelCostResolverAuthorityV2(service, snapshot);
}

function openScene() {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, cardType);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(session, actor, { commandId: `mulligan-${actor}`,
      expectedVersion: session.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
    assert.equal(result.outcome.status, 'applied'); session = result.session;
  }
  const established = commitDuelPlayingMutationV2(session.match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates)
      .map(([uid, prior]) => [uid, { ...prior, readiness: 'ready' }])) }, transitions: [] }));
  session = advanceDuelCommandSessionNativeV2(session, established).session;
  session = advanceDuelCommandSessionNativeV2(session, channelDuelRunesV2(session.match, 'alice', 2, true)).session;
  session = commitDuelCommandFrameV2(session, { ...session.match.frame, phase: 'main', stateOpen: true,
    priorityPlayerId: 'alice', turnPlayerId: 'alice' }, () => {}).session;
  const player = session.match.players.find(value => value.playerId === 'alice');
  const gear = player.hand.find(value => value.cardId === 'fixture-equip');
  const unit = player.hand.find(value => value.cardId === 'fixture-unit');
  const base = session.match.board.bases.find(value => value.ownerPlayerId === 'alice').locationId;
  let moved = moveDuelPhysicalCardToChainV2(session.match,
    { uid: unit.uid, zoneEpoch: session.match.physicalCardsByUID[unit.uid].zoneEpoch }, 'alice');
  session = advanceDuelCommandSessionNativeV2(session, moved).session;
  session = commitDuelCommandFrameV2(session, { ...session.match.frame, stateOpen: false }, () => {}).session;
  session = advanceDuelCommandSessionNativeV2(session,
    finalizeDuelPhysicalUnitFromChainV2(session.match, unit.uid, 'alice', base, 'enter-ready', id => id === 'fixture-unit')).session;
  session = advanceDuelCommandSessionNativeV2(session,
    registerDuelGearFromTrustedSourceV2(session.match, gear.uid, 'alice', base, true)).session;
  session = commitDuelCommandFrameV2(session, { ...session.match.frame, stateOpen: true,
    priorityPlayerId: 'alice' }, () => {}).session;
  return { session, gear, unit };
}

function bringBobUnit(session) {
  const bob = session.match.players.find(value => value.playerId === 'bob');
  const unit = bob.hand.find(value => value.cardId === 'fixture-unit');
  const base = session.match.board.bases.find(value => value.ownerPlayerId === 'bob').locationId;
  const moved = moveDuelPhysicalCardToChainV2(session.match,
    { uid: unit.uid, zoneEpoch: session.match.physicalCardsByUID[unit.uid].zoneEpoch }, 'bob');
  session = advanceDuelCommandSessionNativeV2(session, moved).session;
  session = commitDuelCommandFrameV2(session, { ...session.match.frame, stateOpen: false }, () => {}).session;
  session = advanceDuelCommandSessionNativeV2(session,
    finalizeDuelPhysicalUnitFromChainV2(session.match, unit.uid, 'bob', base, 'enter-ready', id => id === 'fixture-unit')).session;
  return { session, unit };
}

function services({ equip = equipCost, play = gearPlayCost, readHead, commitHead } = {}) {
  const semantics = {
    kind: 'equip-activated-ability', sourceScope: 'source-gear-on-board', abilityClass: 'activated-ability',
    event: 'activate', timing: 'main-open-outside-showdown',
    target: { kind: 'unit', controller: 'source-controller', scope: 'controlled-unit', selection: 'target' },
    attach: { kind: 'attach-source-gear', destination: 'target-unit', resolution: 'deferred-attachment' },
    cost: { kind: 'base-cost', literal: 'fixture-cost', energy: equip.energy,
      power: equip.power.length ? { kind: 'specific-domain', domain: equip.power[0].allowedDomains[0] } : null,
      nonResourceLiteral: null }, costAlternatives: [], costAlterations: [],
  };
  return {
    readHead, commitHead,
    programs: { getProgram: cardId => ({ cardId, programId: 'fixture-equip-ability',
      source: { cardType: 'Gear', dataVersion: metadata.dataVersion, sourceCatalogDigest: metadata.catalogDigest },
      semantics }) },
    program: request => {
      const proof = inspectDuelEquipActivationAttemptV1(request.attempt);
      assert.equal(proof.gearUID, request.gearUID);
      assert.equal(proof.targetUID, request.targetUID);
      assert.throws(() => inspectDuelEquipActivationAttemptV1(structuredClone(request.attempt)), /unadmitted/);
      return { status: 'known', kind: 'equip-activated-ability', cardId: request.gearCardId,
        programId: 'fixture-equip-ability', programFingerprint: 'fixture-equip-fingerprint', equipCost: equip };
    },
    cost: costAuthority(equip),
    costForActivation: request => {
      assert.equal(inspectDuelEquipActivationAttemptV1(request.attempt).sourceEpoch, request.sourceEpoch);
      assert.equal(request.abilityKind, 'equip-activation');
      assert.equal(request.gearCardId, request.program.cardId);
      assert.equal(request.program.equipCost.energy, equip.energy);
      return costAuthority(equip);
    },
    costBinding: request => ({ ...request, status: 'complete' }),
    sourceAttestor: request => {
      assert.equal(inspectDuelEquipActivationAttemptV1(request.attempt).gearUID, request.sourceReference.sourceUID);
      return { matchId: request.match.matchId, actor: request.actor,
        paymentId: request.paymentId, sourceReference: request.sourceReference,
        sourceProofId: `source:${request.paymentId}`, mode: 'current',
        sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID].zoneEpoch,
        ...(request.taskId ? { taskId: request.taskId } : {}),
        ...(request.continuationId ? { continuationId: request.continuationId } : {}) };
    },
  };
}

function start(h, commandId = 'equip-1') {
  const result = beginDuelEquipActivationV1(h.session, 'alice', { commandId,
    expectedVersion: h.session.commandSession.match.stateVersion,
    command: { gearUID: h.gear.uid, targetUID: h.unit.uid } });
  h.session = result.session; return result;
}
function pay(h, pending) {
  const funded = applyDuelEquipActivationResourceV1(h.session, 'alice', {
    commandId: 'fund-equip', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: h.session.commandSession.match.resources.bases[0].baseRunes[0].uid } });
  assert.equal(funded.outcome.status, 'pending'); h.session = funded.session;
  const paid = applyDuelEquipActivationResourceV1(h.session, 'alice', {
    commandId: 'pay-equip', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: pending.outcome.paymentId } });
  h.session = paid.session; return paid;
}

function readyToResolve(h) {
  const begun = start(h);
  assert.equal(begun.outcome.status, 'pending');
  assert.equal(pay(h, begun).outcome.status, 'paid');
  let result = finalizeDuelEquipActivationV1(h.session, 'alice'); h.session = result.session;
  result = passDuelEquipActivationPriorityV1(h.session, 'alice'); h.session = result.session;
  result = passDuelEquipActivationPriorityV1(h.session, 'bob'); h.session = result.session;
  assert.equal(result.outcome.step, 'resolve');
  return begun;
}

export { openScene, bringBobUnit, services, start, pay, readyToResolve, costAuthority, gearPlayCost, equipCost };
