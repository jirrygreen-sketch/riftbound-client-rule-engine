import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptAdmittedDuelPlayingSessionV2, commitDuelPlayingMutationV2,
  createDuelCommandSessionV2, createDuelUnitPlaySessionV2,
  playDuelOptionalUnitToBaseV2, applyDuelResourceCommandV2,
  createDuelOptionalPlayChoiceAuthorityV1,
  enumerateDuelPhaseSourceClosureCandidatesV2,
} from '../dist/duel/index.js';
import {
  createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2,
  fingerprintDuelCostModifierV2,
} from '../dist/duel/cost-resolver-v2.js';
import { restoreDuelResources } from '../dist/duel/resources.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: 'fixture-accelerate' })),
  champion: { uid: `${playerId}-champion`, cardId: 'fixture-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'fixture-legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'fixture-rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `field-${i}` })),
}));
const metadata = { matchId: 'optional-unit-core', dataVersion: 'fixture-v1', catalogDigest: 'fixture-digest',
  roster: seats.map(({ playerId }) => ({ playerId, displayName: playerId })) };
const cardTypes = cardId => cardId === 'fixture-champion' ? 'Champion' :
  cardId === 'fixture-legend' ? 'Legend' : cardId === 'fixture-rune' ? 'Rune' :
  cardId.startsWith('field-') ? 'Battlefield' : 'Unit';
const description = Object.freeze({ status: 'known', kind: 'optional-play-cost-v1', cardId: 'fixture-accelerate',
  canonicalCardId: 'fixture-accelerate', source: { normalizedAbilityText: '[Accelerate]', energy: 2,
    power: null, might: 2, domains: ['Fury'], tags: [] }, printedBaseCost: { energy: 2, power: null },
  semantics: { kind: 'accelerate', choiceTiming: 'card-play-choices', optional: true,
    additionalCost: { energy: 1, power: [{ allowedDomains: ['Fury'], amount: 1 }] },
    paidEffect: { kind: 'enter-ready-replacement', timing: 'unit-entry' } } });

function makeScene({ energy = 4, fury = 2, decision = 'pay', zeroAfterDiscount = false,
  entrySources = 'target', descriptionOverride = description } = {}) {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, cardTypes);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(session, actor, { commandId: `mulligan-${actor}`,
      expectedVersion: session.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
    assert.equal(result.outcome.status, 'applied');
    session = result.session;
  }
  const card = session.match.players[0].hand[0];
  const locations = session.match.board.bases.map(base => ({ playerId: base.ownerPlayerId, locationId: base.locationId }));
  const rawResources = structuredClone(session.match.resources);
  rawResources.players[0].runePool.energy = energy;
  rawResources.players[0].runePool.power.Fury = fury;
  const playing = commitDuelPlayingMutationV2(session.match, draft => ({
    match: { ...draft, resources: restoreDuelResources(rawResources, locations),
      legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
        [uid, { ...state, readiness: 'ready' }])),
      frame: { ...draft.frame, phase: 'main', stateOpen: true, priorityPlayerId: 'alice', turnPlayerId: 'alice' } },
    transitions: [],
  }));
  const sourceFingerprint = `fingerprint:${card.uid}`;
  const choice = createDuelOptionalPlayChoiceAuthorityV1({ readHead: () => playing,
    readSource: (match, actor, uid) => ({ matchId: match.matchId, actor, uid,
      cardId: card.cardId, sourceEpoch: match.physicalCardsByUID[uid].zoneEpoch,
      sourceProgramFingerprint: sourceFingerprint }),
    nextOpaqueId: (() => { let n = 0; return () => `choice-${++n}`; })() });
  const prompt = choice.issue({ actor: 'alice', commandId: 'play-1',
    expectedVersion: playing.stateVersion, uid: card.uid });
  const receipt = choice.answer({ actor: 'alice', commandId: 'play-1',
    expectedVersion: playing.stateVersion, choiceId: prompt.choiceId,
    optionId: decision === 'pay' ? prompt.payOptionId : prompt.declineOptionId });
  const entry = request => ({ matchId: request.matchId, stateVersion: request.stateVersion,
    eventSeq: request.eventSeq, actor: request.actor, uid: request.uid, cardId: request.cardId,
    sourceEpoch: request.sourceEpoch, baseLocationId: request.baseLocationId,
    programId: sourceFingerprint, sourceCensus: 'complete', sources: entrySources === 'empty' ? [] :
      enumerateDuelPhaseSourceClosureCandidatesV2(request.match).map(candidate => ({ uid: candidate.uid,
        zoneEpoch: candidate.zoneEpoch, programId: candidate.uid === request.uid ? sourceFingerprint :
          `native:${candidate.cardId}`, disposition: 'known-no-effect' })),
    scopes: { play: 'clear', replacement: 'clear', static: 'clear', trigger: 'clear', pendingTasks: 'clear', chain: 'clear' } });
  const program = request => ({ matchId: request.matchId, dataVersion: request.dataVersion,
    catalogDigest: request.catalogDigest, actor: request.actor, uid: request.uid, cardId: request.cardId,
    sourceEpoch: request.sourceEpoch, programFingerprint: sourceFingerprint, description: descriptionOverride });
  const cost = request => {
    const modifier = { id: `accelerate:${request.uid}`, sourceProofId: `proof:${request.uid}`,
      stage: 'additional', target: { kind: 'new-component' }, operation: 'add', choice: request.choice === 'pay' ? 'chosen-optional' : undefined,
      cost: { energy: 1, power: [{ allowedDomains: ['Fury'], amount: 1 }] } };
    const discount = { id: `discount:${request.uid}`, sourceProofId: `discount-proof:${request.uid}`,
      stage: 'total-discount', target: { kind: 'total' }, operation: 'discount',
      reduction: { energy: { amount: 3 }, power: [{ requirementIndex: 0, amount: 1 }] } };
    const modifiers = request.choice === 'pay' ? zeroAfterDiscount ? [modifier, discount] : [modifier] : [];
    const candidate = { sourceUid: `optional:${request.uid}`, sourceEpoch: request.sourceEpoch,
      choice: request.choice === 'pay' ? 'chosen-optional' : 'declined-optional', modifierIds: modifiers.map(item => item.id) };
    const verified = { registryRevision: 'fixture-registry', catalogRevision: 'fixture-v1:fixture-digest',
      nonResourceCosts: 'none', base: { cost: { energy: 2, power: [] }, sourceUid: request.uid, sourceEpoch: request.sourceEpoch },
      candidates: [candidate], orderedModifiers: modifiers };
    const coverage = fingerprintDuelCostCoverageV2(verified);
    return createDuelCostResolverAuthorityV2(() => {
      const req = { transactionId: request.transactionId, subjectId: request.cardId, kind: 'card-play' };
      const proof = modifiers.map(item => ({ proofId: item.sourceProofId, modifierId: item.id,
        request: req, target: item.target, status: 'complete', applicability: 'applies',
        sourceUid: candidate.sourceUid, sourceEpoch: candidate.sourceEpoch, registryRevision: verified.registryRevision,
        catalogRevision: verified.catalogRevision, modifierFingerprint: fingerprintDuelCostModifierV2(req, item),
        candidateSourcesFingerprint: coverage.candidateSourcesFingerprint, resolvedChoicesFingerprint: coverage.resolvedChoicesFingerprint }));
      return { request: req, base: { cost: verified.base.cost, proofId: 'base-proof', status: 'complete', request: req,
        sourceUid: verified.base.sourceUid, sourceEpoch: verified.base.sourceEpoch, registryRevision: verified.registryRevision,
        catalogRevision: verified.catalogRevision }, coverage: { proofId: 'coverage-proof', status: 'complete', request: req,
        allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: 'none', registryRevision: verified.registryRevision,
        catalogRevision: verified.catalogRevision, ...coverage }, proofs: proof, modifiers };
    }, () => verified);
  };
  const services = { programs: { getProgram: cardId => ({ programId: `native:${cardId}` }) }, cost: cost({ transactionId: 'unused', cardId: card.cardId,
    actor: 'alice', uid: card.uid, sourceEpoch: playing.physicalCardsByUID[card.uid].zoneEpoch, choice: 'decline', description, receipt: {} }),
    costBinding: request => ({ ...request, status: 'complete' }), entry,
    optional: { program, costBinding: request => ({ ...request, status: 'complete' }),
      inspectChoice: choice.inspectReceipt, cost },
  };
  return { playing, card, services, receipt, sourceFingerprint, choice };
}

function play(fixture) {
  const session = createDuelUnitPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(fixture.playing), fixture.services);
  return playDuelOptionalUnitToBaseV2(session, 'alice', { commandId: 'play-1', expectedVersion: fixture.playing.stateVersion,
    command: { cardUID: fixture.card.uid, choiceReceipt: fixture.receipt } });
}

test('constructor, mulligan and Main provide an admitted optional Unit source', () => {
  const fixture = makeScene();
  assert.equal(fixture.playing.stage, 'playing');
  assert.equal(fixture.playing.frame.phase, 'main');
  assert.equal(fixture.playing.players[0].hand.some(card => card.uid === fixture.card.uid), true);
});

test('decline pays only base and enters exhausted; pay adds 1E+Fury and enters ready', () => {
  const declineFixture = makeScene({ decision: 'decline' });
  const decline = play(declineFixture);
  assert.deepEqual(decline.outcome.status, 'applied');
  assert.equal(decline.session.commandSession.match.unitMeta[decline.session.commandSession.match.board.units[0].objectId].readied, false);
  assert.equal(decline.session.commandSession.match.resources.players[0].runePool.energy, 2);
  assert.equal(decline.session.commandSession.match.resources.players[0].runePool.power.Fury, 2);
  const paid = play(makeScene());
  assert.deepEqual(paid.outcome.status, 'applied');
  assert.equal(paid.session.commandSession.match.unitMeta[paid.session.commandSession.match.board.units[0].objectId].readied, true);
  assert.equal(paid.session.commandSession.match.resources.players[0].runePool.energy, 1);
  assert.equal(paid.session.commandSession.match.resources.players[0].runePool.power.Fury, 1);
});

test('foreign or cloned choice receipt is blocked before cost/payment', () => {
  const fixture = makeScene();
  const session = createDuelUnitPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(fixture.playing), fixture.services);
  const result = playDuelOptionalUnitToBaseV2(session, 'alice', { commandId: 'play-1', expectedVersion: fixture.playing.stateVersion,
    command: { cardUID: fixture.card.uid, choiceReceipt: structuredClone(fixture.receipt) } });
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'optional-choice-unproved' });
  assert.equal(result.session.commandSession.match.players[0].hand.some(c => c.uid === fixture.card.uid), true);
});

test('missing choice, wrong actor and stale command cannot move the Unit', () => {
  const fixture = makeScene();
  const session = createDuelUnitPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(fixture.playing), fixture.services);
  const envelope = { commandId: 'play-1', expectedVersion: fixture.playing.stateVersion,
    command: { cardUID: fixture.card.uid, choiceReceipt: fixture.receipt } };
  assert.deepEqual(playDuelOptionalUnitToBaseV2(session, 'alice', { ...envelope,
    command: { cardUID: fixture.card.uid } }).outcome,
  { status: 'rejected', reason: 'invalid-command' });
  const wrongActor = playDuelOptionalUnitToBaseV2(session, 'bob', envelope);
  assert.deepEqual(wrongActor.outcome, { status: 'rejected', reason: 'no-permission' });
  assert.deepEqual(playDuelOptionalUnitToBaseV2(wrongActor.session, 'alice', {
    ...envelope, expectedVersion: fixture.playing.stateVersion - 1 }).outcome,
  { status: 'rejected', reason: 'stale-version' });
  assert.equal(session.commandSession.match.players[0].hand.some(card => card.uid === fixture.card.uid), true);
});

test('insufficient payment is atomic and never silently declines', () => {
  const fixture = makeScene({ energy: 0, fury: 0 });
  const result = play(fixture);
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'cost-or-payment-unproved' });
  assert.equal(result.session.commandSession.match.players[0].hand.some(c => c.uid === fixture.card.uid), true);
  assert.equal(result.session.commandSession.match.stateVersion, fixture.playing.stateVersion);
});

test('zero resolved cost after discount still enters ready because pay was selected', () => {
  const result = play(makeScene({ energy: 0, fury: 0, zeroAfterDiscount: true }));
  assert.equal(result.outcome.status, 'applied');
  assert.equal(result.session.commandSession.match.unitMeta[result.session.commandSession.match.board.units[0].objectId].readied, true);
  assert.equal(result.session.commandSession.match.resources.players[0].runePool.energy, 0);
});

test('duplicate optional Unit command replays one ACK; changed payload conflicts', () => {
  const fixture = makeScene();
  const result = play(fixture);
  assert.equal(result.outcome.status, 'applied');
  const envelope = { commandId: 'play-1', expectedVersion: fixture.playing.stateVersion,
    command: { cardUID: fixture.card.uid, choiceReceipt: fixture.receipt } };
  const duplicate = playDuelOptionalUnitToBaseV2(result.session, 'alice', envelope);
  assert.equal(duplicate.duplicate, true);
  assert.strictEqual(duplicate.session, result.session);
  assert.deepEqual(duplicate.outcome, result.outcome);
  const conflict = playDuelOptionalUnitToBaseV2(result.session, 'alice', {
    ...envelope, command: { ...envelope.command, paymentPlan: { power: [] } } });
  assert.deepEqual(conflict.outcome, { status: 'rejected', reason: 'command-conflict' });
});

test('optional entry census must include the actual Hand candidate', () => {
  const fixture = makeScene({ entrySources: 'empty' });
  const result = play(fixture);
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'source-or-entry-unproved' });
  assert.equal(result.session.commandSession.match.players[0].hand.some(card => card.uid === fixture.card.uid), true);
});

test('optional receipt duplicate rejects a receipt from another authority', () => {
  const first = makeScene();
  const applied = play(first);
  assert.equal(applied.outcome.status, 'applied');
  const foreign = makeScene();
  const duplicate = playDuelOptionalUnitToBaseV2(applied.session, 'alice', {
    commandId: 'play-1', expectedVersion: first.playing.stateVersion,
    command: { cardUID: first.card.uid, choiceReceipt: foreign.receipt },
  });
  assert.deepEqual(duplicate.outcome, { status: 'rejected', reason: 'command-conflict' });
  assert.equal(duplicate.duplicate, false);
});

test('optional program binds the paid replacement to unit-entry timing', () => {
  const malformed = structuredClone(description);
  malformed.semantics.paidEffect.timing = 'after-entry';
  const fixture = makeScene({ descriptionOverride: malformed });
  const result = play(fixture);
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'source-or-entry-unproved' });
  assert.equal(result.session.commandSession.match.players[0].hand.some(card => card.uid === fixture.card.uid), true);
});

test('nested optional descriptor access fails closed before cost or mutation', () => {
  const fixture = makeScene();
  let accessed = false;
  const malformed = structuredClone(description);
  Object.defineProperty(malformed, 'semantics', { enumerable: true, get() {
    accessed = true;
    throw new Error('nested getter');
  } });
  assert.equal(fixture.services.optional.inspectChoice(fixture.receipt).decision, 'pay');
  fixture.services.optional.program = request => ({ matchId: request.matchId,
    dataVersion: request.dataVersion, catalogDigest: request.catalogDigest,
    actor: request.actor, uid: request.uid, cardId: request.cardId,
    sourceEpoch: request.sourceEpoch, programFingerprint: fixture.sourceFingerprint,
    description: malformed });
  const session = createDuelUnitPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(fixture.playing), fixture.services);
  const result = playDuelOptionalUnitToBaseV2(session, 'alice', { commandId: 'play-1',
    expectedVersion: fixture.playing.stateVersion,
    command: { cardUID: fixture.card.uid, choiceReceipt: fixture.receipt } });
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'source-or-entry-unproved' });
  assert.equal(accessed, true);
  assert.strictEqual(result.session.commandSession.match, fixture.playing);
});

test('a shared optional service cannot replay another authority receipt as the original ACK', () => {
  const first = makeScene();
  const second = makeScene();
  // Both genuine fixture authorities issue identical public choice data.
  // Opaque identity still distinguishes their independently issued receipts.
  const services = { ...first.services, optional: { ...first.services.optional,
    inspectChoice(receipt) {
      try { return first.choice.inspectReceipt(receipt); }
      catch { return second.choice.inspectReceipt(receipt); }
    }
  } };
  const run = fixture => playDuelOptionalUnitToBaseV2(
    createDuelUnitPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(fixture.playing), services),
    'alice', {commandId:'play-1',expectedVersion:fixture.playing.stateVersion,
      command:{cardUID:fixture.card.uid,choiceReceipt:fixture.receipt}});
  const original = run(first);
  const independentlyPaid = run(second);
  assert.equal(original.outcome.status, 'applied');
  assert.equal(independentlyPaid.outcome.status, 'applied');
  const head = original.session.commandSession.match;
  const rejected = playDuelOptionalUnitToBaseV2(original.session, 'alice', {
    commandId:'play-1',expectedVersion:first.playing.stateVersion,
    command:{cardUID:first.card.uid,choiceReceipt:second.receipt}});
  assert.deepEqual(rejected.outcome, {status:'rejected',reason:'command-conflict'});
  assert.equal(rejected.duplicate, false);
  assert.equal(rejected.session.commandSession.match, head);
  const legitimate = playDuelOptionalUnitToBaseV2(original.session, 'alice', {
    commandId:'play-1',expectedVersion:first.playing.stateVersion,
    command:{cardUID:first.card.uid,choiceReceipt:first.receipt}});
  assert.equal(legitimate.duplicate, true);
  assert.equal(legitimate.outcome, original.outcome);
  assert.equal(legitimate.session.commandSession.match, head);
  assert.equal(head.board.units.length, 1);
});
