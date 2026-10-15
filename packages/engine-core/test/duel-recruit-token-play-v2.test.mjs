import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelMatchV2, resolveDuelMulliganV2, beginDuelRecruitTokenOnChainV2,
  inspectDuelRecruitTokenOnChainV2, finalizeDuelRecruitTokenFromChainV2,
  createDuelRecruitUnitV2, cancelDuelRecruitTokenOnChainV2,
  channelDuelRunesV2, commitDuelPlayingMutationV2, enumerateDuelObjectsV2,
} from '../dist/duel/core-v2.js';
import { adoptAdmittedDuelPlayingSessionV2, applyDuelResourceCommandV2 } from '../dist/duel/canonical-session-v2.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2,
  fingerprintDuelCostModifierV2 } from '../dist/duel/cost-resolver-v2.js';
import { createDuelPhaseSourceClosureRegistryV2,
  createDuelPhaseSourceClosureJournalV2 } from '../dist/duel/phase-source-closure-v2.js';
import {
  createDuelRecruitTokenPlayV2, beginDuelRecruitTokenPlayV2,
  resumeDuelRecruitTokenPlayV2, cancelDuelRecruitTokenPlayV2, inspectDuelRecruitTokenPlayV2,
  applyDuelRecruitTokenResourceCommandV2,
} from '../dist/duel/token-play-v2.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-card-${i}`, cardId: 'plain-unit' })),
  champion: { uid: `${playerId}-champion`, cardId: 'plain-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'plain-legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'plain-rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `plain-field-${i}` })),
}));
const metadata = { matchId: 'recruit-token-play-v2', dataVersion: 'fixture-v2', catalogDigest: 'digest-v2',
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const cardType = id => id === 'plain-champion' ? 'Champion' : id === 'plain-legend' ? 'Legend' :
  id === 'plain-rune' ? 'Rune' : id.startsWith('plain-field-') ? 'Battlefield' : 'Unit';
const sourceOracle = ({ match, request }) => ({ ...request, matchId: match.matchId,
  dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
  sourceProofId: `source:${request.sourceEffectId}` });
function playingMatch() {
  let state = createDuelMatchV2(seats, metadata, () => 0, cardType);
  state = resolveDuelMulliganV2(state, 'alice', []);
  return resolveDuelMulliganV2(state, 'bob', []);
}
function requestFor(state, tokenUID = 'recruit-chain-1') {
  const sourceUID = state.players[0].hand[0].uid;
  const locationId = state.board.bases.find(base => base.ownerPlayerId === 'alice').locationId;
  return { kind: 'recruit', tokenUID, sourceEffectId: `effect:${tokenUID}`, eventId: `event:${tokenUID}`,
    sourceUID, sourceZoneEpoch: state.physicalCardsByUID[sourceUID].zoneEpoch, sourceMode: 'current',
    effectControllerPlayerId: 'alice', controllerPlayerId: 'alice', locationId,
    readied: false, name: 'Recruit', baseMight: 1, tags: ['Recruit'] };
}

function paymentSession() {
  let match = channelDuelRunesV2(playingMatch(), 'alice', 1);
  match = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, old]) =>
      [uid, { ...old, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', stateOpen: true, priorityPlayerId: 'alice' },
  }, transitions: [] }));
  let session = adoptAdmittedDuelPlayingSessionV2(match);
  const uid = session.match.resources.bases.find(base => base.playerId === 'alice').baseRunes[0].uid;
  const energy = applyDuelResourceCommandV2(session, 'alice', { commandId: 'fund-recruit',
    expectedVersion: session.match.stateVersion, command: { type: 'rune-energy', uid } });
  assert.equal(energy.outcome.status, 'applied');
  match = commitDuelPlayingMutationV2(energy.session.match, draft => ({ match: { ...draft,
    frame: { ...draft.frame, phase: 'ending', stateOpen: false, priorityPlayerId: 'bob' },
  }, transitions: [] }));
  return adoptAdmittedDuelPlayingSessionV2(match);
}

// Synthetic whole-program and effect witnesses are confined to this mechanism fixture.
// They make no claim about the official OGN275 IR or the server's protected hold journal.
function fixtureClosure(match, event) {
  const context = { matchId: match.matchId, dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest, turn: match.frame.turnNumber,
    taskId: `duel-v2:${match.matchId}:turn-${match.frame.turnNumber}:recruit:0`,
    phase: 'ending', event, clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq } };
  const ledger = name => ({ status: 'empty', ledgerId: `fixture:${name}`,
    revision: 0, proofId: `fixture:${name}:${match.stateVersion}`,
    matchId: context.matchId, dataVersion: context.dataVersion,
    catalogDigest: context.catalogDigest, turn: context.turn, taskId: context.taskId,
    clock: { ...context.clock }, entries: [] });
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
    transitions: event === 'zone-transition' ? [{ eventId: 'fixture:channel',
      uid: transition.uid, from: transition.from, to: transition.to,
      fromZoneEpoch: 0, toZoneEpoch: 1, proofId: 'fixture:channel' }] : [],
    activeEffects: ledger('activeEffects'), chain: ledger('chain'),
    effectQueue: ledger('effectQueue'), feprOutstanding: ledger('feprOutstanding'),
  });
  return { context, registry, journal };
}

function fixtureCost(match, token, transactionId, unknownCoverage = false) {
  const request = { transactionId, subjectId: token.tokenUID, kind: 'card-play' };
  const base = { energy: 0, power: [] };
  const modifier = { id: 'fixture:increase', sourceProofId: 'fixture:modifier',
    stage: 'increase', operation: 'increase', target: { kind: 'new-component' },
    cost: { energy: 1, power: [] } };
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
    proofs: [{ proofId: modifier.sourceProofId, modifierId: modifier.id,
      request, target: modifier.target, status: 'complete', applicability: 'applies',
      sourceUid: token.sourceUID, sourceEpoch: token.sourceZoneEpoch, ...revision,
      modifierFingerprint: fingerprintDuelCostModifierV2(request, modifier),
      ...fingerprints }], modifiers: [modifier],
  }), () => snapshot);
}

function fixtureServices(token, { unknownCoverage = false, unknownFirstAttempt = false,
  bindCostThrowOnce = false } = {}) {
  let costCalls = 0, bindCalls = 0, bindThrew = false;
  return { get costCalls() { return costCalls; },
    get bindCalls() { return bindCalls; },
    effectHead: (session, request) => ({ match: session.match, commandSession: session,
      commandId: request.commandId, sourceEffectId: token.sourceEffectId,
      eventId: token.eventId, sourceUID: token.sourceUID,
      controllerPlayerId: 'alice', status: 'resolving', limitedPlay: true }),
    tokenSource: sourceOracle,
    paymentSource: argument => ({ matchId: argument.match.matchId, actor: 'alice',
      paymentId: argument.paymentId, sourceReference: { ...argument.sourceReference },
      sourceProofId: 'fixture:payment', mode: 'current',
      sourceZoneEpoch: token.sourceZoneEpoch, taskId: argument.taskId,
      continuationId: argument.continuationId }),
    cost: ({ match, transactionId }) => {
      costCalls++;
      return fixtureCost(match, token, transactionId,
        unknownCoverage || (unknownFirstAttempt && costCalls === 1));
    },
    bindCost: request => {
      bindCalls++;
      if (bindCostThrowOnce && !bindThrew) {
        bindThrew = true;
        throw new Error('temporary bindCost-unavailable');
      }
      return { ...request, status: 'complete' };
    },
    legality: request => ({ ...request, status: 'complete' }),
    entry: request => ({ ...request, proofId: 'fixture:exact-entry', status: 'complete',
      disposition: 'default-exhausted-no-effects' }),
    closure: (match, _request, event) => fixtureClosure(match, event),
  };
}

test('mechanism fixture: Chain reservation is nominal, has no board birth, and finalizes once', () => {
  const state = playingMatch();
  const request = requestFor(state);
  const reservation = beginDuelRecruitTokenOnChainV2(state, request, sourceOracle);
  assert.equal(inspectDuelRecruitTokenOnChainV2(reservation).status, 'on-chain');
  assert.throws(() => inspectDuelRecruitTokenOnChainV2(structuredClone(reservation)), /unknown/);
  assert.equal(state.board.units.some(unit => unit.objectId === request.tokenUID), false);
  assert.equal(state.stateVersion, 2);
  assert.throws(() => beginDuelRecruitTokenOnChainV2(state, request, sourceOracle), /reserved|already/);
  assert.throws(() => beginDuelRecruitTokenOnChainV2(state, request, sourceOracle), /reserved|already/);
  const after = finalizeDuelRecruitTokenFromChainV2(state, reservation, sourceOracle);
  assert.equal(after.board.units.filter(unit => unit.objectId === request.tokenUID).length, 1);
  assert.equal(after.unitMeta[request.tokenUID].readied, false);
  assert.equal(inspectDuelRecruitTokenOnChainV2(reservation).status, 'finalized');
  assert.throws(() => finalizeDuelRecruitTokenFromChainV2(after, reservation, sourceOracle), /finalized|busy/);
  const foreignReservation = beginDuelRecruitTokenOnChainV2(state, requestFor(state, 'recruit-foreign'), sourceOracle);
  assert.throws(() => finalizeDuelRecruitTokenFromChainV2(playingMatch(), foreignReservation, sourceOracle), /foreign/);
});

test('mechanism fixture: reentrant sibling reservations share the origin index and tombstone', () => {
  const state = playingMatch();
  const first = requestFor(state, 'recruit-shared-a');
  const sibling = requestFor(state, 'recruit-shared-b');
  let nested = false;
  let siblingReservation;
  const attestor = ({ match, request }) => {
    if (!nested) {
      nested = true;
      siblingReservation = beginDuelRecruitTokenOnChainV2(match, sibling, attestor);
    }
    return sourceOracle({ match, request });
  };
  const firstReservation = beginDuelRecruitTokenOnChainV2(state, first, attestor);
  assert.throws(() => createDuelRecruitUnitV2(state, sibling, sourceOracle), /reservation owns/);
  const afterFirst = finalizeDuelRecruitTokenFromChainV2(state, firstReservation, sourceOracle);
  const afterSibling = finalizeDuelRecruitTokenFromChainV2(state, siblingReservation, sourceOracle);
  assert.equal(afterFirst.board.units.some(unit => unit.objectId === first.tokenUID), true);
  assert.equal(afterSibling.board.units.some(unit => unit.objectId === sibling.tokenUID), true);
  assert.throws(() => createDuelRecruitUnitV2(state, first, sourceOracle), /reservation owns/);
});

test('mechanism fixture: nested failure and direct legacy callback poison outer proof', () => {
  const state = playingMatch();
  const first = requestFor(state, 'recruit-nested-failure-a');
  const sibling = requestFor(state, 'recruit-nested-failure-b');
  let nested = false;
  const failingNested = ({ match, request }) => {
    if (!nested) {
      nested = true;
      try {
        beginDuelRecruitTokenOnChainV2(match, sibling, () => { throw new Error('temporary nested source'); });
      } catch { /* captured nested failure must still poison outer */ }
    }
    return sourceOracle({ match, request });
  };
  assert.throws(() => beginDuelRecruitTokenOnChainV2(state, first, failingNested), /changed|callback/);
  const retry = beginDuelRecruitTokenOnChainV2(state, first, sourceOracle);
  assert.equal(inspectDuelRecruitTokenOnChainV2(retry).status, 'on-chain');

  const direct = requestFor(state, 'recruit-direct-legacy-a');
  const directSibling = requestFor(state, 'recruit-direct-legacy-b');
  assert.throws(() => beginDuelRecruitTokenOnChainV2(state, direct, ({ match, request }) => {
    try { createDuelRecruitUnitV2(match, directSibling, sourceOracle); } catch { /* poison */ }
    return sourceOracle({ match, request });
  }), /changed|callback/);
});

test('mechanism fixture: pre-payment cancel leaves a tombstone and releases only the active claim', () => {
  const state = playingMatch();
  const request = requestFor(state, 'recruit-cancelled');
  const reservation = beginDuelRecruitTokenOnChainV2(state, request, sourceOracle);
  cancelDuelRecruitTokenOnChainV2(state, reservation);
  assert.equal(inspectDuelRecruitTokenOnChainV2(reservation).status, 'cancelled');
  assert.throws(() => cancelDuelRecruitTokenOnChainV2(state, reservation), /cancelled/);
  assert.throws(() => finalizeDuelRecruitTokenFromChainV2(state, reservation, sourceOracle), /cancelled/);
  assert.throws(() => beginDuelRecruitTokenOnChainV2(state, request, sourceOracle), /reserved/);
  const next = requestFor(state, 'recruit-cancelled-next');
  const nextReservation = beginDuelRecruitTokenOnChainV2(state, next, sourceOracle);
  assert.equal(inspectDuelRecruitTokenOnChainV2(nextReservation).status, 'on-chain');
});

test('mechanism fixture: TokenPlay cancel is terminal before payment', () => {
  const session = adoptAdmittedDuelPlayingSessionV2(playingMatch());
  const token = requestFor(session.match, 'recruit-play-cancel');
  const request = { commandId: 'hold-cancel', expectedVersion: session.match.stateVersion, token,
    taskId: 'task-cancel', paymentId: 'payment-cancel', continuationId: 'continuation-cancel',
    transactionId: 'transaction-cancel' };
  const play = createDuelRecruitTokenPlayV2(session, request, fixtureServices(token));
  assert.equal(beginDuelRecruitTokenPlayV2(play).stage, 'chain');
  assert.equal(cancelDuelRecruitTokenPlayV2(play).reason, 'cancelled');
  assert.equal(inspectDuelRecruitTokenPlayV2(play).stage, 'cancelled');
  assert.equal(inspectDuelRecruitTokenPlayV2(play).chainStatus, 'cancelled');
  assert.equal(resumeDuelRecruitTokenPlayV2(play).reason, 'cancelled');
  assert.equal(cancelDuelRecruitTokenPlayV2(play).reason, 'cancelled');
});

test('mechanism fixture: source-provider reentry poisons the reservation and cannot be recovered', () => {
  const state = playingMatch();
  const request = requestFor(state, 'recruit-reentry');
  let reentered = false;
  const reentrant = ({ match, request: inner }) => {
    if (!reentered) {
      reentered = true;
      try { beginDuelRecruitTokenOnChainV2(match, inner, reentrant); } catch { /* expected poison */ }
    }
    return sourceOracle({ match, request: inner });
  };
  assert.throws(() => beginDuelRecruitTokenOnChainV2(state, request, reentrant), /changed|reserved/);
});

test('mechanism fixture: an ordinary source failure leaves Chain unreserved and retryable', () => {
  const state = playingMatch();
  const request = requestFor(state, 'recruit-retry');
  let failOnce = true;
  const retryable = ({ match, request: inner }) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('temporary source-unavailable');
    }
    return sourceOracle({ match, request: inner });
  };
  assert.throws(() => beginDuelRecruitTokenOnChainV2(state, request, retryable), /source|attest|callback/);
  const reservation = beginDuelRecruitTokenOnChainV2(state, request, retryable);
  assert.equal(inspectDuelRecruitTokenOnChainV2(reservation).status, 'on-chain');
  assert.equal(state.board.units.some(unit => unit.objectId === request.tokenUID), false);
});

test('mechanism fixture: paid nonzero modified cost finalizes one exhausted Recruit outside Main Priority', () => {
  const session = paymentSession();
  const token = requestFor(session.match, 'recruit-paid');
  const request = { commandId: 'hold-paid', expectedVersion: session.match.stateVersion, token,
    taskId: 'task-paid', paymentId: 'payment-paid', continuationId: 'continuation-paid',
    transactionId: 'transaction-paid' };
  const services = fixtureServices(token);
  const play = createDuelRecruitTokenPlayV2(session, request, services);
  assert.equal(beginDuelRecruitTokenPlayV2(play).stage, 'chain');
  assert.equal(session.match.board.units.some(unit => unit.objectId === token.tokenUID), false);
  const prepared = resumeDuelRecruitTokenPlayV2(play);
  assert.equal(prepared.stage, 'payment', prepared.reason);
  assert.deepEqual(inspectDuelRecruitTokenPlayV2(play).finalResolvedCost, { energy: 1, power: [] });
  assert.equal(prepared.session.match.frame.pendingPayment.paymentId, request.paymentId);
  assert.equal(prepared.session.match.resources.players[0].runePool.energy, 1);
  const pay = { commandId: 'pay-recruit', expectedVersion: prepared.session.match.stateVersion,
    command: { type: 'pay-pending', paymentId: request.paymentId } };
  const paid = applyDuelRecruitTokenResourceCommandV2(play, 'alice', pay);
  assert.equal(paid.outcome.status, 'applied', paid.outcome.reason);
  assert.equal(paid.session.match.resources.players[0].runePool.energy, 0);
  const duplicate = applyDuelRecruitTokenResourceCommandV2(play, 'alice', pay);
  assert.equal(duplicate.duplicate, true);
  assert.strictEqual(duplicate.session, paid.session);
  const finished = resumeDuelRecruitTokenPlayV2(play);
  assert.equal(finished.status, 'finalized', finished.reason);
  assert.equal(finished.session.match.board.units.filter(unit => unit.objectId === token.tokenUID).length, 1);
  assert.equal(finished.session.match.unitMeta[token.tokenUID].readied, false);
  assert.equal(finished.session.match.resources.players[0].runePool.energy, 0);
  assert.equal(resumeDuelRecruitTokenPlayV2(play).status, 'finalized');
  assert.equal(finished.session.match.board.units.filter(unit => unit.objectId === token.tokenUID).length, 1);
  assert.equal(services.costCalls, 1);
});

test('mechanism fixture: unknown modifier coverage blocks before task, payment and birth', () => {
  const session = paymentSession();
  const token = requestFor(session.match, 'recruit-unknown-cost');
  const request = { commandId: 'hold-unknown', expectedVersion: session.match.stateVersion, token,
    taskId: 'task-unknown', paymentId: 'payment-unknown', continuationId: 'continuation-unknown',
    transactionId: 'transaction-unknown' };
  const services = fixtureServices(token, { unknownCoverage: true });
  const play = createDuelRecruitTokenPlayV2(session, request, services);
  assert.equal(beginDuelRecruitTokenPlayV2(play).stage, 'chain');
  const blocked = resumeDuelRecruitTokenPlayV2(play);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.stage, 'choosing');
  assert.strictEqual(blocked.session, session);
  const repeated = resumeDuelRecruitTokenPlayV2(play);
  assert.equal(repeated.status, 'blocked');
  assert.equal(repeated.reason, 'trusted-proof-or-session-unproved');
  // An unfixed (unknown) attempt is retryable at the same protected head/transaction: the trusted
  // cost service is consulted again instead of being permanently frozen, without producing a task,
  // payment or birth while the coverage stays unknown.
  assert.equal(services.costCalls, 2);
  assert.equal(session.requiredTasks.length, 0);
  assert.equal(session.match.board.units.some(unit => unit.objectId === token.tokenUID), false);
});

test('mechanism fixture: same play/transaction unknown->trusted recovery completes without a new effect/event', () => {
  const session = paymentSession();
  const token = requestFor(session.match, 'recruit-recovered-cost');
  const request = { commandId: 'hold-recovered', expectedVersion: session.match.stateVersion, token,
    taskId: 'task-recovered', paymentId: 'payment-recovered',
    continuationId: 'continuation-recovered', transactionId: 'transaction-recovered' };
  // First cost attempt returns unknown coverage; the second returns the trusted complete proof.
  // No new command/effect/event/transaction and no new TokenPlay handle is created.
  const services = fixtureServices(token, { unknownFirstAttempt: true });
  const play = createDuelRecruitTokenPlayV2(session, request, services);
  assert.equal(beginDuelRecruitTokenPlayV2(play).stage, 'chain');
  const blocked = resumeDuelRecruitTokenPlayV2(play);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.stage, 'choosing');
  assert.equal(services.costCalls, 1);
  assert.equal(session.requiredTasks.length, 0);
  assert.equal(session.match.frame.pendingPayment, null);
  assert.equal(session.match.board.units.some(unit => unit.objectId === token.tokenUID), false);
  const prepared = resumeDuelRecruitTokenPlayV2(play);
  assert.equal(prepared.stage, 'payment', prepared.reason);
  assert.equal(services.costCalls, 2);
  assert.deepEqual(inspectDuelRecruitTokenPlayV2(play).finalResolvedCost, { energy: 1, power: [] });
  assert.equal(prepared.session.match.frame.pendingPayment.paymentId, request.paymentId);
  assert.equal(prepared.session.match.resources.players[0].runePool.energy, 1);
  const pay = { commandId: 'pay-recovered', expectedVersion: prepared.session.match.stateVersion,
    command: { type: 'pay-pending', paymentId: request.paymentId } };
  const paid = applyDuelRecruitTokenResourceCommandV2(play, 'alice', pay);
  assert.equal(paid.outcome.status, 'applied', paid.outcome.reason);
  const finished = resumeDuelRecruitTokenPlayV2(play);
  assert.equal(finished.status, 'finalized', finished.reason);
  assert.equal(finished.session.match.board.units.filter(unit => unit.objectId === token.tokenUID).length, 1);
  assert.equal(finished.session.match.unitMeta[token.tokenUID].readied, false);
  // The full modified cost was charged exactly once and never re-resolved.
  assert.equal(finished.session.match.resources.players[0].runePool.energy, 0);
  assert.equal(services.costCalls, 2);
});

test('mechanism fixture: a successful resolve then bindCost throw recovers with one cost call, identity unchanged', () => {
  const session = paymentSession();
  const token = requestFor(session.match, 'recruit-bind-retry');
  const request = { commandId: 'hold-bind', expectedVersion: session.match.stateVersion, token,
    taskId: 'task-bind', paymentId: 'payment-bind', continuationId: 'continuation-bind',
    transactionId: 'transaction-bind' };
  // Resolver succeeds once; the independent bindCost callback throws once. Recovery must reuse the
  // cached fixed cost, so the cost service is consulted exactly once and the identity is unchanged.
  const services = fixtureServices(token, { bindCostThrowOnce: true });
  const play = createDuelRecruitTokenPlayV2(session, request, services);
  assert.equal(beginDuelRecruitTokenPlayV2(play).stage, 'chain');
  const failed = resumeDuelRecruitTokenPlayV2(play);
  assert.equal(failed.status, 'blocked');
  assert.equal(failed.stage, 'choosing');
  assert.equal(failed.reason, 'trusted-proof-or-session-unproved');
  assert.equal(services.costCalls, 1);
  assert.equal(services.bindCalls, 1);
  const retried = resumeDuelRecruitTokenPlayV2(play);
  assert.equal(retried.stage, 'payment', retried.reason);
  assert.equal(services.costCalls, 1);
  assert.equal(services.bindCalls, 2);
  assert.deepEqual(inspectDuelRecruitTokenPlayV2(play).finalResolvedCost, { energy: 1, power: [] });
  assert.equal(retried.session.match.frame.pendingPayment.paymentId, request.paymentId);
  assert.equal(retried.session.match.resources.players[0].runePool.energy, 1);
});

test('mechanism fixture: missing protected effect/closure evidence remains pending and cannot birth', () => {
  const session = adoptAdmittedDuelPlayingSessionV2(playingMatch());
  const request = requestFor(session.match, 'recruit-pending');
  const services = {
    effectHead: () => null,
    tokenSource: sourceOracle,
    paymentSource: () => { throw new Error('not reached'); },
    cost: () => { throw new Error('not reached'); },
    bindCost: () => { throw new Error('not reached'); },
    closure: () => null,
  };
  const play = createDuelRecruitTokenPlayV2(session, {
    commandId: 'hold-effect', expectedVersion: session.match.stateVersion,
    token: request, taskId: 'task-hold', paymentId: 'payment-hold',
    continuationId: 'continuation-hold', transactionId: 'txn-hold',
  }, services);
  const begun = beginDuelRecruitTokenPlayV2(play);
  assert.equal(begun.status, 'blocked');
  assert.equal(inspectDuelRecruitTokenPlayV2(play).stage, 'source-pending');
  assert.equal(resumeDuelRecruitTokenPlayV2(play).status, 'blocked');
  assert.equal(session.match.board.units.some(unit => unit.objectId === request.tokenUID), false);

  const pendingServices = { ...services, effectHead: (current, currentRequest) => ({
    match: current.match, commandSession: current, commandId: currentRequest.commandId,
    sourceEffectId: currentRequest.token.sourceEffectId, eventId: currentRequest.token.eventId,
    sourceUID: currentRequest.token.sourceUID, controllerPlayerId: 'alice',
    status: 'resolving', limitedPlay: true,
  }) };
  const pendingPlay = createDuelRecruitTokenPlayV2(session, {
    commandId: 'hold-effect-2', expectedVersion: session.match.stateVersion,
    token: { ...request, tokenUID: 'recruit-chain-pending', sourceEffectId: 'effect:pending', eventId: 'event:pending' },
    taskId: 'task-pending', paymentId: 'payment-pending', continuationId: 'continuation-pending', transactionId: 'txn-pending',
  }, pendingServices);
  assert.equal(beginDuelRecruitTokenPlayV2(pendingPlay).stage, 'chain');
  assert.equal(resumeDuelRecruitTokenPlayV2(pendingPlay).stage, 'choosing');
  assert.equal(inspectDuelRecruitTokenPlayV2(pendingPlay).chainStatus, 'on-chain');
});
