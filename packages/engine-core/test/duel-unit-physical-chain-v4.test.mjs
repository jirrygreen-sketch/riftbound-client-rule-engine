import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2,
  commitDuelCommandFrameV2, advanceDuelCommandSessionNativeV2 } from '../dist/duel/canonical-session-v2.js';
import { channelDuelRunesV2, commitDuelPlayingMutationV2,
  finalizeDuelPhysicalUnitFromChainV2, cancelDuelPhysicalUnitChainToHandV2 } from '../dist/duel/core-v2.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2 } from '../dist/duel/cost-resolver-v2.js';
import { createDuelPhaseSourceClosureRegistryV2,
  createDuelPhaseSourceClosureJournalV2,
  enumerateDuelPhaseSourceClosureCandidatesV2 } from '../dist/duel/phase-source-closure-v2.js';
import {
  createDuelPrintedUnitChainSessionV4, beginDuelPrintedUnitPhysicalChainV4,
  answerDuelPrintedUnitPhysicalChainV4, applyDuelPrintedUnitPhysicalChainResourceV4,
  resumeDuelPrintedUnitPhysicalChainV4, inspectDuelPrintedUnitPhysicalChainV4,
  cancelDuelPrintedUnitPhysicalChainV4,
} from '../dist/duel/cardplay-unit-chain-v4.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: 'fixture-accelerate' })),
  champion: { uid: `${playerId}-champion`, cardId: 'fixture-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'fixture-legend' },
  runeDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'fixture-rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
    cardId: `fixture-field-${playerId}-${i}` })),
}));
const metadata = { matchId: 'printed-unit-chain-v4-fixture', dataVersion: 'fixture-v1',
  catalogDigest: 'fixture-digest', roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const types = cardId => cardId === 'fixture-champion' ? 'Champion' : cardId === 'fixture-legend'
  ? 'Legend' : cardId === 'fixture-rune' ? 'Rune' : cardId.startsWith('fixture-field-') ? 'Battlefield' : 'Unit';
const runeCost = { energy: 1, power: [] };
function costAuthority(baseCost = runeCost) {
  const snapshot = request => ({ registryRevision: 'fixture-registry', catalogRevision: 'fixture-catalog',
    nonResourceCosts: 'none', base: { sourceUid: `base:${request.subjectId}`, sourceEpoch: 0, cost: baseCost },
    candidates: [], orderedModifiers: [] });
  const service = request => {
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
function scene(zeroAliceEnergy = false) {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, types);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(session, actor, { commandId: `mulligan-${actor}`,
      expectedVersion: session.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
    assert.equal(result.outcome.status, 'applied'); session = result.session;
  }
  const established = commitDuelPlayingMutationV2(session.match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates)
      .map(([uid, prior]) => [uid, { ...prior, readiness: 'ready' }])) }, transitions: [] }));
  session = advanceDuelCommandSessionNativeV2(session, established).session;
  const channeled = channelDuelRunesV2(session.match, 'alice', 1, true);
  session = advanceDuelCommandSessionNativeV2(session, channeled).session;
  const opened = commitDuelCommandFrameV2(session, { ...session.match.frame,
    phase: 'main', stateOpen: true, priorityPlayerId: 'alice', turnPlayerId: 'alice' },
    (before, proposed) => assert.equal(proposed.phase, 'main')).session;
  if (zeroAliceEnergy) {
    const drained = commitDuelPlayingMutationV2(opened.match, draft => ({ match: { ...draft,
      resources: { ...draft.resources, players: draft.resources.players.map(player =>
        player.playerId === 'alice' ? { ...player, runePool: { ...player.runePool, energy: 0 } } : player) },
    }, transitions: [] }));
    session = advanceDuelCommandSessionNativeV2(opened, drained).session;
  } else session = opened;
  return { session, uid: session.match.players.find(player => player.playerId === 'alice').hand[0].uid };
}
function harness(baseCost = runeCost, zeroAliceEnergy = false) {
  const created = scene(zeroAliceEnergy); let head = created.session.match;
  const attestationPhases = [];
  const programFingerprint = 'fixture-whole-accelerate-v4';
  const services = {
    programs: { getProgram: () => ({ programId: programFingerprint }) },
    program: request => ({ status: 'known', kind: 'Unit', cardId: request.cardId,
      programId: programFingerprint, programFingerprint, optionalCost: 'accelerate' }),
    cost: costAuthority(baseCost),
    costBinding: request => ({ ...request, status: 'complete' }),
    entry: request => ({ ...request, sourceCensus: 'complete', resolution: 'complete',
      scopes: { play: 'clear', replacement: 'clear', static: 'clear', trigger: 'clear', pendingTasks: 'clear', chain: 'clear' },
      sources: enumerateDuelPhaseSourceClosureCandidatesV2(request.match).map(source => ({
        uid: source.uid, zoneEpoch: source.zoneEpoch,
        programId: source.uid === request.uid ? request.programId : programFingerprint,
        disposition: 'known-no-effect' })) }),
    closure: (request, context) => {
      // Mechanism fixture: these empty protected ledgers are supplied by the
      // trusted test runtime, not a claim about official program coverage.
      const ledger = name => ({ status: 'empty', ledgerId: `fixture:${name}`, revision: 1,
        proofId: `fixture:${name}:proof`, matchId: context.matchId, dataVersion: context.dataVersion,
        catalogDigest: context.catalogDigest, turn: context.turn, taskId: context.taskId,
        clock: context.clock, entries: [] });
      const journal = createDuelPhaseSourceClosureJournalV2({ ...context,
        tokenReferences: [], preExitSources: [], drawSubjects: [], transitions: [],
        activeEffects: ledger('active'), chain: ledger('chain'),
        effectQueue: ledger('queue'), feprOutstanding: ledger('fepr') });
      const cardIds = [...new Set(request.match.provenance.originalPhysicalCards.map(card => card.cardId))];
      const registry = createDuelPhaseSourceClosureRegistryV2({
        matchId: context.matchId, dataVersion: context.dataVersion, catalogDigest: context.catalogDigest,
        printings: cardIds.map(cardId => ({ cardId, programReference: `fixture:${cardId}` })) },
      source => ({ status: 'complete', ...source.context, uid: source.source.uid, kind: source.source.kind,
        cardId: source.source.cardId, zoneEpoch: source.source.zoneEpoch,
        controllerPlayerId: source.source.controllerPlayerId, zone: source.source.zone,
        programReference: source.expectedProgramReference, referenceKind: source.referenceKind,
        proofId: `fixture:${source.source.uid}`, eventSupported: true, decision: 'inactive',
        coverage: { wholeProgram: true, zoneScope: 'whole-program', eventScope: 'whole-program',
          static: true, replacements: true, continuous: true, triggers: true } }));
      return { registry, journal };
    },
    sourceAttestor: request => ({ matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
      sourceReference: request.sourceReference, sourceProofId: `source:${request.paymentId}`,
      mode: 'current', sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID].zoneEpoch,
      ...(request.taskId ? { taskId: request.taskId } : {}), ...(request.continuationId ? { continuationId: request.continuationId } : {}) }),
    sourceAttestorV4: request => {
      attestationPhases.push(request.phase);
      return services.sourceAttestor(request);
    },
    isUnitPrinting: cardId => cardId === 'fixture-accelerate',
    choice: { readSource: (match, actor, uid) => ({ matchId: match.matchId, actor, uid,
      cardId: match.chainCards.find(card => card.uid === uid).cardId,
      sourceEpoch: match.physicalCardsByUID[uid].zoneEpoch, sourceProgramFingerprint: programFingerprint }),
      nextOpaqueId: (() => { let id = 0; return () => `v4-choice-${++id}`; })() },
  };
  let session = createDuelPrintedUnitChainSessionV4(created.session, services);
  return { created, services, attestationPhases, get session() { return session; }, set session(value) { session = value; }, uid: created.uid };
}

test('V4 closes State after Hand -> Chain and emits a physical Chain-head choice', () => {
  const h = harness();
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-v4', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  assert.equal(begun.outcome.status, 'choice'); h.session = begun.session;
  const match = h.session.commandSession.match;
  assert.equal(match.players[0].hand.some(card => card.uid === h.uid), false);
  assert.equal(match.chainCards.some(card => card.uid === h.uid), true);
  assert.equal(match.board.units.some(unit => unit.objectId === h.uid), false);
  assert.equal(match.frame.stateOpen, false);
  assert.equal(match.physicalCardsByUID[h.uid].zoneEpoch, 1);
  assert.equal(inspectDuelPrintedUnitPhysicalChainV4(h.session).phase, 'choice');
  assert.equal(beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'again', expectedVersion: match.stateVersion, command: { cardUID: h.uid } }).outcome.status, 'rejected');
});

test('V4 pay path uses a fixed nonzero cost, real resource payment, and one final exhausted entry', () => {
  const h = harness();
  let begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-v4', expectedVersion: h.session.commandSession.match.stateVersion, command: { cardUID: h.uid } });
  h.session = begun.session;
  const prompt = begun.outcome.prompt;
  const answered = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-v4', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { choiceId: prompt.choiceId, optionId: prompt.payOptionId } });
  assert.equal(answered.outcome.status, 'pending'); h.session = answered.session;
  assert.deepEqual(inspectDuelPrintedUnitPhysicalChainV4(h.session).fixedCost, runeCost);
  const funded = applyDuelPrintedUnitPhysicalChainResourceV4(h.session, 'alice',
    { commandId: 'fund-v4', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { type: 'rune-energy', uid: h.session.commandSession.match.resources.bases[0].baseRunes[0].uid } });
  assert.equal(funded.outcome.status, 'pending'); h.session = funded.session;
  const paid = applyDuelPrintedUnitPhysicalChainResourceV4(h.session, 'alice',
    { commandId: 'pay-v4', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { type: 'pay-pending', paymentId: answered.outcome.paymentId } });
  assert.equal(paid.outcome.status, 'paid'); h.session = paid.session;
  assert.deepEqual(h.attestationPhases, ['issue', 'prepare', 'pay']);
  const paidHead = h.session.commandSession.match;
  const finished = resumeDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'finish-v4', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  assert.equal(finished.outcome.status, 'applied'); h.session = finished.session;
  const match = h.session.commandSession.match;
  assert.equal(match.players[0].hand.some(card => card.uid === h.uid), false);
  assert.equal(match.chainCards.some(card => card.uid === h.uid), false);
  assert.equal(match.board.units.filter(unit => unit.objectId === h.uid).length, 1);
  assert.equal(match.unitMeta[h.uid].readied, true);
  assert.equal(match.frame.stateOpen, true);
  assert.equal(match.physicalCardsByUID[h.uid].zoneEpoch, 2);
  assert.equal(match.stateVersion, finished.outcome.appliedVersion);
  assert.throws(() => finalizeDuelPhysicalUnitFromChainV2(paidHead, h.uid, 'alice',
    paidHead.board.bases.find(base => base.ownerPlayerId === 'alice').locationId,
    'enter-ready', () => true), /already claimed/);
  assert.equal(resumeDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'finish-v4', expectedVersion: match.stateVersion, command: { cardUID: h.uid } }).duplicate, true);
  assert.equal(resumeDuelPrintedUnitPhysicalChainV4(h.session, 'bob',
    { commandId: 'finish-v4', expectedVersion: match.stateVersion, command: { cardUID: h.uid } }).outcome.status, 'blocked');
});

test('unknown entry closure and pre-choice resource commands remain blocked without birth', () => {
  const h = harness();
  h.services.entry = request => ({ ...request, sourceCensus: 'complete', resolution: 'unknown',
    scopes: { play: 'clear', replacement: 'unknown', static: 'clear', trigger: 'clear', pendingTasks: 'clear', chain: 'clear' },
    sources: enumerateDuelPhaseSourceClosureCandidatesV2(request.match).map(source => ({
      uid: source.uid, zoneEpoch: source.zoneEpoch, programId: 'fixture-whole-accelerate-v4',
      disposition: 'known-no-effect' })) });
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-v4', expectedVersion: h.session.commandSession.match.stateVersion, command: { cardUID: h.uid } });
  assert.equal(begun.outcome.status, 'choice'); h.session = begun.session;
  const before = h.session.commandSession.match;
  const blocked = applyDuelPrintedUnitPhysicalChainResourceV4(h.session, 'alice',
    { commandId: 'before-choice', expectedVersion: before.stateVersion, command: { type: 'rune-energy', uid: 'alice-rune-0' } });
  assert.equal(blocked.outcome.status, 'blocked');
  const prompt = begun.outcome.prompt;
  const answer = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-v4', expectedVersion: before.stateVersion, command: { choiceId: prompt.choiceId, optionId: prompt.declineOptionId } });
  assert.equal(answer.outcome.status, 'blocked');
  assert.equal(h.session.commandSession.match.board.units.some(unit => unit.objectId === h.uid), false);
});

test('decline enters exhausted while discounted-to-zero pay still enters ready', () => {
  for (const [decision, option, ready] of [['decline', 'declineOptionId', false],
    ['pay', 'payOptionId', true]]) {
    const h = harness({ energy: 0, power: [] });
    const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
      { commandId: `play-${decision}`, expectedVersion: h.session.commandSession.match.stateVersion,
        command: { cardUID: h.uid } });
    h.session = begun.session;
    const answered = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
      { commandId: `play-${decision}`, expectedVersion: h.session.commandSession.match.stateVersion,
        command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt[option] } });
    assert.equal(answered.outcome.status, 'pending'); h.session = answered.session;
    assert.equal(inspectDuelPrintedUnitPhysicalChainV4(h.session).decision, decision);
    const paid = applyDuelPrintedUnitPhysicalChainResourceV4(h.session, 'alice',
      { commandId: `pay-${decision}`, expectedVersion: h.session.commandSession.match.stateVersion,
        command: { type: 'pay-pending', paymentId: answered.outcome.paymentId } });
    assert.equal(paid.outcome.status, 'paid'); h.session = paid.session;
    const finished = resumeDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
      { commandId: `finish-${decision}`, expectedVersion: h.session.commandSession.match.stateVersion,
        command: { cardUID: h.uid } });
    assert.equal(finished.outcome.status, 'applied');
    assert.equal(finished.session.commandSession.match.unitMeta[h.uid].readied, ready);
  }
});

test('pre-payment cancellation returns the physical Unit through Core and paid cancellation blocks', () => {
  const h = harness();
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-cancel', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  h.session = begun.session;
  const cancelled = cancelDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'cancel', expectedVersion: h.session.commandSession.match.stateVersion });
  assert.equal(cancelled.outcome.status, 'cancelled');
  const match = cancelled.session.commandSession.match;
  assert.equal(match.players[0].hand.some(card => card.uid === h.uid), true);
  assert.equal(match.chainCards.some(card => card.uid === h.uid), false);
  assert.equal(match.board.units.some(unit => unit.objectId === h.uid), false);
  assert.equal(match.physicalCardsByUID[h.uid].zoneEpoch, 2);
  assert.equal(match.frame.stateOpen, true);
  assert.throws(() => inspectDuelPrintedUnitPhysicalChainV4(h.session), /spent/);
});

test('cancelled Chain epoch is tombstoned while the same physical Hand card may start a new epoch', () => {
  const h = harness();
  const staleSibling = createDuelPrintedUnitChainSessionV4(h.created.session, h.services);
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-epoch-round-1', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  assert.equal(begun.outcome.status, 'choice');
  h.session = begun.session;
  const staleChainHead = begun.session.commandSession.match;
  const cancelled = cancelDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'cancel-epoch-round-1', expectedVersion: h.session.commandSession.match.stateVersion });
  assert.equal(cancelled.outcome.status, 'cancelled');
  h.session = cancelled.session;
  assert.equal(h.session.commandSession.match.physicalCardsByUID[h.uid].zoneEpoch, 2);

  const restarted = createDuelPrintedUnitChainSessionV4(h.session.commandSession, h.services);
  const second = beginDuelPrintedUnitPhysicalChainV4(restarted, 'alice',
    { commandId: 'play-epoch-round-2', expectedVersion: restarted.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  assert.equal(second.outcome.status, 'choice');
  assert.equal(second.session.commandSession.match.physicalCardsByUID[h.uid].zoneEpoch, 3);

  const stale = beginDuelPrintedUnitPhysicalChainV4(staleSibling, 'alice',
    { commandId: 'play-stale-sibling', expectedVersion: staleSibling.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  assert.equal(stale.outcome.status, 'blocked');
  assert.throws(() => finalizeDuelPhysicalUnitFromChainV2(staleChainHead, h.uid, 'alice',
    staleChainHead.board.bases.find(base => base.ownerPlayerId === 'alice').locationId,
    'enter-ready', () => true), /Chain round already claimed/);
});

test('foreign protected journal, wrong actor, and clone cannot authorize entry or choice', () => {
  const h = harness();
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-journal', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  h.session = begun.session;
  const prompt = begun.outcome.prompt;
  assert.equal(answerDuelPrintedUnitPhysicalChainV4(h.session, 'bob',
    { commandId: 'play-journal', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { choiceId: prompt.choiceId, optionId: prompt.payOptionId } }).outcome.status, 'rejected');
  const closure = h.services.closure;
  h.services.closure = (request, context) => ({ ...closure(request, context), journal: {} });
  const answer = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-journal', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { choiceId: prompt.choiceId, optionId: prompt.payOptionId } });
  assert.equal(answer.outcome.status, 'blocked');
  assert.equal(h.session.commandSession.match.frame.pendingPayment, null);
  assert.throws(() => inspectDuelPrintedUnitPhysicalChainV4(structuredClone(h.session)), /unadmitted/);
});

test('choice provider throw after Chain close returns a held head and retries without a second transfer', () => {
  const h = harness();
  const reader = h.services.choice.readSource;
  let calls = 0;
  h.services.choice.readSource = (...args) => {
    if (++calls === 1) throw new Error('fixture callback failure');
    return reader(...args);
  };
  const originalVersion = h.session.commandSession.match.stateVersion;
  const first = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-throw', expectedVersion: originalVersion, command: { cardUID: h.uid } });
  assert.equal(first.outcome.status, 'blocked');
  assert.equal(first.persistRequired, true); h.session = first.session;
  assert.equal(h.session.commandSession.match.chainCards.filter(card => card.uid === h.uid).length, 1);
  assert.equal(h.session.commandSession.match.frame.stateOpen, false);
  const retry = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-throw', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  assert.equal(retry.outcome.status, 'choice');
  assert.equal(retry.session.commandSession.match.stateVersion, originalVersion + 2);
});

test('duplicate funding uses the canonical receipt and does not add resources twice', () => {
  const h = harness();
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-dup', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  h.session = begun.session;
  const answered = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-dup', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt.payOptionId } });
  h.session = answered.session;
  const envelope = { commandId: 'fund-dup', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: h.session.commandSession.match.resources.bases[0].baseRunes[0].uid } };
  const first = applyDuelPrintedUnitPhysicalChainResourceV4(h.session, 'alice', envelope);
  assert.equal(first.outcome.status, 'pending'); h.session = first.session;
  const version = h.session.commandSession.match.stateVersion;
  const second = applyDuelPrintedUnitPhysicalChainResourceV4(h.session, 'alice', envelope);
  assert.equal(second.duplicate, true);
  assert.equal(second.outcome.status, 'pending');
  assert.equal(second.session.commandSession.match.stateVersion, version);
  assert.equal(second.session.commandSession.match.resources.players[0].runePool.energy, 1);
});

test('resolved cost stays fixed after a transient binding failure', () => {
  const h = harness();
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-fixed', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  h.session = begun.session;
  const binding = h.services.costBinding; let calls = 0;
  h.services.costBinding = request => { if (++calls === 1) throw Error('transient binding failure'); return binding(request); };
  const envelope = { commandId: 'play-fixed', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt.payOptionId } };
  const first = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice', envelope);
  assert.equal(first.outcome.status, 'blocked');
  assert.deepEqual(inspectDuelPrintedUnitPhysicalChainV4(h.session).fixedCost, runeCost);
  assert.equal(h.session.commandSession.match.frame.pendingPayment, null);
  const retry = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice', envelope);
  assert.equal(retry.outcome.status, 'pending');
  assert.equal(calls, 2);
});

test('pre-exit attestation cannot impersonate a current Chain physical source', () => {
  const h = harness();
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-epoch', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  h.session = begun.session;
  const original = h.services.sourceAttestor;
  h.services.sourceAttestor = request => ({ ...original(request), mode: 'pre-exit', sourceZoneEpoch: 0 });
  const answered = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-epoch', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt.payOptionId } });
  assert.equal(answered.outcome.status, 'blocked');
  assert.equal(h.session.commandSession.match.frame.pendingPayment, null);
  assert.equal(h.session.commandSession.match.board.units.some(unit => unit.objectId === h.uid), false);
});

test('caught provider reentry poisons answer before task, payment, or birth', () => {
  const h = harness();
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-reentry', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  h.session = begun.session;
  const prompt = begun.outcome.prompt;
  const envelope = { commandId: 'play-reentry', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { choiceId: prompt.choiceId, optionId: prompt.payOptionId } };
  const entry = h.services.entry;
  h.services.entry = request => {
    const nested = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice', envelope);
    assert.equal(nested.outcome.reason, 'reentrant-command');
    return entry(request);
  };
  const answer = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice', envelope);
  assert.equal(answer.outcome.status, 'blocked');
  assert.equal(h.session.commandSession.match.frame.pendingPayment, null);
  assert.equal(h.session.commandSession.match.board.units.some(unit => unit.objectId === h.uid), false);
});

test('a sibling V4 wrapper cannot reserve the same physical Hand UID', () => {
  const h = harness();
  const sibling = createDuelPrintedUnitChainSessionV4(h.created.session, h.services);
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-owner', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  assert.equal(begun.outcome.status, 'choice');
  const denied = beginDuelPrintedUnitPhysicalChainV4(sibling, 'alice',
    { commandId: 'play-sibling', expectedVersion: sibling.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  assert.equal(denied.outcome.status, 'blocked');
  assert.equal(denied.session.commandSession.match.players[0].hand.some(card => card.uid === h.uid), true);
  assert.equal(begun.session.commandSession.match.chainCards.filter(card => card.uid === h.uid).length, 1);
});

test('unknown total cost leaves the Chain head without a payment task or board birth', () => {
  const h = harness();
  h.services.cost = createDuelCostResolverAuthorityV2(request => ({ request,
    base: { request, status: 'unknown', proofId: 'fixture-unknown-base', cost: runeCost,
      sourceUid: h.uid, sourceEpoch: 1, registryRevision: 'fixture', catalogRevision: 'fixture' },
    coverage: { request, status: 'unknown', proofId: 'fixture-unknown-coverage',
      allModifierSourcesCovered: false, choicesResolved: false, nonResourceCosts: 'unknown',
      registryRevision: 'fixture', catalogRevision: 'fixture',
      candidateSourcesFingerprint: 'fixture', resolvedChoicesFingerprint: 'fixture' },
    proofs: [], modifiers: [] }), () => { throw Error('unknown verified sources'); });
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-unknown-cost', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  h.session = begun.session;
  const answer = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-unknown-cost', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt.payOptionId } });
  assert.equal(answer.outcome.status, 'blocked');
  assert.equal(h.session.commandSession.requiredTasks.length, 0);
  assert.equal(h.session.commandSession.match.frame.pendingPayment, null);
  assert.equal(h.session.commandSession.match.chainCards.some(card => card.uid === h.uid), true);
  assert.equal(h.session.commandSession.match.board.units.some(unit => unit.objectId === h.uid), false);
});

test('duplicate pay after settlement cannot debit or birth a second time', () => {
  const h = harness({ energy: 0, power: [] });
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-pay-dup', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  h.session = begun.session;
  const answered = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-pay-dup', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt.payOptionId } });
  h.session = answered.session;
  const envelope = { commandId: 'pay-dup', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: answered.outcome.paymentId } };
  const paid = applyDuelPrintedUnitPhysicalChainResourceV4(h.session, 'alice', envelope);
  assert.equal(paid.outcome.status, 'paid'); h.session = paid.session;
  const version = h.session.commandSession.match.stateVersion;
  const retry = applyDuelPrintedUnitPhysicalChainResourceV4(h.session, 'alice', envelope);
  assert.equal(retry.outcome.status, 'blocked');
  assert.equal(retry.session.commandSession.match.stateVersion, version);
  assert.equal(retry.session.commandSession.match.board.units.some(unit => unit.objectId === h.uid), false);
});

test('trusted Chain cost factory receives the genuine choice receipt and retries transient failure', () => {
  const h = harness();
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-factory', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  h.session = begun.session;
  let calls = 0;
  let inspected = null;
  h.services.costForChain = request => {
    calls++;
    assert.equal(request.match, request.commandSession.match);
    assert.equal(request.match.frame.stateOpen, false);
    assert.equal(request.match.chainCards.filter(card => card.uid === h.uid).length, 1);
    assert.equal(request.choiceReceipt.decision, 'pay');
    inspected = request.inspectChoiceReceipt();
    assert.equal(inspected.uid, h.uid);
    assert.equal(inspected.sourceEpoch, request.sourceEpoch);
    assert.equal(inspected.decision, 'pay');
    if (calls === 1) throw new Error('transient factory failure');
    return costAuthority(runeCost);
  };
  const envelope = { commandId: 'play-factory', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt.payOptionId } };
  const first = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice', envelope);
  assert.equal(first.outcome.status, 'blocked');
  assert.equal(first.persistRequired, false);
  assert.equal(calls, 1);
  assert.equal(inspected.decision, 'pay');
  const retry = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice', envelope);
  assert.equal(retry.outcome.status, 'pending');
  assert.equal(calls, 2);
});

test('unknown Chain cost factory result stays retryable without issuing a payment task', () => {
  const h = harness();
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-factory-unknown', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  h.session = begun.session;
  let calls = 0;
  h.services.costForChain = request => {
    calls++;
    if (calls === 1) return createDuelCostResolverAuthorityV2(() => ({
      request,
      base: { request, status: 'unknown', proofId: 'factory-unknown-base', cost: runeCost,
        sourceUid: h.uid, sourceEpoch: request.sourceEpoch, registryRevision: 'fixture', catalogRevision: 'fixture' },
      coverage: { request, status: 'unknown', proofId: 'factory-unknown-coverage',
        allModifierSourcesCovered: false, choicesResolved: false, nonResourceCosts: 'unknown',
        registryRevision: 'fixture', catalogRevision: 'fixture', candidateSourcesFingerprint: 'fixture',
        resolvedChoicesFingerprint: 'fixture' }, proofs: [], modifiers: [] }),
      () => { throw Error('unknown verified sources'); });
    return costAuthority(runeCost);
  };
  const envelope = { commandId: 'play-factory-unknown', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt.payOptionId } };
  const first = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice', envelope);
  assert.equal(first.outcome.status, 'blocked');
  assert.equal(h.session.commandSession.requiredTasks.length, 0);
  assert.equal(h.session.commandSession.match.frame.pendingPayment, null);
  assert.equal(calls, 1);
  const retry = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice', envelope);
  assert.equal(retry.outcome.status, 'pending');
  assert.equal(calls, 2);
});

test('caught Chain cost factory reentry is rejected before task or payment issuance', () => {
  const h = harness();
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice',
    { commandId: 'play-factory-reentry', expectedVersion: h.session.commandSession.match.stateVersion,
      command: { cardUID: h.uid } });
  h.session = begun.session;
  const envelope = { commandId: 'play-factory-reentry', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt.payOptionId } };
  h.services.costForChain = request => {
    const nested = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice', envelope);
    assert.equal(nested.outcome.status, 'blocked');
    assert.equal(nested.outcome.reason, 'reentrant-command');
    return costAuthority(runeCost);
  };
  const answer = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice', envelope);
  assert.equal(answer.outcome.status, 'blocked');
  assert.equal(answer.outcome.reason, 'reentrant-command');
  assert.equal(h.session.commandSession.requiredTasks.length, 0);
  assert.equal(h.session.commandSession.match.frame.pendingPayment, null);
  assert.equal(h.session.commandSession.match.board.units.some(unit => unit.objectId === h.uid), false);
});



test('V4 constructor rejects a copied canonical session before claims or physical movement', () => {
  const h = harness();
  const before = h.created.session.match;
  assert.throws(() => createDuelPrintedUnitChainSessionV4(
    Object.freeze({ ...h.created.session }), h.services), /unadmitted|session|authority/i);
  assert.strictEqual(h.created.session.match, before);
  assert.equal(before.chainCards?.length ?? 0, 0);
  const genuine = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice', {
    commandId: 'parent-genuine-after-clone', expectedVersion: before.stateVersion,
    command: { cardUID: h.uid },
  });
  assert.equal(genuine.outcome.status, 'choice');
});


test('Core pre-payment cancellation consumes its exact Chain epoch once', () => {
  const h = harness();
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice', {
    commandId: 'parent-cancel-once', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { cardUID: h.uid },
  });
  const oldChain = begun.session.commandSession.match;
  const cancelled = cancelDuelPrintedUnitPhysicalChainV4(begun.session, 'alice', {
    commandId: 'parent-cancel-once-finish', expectedVersion: oldChain.stateVersion,
  });
  assert.equal(cancelled.outcome.status, 'cancelled');
  assert.throws(() => cancelDuelPhysicalUnitChainToHandV2(oldChain, h.uid, 'alice'), /already cancelled|finalized/);
});

test('underfunded V4 pay does not consume the wrapper and retries after funding on the same session', () => {
  const h = harness(runeCost, true);
  const begun = beginDuelPrintedUnitPhysicalChainV4(h.session, 'alice', {
    commandId: 'underfunded-retry', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { cardUID: h.uid },
  });
  assert.equal(begun.outcome.status, 'choice'); h.session = begun.session;
  const answered = answerDuelPrintedUnitPhysicalChainV4(h.session, 'alice', {
    commandId: 'underfunded-retry', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt.payOptionId },
  });
  assert.equal(answered.outcome.status, 'pending'); h.session = answered.session;
  const first = applyDuelPrintedUnitPhysicalChainResourceV4(h.session, 'alice', {
    commandId: 'underfunded-pay', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: answered.outcome.paymentId },
  });
  assert.equal(first.outcome.status, 'blocked');
  assert.equal(first.persistRequired, false);
  assert.strictEqual(first.session, h.session);
  const funded = applyDuelPrintedUnitPhysicalChainResourceV4(h.session, 'alice', {
    commandId: 'underfunded-fund', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: h.session.commandSession.match.resources.bases[0].baseRunes[0].uid },
  });
  assert.equal(funded.outcome.status, 'pending'); h.session = funded.session;
  const retried = applyDuelPrintedUnitPhysicalChainResourceV4(h.session, 'alice', {
    commandId: 'underfunded-pay', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: answered.outcome.paymentId },
  });
  assert.equal(retried.outcome.status, 'paid');
});
