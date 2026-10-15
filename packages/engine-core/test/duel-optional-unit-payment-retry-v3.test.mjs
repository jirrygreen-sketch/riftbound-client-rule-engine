import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelCommandSessionV2, adoptAdmittedDuelPlayingSessionV2,
  commitDuelPlayingMutationV2, applyDuelResourceCommandV2,
  channelDuelRunesV2, referenceDuelPhysicalCardV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  createDuelUnitPlaySessionV2,
  beginDuelOptionalUnitPaymentV3,
  applyDuelOptionalUnitPaymentResourceCommandV3,
  resumeDuelOptionalUnitPaymentV3,
  inspectDuelOptionalUnitPaymentV3,
} from '../dist/duel/index.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2,
  fingerprintDuelCostModifierV2 } from '../dist/duel/cost-resolver-v2.js';
import { restoreDuelResources } from '../dist/duel/resources.js';
import { createDuelOptionalPlayChoiceAuthorityV1 } from '../dist/duel/optional-play-choice-v1.js';

const CARD = 'fixture-accelerate-v3';
const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: CARD })),
  champion: { uid: `${playerId}-champion`, cardId: 'fixture-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'fixture-legend' },
  runeDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'fixture-rune', domain: i % 2 ? 'Calm' : 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `field-${i}` })),
}));
const metadata = { matchId: 'optional-unit-payment-v3', dataVersion: 'fixture-v3', catalogDigest: 'fixture-v3-digest',
  roster: seats.map(({ playerId }) => ({ playerId, displayName: playerId })) };
const cardTypes = cardId => cardId === 'fixture-champion' ? 'Champion' : cardId === 'fixture-legend' ? 'Legend' :
  cardId === 'fixture-rune' ? 'Rune' : cardId.startsWith('field-') ? 'Battlefield' : 'Unit';
const description = Object.freeze({ status: 'known', kind: 'optional-play-cost-v1', cardId: CARD,
  canonicalCardId: CARD, source: { normalizedAbilityText: '[Accelerate]', energy: 2, power: null,
    might: 2, domains: ['Fury'], tags: [] }, printedBaseCost: { energy: 2, power: null },
  semantics: { kind: 'accelerate', choiceTiming: 'card-play-choices', optional: true,
    additionalCost: { energy: 1, power: [{ allowedDomains: ['Fury'], amount: 1 }] },
    paidEffect: { kind: 'enter-ready-replacement', timing: 'unit-entry' } } });

function resolver(request, { zero = false } = {}) {
  const req = { transactionId: request.transactionId, subjectId: request.cardId, kind: 'card-play' };
  const additional = { id: `accelerate:${request.uid}`, sourceProofId: `proof:${request.uid}`,
    stage: 'additional', target: { kind: 'new-component' }, operation: 'add',
    choice: request.choice === 'pay' ? 'chosen-optional' : 'declined-optional',
    cost: { energy: 1, power: [{ allowedDomains: ['Fury'], amount: 1 }] } };
  const discount = { id: `zero-discount:${request.uid}`, sourceProofId: `zero-proof:${request.uid}`,
    stage: 'total-discount', target: { kind: 'total' }, operation: 'discount',
    reduction: { energy: { amount: 3 }, power: [{ requirementIndex: 0, amount: 1 }] } };
  const modifiers = request.choice === 'pay' ? (zero ? [additional, discount] : [additional]) : [];
  const verified = { registryRevision: 'fixture-registry-v3', catalogRevision: 'fixture-v3-digest',
    nonResourceCosts: 'none', base: { cost: { energy: 2, power: [] }, sourceUid: request.uid, sourceEpoch: request.sourceEpoch },
    candidates: [{ sourceUid: `optional:${request.uid}`, sourceEpoch: request.sourceEpoch,
      choice: request.choice === 'pay' ? 'chosen-optional' : 'declined-optional', modifierIds: modifiers.map(item => item.id) }],
    orderedModifiers: modifiers };
  const coverage = fingerprintDuelCostCoverageV2(verified);
  const cost = createDuelCostResolverAuthorityV2(() => ({ request: req,
    base: { cost: verified.base.cost, proofId: 'v3-base-proof', status: 'complete', request: req,
      sourceUid: verified.base.sourceUid, sourceEpoch: verified.base.sourceEpoch,
      registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision },
    coverage: { proofId: 'v3-coverage-proof', status: 'complete', request: req,
      allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: 'none',
      registryRevision: verified.registryRevision, catalogRevision: verified.catalogRevision, ...coverage },
    proofs: modifiers.map(item => ({ proofId: item.sourceProofId, modifierId: item.id, request: req,
      target: item.target, status: 'complete', applicability: 'applies', sourceUid: `optional:${request.uid}`,
      sourceEpoch: request.sourceEpoch, registryRevision: verified.registryRevision,
      catalogRevision: verified.catalogRevision, modifierFingerprint: fingerprintDuelCostModifierV2(req, item),
      candidateSourcesFingerprint: coverage.candidateSourcesFingerprint,
      resolvedChoicesFingerprint: coverage.resolvedChoicesFingerprint })), modifiers }), () => verified);
  return cost;
}

function fixture({ decision = 'pay', energy = 0, fury = 0, zero = false } = {}) {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, cardTypes);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(session, actor, { commandId: `mulligan-${actor}`,
      expectedVersion: session.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
    assert.equal(result.outcome.status, 'applied');
    session = result.session;
  }
  let match = channelDuelRunesV2(session.match, 'alice', 4);
  const locations = match.board.bases.map(base => ({ playerId: base.ownerPlayerId, locationId: base.locationId }));
  const resources = structuredClone(match.resources);
  resources.players[0].runePool.energy = energy;
  resources.players[0].runePool.power.Fury = fury;
  match = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
    resources: restoreDuelResources(resources, locations),
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) => [uid, { ...state, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', stateOpen: true, priorityPlayerId: 'alice', turnPlayerId: 'alice' } }, transitions: [] }));
  const card = match.players[0].hand[0];
  const fingerprint = `v3-program:${card.uid}`;
  const choice = createDuelOptionalPlayChoiceAuthorityV1({ readHead: () => match,
    readSource: (head, actor, uid) => ({ matchId: head.matchId, actor, uid, cardId: card.cardId,
      sourceEpoch: head.physicalCardsByUID[uid].zoneEpoch, sourceProgramFingerprint: fingerprint }),
    nextOpaqueId: (() => { let n = 0; return () => `v3-choice-${++n}`; })() });
  const prompt = choice.issue({ actor: 'alice', commandId: 'unit-v3-play', expectedVersion: match.stateVersion, uid: card.uid });
  const receipt = choice.answer({ actor: 'alice', commandId: 'unit-v3-play', expectedVersion: match.stateVersion,
    choiceId: prompt.choiceId, optionId: decision === 'pay' ? prompt.payOptionId : prompt.declineOptionId });
  const entry = request => ({ matchId: request.matchId, stateVersion: request.stateVersion, eventSeq: request.eventSeq,
    actor: request.actor, uid: request.uid, cardId: request.cardId, sourceEpoch: request.sourceEpoch,
    baseLocationId: request.baseLocationId, programId: request.programId, sourceCensus: 'complete',
    sources: enumerateDuelPhaseSourceClosureCandidatesV2(request.match).map(candidate => ({ uid: candidate.uid,
      zoneEpoch: candidate.zoneEpoch, programId: candidate.uid === request.uid ? fingerprint : `native:${candidate.cardId}`,
      disposition: 'known-no-effect' })), scopes: { play: 'clear', replacement: 'clear', static: 'clear',
      trigger: 'clear', pendingTasks: 'clear', chain: 'clear' } });
  const services = {
    programs: { getProgram: cardId => ({ programId: `native:${cardId}` }) },
    cost: resolver({ transactionId: 'unused', cardId: card.cardId, actor: 'alice', uid: card.uid,
      sourceEpoch: match.physicalCardsByUID[card.uid].zoneEpoch, choice: decision, description, receipt: {} }, { zero }),
    costBinding: request => ({ ...request, status: 'complete' }), entry,
    optional: { program: request => ({ matchId: request.matchId, dataVersion: request.dataVersion,
      catalogDigest: request.catalogDigest, actor: request.actor, uid: request.uid, cardId: request.cardId,
      sourceEpoch: request.sourceEpoch, programFingerprint: fingerprint, description }),
      inspectChoice: choice.inspectReceipt, cost: request => resolver(request, { zero }), costBinding: request => ({ ...request, status: 'complete' }), entry },
    optionalPaymentV3: { sourceAttestor: request => ({ matchId: request.match.matchId, actor: request.actor,
      paymentId: request.paymentId, sourceReference: { ...request.sourceReference }, sourceProofId: `v3-source:${request.paymentId}`,
      mode: 'current', sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID].zoneEpoch,
      ...(request.taskId ? { taskId: request.taskId, continuationId: request.continuationId } : {}) }) },
  };
  const action = createDuelUnitPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(match), services);
  return { action, card, receipt, services, match, rune: i => action.commandSession.match.resources.bases[0].baseRunes[i] };
}

function begin(f) {
  return beginDuelOptionalUnitPaymentV3(f.action, 'alice', { commandId: 'unit-v3-play', expectedVersion: f.match.stateVersion,
    command: { cardUID: f.card.uid, choiceReceipt: f.receipt } });
}

test('payment retry keeps its original ACK while paid entry is still unproved', () => {
  const f=fixture(); const begun=begin(f); let current=begun.session;
  for (const i of [0,1,2]) {
    const r=applyDuelOptionalUnitPaymentResourceCommandV3(current,'alice', {
      commandId:`duplicate-funding-${i}`,expectedVersion:current.commandSession.match.stateVersion,
      command:{type:'rune-energy',uid:f.rune(i).uid}});
    assert.equal(r.outcome.status,'applied'); current=r.session;
  }
  let r=applyDuelOptionalUnitPaymentResourceCommandV3(current,'alice', {
    commandId:'duplicate-power',expectedVersion:current.commandSession.match.stateVersion,
    command:{type:'rune-power',uid:f.rune(3).uid}});
  assert.equal(r.outcome.status,'applied'); current=r.session;
  const envelope={commandId:'duplicate-payment',expectedVersion:current.commandSession.match.stateVersion,
    command:{type:'pay-pending',paymentId:begun.outcome.paymentId}};
  const paid=applyDuelOptionalUnitPaymentResourceCommandV3(current,'alice',envelope);
  assert.equal(paid.outcome.status,'applied');
  assert.equal(inspectDuelOptionalUnitPaymentV3(paid.session).status,'pending');
  const originalEntry=f.services.optional.entry;
  f.services.optional.entry=request=>({...originalEntry(request),sourceCensus:'unknown'});
  const waiting=resumeDuelOptionalUnitPaymentV3(paid.session,'alice',{commandId:'retry-entry',
    expectedVersion:paid.session.commandSession.match.stateVersion,command:{cardUID:f.card.uid}});
  assert.deepEqual(waiting.outcome,{status:'blocked',reason:'unproven-entry'});
  const retry=applyDuelOptionalUnitPaymentResourceCommandV3(paid.session,'alice',envelope);
  assert.deepEqual(retry.outcome,paid.outcome);
  assert.equal(retry.duplicate,true);
  assert.equal(retry.persistRequired,false);
  assert.equal(retry.session,paid.session);
});
