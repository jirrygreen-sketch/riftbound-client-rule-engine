import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2,
  commitDuelCommandFrameV2, advanceDuelCommandSessionNativeV2 } from '../dist/duel/canonical-session-v2.js';
import { channelDuelRunesV2, commitDuelPlayingMutationV2,
  finalizeDuelPhysicalGearFromChainV1 } from '../dist/duel/core-v2.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2 } from '../dist/duel/cost-resolver-v2.js';
import { createDuelPhaseSourceClosureRegistryV2, createDuelPhaseSourceClosureJournalV2,
  enumerateDuelPhaseSourceClosureCandidatesV2 } from '../dist/duel/phase-source-closure-v2.js';
import {
  createDuelPrintedGearChainSessionV1, beginDuelPrintedGearPhysicalChainV1,
  applyDuelPrintedGearPhysicalChainResourceV1, resumeDuelPrintedGearPhysicalChainV1,
  inspectDuelPrintedGearPhysicalChainV1, cancelDuelPrintedGearPhysicalChainV1,
} from '../dist/duel/cardplay-gear-v1.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: 'fixture-gear' })),
  champion: { uid: `${playerId}-champion`, cardId: 'fixture-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'fixture-legend' },
  runeDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'fixture-rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `fixture-field-${playerId}-${i}` })),
}));
const metadata = { matchId: 'printed-gear-chain-v1-fixture', dataVersion: 'fixture-v1', catalogDigest: 'fixture-digest',
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const types = cardId => cardId === 'fixture-champion' ? 'Champion' : cardId === 'fixture-legend' ? 'Legend' :
  cardId === 'fixture-rune' ? 'Rune' : cardId.startsWith('fixture-field-') ? 'Battlefield' : 'Gear';
const gearCost = { energy: 2, power: [] };

function costAuthority(baseCost = gearCost) {
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

function scene() {
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
  const channeled = channelDuelRunesV2(session.match, 'alice', 2, true);
  session = advanceDuelCommandSessionNativeV2(session, channeled).session;
  const opened = commitDuelCommandFrameV2(session, { ...session.match.frame,
    phase: 'main', stateOpen: true, priorityPlayerId: 'alice', turnPlayerId: 'alice' },
    (_before, proposed) => assert.equal(proposed.phase, 'main')).session;
  return { session: opened, uid: opened.match.players.find(player => player.playerId === 'alice').hand[0].uid };
}

function harness({ cost = gearCost, entry = null, program = null, closure = null } = {}) {
  const created = scene();
  const programFingerprint = 'fixture-whole-gear-v1';
  const services = {
    programs: { getProgram: () => ({ programId: programFingerprint }) },
    program: program ?? (request => ({ status: 'known', kind: 'Gear', cardId: request.cardId,
      programId: programFingerprint, programFingerprint })),
    cost: costAuthority(cost),
    costBinding: request => ({ ...request, status: 'complete' }),
    entry: entry ?? (request => ({ ...request, sourceCensus: 'complete', resolution: 'complete',
      scopes: { play: 'clear', replacement: 'clear', static: 'clear', trigger: 'clear', pendingTasks: 'clear', chain: 'clear' },
      sources: enumerateDuelPhaseSourceClosureCandidatesV2(request.match).map(source => ({
        uid: source.uid, zoneEpoch: source.zoneEpoch, programId: source.uid === request.uid ? request.programId : programFingerprint,
        disposition: 'known-no-effect' })) })),
    closure: closure ?? ((request, context) => {
      const ledger = name => ({ status: 'empty', ledgerId: `fixture:${name}`, revision: 1,
        proofId: `fixture:${name}:proof`, matchId: context.matchId, dataVersion: context.dataVersion,
        catalogDigest: context.catalogDigest, turn: context.turn, taskId: context.taskId, clock: context.clock, entries: [] });
      const journal = createDuelPhaseSourceClosureJournalV2({ ...context, tokenReferences: [], preExitSources: [],
        drawSubjects: [], transitions: [], activeEffects: ledger('active'), chain: ledger('chain'),
        effectQueue: ledger('queue'), feprOutstanding: ledger('fepr') });
      const cardIds = [...new Set(request.match.provenance.originalPhysicalCards.map(card => card.cardId))];
      const registry = createDuelPhaseSourceClosureRegistryV2({ matchId: context.matchId,
        dataVersion: context.dataVersion, catalogDigest: context.catalogDigest,
        printings: cardIds.map(cardId => ({ cardId, programReference: `fixture:${cardId}` })) }, source => ({
          status: 'complete', ...source.context, uid: source.source.uid, kind: source.source.kind,
          cardId: source.source.cardId, zoneEpoch: source.source.zoneEpoch,
          controllerPlayerId: source.source.controllerPlayerId, zone: source.source.zone,
          programReference: source.expectedProgramReference, referenceKind: source.referenceKind,
          proofId: `fixture:${source.source.uid}`, eventSupported: true, decision: 'inactive',
          coverage: { wholeProgram: true, zoneScope: 'whole-program', eventScope: 'whole-program',
            static: true, replacements: true, continuous: true, triggers: true } }));
      return { registry, journal };
    }),
    sourceAttestor: request => ({ matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
      sourceReference: request.sourceReference, sourceProofId: `source:${request.paymentId}`, mode: 'current',
      sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID].zoneEpoch,
      ...(request.taskId ? { taskId: request.taskId } : {}), ...(request.continuationId ? { continuationId: request.continuationId } : {}) }),
    isGearPrinting: cardId => cardId === 'fixture-gear',
  };
  let session = createDuelPrintedGearChainSessionV1(created.session, services);
  return { created, services, get session() { return session; }, set session(value) { session = value; }, uid: created.uid,
    programFingerprint };
}

function start(h, commandId = 'play-gear') {
  const result = beginDuelPrintedGearPhysicalChainV1(h.session, 'alice', {
    commandId, expectedVersion: h.session.commandSession.match.stateVersion, command: { cardUID: h.uid } });
  h.session = result.session; return result;
}
function pay(h, pending, commandId = 'pay-gear') {
  const result = applyDuelPrintedGearPhysicalChainResourceV1(h.session, 'alice', {
    commandId, expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: pending.outcome.paymentId } });
  h.session = result.session; return result;
}

test('non-Unit Gear Chain play pays printed cost and enters Ready on own Base exactly once', () => {
  const h = harness();
  const begun = start(h);
  assert.equal(begun.outcome.status, 'pending');
  const chain = h.session.commandSession.match;
  assert.equal(chain.frame.stateOpen, false);
  assert.equal(chain.players[0].hand.some(card => card.uid === h.uid), false);
  assert.equal(chain.chainCards.filter(card => card.uid === h.uid).length, 1);
  assert.equal(chain.physicalCardsByUID[h.uid].zoneEpoch, 1);
  const funded = applyDuelPrintedGearPhysicalChainResourceV1(h.session, 'alice', {
    commandId: 'fund-gear', expectedVersion: chain.stateVersion,
    command: { type: 'rune-energy', uid: chain.resources.bases[0].baseRunes[0].uid } });
  assert.equal(funded.outcome.status, 'pending'); h.session = funded.session;
  const fundedAgain = applyDuelPrintedGearPhysicalChainResourceV1(h.session, 'alice', {
    commandId: 'fund-gear-again', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: h.session.commandSession.match.resources.bases[0].baseRunes[1].uid } });
  assert.equal(fundedAgain.outcome.status, 'pending'); h.session = fundedAgain.session;
  const paid = pay(h, begun);
  assert.equal(paid.outcome.status, 'paid');
  const finished = resumeDuelPrintedGearPhysicalChainV1(h.session, 'alice', {
    commandId: 'finish-gear', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { cardUID: h.uid } });
  assert.equal(finished.outcome.status, 'applied'); h.session = finished.session;
  const match = h.session.commandSession.match;
  const gear = match.gears.filter(item => item.uid === h.uid);
  assert.equal(gear.length, 1); assert.equal(gear[0].readied, true);
  assert.equal(gear[0].attachedToUID, null);
  assert.equal(gear[0].locationId, match.board.bases.find(base => base.ownerPlayerId === 'alice').locationId);
  assert.equal(match.chainCards.some(card => card.uid === h.uid), false);
  assert.equal(match.physicalCardsByUID[h.uid].zoneEpoch, 2);
  assert.equal(resumeDuelPrintedGearPhysicalChainV1(h.session, 'alice', {
    commandId: 'finish-gear', expectedVersion: match.stateVersion, command: { cardUID: h.uid } }).duplicate, true);
  assert.throws(() => finalizeDuelPhysicalGearFromChainV1(
    paid.session.commandSession.match, h.uid, 'alice', gear[0].locationId, () => true), /already claimed/);
});

test('underfunded pay is retryable after funding and does not consume the Gear wrapper', () => {
  const h = harness(); const begun = start(h);
  const underfunded = pay(h, begun, 'pay-underfunded');
  assert.equal(underfunded.outcome.status, 'blocked');
  assert.equal(inspectDuelPrintedGearPhysicalChainV1(h.session).phase, 'payment');
  const fund = applyDuelPrintedGearPhysicalChainResourceV1(h.session, 'alice', {
    commandId: 'fund-after-underfunded', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: h.session.commandSession.match.resources.bases[0].baseRunes[0].uid } });
  assert.equal(fund.outcome.status, 'pending'); h.session = fund.session;
  const fundAgain = applyDuelPrintedGearPhysicalChainResourceV1(h.session, 'alice', {
    commandId: 'fund-after-underfunded-again', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: h.session.commandSession.match.resources.bases[0].baseRunes[1].uid } });
  assert.equal(fundAgain.outcome.status, 'pending'); h.session = fundAgain.session;
  const paid = pay(h, begun, 'pay-after-funding');
  assert.equal(paid.outcome.status, 'paid'); h.session = paid.session;
  const finished = resumeDuelPrintedGearPhysicalChainV1(h.session, 'alice', {
    commandId: 'finish-after-funding', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { cardUID: h.uid } });
  assert.equal(finished.outcome.status, 'applied');
  assert.equal(finished.session.commandSession.match.gears.filter(item => item.uid === h.uid).length, 1);
});

test('pre-payment cancel returns a cost-blocked Gear to Hand and paid cancel is blocked', () => {
  const h = harness();
  h.services.cost = createDuelCostResolverAuthorityV2(() => { throw Error('unknown cost'); }, () => {
    throw Error('unknown verified cost');
  });
  const begun = start(h);
  assert.deepEqual(begun.outcome, { status: 'blocked', reason: 'cost-or-payment-unproved' });
  const cancelled = cancelDuelPrintedGearPhysicalChainV1(h.session, 'alice', {
    commandId: 'cancel-gear', expectedVersion: h.session.commandSession.match.stateVersion });
  assert.equal(cancelled.outcome.status, 'cancelled'); h.session = cancelled.session;
  assert.equal(h.session.commandSession.match.players[0].hand.some(card => card.uid === h.uid), true);
  assert.equal(h.session.commandSession.match.gears.some(item => item.uid === h.uid), false);

  const h2 = harness(); const begun2 = start(h2); const fund = applyDuelPrintedGearPhysicalChainResourceV1(h2.session, 'alice', {
    commandId: 'fund-paid-cancel', expectedVersion: h2.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: h2.session.commandSession.match.resources.bases[0].baseRunes[0].uid } });
  h2.session = fund.session;
  const fund2 = applyDuelPrintedGearPhysicalChainResourceV1(h2.session, 'alice', {
    commandId: 'fund-paid-cancel-again', expectedVersion: h2.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: h2.session.commandSession.match.resources.bases[0].baseRunes[1].uid } });
  h2.session = fund2.session; const paid = pay(h2, begun2, 'pay-paid-cancel'); assert.equal(paid.outcome.status, 'paid'); h2.session = paid.session;
  assert.deepEqual(cancelDuelPrintedGearPhysicalChainV1(h2.session, 'alice', {
    commandId: 'cancel-after-paid', expectedVersion: h2.session.commandSession.match.stateVersion }).outcome,
    { status: 'blocked', reason: 'refund-unavailable' });
});

test('unknown Gear cost retries on the same closed Chain head without a second transfer', () => {
  const h = harness();
  h.services.cost = createDuelCostResolverAuthorityV2(() => { throw Error('unknown cost'); }, () => {
    throw Error('unknown verified cost');
  });
  const first = start(h, 'retry-gear');
  assert.equal(first.outcome.status, 'blocked');
  const blockedHead = h.session.commandSession.match;
  assert.equal(blockedHead.chainCards.filter(card => card.uid === h.uid).length, 1);
  h.services.cost = costAuthority(gearCost);
  const retry = start(h, 'retry-gear');
  assert.equal(retry.outcome.status, 'pending');
  assert.equal(retry.session.commandSession.match.chainCards.filter(card => card.uid === h.uid).length, 1);
  assert.equal(retry.session.commandSession.match.stateVersion, blockedHead.stateVersion + 1);
});

test('unknown whole source or cloned session cannot admit Gear', () => {
  const h = harness({ program: request => ({ status: 'unknown', kind: 'unknown', cardId: request.cardId,
    programId: 'unknown', programFingerprint: 'unknown' }) });
  const blocked = start(h);
  assert.deepEqual(blocked.outcome, { status: 'blocked', reason: 'source-or-entry-unproved' });
  assert.equal(h.session.commandSession.match.players[0].hand.some(card => card.uid === h.uid), true);
  assert.throws(() => inspectDuelPrintedGearPhysicalChainV1(structuredClone(h.session)), /unadmitted/);
});

test('Gear source is actor-bound and cannot be funded by another player', () => {
  const h = harness(); const begun = start(h);
  const wrong = applyDuelPrintedGearPhysicalChainResourceV1(h.session, 'bob', {
    commandId: 'bob-fund', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: h.session.commandSession.match.resources.bases[0].baseRunes[0].uid } });
  assert.equal(wrong.outcome.status, 'blocked');
  assert.equal(applyDuelPrintedGearPhysicalChainResourceV1(h.session, 'bob', {
    commandId: 'bob-pay', expectedVersion: h.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: begun.outcome.paymentId } }).outcome.status, 'blocked');
});

test('sibling wrapper, reentrant provider, and pre-exit source proof cannot birth Gear', () => {
  const h = harness();
  const sibling = createDuelPrintedGearChainSessionV1(h.created.session, h.services);
  const begun = start(h, 'owner-gear');
  assert.equal(begun.outcome.status, 'pending');
  const denied = beginDuelPrintedGearPhysicalChainV1(sibling, 'alice', {
    commandId: 'sibling-gear', expectedVersion: sibling.commandSession.match.stateVersion,
    command: { cardUID: h.uid } });
  assert.deepEqual(denied.outcome, { status: 'blocked', reason: 'outstanding-task-or-session' });

  const reentrant = harness();
  const originalProgram = reentrant.services.program;
  reentrant.services.program = request => {
    const nested = beginDuelPrintedGearPhysicalChainV1(reentrant.session, 'alice', {
      commandId: 'nested-gear', expectedVersion: reentrant.session.commandSession.match.stateVersion,
      command: { cardUID: reentrant.uid } });
    assert.deepEqual(nested.outcome, { status: 'blocked', reason: 'reentrant-command' });
    return originalProgram(request);
  };
  const poisoned = start(reentrant, 'outer-gear');
  assert.deepEqual(poisoned.outcome, { status: 'blocked', reason: 'reentrant-command' });
  assert.equal(reentrant.session.commandSession.match.players[0].hand.some(card => card.uid === reentrant.uid), true);

  const preExit = harness();
  const originalAttestor = preExit.services.sourceAttestor;
  preExit.services.sourceAttestor = request => ({ ...originalAttestor(request), mode: 'pre-exit', sourceZoneEpoch: 0 });
  const preExitResult = start(preExit, 'pre-exit-gear');
  assert.equal(preExitResult.outcome.status, 'blocked');
  assert.equal(preExit.session.commandSession.match.gears.some(item => item.uid === preExit.uid), false);
});


// Parent regression: a cancellation and a successful Gear entry have distinct terminal receipts.
test('cancelled Gear has an idempotent cancelled receipt and cannot report a successful entry',()=>{
  const h=harness();
  h.services.cost=createDuelCostResolverAuthorityV2(()=>{throw Error('unknown');},()=>{throw Error('unknown');});
  start(h);const commandId='cancel-terminal';
  const cancelled=cancelDuelPrintedGearPhysicalChainV1(h.session,'alice',{commandId,expectedVersion:h.session.commandSession.match.stateVersion});
  assert.equal(cancelled.outcome.status,'cancelled');h.session=cancelled.session;
  const head=h.session.commandSession.match;
  assert.equal(inspectDuelPrintedGearPhysicalChainV1(h.session).phase,'cancelled');
  const duplicate=cancelDuelPrintedGearPhysicalChainV1(h.session,'alice',{commandId,expectedVersion:head.stateVersion});
  assert.equal(duplicate.outcome.status,'cancelled');assert.equal(duplicate.duplicate,true);assert.equal(duplicate.persistRequired,false);assert.equal(duplicate.session,h.session);
  const resumed=resumeDuelPrintedGearPhysicalChainV1(h.session,'alice',{commandId,expectedVersion:head.stateVersion,command:{cardUID:h.uid}});
  assert.equal(resumed.outcome.status,'blocked');assert.equal(resumed.session.commandSession.match,head);
  assert.equal(head.gears.length,0);assert.equal(head.players[0].hand.some(c=>c.uid===h.uid),true);
  assert.equal(cancelDuelPrintedGearPhysicalChainV1(h.session,'bob',{commandId,expectedVersion:head.stateVersion}).outcome.status,'blocked');
});
