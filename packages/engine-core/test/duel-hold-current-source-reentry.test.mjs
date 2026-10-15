import assert from 'node:assert/strict';
import test from 'node:test';
import { playing, oracle, index } from './duel-phase-source-authority-v2.test.mjs';
import {
  checkpointDuelTurnCursorV2, commitDuelCommandMutationV2,
  issueDuelRequiredCostTaskV2, prepareDuelRequiredCostPaymentV2,
  applyDuelResourceCommandV2,
  advanceDuelCommandSessionNativeV2,
} from '../dist/duel/canonical-session-v2.js';
import {
  runDuelStartOfTurnV2,
  resumeDuelStartOfTurnV2,
  runDuelEndOfTurnV2,
  issueDuelNativeHoldAttemptV3,
  inspectDuelNativeHoldAttemptV3,
} from '../dist/duel/turn-executor-v2.js';
import {
  commitDuelPlayingMutationV2, enumerateDuelObjectsV2, inspectDuelNativeTokenHistoryV2,
} from '../dist/duel/core-v2.js';
import {
  createDuelRecruitTokenPlayV3, beginDuelRecruitTokenPlayV3, resumeDuelRecruitTokenPlayV3,
  inspectDuelRecruitTokenPlayV3, applyDuelRecruitTokenResourceCommandV3,
  rebindDuelRecruitTokenPlayV3,
} from '../dist/duel/token-play-v3.js';
import {
  createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2,
  fingerprintDuelCostModifierV2,
} from '../dist/duel/cost-resolver-v2.js';
import {
  createDuelPhaseSourceClosureRegistryV2, createDuelPhaseSourceClosureJournalV2,
} from '../dist/duel/phase-source-closure-v2.js';
import { createDuelPhaseSourceRegistryWithNativeTokenSourceV2 } from
  '../dist/duel/phase-source-authority-v2.js';

test('different resolver reentry poisons an outer native Hold attempt', () => {
  const sources = oracle(request => request.event === 'hold' && request.source.kind === 'battlefield'
    ? { scope: 'handlers-or-modifiers' } : {});
  let attempt;
  let source;
  let nested;
  const result = runDuelStartOfTurnV2(playing(), {
    sources,
    resolveNativeHandlers: context => {
      source = context.sources[0];
      attempt = issueDuelNativeHoldAttemptV3(context.nativeHoldInvocationV3, source);
      nested = runDuelStartOfTurnV2(context.session, {
        sources,
        resolveNativeHandlers: () => ({ status: 'pending' }),
      });
      return { status: 'pending' };
    },
  });

  assert.equal(result.status, 'pending');
  assert.equal(nested.status, 'pending');
  assert.equal(inspectDuelNativeHoldAttemptV3(attempt, result.session,
    source.uid, source.zoneEpoch, source.controllerPlayerId, result.pending.taskId), false,
  'nested same-session Hold must poison the outer attempt');
});

test('an independent native session boundary does not poison the outer attempt', () => {
  const sources = oracle(request => request.event === 'hold' && request.source.kind === 'battlefield'
    ? { scope: 'handlers-or-modifiers' } : {});
  let attempt;
  let source;
  let nested;
  let entered = false;
  const result = runDuelStartOfTurnV2(playing(), {
    sources,
    resolveNativeHandlers: context => {
      source = context.sources[0];
      attempt = issueDuelNativeHoldAttemptV3(context.nativeHoldInvocationV3, source);
      if (!entered) {
        entered = true;
        nested = runDuelStartOfTurnV2(playing(), {
          sources,
          resolveNativeHandlers: () => ({ status: 'pending' }),
        });
      }
      return { status: 'pending' };
    },
  });

  assert.equal(result.status, 'pending');
  assert.equal(nested.status, 'pending');
  assert.equal(inspectDuelNativeHoldAttemptV3(attempt, result.session,
    source.uid, source.zoneEpoch, source.controllerPlayerId, result.pending.taskId), true,
  'a different native session must not poison this attempt');
});

test('native Hold attempt expires when the current battlefield source controller changes', () => {
  const original = commitDuelCommandMutationV2(playing(), draft => ({
    match: { ...draft, board: { ...draft.board, battlefields: draft.board.battlefields.map((field, index) =>
      index === 0 ? { ...field, controllerPlayerId: 'alice' } : field) } },
    transitions: [],
  })).session;
  const sources = oracle(request => request.event === 'hold' && request.source.kind === 'battlefield' &&
    request.source.controllerPlayerId === 'alice' ? { scope: 'handlers-or-modifiers' } : {});
  let attempt;
  let source;
  let callbackSession;
  const result = runDuelStartOfTurnV2(original, {
    sources,
    resolveNativeHandlers: context => {
      source = context.sources.find(item => item.kind === 'battlefield');
      callbackSession = context.session;
      attempt = issueDuelNativeHoldAttemptV3(context.nativeHoldInvocationV3, source);
      return { status: 'pending' };
    },
  });
  assert.equal(result.status, 'pending');
  assert.equal(source.controllerPlayerId, 'alice');

  const changed = commitDuelCommandMutationV2(callbackSession, draft => ({
    match: { ...draft, board: { ...draft.board, battlefields: draft.board.battlefields.map(field =>
      field.instanceId === source.uid ? { ...field, controllerPlayerId: 'bob' } : field) } },
    transitions: [],
  })).session;
  const current = changed.match.board.battlefields.find(field => field.instanceId === source.uid);
  assert.equal(current.controllerPlayerId, 'bob');
  assert.equal(inspectDuelNativeHoldAttemptV3(attempt, changed, source.uid,
    source.zoneEpoch, source.controllerPlayerId, result.pending.taskId), false,
  'changed held source must invalidate the old attempt');
});

const handlers = () => oracle(request => request.event === 'hold' &&
  request.source.kind === 'battlefield' ? { scope: 'handlers-or-modifiers' } : {});
const noHandlers = () => oracle(() => ({}));
const retry = result => ({ status: 'retry', matchId: result.session.match.matchId,
  turn: result.pending.turn, taskId: result.pending.taskId });
const valid = (attempt, result, source, taskId) => inspectDuelNativeHoldAttemptV3(
  attempt, result.session, source.uid, source.zoneEpoch, source.controllerPlayerId, taskId);

test('checkpoint wrapper at the same Hold boundary poisons the outer attempt', () => {
  const sources = handlers();
  let attempt, source, nested;
  const outer = runDuelStartOfTurnV2(playing(), { sources, resolveNativeHandlers: context => {
    source = context.sources[0];
    attempt = issueDuelNativeHoldAttemptV3(context.nativeHoldInvocationV3, source);
    const wrapper = checkpointDuelTurnCursorV2(context.session, context.session.turnCursorV2);
    nested = runDuelStartOfTurnV2(wrapper, { sources,
      resolveNativeHandlers: () => ({ status: 'pending' }) });
    return { status: 'pending' };
  } });
  const attemptStillValid = valid(attempt, outer, source, outer.pending.taskId);
  console.log(JSON.stringify({ variant: 'wrapper', outer: outer.status,
    nested: nested.status, attemptStillValid }));
  assert.equal(outer.status, 'pending');
  assert.equal(nested.status, 'pending');
  assert.equal(attemptStillValid, false);
});

for (const variant of ['ancestor', 'sibling']) {
  test(`${variant} session at the same Hold boundary poisons the outer attempt`, () => {
    const sources = handlers();
    const pending = runDuelStartOfTurnV2(playing(), { sources,
      resolveNativeHandlers: () => ({ status: 'pending' }) });
    assert.equal(pending.status, 'pending');
    const ancestor = pending.session;
    const outerSession = checkpointDuelTurnCursorV2(ancestor, ancestor.turnCursorV2);
    const innerSession = variant === 'ancestor' ? ancestor :
      checkpointDuelTurnCursorV2(ancestor, ancestor.turnCursorV2);
    let attempt, source, nested;
    const outer = resumeDuelStartOfTurnV2(outerSession, pending.pending.taskId,
      retry(pending), { sources, resolveNativeHandlers: context => {
        source = context.sources[0];
        attempt = issueDuelNativeHoldAttemptV3(context.nativeHoldInvocationV3, source);
        nested = resumeDuelStartOfTurnV2(innerSession, pending.pending.taskId,
          retry(pending), { sources, resolveNativeHandlers: () => ({ status: 'pending' }) });
        return { status: 'pending' };
      } });
    const attemptStillValid = valid(attempt, outer, source, pending.pending.taskId);
    console.log(JSON.stringify({ variant, outer: outer.status,
      nested: nested.status, attemptStillValid }));
    assert.equal(outer.status, 'pending');
    assert.equal(nested.status, 'pending');
    assert.equal(attemptStillValid, false);
  });
}

test('old Hold attempt expires after the real turn cursor leaves Hold', () => {
  let attempt, source;
  const pending = runDuelStartOfTurnV2(playing(), { sources: handlers(),
    resolveNativeHandlers: context => {
      source = context.sources[0];
      attempt = issueDuelNativeHoldAttemptV3(context.nativeHoldInvocationV3, source);
      return { status: 'pending' };
    } });
  assert.equal(pending.status, 'pending');
  const advanced = resumeDuelStartOfTurnV2(pending.session, pending.pending.taskId,
    retry(pending), { sources: noHandlers(), fepr: () => ({ status: 'none' }) });
  const attemptStillValid = valid(attempt, advanced, source, pending.pending.taskId);
  console.log(JSON.stringify({ variant: 'left-hold', next: advanced.status,
    step: advanced.session.turnCursorV2.step, attemptStillValid }));
  assert.equal(advanced.status, 'main');
  assert.equal(attemptStillValid, false);
});

test('old Hold attempt stays expired after controller leaves and returns', () => {
  const controlled = commitDuelCommandMutationV2(playing(), draft => ({
    match: { ...draft, board: { ...draft.board, battlefields: draft.board.battlefields.map(
      (field, index) => index === 0 ? { ...field, controllerPlayerId: 'alice' } : field) } },
    transitions: [],
  })).session;
  const sources = oracle(request => request.event === 'hold' &&
    request.source.kind === 'battlefield' && request.source.controllerPlayerId === 'alice'
    ? { scope: 'handlers-or-modifiers' } : {});
  let attempt, source, callbackSession;
  const pending = runDuelStartOfTurnV2(controlled, { sources,
    resolveNativeHandlers: context => {
      callbackSession = context.session;
      source = context.sources.find(item => item.kind === 'battlefield');
      attempt = issueDuelNativeHoldAttemptV3(context.nativeHoldInvocationV3, source);
      return { status: 'pending' };
    } });
  assert.equal(pending.status, 'pending');
  const changeController = (session, controllerPlayerId) => commitDuelCommandMutationV2(
    session, draft => ({ match: { ...draft, board: { ...draft.board,
      battlefields: draft.board.battlefields.map(field => field.instanceId === source.uid
        ? { ...field, controllerPlayerId } : field) } }, transitions: [] })).session;
  const bob = changeController(callbackSession, 'bob');
  const aliceAgain = changeController(bob, 'alice');
  const duringBob = inspectDuelNativeHoldAttemptV3(attempt, bob, source.uid,
    source.zoneEpoch, source.controllerPlayerId, pending.pending.taskId);
  const afterReturn = inspectDuelNativeHoldAttemptV3(attempt, aliceAgain, source.uid,
    source.zoneEpoch, source.controllerPlayerId, pending.pending.taskId);
  console.log(JSON.stringify({ variant: 'controller-round-trip', duringBob, afterReturn,
    zoneEpoch: aliceAgain.match.physicalCardsByUID[source.uid].zoneEpoch }));
  assert.equal(duringBob, false);
  assert.equal(afterReturn, false);
});

test('a real completed required payment resumes its original Hold task', () => {
  const sources = handlers();
  let attest;
  const pending = runDuelStartOfTurnV2(playing(), { sources, resolveNativeHandlers: context => {
    const source = context.sources[0];
    const sourceReference = { kind: 'effect', referenceId: 'review:hold-payment', sourceUID: source.uid };
    const task = { matchId: context.match.matchId, expectedVersion: context.match.stateVersion,
      taskId: 'review:cost-task', paymentId: 'review:payment', actor: 'alice',
      finalResolvedCost: { energy: 0, power: [] }, opaqueSource: sourceReference,
      continuationId: 'review:continuation' };
    const epoch = context.match.physicalCardsByUID[source.uid].zoneEpoch;
    attest = request => ({ matchId: request.match.matchId, actor: request.actor,
      paymentId: request.paymentId, sourceReference: request.sourceReference,
      sourceProofId: 'review:independent-payment-source', mode: 'current',
      sourceZoneEpoch: epoch, taskId: request.taskId, continuationId: request.continuationId });
    const issued = issueDuelRequiredCostTaskV2(context.session, task, attest);
    const active = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, attest);
    return { status: 'pending', session: active.session };
  } });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.session.requiredTasks[0].status, 'active');
  assert.equal(pending.session.match.frame.pendingPayment.paymentId, 'review:payment');
  const paid = applyDuelResourceCommandV2(pending.session, 'alice', {
    commandId: 'review:pay-once', expectedVersion: pending.session.match.stateVersion,
    command: { type: 'pay-pending', paymentId: 'review:payment' },
  }, { sourceAttestor: attest });
  assert.equal(paid.outcome.status, 'applied');
  assert.equal(paid.session.requiredTasks[0].status, 'completed');
  const resumed = resumeDuelStartOfTurnV2(paid.session, pending.pending.taskId,
    retry(pending), { sources: noHandlers(), fepr: () => ({ status: 'none' }) });
  console.log(JSON.stringify({ variant: 'payment', pendingSessionIsReal: true,
    pendingTaskID: pending.session.turnCursorV2.pendingTaskID,
    paidTask: paid.session.requiredTasks[0].status, resume: resumed.status,
    reason: resumed.reason, step: resumed.session.turnCursorV2.step }));
  assert.equal(resumed.status, 'main');
});

function captureAttempt(session = playing(), sources = handlers()) {
  let attempt, source, callbackSession, invocation;
  const pending = runDuelStartOfTurnV2(session, { sources, resolveNativeHandlers: context => {
    callbackSession = context.session;
    invocation = context.nativeHoldInvocationV3;
    source = context.sources[0];
    attempt = issueDuelNativeHoldAttemptV3(invocation, source);
    return { status: 'pending' };
  } });
  assert.equal(pending.status, 'pending', pending.reason);
  return { pending, attempt, source, callbackSession, invocation };
}

test('unknown Hold sources remain pending without invoking native handlers', () => {
  let calls = 0;
  const pending = runDuelStartOfTurnV2(playing(), {
    sources: oracle(request => request.event === 'hold' ? { status: 'unknown' } : {}),
    resolveNativeHandlers: () => { calls++; return { status: 'pending' }; },
  });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.pending.step, 'hold');
  assert.equal(calls, 0);
  assert.equal(inspectDuelNativeTokenHistoryV2(pending.session.match).births.length, 0);
});

test('issued Hold payment retains its exact task before the payment owner activates it', () => {
  let issued, attest;
  const pending = runDuelStartOfTurnV2(playing(), { sources: handlers(),
    resolveNativeHandlers: context => {
      const source = context.sources[0];
      attest = asked => ({ matchId: asked.match.matchId, actor: asked.actor,
        paymentId: asked.paymentId, sourceReference: asked.sourceReference,
        sourceProofId: 'issued:source', mode: 'current', sourceZoneEpoch: source.zoneEpoch,
        taskId: asked.taskId, continuationId: asked.continuationId });
      issued = issueDuelRequiredCostTaskV2(context.session, {
        matchId: context.match.matchId, expectedVersion: context.match.stateVersion,
        taskId: 'issued:task', paymentId: 'issued:payment', actor: 'alice',
        finalResolvedCost: { energy: 0, power: [] },
        opaqueSource: { kind: 'effect', referenceId: 'issued:effect', sourceUID: source.uid },
        continuationId: 'issued:continuation',
      }, attest);
      return { status: 'pending', session: issued.session };
    } });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.session, issued.session);
  assert.equal(pending.session.requiredTasks[0].status, 'issued');
  assert.equal(pending.session.turnCursorV2.pendingTaskID, pending.pending.taskId);
  assert.equal(resumeDuelStartOfTurnV2(pending.session, pending.pending.taskId, retry(pending), {
    sources: noHandlers(),
  }).status, 'rejected');
  const active = prepareDuelRequiredCostPaymentV2(pending.session, issued.authority, attest);
  const paid = applyDuelResourceCommandV2(active.session, 'alice', {
    commandId: 'issued:pay', expectedVersion: active.session.match.stateVersion,
    command: { type: 'pay-pending', paymentId: 'issued:payment' },
  }, { sourceAttestor: attest });
  assert.equal(paid.outcome.status, 'applied');
  assert.equal(resumeDuelStartOfTurnV2(paid.session, pending.pending.taskId, retry(pending), {
    sources: noHandlers(), fepr: () => ({ status: 'none' }),
  }).status, 'main');
});

test('native Hold issuance is callback-only, single-use and descriptor-safe', () => {
  let invocation, attempt, source, getterReads = 0;
  const pending = runDuelStartOfTurnV2(playing(), { sources: handlers(),
    resolveNativeHandlers: context => {
      invocation = context.nativeHoldInvocationV3;
      source = context.sources[0];
      assert.throws(() => issueDuelNativeHoldAttemptV3(structuredClone(invocation), source));
      assert.throws(() => issueDuelNativeHoldAttemptV3(invocation, {
        ...source, controllerPlayerId: 'foreign', toJSON: () => source,
      }));
      const accessor = { ...source };
      Object.defineProperty(accessor, 'uid', { enumerable: true,
        get: () => { getterReads++; return source.uid; } });
      assert.throws(() => issueDuelNativeHoldAttemptV3(invocation, accessor));
      attempt = issueDuelNativeHoldAttemptV3(invocation, source);
      assert.throws(() => issueDuelNativeHoldAttemptV3(invocation, source));
      return { status: 'pending' };
    } });
  assert.equal(pending.status, 'pending');
  assert.equal(getterReads, 0);
  assert.equal(valid(attempt, pending, source, pending.pending.taskId), true);
  assert.throws(() => issueDuelNativeHoldAttemptV3(invocation, source));
  assert.equal(valid(structuredClone(attempt), pending, source, pending.pending.taskId), false);
  assert.equal(valid(attempt, { session: structuredClone(pending.session) }, source,
    pending.pending.taskId), false);
  assert.equal(valid(attempt, { session: playing() }, source, pending.pending.taskId), false);
});

test('native Hold source continuity checks every Core commit inside a single session advance', () => {
  const controlled = commitDuelCommandMutationV2(playing(), draft => ({
    match: { ...draft, board: { ...draft.board, battlefields: draft.board.battlefields.map(
      (field, fieldIndex) => fieldIndex === 0 ? { ...field, controllerPlayerId: 'alice' } : field) } },
    transitions: [],
  })).session;
  const { pending, attempt, source, callbackSession } = captureAttempt(controlled);
  const change = (match, controllerPlayerId) => commitDuelPlayingMutationV2(match, draft => ({
    match: { ...draft, board: { ...draft.board, battlefields: draft.board.battlefields.map(field =>
      field.instanceId === source.uid ? { ...field, controllerPlayerId } : field) } },
    transitions: [],
  }));
  const bob = change(callbackSession.match, 'bob');
  const aliceAgain = change(bob, 'alice');
  const advanced = advanceDuelCommandSessionNativeV2(callbackSession, aliceAgain).session;
  assert.equal(advanced.match.physicalCardsByUID[source.uid].zoneEpoch, source.zoneEpoch);
  assert.equal(valid(attempt, { session: advanced }, source, pending.pending.taskId), false);
});

test('different Hold boundaries in one native lineage remain isolated', () => {
  const initial = playing();
  const otherSources = oracle(request => request.event === 'hold' &&
    request.taskId.includes(':hold-effects:') && request.source.uid === request.subjectUID
    ? { scope: 'handlers-or-modifiers' } : {});
  const other = runDuelStartOfTurnV2(initial, { sources: otherSources,
    resolveNativeHandlers: () => ({ status: 'pending' }) });
  assert.equal(other.pending.step, 'hold-effects');
  let attempt, source, nested;
  const pending = runDuelStartOfTurnV2(initial, { sources: handlers(),
    resolveNativeHandlers: context => {
      source = context.sources[0];
      attempt = issueDuelNativeHoldAttemptV3(context.nativeHoldInvocationV3, source);
      nested = resumeDuelStartOfTurnV2(other.session, other.pending.taskId, retry(other), {
        sources: otherSources, resolveNativeHandlers: () => ({ status: 'pending' }),
      });
      return { status: 'pending' };
    } });
  assert.equal(pending.status, 'pending');
  assert.equal(nested.status, 'pending');
  assert.equal(valid(attempt, pending, source, pending.pending.taskId), true);
});

function syntheticRecruitSources() {
  const catalog = index();
  const references = new Map(catalog.printings.map(printing => [printing.cardId, printing.programReference]));
  const evidence = (request, programReference, scope = 'known-no-handler') => ({
    status: 'complete', matchId: request.matchId, dataVersion: request.dataVersion,
    catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
    uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
    programReference, event: request.event, eventSupported: true, scope,
    replacementsCovered: true, staticCovered: true, continuousCovered: true, triggersCovered: true,
  });
  return createDuelPhaseSourceRegistryWithNativeTokenSourceV2(catalog,
    request => evidence(request, references.get(request.source.cardId),
      request.event === 'hold' && request.source.uid === request.subjectUID &&
      request.source.controllerPlayerId === 'alice' ? 'handlers-or-modifiers' : 'known-no-handler'),
    request => {
      const birth = inspectDuelNativeTokenHistoryV2(request.match).births.find(item =>
        item.kind === 'recruit' && item.tokenUID === request.source.uid);
      assert.ok(birth);
      return evidence(request, JSON.stringify({ birthEventId: birth.eventId,
        catalogDigest: request.catalogDigest, dataVersion: request.dataVersion,
        kind: 'recruit-birth-reference', matchId: request.matchId, schemaVersion: 1,
        sourceEffectId: birth.sourceEffectId, sourceMode: birth.sourceMode,
        sourceProofId: birth.sourceProofId, sourceUID: birth.sourceUID,
        sourceZoneEpoch: birth.sourceZoneEpoch, tokenUID: birth.tokenUID }));
    });
}

function syntheticRecruitClosure(match, request, event) {
  const context = { matchId: match.matchId, dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest, turn: match.frame.turnNumber,
    taskId: request.taskId, phase: 'hold', event,
    clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq } };
  const ledger = name => ({ status: 'empty', ledgerId: `synthetic:${name}`, revision: 0,
    proofId: `synthetic:${name}:${match.stateVersion}`, matchId: context.matchId,
    dataVersion: context.dataVersion, catalogDigest: context.catalogDigest, turn: context.turn,
    taskId: context.taskId, clock: context.clock, entries: [] });
  const catalog = index();
  const registry = createDuelPhaseSourceClosureRegistryV2(catalog,
    ({ context: current, source, expectedProgramReference, referenceKind }) => {
      assert.ok(catalog.printings.some(printing => printing.cardId === source.cardId &&
        printing.programReference === expectedProgramReference));
      return { ...current, status: 'complete', uid: source.uid, kind: source.kind,
        cardId: source.cardId, zoneEpoch: source.zoneEpoch,
        controllerPlayerId: source.controllerPlayerId, zone: source.zone,
        programReference: expectedProgramReference, referenceKind,
        proofId: `synthetic:${source.uid}:${event}`, eventSupported: true, decision: 'inactive',
        coverage: { wholeProgram: true, zoneScope: 'whole-program', eventScope: 'whole-program',
          static: true, replacements: true, continuous: true, triggers: true } };
    });
  const transition = match.provenance.transitions[0];
  assert.ok(transition);
  assert.ok(enumerateDuelObjectsV2(match).every(source => source.cardId !== null));
  const journal = createDuelPhaseSourceClosureJournalV2({ ...context,
    tokenReferences: [], preExitSources: [], drawSubjects: [],
    transitions: event === 'zone-transition' ? [{ ...transition,
      eventId: 'synthetic:initial-transfer', fromZoneEpoch: 0, toZoneEpoch: 1,
      proofId: 'synthetic:initial-transfer' }] : [],
    activeEffects: ledger('activeEffects'), chain: ledger('chain'),
    effectQueue: ledger('effectQueue'), feprOutstanding: ledger('feprOutstanding'),
  });
  return { context, registry, journal };
}

function syntheticRecruitCost(match, token, transactionId) {
  const request = { transactionId, subjectId: token.tokenUID, kind: 'card-play' };
  const base = { energy: 0, power: [] };
  const modifier = { id: 'synthetic:increase', sourceProofId: 'synthetic:modifier', stage: 'increase',
    operation: 'increase', target: { kind: 'new-component' }, cost: { energy: 1, power: [] } };
  const revision = { registryRevision: 'synthetic:1', catalogRevision: match.catalogDigest };
  const snapshot = { ...revision, nonResourceCosts: 'none',
    base: { cost: base, sourceUid: token.sourceUID, sourceEpoch: token.sourceZoneEpoch },
    candidates: [{ sourceUid: token.sourceUID, sourceEpoch: token.sourceZoneEpoch,
      choice: 'mandatory', modifierIds: [modifier.id] }], orderedModifiers: [modifier] };
  const fingerprints = fingerprintDuelCostCoverageV2(snapshot);
  return createDuelCostResolverAuthorityV2(() => ({ request,
    base: { request, cost: base, status: 'complete', proofId: 'synthetic:base',
      sourceUid: token.sourceUID, sourceEpoch: token.sourceZoneEpoch, ...revision },
    coverage: { request, proofId: 'synthetic:coverage', status: 'complete',
      allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: 'none',
      ...revision, ...fingerprints },
    proofs: [{ proofId: modifier.sourceProofId, modifierId: modifier.id, request,
      target: modifier.target, status: 'complete', applicability: 'applies',
      sourceUid: token.sourceUID, sourceEpoch: token.sourceZoneEpoch, ...revision,
      modifierFingerprint: fingerprintDuelCostModifierV2(request, modifier), ...fingerprints }],
    modifiers: [modifier],
  }), () => snapshot);
}

test('protected TokenPlay pays a real modified cost and resumes the exact Hold task with one birth', () => {
  let session = playing();
  const ordinary = { sources: noHandlers(), fepr: () => ({ status: 'none' }) };
  for (const actor of ['alice', 'bob']) {
    const main = runDuelStartOfTurnV2(session, ordinary);
    assert.equal(main.status, 'main', main.reason);
    const ended = runDuelEndOfTurnV2(main.session, actor, ordinary);
    assert.equal(ended.status, 'awaiting-turn-start', ended.reason);
    session = ended.session;
  }
  assert.equal(session.match.frame.turnNumber, 3);
  session = commitDuelCommandMutationV2(session, draft => ({
    match: { ...draft, board: { ...draft.board, battlefields: draft.board.battlefields.map(
      (field, fieldIndex) => fieldIndex === 0 ? { ...field, controllerPlayerId: 'alice' } : field) } },
    transitions: [],
  })).session;
  let tokenPlay, attempt, source, request, callbackCount = 0, costCalls = 0;
  const services = { sources: syntheticRecruitSources(), fepr: () => ({ status: 'none' }),
    resolveNativeHandlers: context => {
      callbackCount++;
      assert.equal(context.taskId, request?.taskId ?? context.taskId);
      assert.equal(context.session.turnCursorV2.pendingTaskID, context.taskId);
      if (!tokenPlay) {
        source = context.sources.find(item => item.uid === context.match.board.battlefields[context.holdIndex].instanceId);
        attempt = issueDuelNativeHoldAttemptV3(context.nativeHoldInvocationV3, source);
        const token = { kind: 'recruit', tokenUID: 'lifecycle:recruit', sourceEffectId: 'lifecycle:effect',
          eventId: 'lifecycle:event', sourceUID: source.uid, sourceZoneEpoch: source.zoneEpoch,
          sourceMode: 'current', effectControllerPlayerId: 'alice', controllerPlayerId: 'alice',
          locationId: context.match.board.bases.find(base => base.ownerPlayerId === 'alice').locationId,
          readied: false, name: 'Recruit', baseMight: 1, tags: ['Recruit'] };
        request = { commandId: 'lifecycle:play', expectedVersion: context.match.stateVersion, token,
          taskId: context.taskId, paymentId: 'lifecycle:payment', continuationId: 'lifecycle:continuation',
          transactionId: 'lifecycle:transaction' };
        tokenPlay = createDuelRecruitTokenPlayV3(context.session, request, {
          effectHead: current => ({ match: current.match, commandSession: current,
            commandId: request.commandId, sourceEffectId: token.sourceEffectId,
            eventId: token.eventId, sourceUID: source.uid, controllerPlayerId: 'alice',
            status: 'resolving', limitedPlay: true, nativeHoldAttemptV3: attempt,
            sourceProofId: 'lifecycle:source' }),
          tokenSource: ({ match, request: asked }) => ({ ...asked, matchId: match.matchId,
            dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
            sourceProofId: 'lifecycle:source' }),
          paymentSource: asked => ({ matchId: asked.match.matchId, actor: asked.actor,
            paymentId: asked.paymentId, sourceReference: asked.sourceReference,
            sourceProofId: 'lifecycle:payment-source', mode: 'current',
            sourceZoneEpoch: source.zoneEpoch, taskId: asked.taskId, continuationId: asked.continuationId }),
          cost: ({ match, transactionId }) => {
            costCalls++;
            return syntheticRecruitCost(match, token, transactionId);
          },
          bindCost: asked => ({ ...asked, status: 'complete' }),
          legality: asked => ({ ...asked, status: 'complete' }),
          entry: asked => ({ ...asked, proofId: 'synthetic:entry', status: 'complete',
            disposition: 'default-exhausted-no-effects' }),
          closure: syntheticRecruitClosure,
        });
        assert.equal(beginDuelRecruitTokenPlayV3(tokenPlay).stage, 'chain');
      } else rebindDuelRecruitTokenPlayV3(tokenPlay, context.session);
      const progress = resumeDuelRecruitTokenPlayV3(tokenPlay);
      if (progress.status === 'finalized') return { status: 'applied',
        match: progress.session.match, handledSources: [source] };
      assert.equal(progress.stage, 'payment', progress.reason);
      return { status: 'continuing', session: progress.session, tokenPlay, handledSources: [source] };
    } };
  const pending = runDuelStartOfTurnV2(session, services);
  assert.equal(pending.status, 'pending', pending.reason);
  assert.equal(pending.session.turnCursorV2.pendingTaskID, pending.pending.taskId);
  assert.equal(pending.session.requiredTasks[0].status, 'active');
  assert.equal(pending.session.match.frame.pendingPayment.resolvedCost.energy, 1);
  assert.equal(inspectDuelNativeTokenHistoryV2(pending.session.match).births.length, 0);
  assert.equal(valid(attempt, pending, source, pending.pending.taskId), true);
  const blocked = resumeDuelStartOfTurnV2(pending.session, pending.pending.taskId, retry(pending), services);
  assert.equal(blocked.status, 'rejected');
  assert.equal(callbackCount, 1);
  const rune = pending.session.match.resources.bases.find(base => base.playerId === 'alice').baseRunes[0];
  const funded = applyDuelRecruitTokenResourceCommandV3(tokenPlay, 'alice', {
    commandId: 'lifecycle:fund', expectedVersion: pending.session.match.stateVersion,
    command: { type: 'rune-energy', uid: rune.uid },
  });
  assert.equal(funded.outcome.status, 'applied');
  const paid = applyDuelRecruitTokenResourceCommandV3(tokenPlay, 'alice', {
    commandId: 'lifecycle:pay', expectedVersion: funded.session.match.stateVersion,
    command: { type: 'pay-pending', paymentId: request.paymentId },
  });
  assert.equal(paid.outcome.status, 'applied');
  assert.equal(paid.outcome.paymentCompleted.requiredTask.taskId, pending.pending.taskId);
  assert.equal(paid.session.requiredTasks[0].status, 'completed');
  assert.equal(paid.session.match.frame.pendingPayment, null);
  assert.equal(valid(attempt, paid, source, pending.pending.taskId), true);
  assert.throws(() => rebindDuelRecruitTokenPlayV3(tokenPlay, pending.session), /descendant/);
  const resumed = resumeDuelStartOfTurnV2(paid.session, pending.pending.taskId, retry(pending), services);
  assert.equal(resumed.status, 'main', resumed.reason);
  assert.equal(callbackCount, 2);
  assert.equal(costCalls, 1);
  assert.equal(resumed.session.requiredTasks.length, 1);
  const births = inspectDuelNativeTokenHistoryV2(resumed.session.match).births;
  assert.equal(births.length, 1);
  assert.equal(births[0].tokenUID, request.token.tokenUID);
  assert.equal(resumed.session.match.board.units.find(unit => unit.objectId === request.token.tokenUID).controllerPlayerId, 'alice');
  assert.equal(resumed.session.match.unitMeta[request.token.tokenUID].readied, false);
  assert.equal(inspectDuelRecruitTokenPlayV3(tokenPlay).stage, 'finalized');
  assert.equal(resumeDuelRecruitTokenPlayV3(tokenPlay).status, 'finalized');
  assert.equal(resumeDuelStartOfTurnV2(resumed.session, pending.pending.taskId,
    retry(pending), services).status, 'duplicate');
  assert.equal(valid(attempt, resumed, source, pending.pending.taskId), false);
  assert.equal(inspectDuelNativeTokenHistoryV2(resumed.session.match).births.length, 1);
});
