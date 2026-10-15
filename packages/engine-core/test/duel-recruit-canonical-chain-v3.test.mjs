import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelMatchV2, resolveDuelMulliganV2,
  beginDuelRecruitTokenOnChainV3, cancelDuelRecruitTokenOnChainV3,
  finalizeDuelRecruitTokenFromChainV3, inspectDuelRecruitTokenOnChainV3,
  inspectDuelCanonicalRecruitTokenChainV3, inspectDuelNativeCommitPathV2,
  inspectDuelNativeTokenHistoryV2, createDuelRecruitUnitV2,
  channelDuelRunesV2, commitDuelPlayingMutationV2, enumerateDuelObjectsV2,
  beginDuelRecruitTokenOnChainV2, cancelDuelRecruitTokenOnChainV2,
} from '../dist/duel/core-v2.js';
import { adoptAdmittedDuelPlayingSessionV2, applyDuelResourceCommandV2 } from
  '../dist/duel/canonical-session-v2.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2,
  fingerprintDuelCostModifierV2 } from '../dist/duel/cost-resolver-v2.js';
import { createDuelPhaseSourceClosureRegistryV2,
  createDuelPhaseSourceClosureJournalV2 } from '../dist/duel/phase-source-closure-v2.js';
import {
  createDuelRecruitTokenPlayV3, beginDuelRecruitTokenPlayV3,
  resumeDuelRecruitTokenPlayV3, cancelDuelRecruitTokenPlayV3,
  inspectDuelRecruitTokenPlayV3, applyDuelRecruitTokenResourceCommandV3,
} from '../dist/duel/token-play-v3.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-card-${i}`, cardId: 'plain-unit' })),
  champion: { uid: `${playerId}-champion`, cardId: 'plain-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'plain-legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'plain-rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `plain-field-${i}` })),
}));
const metadata = { matchId: 'recruit-canonical-chain-v3', dataVersion: 'fixture-v3', catalogDigest: 'digest-v3',
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const cardType = id => id === 'plain-champion' ? 'Champion' : id === 'plain-legend' ? 'Legend' :
  id === 'plain-rune' ? 'Rune' : id.startsWith('plain-field-') ? 'Battlefield' : 'Unit';
const sourceOracle = ({ match, request }) => ({ ...request, matchId: match.matchId,
  dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
  sourceProofId: `source:${request.sourceEffectId}` });
function playing() {
  let state = createDuelMatchV2(seats, metadata, () => 0, cardType);
  state = resolveDuelMulliganV2(state, 'alice', []);
  return resolveDuelMulliganV2(state, 'bob', []);
}
function requestFor(state, suffix = 'one') {
  const source = state.players[0].hand[0];
  const locationId = state.board.bases.find(base => base.ownerPlayerId === 'alice').locationId;
  return { kind: 'recruit', tokenUID: `recruit:v3:${suffix}`, sourceEffectId: `effect:v3:${suffix}`,
    eventId: `event:v3:${suffix}`, sourceUID: source.uid, sourceZoneEpoch: state.physicalCardsByUID[source.uid].zoneEpoch,
    sourceMode: 'current', effectControllerPlayerId: 'alice', controllerPlayerId: 'alice', locationId,
    readied: false, name: 'Recruit', baseMight: 1, tags: ['Recruit'] };
}

test('V3 begin admits a canonical Chain-born identity without a board birth or physical printing', () => {
  const before = playing();
  assert.throws(() => commitDuelPlayingMutationV2(before, draft => ({
    match: { ...draft, tokenChain: [] }, transitions: [],
  })), /ordinary mutation|canonical Recruit Chain/);
  const request = requestFor(before);
  const begun = beginDuelRecruitTokenOnChainV3(before, request, sourceOracle);
  const carrier = inspectDuelCanonicalRecruitTokenChainV3(begun.match);
  assert.equal(carrier.length, 1);
  assert.deepEqual({ uid: carrier[0].tokenUID, epoch: carrier[0].zoneEpoch, might: carrier[0].baseMight },
    { uid: request.tokenUID, epoch: null, might: 1 });
  assert.equal(carrier[0].birthStateVersion, begun.match.stateVersion,
    'canonical carrier clock is the native commit clock');
  assert.equal(begun.match.board.units.some(unit => unit.objectId === request.tokenUID), false);
  assert.equal(begun.match.physicalCardsByUID[request.tokenUID], undefined);
  assert.equal(inspectDuelRecruitTokenOnChainV3(begun.reservation).status, 'on-chain');
  assert.equal(inspectDuelNativeCommitPathV2(before, begun.match).length, 1);
  assert.equal(inspectDuelNativeCommitPathV2(before, begun.match)[0].tokenBirths.length, 0);
  assert.throws(() => commitDuelPlayingMutationV2(begun.match, draft => ({
    match: { ...draft, tokenChain: [] }, transitions: [],
  })), /ordinary mutation|canonical Recruit Chain/);
});

test('V3 finalize consumes the canonical carrier and records one genuine token birth', () => {
  const before = playing();
  const request = requestFor(before, 'finalize');
  const begun = beginDuelRecruitTokenOnChainV3(before, request, sourceOracle);
  const after = finalizeDuelRecruitTokenFromChainV3(begun.match, begun.reservation, sourceOracle);
  assert.equal(inspectDuelCanonicalRecruitTokenChainV3(after).length, 0);
  assert.equal(after.board.units.filter(unit => unit.objectId === request.tokenUID).length, 1);
  assert.equal(after.unitMeta[request.tokenUID].readied, false);
  const commits = inspectDuelNativeCommitPathV2(begun.match, after);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].tokenBirths.length, 1);
  assert.equal(commits[0].tokenBirths[0].tokenUID, request.tokenUID);
  assert.equal(inspectDuelNativeTokenHistoryV2(after).births.at(-1).sourceEffectId, request.sourceEffectId);
  assert.throws(() => finalizeDuelRecruitTokenFromChainV3(after, begun.reservation, sourceOracle), /finalized|busy/);
  assert.throws(() => createDuelRecruitUnitV2(begun.match, request, sourceOracle), /canonical Chain|reservation/);
});

test('V3 pre-payment cancel commits a canonical tombstone and rejects late finalize', () => {
  const before = playing();
  const request = requestFor(before, 'cancel');
  const begun = beginDuelRecruitTokenOnChainV3(before, request, sourceOracle);
  const cancelled = cancelDuelRecruitTokenOnChainV3(begun.match, begun.reservation);
  assert.equal(inspectDuelCanonicalRecruitTokenChainV3(cancelled.match).length, 0);
  assert.equal(inspectDuelRecruitTokenOnChainV3(begun.reservation).status, 'cancelled');
  assert.throws(() => finalizeDuelRecruitTokenFromChainV3(cancelled.match, begun.reservation, sourceOracle), /cancelled/);
  assert.throws(() => cancelDuelRecruitTokenOnChainV3(cancelled.match, begun.reservation), /cancelled/);
  assert.equal(cancelled.match.stateVersion, begun.match.stateVersion + 1);
});

test('V3 carrier is native-only and cloned state or reservation cannot authorize a birth', () => {
  const before = playing();
  const request = requestFor(before, 'clone');
  const begun = beginDuelRecruitTokenOnChainV3(before, request, sourceOracle);
  assert.throws(() => inspectDuelCanonicalRecruitTokenChainV3(structuredClone(begun.match)), /untrusted|admitted/);
  assert.throws(() => inspectDuelRecruitTokenOnChainV3(structuredClone(begun.reservation)), /unknown/);
});

function paymentSession() {
  let match = channelDuelRunesV2(playing(), 'alice', 1);
  match = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, old]) =>
      [uid, { ...old, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', stateOpen: true, priorityPlayerId: 'alice' },
  }, transitions: [] }));
  let session = adoptAdmittedDuelPlayingSessionV2(match);
  const rune = session.match.resources.bases.find(base => base.playerId === 'alice').baseRunes[0].uid;
  const funded = applyDuelResourceCommandV2(session, 'alice', { commandId: 'fund-v3',
    expectedVersion: session.match.stateVersion, command: { type: 'rune-energy', uid: rune } });
  assert.equal(funded.outcome.status, 'applied');
  match = commitDuelPlayingMutationV2(funded.session.match, draft => ({ match: { ...draft,
    frame: { ...draft.frame, phase: 'ending', stateOpen: false, priorityPlayerId: 'bob' },
  }, transitions: [] }));
  return adoptAdmittedDuelPlayingSessionV2(match);
}

// This fixture intentionally supplies synthetic source and whole-program witnesses. It tests
// coordinator mechanics and makes no claim about the official catalog or production journal.
function fixtureClosure(match, event) {
  const context = { matchId: match.matchId, dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest, turn: match.frame.turnNumber,
    taskId: `duel-v2:${match.matchId}:turn-${match.frame.turnNumber}:recruit:0`,
    phase: 'ending', event, clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq } };
  const ledger = name => ({ status: 'empty', ledgerId: `fixture:${name}`, revision: 0,
    proofId: `fixture:${name}:${match.stateVersion}`, matchId: context.matchId,
    dataVersion: context.dataVersion, catalogDigest: context.catalogDigest, turn: context.turn,
    taskId: context.taskId, clock: { ...context.clock }, entries: [] });
  const index = [...new Set(enumerateDuelObjectsV2(match).map(object => object.cardId)
    .filter(cardId => cardId !== null))].map(cardId => ({ cardId, programReference: `fixture:${cardId}` }));
  const registry = createDuelPhaseSourceClosureRegistryV2({ matchId: match.matchId,
    dataVersion: match.dataVersion, catalogDigest: match.catalogDigest, printings: index },
  ({ context: c, source, expectedProgramReference, referenceKind }) => ({
    status: 'complete', matchId: c.matchId, dataVersion: c.dataVersion,
    catalogDigest: c.catalogDigest, turn: c.turn, taskId: c.taskId, phase: c.phase,
    event: c.event, clock: { ...c.clock }, uid: source.uid, kind: source.kind,
    cardId: source.cardId, zoneEpoch: source.zoneEpoch,
    controllerPlayerId: source.controllerPlayerId, zone: { ...source.zone },
    programReference: expectedProgramReference, referenceKind,
    proofId: `fixture:${source.uid}:${event}`, eventSupported: true, decision: 'inactive',
    coverage: { wholeProgram: true, zoneScope: 'whole-program', eventScope: 'whole-program',
      static: true, replacements: true, continuous: true, triggers: true },
  }));
  const transition = match.provenance.transitions[0];
  const journal = createDuelPhaseSourceClosureJournalV2({ ...context,
    tokenReferences: [], preExitSources: [], drawSubjects: [],
    transitions: event === 'zone-transition' ? [{ eventId: 'fixture:channel', uid: transition.uid,
      from: transition.from, to: transition.to, fromZoneEpoch: 0, toZoneEpoch: 1,
      proofId: 'fixture:channel' }] : [],
    activeEffects: ledger('activeEffects'), chain: ledger('chain'),
    effectQueue: ledger('effectQueue'), feprOutstanding: ledger('feprOutstanding'),
  });
  return { context, registry, journal };
}

function fixtureCost(match, token, transactionId, unknownCoverage = false) {
  const request = { transactionId, subjectId: token.tokenUID, kind: 'card-play' };
  const base = { energy: 0, power: [] };
  const modifier = { id: 'fixture:increase', sourceProofId: 'fixture:modifier', stage: 'increase',
    operation: 'increase', target: { kind: 'new-component' }, cost: { energy: 1, power: [] } };
  const revision = { registryRevision: 'fixture:1', catalogRevision: match.catalogDigest };
  const snapshot = { ...revision, nonResourceCosts: 'none',
    base: { cost: base, sourceUid: token.sourceUID, sourceEpoch: token.sourceZoneEpoch },
    candidates: [{ sourceUid: token.sourceUID, sourceEpoch: token.sourceZoneEpoch,
      choice: 'mandatory', modifierIds: [modifier.id] }], orderedModifiers: [modifier] };
  const fingerprints = fingerprintDuelCostCoverageV2(snapshot);
  return createDuelCostResolverAuthorityV2(() => ({ request,
    base: { request, cost: base, status: 'complete', proofId: 'fixture:base',
      sourceUid: token.sourceUID, sourceEpoch: token.sourceZoneEpoch, ...revision },
    coverage: { request, proofId: 'fixture:coverage', status: unknownCoverage ? 'unknown' : 'complete',
      allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: 'none',
      ...revision, ...fingerprints },
    proofs: [{ proofId: modifier.sourceProofId, modifierId: modifier.id, request,
      target: modifier.target, status: 'complete', applicability: 'applies',
      sourceUid: token.sourceUID, sourceEpoch: token.sourceZoneEpoch, ...revision,
      modifierFingerprint: fingerprintDuelCostModifierV2(request, modifier), ...fingerprints }],
    modifiers: [modifier],
  }), () => snapshot);
}

function fixtureServices(token, { unknownCoverage = false, unknownFirstAttempt = false,
  bindCostThrowOnce = false, unknownClosureEvent, effectHead: customEffectHead } = {}) {
  let costCalls = 0, bindCalls = 0, bindThrew = false;
  const service = {
    get costCalls() { return costCalls; }, get bindCalls() { return bindCalls; },
    effectHead: customEffectHead ?? ((session, request) => ({ match: session.match,
      commandSession: session, commandId: request.commandId, sourceEffectId: token.sourceEffectId,
      eventId: token.eventId, sourceUID: token.sourceUID, controllerPlayerId: 'alice',
      status: 'resolving', limitedPlay: true })),
    tokenSource: sourceOracle,
    paymentSource: argument => ({ matchId: argument.match.matchId, actor: 'alice',
      paymentId: argument.paymentId, sourceReference: { ...argument.sourceReference },
      sourceProofId: 'fixture:payment', mode: 'current', sourceZoneEpoch: token.sourceZoneEpoch,
      taskId: argument.taskId, continuationId: argument.continuationId }),
    cost: ({ match, transactionId }) => {
      costCalls++;
      return fixtureCost(match, token, transactionId,
        unknownCoverage || (unknownFirstAttempt && costCalls === 1));
    },
    bindCost: request => {
      bindCalls++;
      if (bindCostThrowOnce && !bindThrew) { bindThrew = true; throw new Error('temporary bind'); }
      return { ...request, status: 'complete' };
    },
    legality: request => ({ ...request, status: 'complete' }),
    entry: request => ({ ...request, proofId: 'fixture:entry', status: 'complete',
      disposition: 'default-exhausted-no-effects' }),
    closure: (match, _request, event) => event === unknownClosureEvent ? null : fixtureClosure(match, event),
  };
  return service;
}

function playRequest(state, suffix) {
  const token = requestFor(state, suffix);
  return { commandId: `command:v3:${suffix}`, expectedVersion: state.stateVersion, token,
    taskId: `task:v3:${suffix}`, paymentId: `payment:v3:${suffix}`,
    continuationId: `continuation:v3:${suffix}`, transactionId: `transaction:v3:${suffix}` };
}

test('V3 TokenPlay admits the exact command/effect head and retries pending source on the same head', () => {
  const session = adoptAdmittedDuelPlayingSessionV2(playing());
  const request = playRequest(session.match, 'source-retry');
  let available = false;
  const services = fixtureServices(request.token, { effectHead: (current, currentRequest) => available
    ? { match: current.match, commandSession: current, commandId: currentRequest.commandId,
      sourceEffectId: currentRequest.token.sourceEffectId, eventId: currentRequest.token.eventId,
      sourceUID: currentRequest.token.sourceUID, controllerPlayerId: 'alice', status: 'resolving', limitedPlay: true }
    : null });
  const play = createDuelRecruitTokenPlayV3(session, request, services);
  assert.equal(beginDuelRecruitTokenPlayV3(play).stage, 'source-pending');
  available = true;
  assert.equal(beginDuelRecruitTokenPlayV3(play).stage, 'chain');
  assert.equal(inspectDuelRecruitTokenPlayV3(play).chainStatus, 'on-chain');
});

test('V3 TokenPlay resolves a complete modified cost, gates payment to the payer, and charges once', () => {
  const session = paymentSession();
  const request = playRequest(session.match, 'paid');
  const services = fixtureServices(request.token);
  const play = createDuelRecruitTokenPlayV3(session, request, services);
  assert.equal(beginDuelRecruitTokenPlayV3(play).stage, 'chain');
  const prepared = resumeDuelRecruitTokenPlayV3(play);
  assert.equal(prepared.stage, 'payment');
  assert.deepEqual(inspectDuelRecruitTokenPlayV3(play).finalResolvedCost, { energy: 1, power: [] });
  const stale = applyDuelRecruitTokenResourceCommandV3(play, 'bob', {
    commandId: 'pay-bob', expectedVersion: prepared.session.match.stateVersion,
    command: { type: 'pay-pending', paymentId: request.paymentId } });
  assert.equal(stale.outcome.status, 'rejected');
  assert.equal(stale.outcome.reason, 'no-permission');
  const payEnvelope = { commandId: 'pay-alice', expectedVersion: prepared.session.match.stateVersion,
    command: { type: 'pay-pending', paymentId: request.paymentId } };
  const paid = applyDuelRecruitTokenResourceCommandV3(play, 'alice', payEnvelope);
  assert.equal(paid.outcome.status, 'applied');
  assert.equal(paid.session.match.resources.players[0].runePool.energy, 0);
  const duplicate = applyDuelRecruitTokenResourceCommandV3(play, 'alice', payEnvelope);
  assert.equal(duplicate.duplicate, true);
  assert.strictEqual(duplicate.session, paid.session);
  const finished = resumeDuelRecruitTokenPlayV3(play);
  assert.equal(finished.status, 'finalized', finished.reason);
  assert.equal(finished.session.match.board.units.filter(unit => unit.objectId === request.token.tokenUID).length, 1);
  assert.equal(finished.session.match.unitMeta[request.token.tokenUID].readied, false);
  assert.equal(services.costCalls, 1);
});

test('V3 TokenPlay keeps unknown cost and bind failures retryable without changing the head', () => {
  const unknownSession = paymentSession();
  const unknownRequest = playRequest(unknownSession.match, 'unknown-cost');
  const unknownServices = fixtureServices(unknownRequest.token, { unknownFirstAttempt: true });
  const unknownPlay = createDuelRecruitTokenPlayV3(unknownSession, unknownRequest, unknownServices);
  assert.equal(beginDuelRecruitTokenPlayV3(unknownPlay).stage, 'chain');
  assert.equal(resumeDuelRecruitTokenPlayV3(unknownPlay).stage, 'choosing');
  assert.equal(unknownServices.costCalls, 1);
  const prepared = resumeDuelRecruitTokenPlayV3(unknownPlay);
  assert.equal(prepared.stage, 'payment');
  assert.equal(unknownServices.costCalls, 2);

  const bindSession = paymentSession();
  const bindRequest = playRequest(bindSession.match, 'bind-retry');
  const bindServices = fixtureServices(bindRequest.token, { bindCostThrowOnce: true });
  const bindPlay = createDuelRecruitTokenPlayV3(bindSession, bindRequest, bindServices);
  assert.equal(beginDuelRecruitTokenPlayV3(bindPlay).stage, 'chain');
  assert.equal(resumeDuelRecruitTokenPlayV3(bindPlay).stage, 'choosing');
  assert.equal(bindServices.costCalls, 1);
  assert.equal(resumeDuelRecruitTokenPlayV3(bindPlay).stage, 'payment');
  assert.equal(bindServices.costCalls, 1);
  assert.equal(bindServices.bindCalls, 2);
});

test('V3 TokenPlay does not birth when closure is unknown, then births one exhausted Recruit when complete', () => {
  const session = paymentSession();
  const request = playRequest(session.match, 'closure');
  const services = fixtureServices(request.token, { unknownClosureEvent: 'zone-transition' });
  const play = createDuelRecruitTokenPlayV3(session, request, services);
  assert.equal(beginDuelRecruitTokenPlayV3(play).stage, 'chain');
  const prepared = resumeDuelRecruitTokenPlayV3(play);
  assert.equal(prepared.stage, 'payment');
  const pay = applyDuelRecruitTokenResourceCommandV3(play, 'alice', {
    commandId: 'pay-closure', expectedVersion: prepared.session.match.stateVersion,
    command: { type: 'pay-pending', paymentId: request.paymentId } });
  assert.equal(pay.outcome.status, 'applied');
  const pending = resumeDuelRecruitTokenPlayV3(play);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.stage, 'finalizing');
  assert.equal(pending.session.match.board.units.some(unit => unit.objectId === request.token.tokenUID), false);
  services.closure = (match, _request, event) => fixtureClosure(match, event);
  const finished = resumeDuelRecruitTokenPlayV3(play);
  assert.equal(finished.status, 'finalized', finished.reason);
  assert.equal(finished.session.match.unitMeta[request.token.tokenUID].readied, false);
  assert.equal(finished.session.match.board.units.filter(unit => unit.objectId === request.token.tokenUID).length, 1);
});

test('V3 TokenPlay keeps an unknown entry proof blocked after payment', () => {
  const session = paymentSession();
  const request = playRequest(session.match, 'entry-unknown');
  const services = fixtureServices(request.token);
  services.entry = entryRequest => ({ ...entryRequest, proofId: 'fixture:unknown-entry',
    status: 'unknown', disposition: 'unknown' });
  const play = createDuelRecruitTokenPlayV3(session, request, services);
  beginDuelRecruitTokenPlayV3(play);
  const prepared = resumeDuelRecruitTokenPlayV3(play);
  assert.equal(prepared.stage, 'payment');
  const paid = applyDuelRecruitTokenResourceCommandV3(play, 'alice', {
    commandId: 'pay-entry-unknown', expectedVersion: prepared.session.match.stateVersion,
    command: { type: 'pay-pending', paymentId: request.paymentId } });
  assert.equal(paid.outcome.status, 'applied');
  const blocked = resumeDuelRecruitTokenPlayV3(play);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.stage, 'entry');
  assert.equal(blocked.session.match.board.units.some(unit => unit.objectId === request.token.tokenUID), false);
});

test('V3 TokenPlay cancellation is honest before payment and blocked after payment starts', () => {
  const session = adoptAdmittedDuelPlayingSessionV2(playing());
  const request = playRequest(session.match, 'cancel');
  const play = createDuelRecruitTokenPlayV3(session, request, fixtureServices(request.token));
  assert.equal(beginDuelRecruitTokenPlayV3(play).stage, 'chain');
  assert.equal(cancelDuelRecruitTokenPlayV3(play).reason, 'cancelled');
  assert.equal(inspectDuelRecruitTokenPlayV3(play).chainStatus, 'cancelled');
  assert.equal(resumeDuelRecruitTokenPlayV3(play).reason, 'cancelled');

  const paidSession = paymentSession();
  const paidRequest = playRequest(paidSession.match, 'cancel-paid');
  const paidPlay = createDuelRecruitTokenPlayV3(paidSession, paidRequest, fixtureServices(paidRequest.token));
  beginDuelRecruitTokenPlayV3(paidPlay);
  assert.equal(resumeDuelRecruitTokenPlayV3(paidPlay).stage, 'payment');
  assert.equal(cancelDuelRecruitTokenPlayV3(paidPlay).reason, 'cancel-pending-after-payment-task');
});

test('V3 native claims reject physical UID collision, cloned handles, provider reentry, and legacy rebirth', () => {
  const state = playing();
  const physicalUID = state.players[0].hand[0].uid;
  assert.throws(() => beginDuelRecruitTokenOnChainV3(state,
    { ...requestFor(state, 'physical-collision'), tokenUID: physicalUID }, sourceOracle), /UID|already|physical/);
  const staleSession = adoptAdmittedDuelPlayingSessionV2(state);
  const staleRequest = playRequest(state, 'stale');
  assert.throws(() => createDuelRecruitTokenPlayV3(staleSession,
    { ...staleRequest, expectedVersion: staleRequest.expectedVersion - 1 }, fixtureServices(staleRequest.token)), /identity|version|selection/);
  const request = requestFor(state, 'poison');
  let handle;
  const services = fixtureServices(request, { effectHead: (current, currentRequest) => {
    try { beginDuelRecruitTokenPlayV3(handle); } catch { /* expected reentry poison */ }
    return { match: current.match, commandSession: current, commandId: currentRequest.commandId,
      sourceEffectId: request.sourceEffectId, eventId: request.eventId, sourceUID: request.sourceUID,
      controllerPlayerId: 'alice', status: 'resolving', limitedPlay: true };
  }});
  handle = createDuelRecruitTokenPlayV3(adoptAdmittedDuelPlayingSessionV2(state),
    playRequest(state, 'poison'), services);
  assert.equal(beginDuelRecruitTokenPlayV3(handle).stage, 'poisoned');
  assert.throws(() => inspectDuelRecruitTokenPlayV3(structuredClone(handle)), /unknown|cloned/);

  const direct = beginDuelRecruitTokenOnChainV3(state, requestFor(state, 'legacy-guard'), sourceOracle);
  assert.throws(() => beginDuelRecruitTokenOnChainV3(state, requestFor(state, 'legacy-guard'), sourceOracle), /reserved|already/);
  assert.throws(() => createDuelRecruitUnitV2(direct.match, requestFor(state, 'legacy-guard'), sourceOracle), /canonical Chain|reservation/);
  const cancelled = cancelDuelRecruitTokenOnChainV3(direct.match, direct.reservation);
  assert.throws(() => createDuelRecruitUnitV2(cancelled.match, requestFor(state, 'legacy-guard'), sourceOracle), /canonical Chain|reservation/);
});

test('V3 origin index allows distinct sibling reservations but blocks foreign/stale finalize paths', () => {
  const state = playing();
  const first = beginDuelRecruitTokenOnChainV3(state, requestFor(state, 'sibling-a'), sourceOracle);
  const second = beginDuelRecruitTokenOnChainV3(state, requestFor(state, 'sibling-b'), sourceOracle);
  assert.equal(inspectDuelCanonicalRecruitTokenChainV3(first.match).length, 1);
  assert.equal(inspectDuelCanonicalRecruitTokenChainV3(second.match).length, 1);
  const firstAfter = finalizeDuelRecruitTokenFromChainV3(first.match, first.reservation, sourceOracle);
  const secondAfter = finalizeDuelRecruitTokenFromChainV3(second.match, second.reservation, sourceOracle);
  assert.equal(firstAfter.board.units.filter(unit => unit.objectId === 'recruit:v3:sibling-a').length, 1);
  assert.equal(secondAfter.board.units.filter(unit => unit.objectId === 'recruit:v3:sibling-b').length, 1);
  assert.throws(() => finalizeDuelRecruitTokenFromChainV3(secondAfter, first.reservation, sourceOracle), /native descendant|finalized|foreign|canonical/);
  const foreign = beginDuelRecruitTokenOnChainV3(playing(), requestFor(playing(), 'foreign'), sourceOracle);
  assert.throws(() => finalizeDuelRecruitTokenFromChainV3(first.match, foreign.reservation, sourceOracle), /foreign|canonical/);
});

test('V2 and V3 share tuple claims while unrelated legacy reservations remain replayable', () => {
  const state = playing();
  const legacyRequest = requestFor(state, 'legacy-first');
  const legacy = beginDuelRecruitTokenOnChainV2(state, legacyRequest, sourceOracle);
  assert.throws(() => beginDuelRecruitTokenOnChainV3(state, legacyRequest, sourceOracle), /V2 Recruit Chain already owns/);
  const canonicalRequest = requestFor(state, 'canonical-first');
  const canonical = beginDuelRecruitTokenOnChainV3(state, canonicalRequest, sourceOracle);
  assert.throws(() => beginDuelRecruitTokenOnChainV2(state, canonicalRequest, sourceOracle), /V3 canonical Chain owns/);
  cancelDuelRecruitTokenOnChainV2(state, legacy);
  const unrelated = beginDuelRecruitTokenOnChainV2(state, requestFor(state, 'unrelated-legacy'), sourceOracle);
  assert.ok(unrelated);
  assert.equal(inspectDuelCanonicalRecruitTokenChainV3(canonical.match).length, 1);
});


test('ordinary mutation rejects toJSON carrier spoofing and accessor swaps', () => {
  const before = playing();
  const request = requestFor(before, 'json-spoof');
  const begun = beginDuelRecruitTokenOnChainV3(before, request, sourceOracle);
  const original = begun.match.tokenChain;
  for (const fake of [[], [{ ...original[0], sourceEffectId: 'forged-effect',
    locationId: 'forged-location' }], [...original, { ...original[0],
    tokenUID: 'forged-token', sourceEffectId: 'forged-effect', eventId: 'forged-event' }]]) {
    fake.toJSON = () => original;
    assert.throws(() => commitDuelPlayingMutationV2(begun.match, draft => ({
      match: { ...draft, tokenChain: fake }, transitions: [],
    })), /ordinary mutation cannot alter canonical Recruit Chain/);
  }
  let getterInvoked = false;
  assert.throws(() => commitDuelPlayingMutationV2(begun.match, draft => ({
    match: Object.defineProperty({ ...draft }, 'tokenChain', { enumerable: true,
      get() { getterInvoked = true; return original; } }), transitions: [],
  })), /canonical Recruit Chain must be a data property/);
  assert.equal(getterInvoked, false, 'a carrier getter must not run during authorization');
  assert.equal(begun.match.tokenChain, original);
  assert.equal(inspectDuelCanonicalRecruitTokenChainV3(begun.match).length, 1);
  const after = finalizeDuelRecruitTokenFromChainV3(begun.match, begun.reservation, sourceOracle);
  assert.equal(after.board.units.filter(unit => unit.objectId === request.tokenUID).length, 1);
});
