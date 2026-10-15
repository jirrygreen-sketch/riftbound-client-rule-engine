import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelCommandSessionV2, adoptAdmittedDuelPlayingSessionV2,
  commitDuelPlayingMutationV2, commitDuelCommandMutationV2, applyDuelResourceCommandV2,
  channelDuelRunesV2, referenceDuelPhysicalCardV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  createDuelUnitPlaySessionV2,
  advanceDuelUnitCommandSessionV2,
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
  const programFingerprint = uid => `v3-program:${uid}`;
  let currentHead = match;
  const choice = createDuelOptionalPlayChoiceAuthorityV1({ readHead: () => currentHead,
    readSource: (head, actor, uid) => ({ matchId: head.matchId, actor, uid,
      cardId: head.physicalCardsByUID[uid].cardId,
      sourceEpoch: head.physicalCardsByUID[uid].zoneEpoch,
      sourceProgramFingerprint: programFingerprint(uid) }),
    nextOpaqueId: (() => { let n = 0; return () => `v3-choice-${++n}`; })() });
  const prompt = choice.issue({ actor: 'alice', commandId: 'unit-v3-play', expectedVersion: match.stateVersion, uid: card.uid });
  const receipt = choice.answer({ actor: 'alice', commandId: 'unit-v3-play', expectedVersion: match.stateVersion,
    choiceId: prompt.choiceId, optionId: decision === 'pay' ? prompt.payOptionId : prompt.declineOptionId });
  const entry = request => ({ matchId: request.matchId, stateVersion: request.stateVersion, eventSeq: request.eventSeq,
    actor: request.actor, uid: request.uid, cardId: request.cardId, sourceEpoch: request.sourceEpoch,
    baseLocationId: request.baseLocationId, programId: request.programId, sourceCensus: 'complete',
    sources: enumerateDuelPhaseSourceClosureCandidatesV2(request.match).map(candidate => ({ uid: candidate.uid,
      zoneEpoch: candidate.zoneEpoch, programId: candidate.uid === request.uid ? programFingerprint(candidate.uid) : `native:${candidate.cardId}`,
      disposition: 'known-no-effect' })), scopes: { play: 'clear', replacement: 'clear', static: 'clear',
      trigger: 'clear', pendingTasks: 'clear', chain: 'clear' } });
  const services = {
    programs: { getProgram: cardId => ({ programId: `native:${cardId}` }) },
    cost: resolver({ transactionId: 'unused', cardId: card.cardId, actor: 'alice', uid: card.uid,
      sourceEpoch: match.physicalCardsByUID[card.uid].zoneEpoch, choice: decision, description, receipt: {} }, { zero }),
    costBinding: request => ({ ...request, status: 'complete' }), entry,
    optional: { program: request => ({ matchId: request.matchId, dataVersion: request.dataVersion,
      catalogDigest: request.catalogDigest, actor: request.actor, uid: request.uid, cardId: request.cardId,
      sourceEpoch: request.sourceEpoch, programFingerprint: programFingerprint(request.uid), description }),
      inspectChoice: choice.inspectReceipt, cost: request => resolver(request, { zero }), costBinding: request => ({ ...request, status: 'complete' }), entry },
    optionalPaymentV3: { sourceAttestor: request => ({ matchId: request.match.matchId, actor: request.actor,
      paymentId: request.paymentId, sourceReference: { ...request.sourceReference }, sourceProofId: `v3-source:${request.paymentId}`,
      mode: 'current', sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID].zoneEpoch,
      ...(request.taskId ? { taskId: request.taskId, continuationId: request.continuationId } : {}) }) },
  };
  const action = createDuelUnitPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(match), services);
  return { action, card, receipt, services, match, choice,
    setHead: head => { currentHead = head; },
    rune: i => action.commandSession.match.resources.bases[0].baseRunes[i] };
}

function begin(f) {
  return beginDuelOptionalUnitPaymentV3(f.action, 'alice', { commandId: 'unit-v3-play', expectedVersion: f.match.stateVersion,
    command: { cardUID: f.card.uid, choiceReceipt: f.receipt } });
}

test('V3 pay choice is canonical pending, resource-funded, then enters ready once', () => {
  const f = fixture();
  const started = begin(f);
  assert.equal(started.outcome.status, 'pending');
  assert.equal(started.session.commandSession.match.frame.pendingPayment.resolvedCost.energy, 3);
  assert.equal(started.session.commandSession.match.frame.pendingPayment.resolvedCost.power[0].amount, 1);
  assert.equal(inspectDuelOptionalUnitPaymentV3(started.session).decision, 'pay');
  const insufficient = applyDuelOptionalUnitPaymentResourceCommandV3(started.session, 'alice', {
    commandId: 'pay-too-early', expectedVersion: started.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: started.outcome.paymentId } });
  assert.deepEqual(insufficient.outcome, { status: 'rejected', reason: 'payment-rejected' });
  let current = insufficient.session;
  for (const i of [0, 1, 2]) {
    const rune = f.rune(i);
    const result = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
      commandId: `v3-energy-${i}`, expectedVersion: current.commandSession.match.stateVersion,
      command: { type: 'rune-energy', uid: rune.uid } });
    assert.equal(result.outcome.status, 'applied');
    current = result.session;
  }
  const powerRune = f.rune(3);
  let result = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
    commandId: 'v3-power', expectedVersion: current.commandSession.match.stateVersion,
    command: { type: 'rune-power', uid: powerRune.uid } });
  assert.equal(result.outcome.status, 'applied'); current = result.session;
  result = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
    commandId: 'v3-pay', expectedVersion: current.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: started.outcome.paymentId } });
  assert.equal(result.outcome.status, 'applied');
  assert.equal(result.session.commandSession.match.frame.pendingPayment, null);
  const resumed = resumeDuelOptionalUnitPaymentV3(result.session, 'alice', {
    commandId: 'v3-resume', expectedVersion: result.session.commandSession.match.stateVersion,
    command: { cardUID: f.card.uid } });
  assert.equal(resumed.outcome.status, 'applied');
  assert.equal(resumed.session.commandSession.match.board.units.length, 1);
  assert.equal(resumed.session.commandSession.match.unitMeta[f.card.uid].readied, true);
  const duplicate = resumeDuelOptionalUnitPaymentV3(resumed.session, 'alice', {
    commandId: 'v3-resume', expectedVersion: resumed.session.commandSession.match.stateVersion - 1,
    command: { cardUID: f.card.uid } });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.outcome, resumed.outcome);
});

test('V3 decline fixes the base cost and enters exhausted without a second choice', () => {
  const f = fixture({ decision: 'decline' });
  const started = begin(f);
  assert.equal(started.outcome.decision, 'decline');
  let current = started.session;
  for (const i of [0, 1]) {
    const rune = f.rune(i);
    const result = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
      commandId: `decline-energy-${i}`, expectedVersion: current.commandSession.match.stateVersion,
      command: { type: 'rune-energy', uid: rune.uid } });
    assert.equal(result.outcome.status, 'applied'); current = result.session;
  }
  const paid = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
    commandId: 'decline-pay', expectedVersion: current.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: started.outcome.paymentId } });
  assert.equal(paid.outcome.status, 'applied');
  const resumed = resumeDuelOptionalUnitPaymentV3(paid.session, 'alice', {
    commandId: 'decline-resume', expectedVersion: paid.session.commandSession.match.stateVersion,
    command: { cardUID: f.card.uid } });
  assert.equal(resumed.outcome.status, 'applied');
  assert.equal(resumed.session.commandSession.match.unitMeta[f.card.uid].readied, false);
});

test('V3 preserves pay when the trusted resolver reduces the final cost to zero', () => {
  const f = fixture({ zero: true });
  const started = begin(f);
  assert.equal(started.outcome.status, 'pending');
  assert.equal(started.session.commandSession.match.frame.pendingPayment.resolvedCost.energy, 0);
  assert.deepEqual(started.session.commandSession.match.frame.pendingPayment.resolvedCost.power, []);
  const paid = applyDuelOptionalUnitPaymentResourceCommandV3(started.session, 'alice', {
    commandId: 'v3-zero-pay', expectedVersion: started.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: started.outcome.paymentId } });
  assert.equal(paid.outcome.status, 'applied');
  const resumed = resumeDuelOptionalUnitPaymentV3(paid.session, 'alice', {
    commandId: 'v3-zero-resume', expectedVersion: paid.session.commandSession.match.stateVersion,
    command: { cardUID: f.card.uid } });
  assert.equal(resumed.outcome.status, 'applied');
  assert.equal(resumed.session.commandSession.match.unitMeta[f.card.uid].readied, true);
});

test('V3 rejects cloned choice, wrong actor, stale head and reentry while retaining pending', () => {
  const f = fixture();
  const cloned = beginDuelOptionalUnitPaymentV3(f.action, 'alice', { commandId: 'clone', expectedVersion: f.match.stateVersion,
    command: { cardUID: f.card.uid, choiceReceipt: structuredClone(f.receipt) } });
  assert.deepEqual(cloned.outcome, { status: 'blocked', reason: 'optional-choice-unproved' });
  const wrong = begin(f);
  assert.equal(wrong.outcome.status, 'pending');
  const wrongActor = applyDuelOptionalUnitPaymentResourceCommandV3(wrong.session, 'bob', {
    commandId: 'wrong-actor', expectedVersion: wrong.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: wrong.outcome.paymentId } });
  assert.deepEqual(wrongActor.outcome, { status: 'rejected', reason: 'no-permission' });
  const stale = resumeDuelOptionalUnitPaymentV3(wrongActor.session, 'alice', {
    commandId: 'stale-resume', expectedVersion: wrongActor.session.commandSession.match.stateVersion - 1,
    command: { cardUID: f.card.uid } });
  assert.deepEqual(stale.outcome, { status: 'rejected', reason: 'stale-version' });
  assert.notEqual(wrong.session.commandSession.match.frame.pendingPayment, null);
});

test('V3 keeps a paid payment closed when the current entry closure is unproved', () => {
  const f = fixture();
  const started = begin(f);
  f.services.optional.entry = () => ({
    matchId: f.match.matchId, stateVersion: started.session.commandSession.match.stateVersion,
    eventSeq: started.session.commandSession.match.eventSeq, actor: 'alice', uid: f.card.uid,
    cardId: f.card.cardId, sourceEpoch: 0, baseLocationId: 'wrong-base', programId: 'wrong',
    sourceCensus: 'unknown', sources: [], scopes: { play: 'unknown', replacement: 'clear', static: 'clear',
      trigger: 'clear', pendingTasks: 'clear', chain: 'clear' },
  });
  const paid = applyDuelOptionalUnitPaymentResourceCommandV3(started.session, 'alice', {
    commandId: 'v3-decline-pay', expectedVersion: started.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: started.outcome.paymentId } });
  assert.equal(paid.outcome.status, 'rejected');
  // The entry service is not consulted by payment; close it with real Rune commands first.
  let current = paid.session;
  for (const i of [0, 1, 2]) {
    const result = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
      commandId: `v3-entry-energy-${i}`, expectedVersion: current.commandSession.match.stateVersion,
      command: { type: 'rune-energy', uid: f.rune(i).uid } });
    assert.equal(result.outcome.status, 'applied'); current = result.session;
  }
  const power = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
    commandId: 'v3-entry-power', expectedVersion: current.commandSession.match.stateVersion,
    command: { type: 'rune-power', uid: f.rune(3).uid } });
  assert.equal(power.outcome.status, 'applied'); current = power.session;
  const closed = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
    commandId: 'v3-entry-paid', expectedVersion: current.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: started.outcome.paymentId } });
  assert.equal(closed.outcome.status, 'applied');
  const resume = resumeDuelOptionalUnitPaymentV3(closed.session, 'alice', {
    commandId: 'v3-entry-resume', expectedVersion: closed.session.commandSession.match.stateVersion,
    command: { cardUID: f.card.uid } });
  assert.deepEqual(resume.outcome, { status: 'blocked', reason: 'unproven-entry' });
  assert.equal(resume.session.commandSession.match.board.units.length, 0);
  assert.equal(resume.session.commandSession.match.frame.pendingPayment, null);
});

test('V3 poisons and rejects a reentrant program authority before installing payment', () => {
  const f = fixture();
  const originalProgram = f.services.optional.program;
  f.services.optional.program = request => {
    const nested = beginDuelOptionalUnitPaymentV3(f.action, 'alice', {
      commandId: 'nested-v3-play', expectedVersion: f.match.stateVersion,
      command: { cardUID: f.card.uid, choiceReceipt: f.receipt },
    });
    assert.deepEqual(nested.outcome, { status: 'blocked', reason: 'reentrant-command' });
    return originalProgram(request);
  };
  const result = begin(f);
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'source-or-entry-unproved' });
  assert.equal(result.session.commandSession.match.frame.pendingPayment, null);
  assert.equal(result.session.commandSession.match.players[0].hand.some(card => card.uid === f.card.uid), true);
});

test('V3 resume uses the shared actor command namespace and records an idempotent ACK', () => {
  const f = fixture();
  const started = begin(f);
  let current = started.session;
  for (const i of [0, 1, 2]) {
    const result = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
      commandId: `namespace-energy-${i}`, expectedVersion: current.commandSession.match.stateVersion,
      command: { type: 'rune-energy', uid: f.rune(i).uid },
    });
    assert.equal(result.outcome.status, 'applied');
    current = result.session;
  }
  const power = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
    commandId: 'namespace-power', expectedVersion: current.commandSession.match.stateVersion,
    command: { type: 'rune-power', uid: f.rune(3).uid },
  });
  assert.equal(power.outcome.status, 'applied');
  current = power.session;
  const closed = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
    commandId: 'namespace-payment', expectedVersion: current.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: started.outcome.paymentId },
  });
  assert.equal(closed.outcome.status, 'applied');
  const reused = resumeDuelOptionalUnitPaymentV3(closed.session, 'alice', {
    commandId: 'unit-v3-play', expectedVersion: closed.session.commandSession.match.stateVersion,
    command: { cardUID: f.card.uid },
  });
  assert.deepEqual(reused.outcome, { status: 'rejected', reason: 'command-conflict' });
  assert.equal(reused.duplicate, false);
  assert.equal(reused.session.commandSession.match.board.units.length, 0);

  const resumed = resumeDuelOptionalUnitPaymentV3(closed.session, 'alice', {
    commandId: 'namespace-resume', expectedVersion: closed.session.commandSession.match.stateVersion,
    command: { cardUID: f.card.uid },
  });
  assert.equal(resumed.outcome.status, 'applied');
  const duplicate = resumeDuelOptionalUnitPaymentV3(resumed.session, 'alice', {
    commandId: 'namespace-resume', expectedVersion: resumed.session.commandSession.match.stateVersion - 1,
    command: { cardUID: f.card.uid },
  });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.outcome, resumed.outcome);
  assert.equal(duplicate.session.commandSession.match.board.units.length, 1);
});

test('V3 completed continuation permits a second optional Unit with a fresh choice and receipt', () => {
  const f = fixture({ decision: 'decline', energy: 4 });
  const started = begin(f);
  let current = started.session;
  for (const i of [0, 1]) {
    const result = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
      commandId: `second-first-energy-${i}`, expectedVersion: current.commandSession.match.stateVersion,
      command: { type: 'rune-energy', uid: f.rune(i).uid },
    });
    assert.equal(result.outcome.status, 'applied');
    current = result.session;
  }
  const firstPaid = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
    commandId: 'second-first-payment', expectedVersion: current.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: started.outcome.paymentId },
  });
  assert.equal(firstPaid.outcome.status, 'applied');
  const firstResumed = resumeDuelOptionalUnitPaymentV3(firstPaid.session, 'alice', {
    commandId: 'second-first-resume', expectedVersion: firstPaid.session.commandSession.match.stateVersion,
    command: { cardUID: f.card.uid },
  });
  assert.equal(firstResumed.outcome.status, 'applied');

  const nextMatch = firstResumed.session.commandSession.match;
  f.setHead(nextMatch);
  const secondCard = nextMatch.players[0].hand[0];
  const secondPrompt = f.choice.issue({ actor: 'alice', commandId: 'second-play',
    expectedVersion: nextMatch.stateVersion, uid: secondCard.uid });
  const secondReceipt = f.choice.answer({ actor: 'alice', commandId: 'second-play',
    expectedVersion: nextMatch.stateVersion, choiceId: secondPrompt.choiceId,
    optionId: secondPrompt.declineOptionId });
  const secondStarted = beginDuelOptionalUnitPaymentV3(firstResumed.session, 'alice', {
    commandId: 'second-play', expectedVersion: nextMatch.stateVersion,
    command: { cardUID: secondCard.uid, choiceReceipt: secondReceipt },
  });
  assert.equal(secondStarted.outcome.status, 'pending');
  assert.equal(secondStarted.outcome.decision, 'decline');
  current = secondStarted.session;
  for (const i of [0, 1]) {
    const rune = current.commandSession.match.resources.bases[0].baseRunes.find(item => item.readied);
    assert.ok(rune);
    const result = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
      commandId: `second-second-energy-${i}`, expectedVersion: current.commandSession.match.stateVersion,
      command: { type: 'rune-energy', uid: rune.uid },
    });
    assert.equal(result.outcome.status, 'applied');
    current = result.session;
  }
  const secondPaid = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
    commandId: 'second-second-payment', expectedVersion: current.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: secondStarted.outcome.paymentId },
  });
  assert.equal(secondPaid.outcome.status, 'applied');
  const secondResumed = resumeDuelOptionalUnitPaymentV3(secondPaid.session, 'alice', {
    commandId: 'second-second-resume', expectedVersion: secondPaid.session.commandSession.match.stateVersion,
    command: { cardUID: secondCard.uid },
  });
  assert.equal(secondResumed.outcome.status, 'applied');
  assert.equal(secondResumed.session.commandSession.match.board.units.length, 2);
  assert.equal(secondResumed.session.commandSession.match.unitMeta[secondCard.uid].readied, false);
  const oldBegin = beginDuelOptionalUnitPaymentV3(secondResumed.session, 'alice', {
    commandId: 'unit-v3-play', expectedVersion: f.match.stateVersion,
    command: { cardUID: f.card.uid, choiceReceipt: f.receipt },
  });
  assert.equal(oldBegin.duplicate, true);
  assert.deepEqual(oldBegin.outcome, started.outcome);
  const oldResume = resumeDuelOptionalUnitPaymentV3(secondResumed.session, 'alice', {
    commandId: 'second-first-resume', expectedVersion: firstPaid.session.commandSession.match.stateVersion,
    command: { cardUID: f.card.uid },
  });
  assert.equal(oldResume.duplicate, true);
  assert.deepEqual(oldResume.outcome, firstResumed.outcome);
});

test('V3 pending continuation rejects native handoff and competing Unit actions after payment closes', () => {
  const f = fixture();
  const started = begin(f);
  f.services.optional.entry = request => ({
    ...request,
    sourceCensus: 'unknown',
    sources: [],
    scopes: { play: 'unknown', replacement: 'clear', static: 'clear', trigger: 'clear',
      pendingTasks: 'clear', chain: 'clear' },
  });
  let current = started.session;
  for (const i of [0, 1, 2]) {
    const result = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
      commandId: `continuation-energy-${i}`, expectedVersion: current.commandSession.match.stateVersion,
      command: { type: 'rune-energy', uid: f.rune(i).uid },
    });
    assert.equal(result.outcome.status, 'applied');
    current = result.session;
  }
  const power = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
    commandId: 'continuation-power', expectedVersion: current.commandSession.match.stateVersion,
    command: { type: 'rune-power', uid: f.rune(3).uid },
  });
  assert.equal(power.outcome.status, 'applied');
  current = power.session;
  const closed = applyDuelOptionalUnitPaymentResourceCommandV3(current, 'alice', {
    commandId: 'continuation-payment', expectedVersion: current.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: started.outcome.paymentId },
  });
  assert.equal(closed.outcome.status, 'applied');
  assert.equal(inspectDuelOptionalUnitPaymentV3(closed.session)?.status, 'pending');

  const blockedResume = resumeDuelOptionalUnitPaymentV3(closed.session, 'alice', {
    commandId: 'continuation-entry', expectedVersion: closed.session.commandSession.match.stateVersion,
    command: { cardUID: f.card.uid },
  });
  assert.deepEqual(blockedResume.outcome, { status: 'blocked', reason: 'unproven-entry' });
  const blockedResource = applyDuelOptionalUnitPaymentResourceCommandV3(closed.session, 'alice', {
    commandId: 'continuation-after-payment', expectedVersion: closed.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: f.rune(0).uid },
  });
  assert.deepEqual(blockedResource.outcome, { status: 'blocked', reason: 'outstanding-task-or-session' });

  const external = commitDuelCommandMutationV2(closed.session.commandSession, draft => ({
    match: { ...draft, frame: { ...draft.frame, priorityPlayerId: 'bob', turnPlayerId: 'bob' } },
    transitions: [],
  })).session;
  assert.throws(() => advanceDuelUnitCommandSessionV2(closed.session, external), /pending optional Unit continuation/);
  assert.equal(inspectDuelOptionalUnitPaymentV3(closed.session)?.status, 'pending');
  assert.equal(closed.session.commandSession.match.frame.priorityPlayerId, 'alice');
});

