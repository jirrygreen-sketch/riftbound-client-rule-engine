import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleDuelPhaseClosureEvidenceV2, createDuelPhaseClosureAuthorityV2,
  issueDuelPhaseClosureRequestV2,
} from '../dist/duel/phase-closure-evidence-v2.js';
import {
  createDuelOfficialProgramRegistry, duelAbilitySourceFromCatalog,
  encodeDuelProgramReferenceRaw, createDuelGoldIntrinsicAbilityReference,
  encodeDuelGoldIntrinsicAbilityReferenceRaw,
} from '@riftbound/card-dsl/duel';

const GOLD_REFERENCE = encodeDuelGoldIntrinsicAbilityReferenceRaw(createDuelGoldIntrinsicAbilityReference());
const contextFor = (phase = 'hold', event = phase) => ({
  matchId: 'one-match', dataVersion: 'catalog-one', catalogDigest: 'sha256:trusted-test',
  turn: 3, taskId: `duel-v2:one-match:turn-3:${event}:0`, phase, event,
  clock: { stateVersion: 44, eventSeq: 16 },
});
const printing = (id, cardType, ability, energy = null) => ({
  id, cardType, ability, energy, power: null, might: cardType === 'Unit' ? 1 : null,
  domains: ['Fury'], tags: [], canonicalCardId: `card.${id}`, name: id,
  fullName: id, localizedName: id, setCode: 'ogn', cardNumber: `OGN-${id}`, variant: 'standard',
});
function catalog(digest = 'sha256:trusted-test') {
  return createDuelOfficialProgramRegistry(duelAbilitySourceFromCatalog({
    dataVersion: 'catalog-one', digest, cards: [
      printing('field', 'Battlefield', 'When you hold here, play a 1 :rb_might: Recruit unit token in your base.'),
      printing('unit', 'Unit', '', 1),
      printing('conquer', 'Unit', 'When I conquer, play a Gold gear token exhausted.'),
      printing('unknown', 'Unit', 'Future unsupported ability.', 1),
      printing('continuous', 'Unit', 'Your token units have +1 :rb_might:.', 5),
    ],
  }));
}
const physicalFor = (cardId = 'unit', zoneEpoch = 2, uid = `uid-${cardId}`) => ({
  uid, kind: cardId === 'field' ? 'battlefield' : 'unit', cardId, zoneEpoch,
  controllerPlayerId: 'alice', zone: { kind: 'board-base', locationId: 'base-alice' },
  ownerPlayerId: 'alice', locationId: 'base-alice', attachedToUID: null,
  visibility: 'internal', carrier: 'object',
});
const locator = request => ({
  matchId: request.context.matchId, taskId: request.context.taskId, uid: request.source.uid,
});
const birthReference = (request, token) => JSON.stringify({
  birthEventId: token.birthEventId, catalogDigest: request.context.catalogDigest,
  dataVersion: request.context.dataVersion, kind: 'recruit-birth-reference',
  matchId: request.context.matchId, schemaVersion: 1,
  sourceEffectId: token.sourceEffectId, sourceMode: token.sourceMode,
  sourceProofId: token.sourceProofId, sourceUID: token.sourceUID,
  sourceZoneEpoch: token.sourceZoneEpoch, tokenUID: token.uid,
});
const clone = value => structuredClone(value);

// Test harness represents trusted Core, DSL registry and event journals in
// private Map/closure state. Only resolver callbacks read it; assembly gets
// neither those records nor a free-form candidate/context/attestation.
function protectedProviders(initial = {}) {
  const core = new Map();
  const tokenBirths = new Map();
  const sourceBirths = new Map([['creator-uid', { uid: 'creator-uid', zoneEpoch: 2 }]]);
  const journalEntries = new Map();
  const coverageNames = [
    'all-source-candidate-closure', 'hidden-zone-event-subjects',
    'continuous-effect-registry', 'cleanup-queue-and-replacements',
    'runtime-subevent-journal', 'recursive-conquer-event-journal',
    'draw-subject-journal', 'pre-exit-event-journal',
    'kill-trigger-effect-cases', 'zone-transition-journal',
  ];
  const controls = {
    registry: catalog(), journalRevision: 7, candidateSetRevision: 11,
    journalOff: new Set(), proofOverride: null, registryOverride: null,
    tokenOverride: null, journalOverride: null, coreOverride: null, ...initial,
  };
  const calls = { core: 0, registry: 0, token: 0, journal: 0 };
  const key = value => JSON.stringify([value.matchId, value.taskId, value.uid]);
  const requestKey = request => key(locator(request));
  const refresh = request => core.set(requestKey(request), clone(request));
  const captureJournal = request => journalEntries.set(requestKey(request), {
    request: clone(request), journalRevision: controls.journalRevision,
    candidateSetRevision: controls.candidateSetRevision,
    proofs: new Map(coverageNames.map(requirement => [requirement, `event-log:${requirement}`])),
  });
  const add = (cardId = 'unit', phase = 'hold', event = phase) => {
    const context = contextFor(phase, event);
    const source = physicalFor(cardId);
    const ref = controls.registry.reference(cardId);
    const canonical = ref ?? {
      kind: 'duel-official-program-reference', schemaVersion: 1,
      programId: `riftbound-duel-official-v1:${cardId}`, cardId,
      dataVersion: context.dataVersion, sourceCatalogDigest: context.catalogDigest,
    };
    const request = {
      context, source, expectedProgramReference: encodeDuelProgramReferenceRaw(canonical),
      referenceKind: 'printing',
    };
    refresh(request);
    captureJournal(request);
    return request;
  };
  const addToken = (kind = 'gold') => {
    const context = contextFor();
    const source = {
      ...physicalFor(null, null, `token-${kind}`), kind: kind === 'gold' ? 'gold' : 'unit',
      cardId: null,
    };
    const referenceKind = kind === 'gold' ? 'gold-cr-intrinsic' : 'recruit-birth';
    const birth = {
      uid: source.uid, kind, birthEventId: `birth-${source.uid}`,
      sourceEffectId: 'effect-1', sourceUID: 'creator-uid', sourceZoneEpoch: 2,
      sourceMode: 'current', sourceProofId: 'protected-birth-proof',
      controllerPlayerId: source.controllerPlayerId, journalRevision: controls.journalRevision,
      decision: kind === 'gold' ? 'active' : 'inactive',
    };
    const expectedProgramReference = kind === 'gold' ? GOLD_REFERENCE :
      birthReference({ context, source, referenceKind }, birth);
    const request = { context, source, expectedProgramReference, referenceKind };
    birth.programReference = expectedProgramReference;
    tokenBirths.set(source.uid, birth);
    refresh(request);
    captureJournal(request);
    return request;
  };
  const authority = createDuelPhaseClosureAuthorityV2({
    resolveCore: sourceLocator => {
      calls.core++;
      return controls.coreOverride?.(sourceLocator, core.get(key(sourceLocator))) ?? core.get(key(sourceLocator)) ?? null;
    },
    resolveRegistry: request => {
      calls.registry++;
      if (controls.registryOverride) return controls.registryOverride(request);
      const cardId = request.source.cardId;
      if (!cardId) return null;
      const reference = controls.registry.reference(cardId);
      if (!reference) return null;
      return {
        request: clone(request),
        encodedProgramReference: encodeDuelProgramReferenceRaw(reference),
        sourceLocal: controls.registry.sourceProgramPhaseScope(cardId, request.context.phase),
      };
    },
    resolveToken: request => {
      calls.token++;
      if (controls.tokenOverride) return controls.tokenOverride(request);
      const birth = tokenBirths.get(request.source.uid);
      const source = birth ? sourceBirths.get(birth.sourceUID) : null;
      const journal = journalEntries.get(requestKey(request));
      return birth && source && source.zoneEpoch === birth.sourceZoneEpoch &&
        birth.programReference === request.expectedProgramReference &&
        journal?.journalRevision === birth.journalRevision &&
        JSON.stringify(journal.request) === JSON.stringify(request)
        ? {
          request: clone(request), uid: birth.uid, kind: birth.kind,
          birthEventId: birth.birthEventId, sourceEffectId: birth.sourceEffectId,
          sourceUID: birth.sourceUID, sourceZoneEpoch: birth.sourceZoneEpoch,
          sourceMode: birth.sourceMode, sourceProofId: birth.sourceProofId,
          controllerPlayerId: birth.controllerPlayerId,
          journalRevision: birth.journalRevision,
          programReference: birth.programReference, decision: birth.decision,
        } : null;
    },
    resolveJournal: (request, requirements) => {
      calls.journal++;
      if (controls.journalOverride) return controls.journalOverride(request, requirements);
      const snapshot = journalEntries.get(requestKey(request));
      if (!snapshot || JSON.stringify(snapshot.request) !== JSON.stringify(request) ||
          snapshot.journalRevision !== controls.journalRevision ||
          snapshot.candidateSetRevision !== controls.candidateSetRevision) return null;
      const proofId = controls.proofOverride ??
        `protected-journal:${request.context.matchId}:${request.context.taskId}:` +
        `${request.context.phase}:${request.context.event}:${request.source.uid}:${request.source.zoneEpoch}:` +
        `${snapshot.journalRevision}:${snapshot.candidateSetRevision}`;
      return {
        request: clone(snapshot.request), proofId,
        journalRevision: snapshot.journalRevision,
        candidateSetRevision: snapshot.candidateSetRevision,
        coverage: requirements.filter(item => !controls.journalOff.has(item) && snapshot.proofs.has(item))
          .map(requirement => ({
            requirement, journalRevision: snapshot.journalRevision,
            proofId: snapshot.proofs.get(requirement),
          })),
      };
    },
  });
  const issue = request => issueDuelPhaseClosureRequestV2(authority, locator(request));
  const assemble = request => assembleDuelPhaseClosureEvidenceV2({ authority, request: issue(request) });
  return { authority, controls, calls, core, tokenBirths, sourceBirths, journalEntries,
    refresh, captureJournal, add, addToken, issue, assemble };
}
test('verified Unit continuous effects are active on the Board and inactive in private zones', () => {
  for (const zone of ['hand', 'main-deck', 'trash', 'champion-zone', 'chain']) {
    const h = protectedProviders(), request = h.add('continuous', 'awaken');
    request.source = { ...request.source, kind: 'card', zone: { kind: zone, zonePlayerId: 'alice' }, locationId: null };
    h.refresh(request); h.captureJournal(request);
    assert.equal(h.assemble(request).status, 'complete', zone);
    assert.equal(h.assemble(request).decision, 'inactive', zone);
  }
  const h = protectedProviders(), request = h.add('continuous', 'awaken');
  assert.equal(h.assemble(request).decision, 'active');
});

function success(args) {
  const result = assembleDuelPhaseClosureEvidenceV2(args);
  assert.equal(result.status, 'complete', JSON.stringify(result));
  assert.deepEqual(Object.keys(result).sort(), [
    'status', 'matchId', 'dataVersion', 'catalogDigest', 'turn', 'taskId', 'phase', 'event', 'clock',
    'uid', 'kind', 'cardId', 'zoneEpoch', 'controllerPlayerId', 'zone', 'programReference',
    'referenceKind', 'proofId', 'eventSupported', 'decision', 'coverage',
  ].sort());
  assert.deepEqual(result.coverage, {
    wholeProgram: true, zoneScope: 'whole-program', eventScope: 'whole-program',
    static: true, replacements: true, continuous: true, triggers: true,
  });
  return result;
}
function unknown(args, reason) {
  const result = assembleDuelPhaseClosureEvidenceV2(args);
  assert.equal(result.status, 'unknown', JSON.stringify(result));
  if (reason !== undefined) assert.equal(result.reason, reason);
  assert.deepEqual(Object.keys(result).sort(), ['reason', 'status']);
}

// Positive cases call real DSL and lookup-backed provider callbacks. The test
// data and callbacks are injected into authority only by the protected harness.
test('fresh protected Core + real DSL registry + journal yields detached evidence', () => {
  const p = protectedProviders();
  const request = p.add();
  const handle = p.issue(request);
  assert.ok(handle);
  const result = success({ authority: p.authority, request: handle });
  assert.equal(result.decision, 'inactive');
  assert.equal(result.uid, request.source.uid);
  assert.equal(result.programReference, request.expectedProgramReference);
  assert.notEqual(result.zone, request.source.zone);
  assert.notEqual(result.clock, request.context.clock);
  assert.deepEqual(p.calls, { core: 2, registry: 1, token: 0, journal: 1 });
  assert.equal(success({ authority: p.authority, request: handle }).decision, 'inactive');
});
test('real hold handler cannot be converted to inactive by injected local data', () => {
  const p = protectedProviders(), request = p.add('field');
  assert.equal(p.assemble(request).decision, 'handler');
  const forged = clone(p.controls.registry.sourceProgramPhaseScope('field', 'hold'));
  forged.handlers = [];
  forged.directBoundaryStatus = 'known-no-handler';
  forged.sourceApplicabilityStatus = 'known-no-handler';
  unknown({ authority: p.authority, request: p.issue(request), sourceLocal: forged }, 'invalid-assembly-input');
  assert.equal(p.assemble(request).decision, 'handler');
});
test('runtime conquer subevents do not become direct phase handlers', () => {
  const p = protectedProviders(), request = p.add('conquer', 'main');
  const resolved = p.controls.registry.sourceProgramPhaseScope('conquer', { phase: 'main', mode: 'runtime-subevents' });
  assert.equal(resolved.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.equal(resolved.directBoundaryStatus, 'known-no-handler');
  assert.deepEqual(resolved.runtimeSubevents.map(item => item.event), ['conquer']);
  assert.equal(p.assemble(request).decision, 'inactive');
  p.controls.journalOff.add('recursive-conquer-event-journal');
  unknown({ authority: p.authority, request: p.issue(request) }, 'missing-global-closure:recursive-conquer-event-journal');
});
test('all basic journal obligations fail closed when protected journal omits one', () => {
  const flags = [
    'all-source-candidate-closure', 'hidden-zone-event-subjects',
    'continuous-effect-registry', 'cleanup-queue-and-replacements',
    'runtime-subevent-journal', 'recursive-conquer-event-journal',
  ];
  for (const requirement of flags) {
    const p = protectedProviders();
    const request = p.add();
    p.controls.journalOff.add(requirement);
    unknown({ authority: p.authority, request: p.issue(request) }, `missing-global-closure:${requirement}`);
  }
});
test('draw/draw-subject and lethal-kill/pre-exit require special journal coverage', () => {
  for (const [phase, event, missing] of [
    ['draw', 'draw', 'draw-subject-journal'],
    ['draw', 'draw-subject', 'draw-subject-journal'],
    ['lethal-kill', 'lethal-kill', 'pre-exit-event-journal'],
    ['lethal-kill', 'pre-exit', 'pre-exit-event-journal'],
    ['lethal-kill', 'pre-exit', 'kill-trigger-effect-cases'],
    ['main', 'zone-transition', 'zone-transition-journal'],
  ]) {
    const p = protectedProviders(), request = p.add('unit', phase, event);
    assert.equal(p.assemble(request).status, 'complete', `${phase}/${event}`);
    p.controls.journalOff.add(missing);
    unknown({ authority: p.authority, request: p.issue(request) }, `missing-global-closure:${missing}`);
  }
});
test('unbound pre-exit candidates and unsupported runtime-effect programs remain unknown', () => {
  const p = protectedProviders(), ordinary = p.add();
  const preExit = clone(ordinary);
  preExit.source.carrier = 'pre-exit';
  p.refresh(preExit);
  p.captureJournal(preExit);
  unknown({ authority: p.authority, request: p.issue(preExit) }, 'unbound-pre-exit-candidate');
  const runtime = clone(ordinary);
  runtime.source = {
    ...runtime.source, kind: 'effect', carrier: 'runtime-effect',
    sourceUID: 'creator-uid', effectId: 'effect-1', runtimeKind: 'queued-effect',
  };
  p.refresh(runtime);
  p.captureJournal(runtime);
  unknown({ authority: p.authority, request: p.issue(runtime) }, 'unsupported-runtime-effect-program');
});
test('unknown real DSL program is never interpreted as local inactivity', () => {
  const p = protectedProviders(), request = p.add('unknown');
  assert.equal(p.controls.registry.sourceProgramPhaseScope('unknown', 'hold').scope, 'unknown');
  unknown({ authority: p.authority, request: p.issue(request) }, 'unbound-source-local-program');
  const valid = p.add('unit');
  const forged = clone(p.controls.registry.sourceProgramPhaseScope('unit', 'hold'));
  forged.sourceCardId = 'unknown';
  forged.reference = clone(p.controls.registry.reference('unknown'));
  unknown({ authority: p.authority, request: p.issue(request), sourceLocal: forged }, 'invalid-assembly-input');
  assert.equal(p.assemble(valid).decision, 'inactive');
});
test('raw JSON booleans, clones and spreads cannot construct either capability', () => {
  const p = protectedProviders(), request = p.add();
  const handle = p.issue(request);
  const forged = {
    candidate: request.source, context: request.context,
    encodedProgramReference: request.expectedProgramReference, referenceKind: request.referenceKind,
    sourceLocal: p.controls.registry.sourceProgramPhaseScope('unit', 'hold'), tokenIntrinsic: null,
    globalClosure: { proofId: 'invented', allSourceCandidateClosure: true, hiddenZoneEventSubjects: true,
      continuousEffectRegistry: true, cleanupQueueAndReplacements: true, drawSubjectJournal: true,
      preExitEventJournal: true, killTriggerEffectCases: true, runtimeSubeventJournal: true,
      recursiveConquerEventJournal: true },
  };
  for (const attacker of [forged, clone(forged), { ...forged }, JSON.parse(JSON.stringify(forged))]) {
    unknown(attacker, 'invalid-assembly-input');
  }
  for (const pair of [
    { authority: p.authority, request: clone(handle) },
    { authority: p.authority, request: { ...handle } },
    { authority: clone(p.authority), request: handle },
    { authority: { ...p.authority }, request: handle },
    JSON.parse(JSON.stringify({ authority: p.authority, request: handle })),
  ]) unknown(pair, 'unbound-core-request');
  assert.equal(success({ authority: p.authority, request: handle }).status, 'complete');
});
test('cross-authority and cross-request replay fail even with coincident proof IDs', () => {
  const p = protectedProviders({ proofOverride: 'same-proof' }), other = protectedProviders();
  const first = p.add('unit');
  const handle = p.issue(first);
  success({ authority: p.authority, request: handle });
  unknown({ authority: other.authority, request: handle }, 'unbound-core-request');
  const second = {
    ...clone(first),
    context: { ...clone(first.context), matchId: 'other-match', turn: 9,
      taskId: 'duel-v2:other-match:turn-9:main:1', phase: 'main', event: 'main',
      clock: { stateVersion: 55, eventSeq: 37 } },
    source: { ...clone(first.source), uid: 'uid-other', zoneEpoch: 7,
      controllerPlayerId: 'bob', zone: { kind: 'board-base', locationId: 'base-bob' } },
  };
  p.refresh(second);
  p.captureJournal(second);
  const replay = p.issue(second);
  unknown({ authority: p.authority, request: replay }, 'replayed-or-colliding-global-proof');
  assert.equal(success({ authority: p.authority, request: handle }).proofId, 'same-proof');
});
test('new match/task/phase/event/clock/source/reference or catalog invalidates issued request', () => {
  const changes = [
    request => { request.context.matchId = 'other-match'; },
    request => { request.context.taskId = 'other-task'; },
    request => { request.context.phase = 'main'; request.context.event = 'main'; },
    request => { request.context.event = 'zone-transition'; },
    request => { request.context.clock.stateVersion++; },
    request => { request.context.clock.eventSeq++; },
    request => { request.source.uid = 'other-uid'; },
    request => { request.source.zoneEpoch++; },
    request => { request.source.zone.locationId = 'foreign-base'; },
    request => { request.source.controllerPlayerId = 'bob'; },
    request => { request.source.ownerPlayerId = 'bob'; },
    request => { request.source.locationId = 'other-location'; },
    request => { request.source.attachedToUID = 'foreign-attachment'; },
    request => { request.source.carrier = 'pre-exit'; },
    request => { request.expectedProgramReference = 'foreign'; },
    request => { request.referenceKind = 'gold-cr-intrinsic'; },
    request => { request.context.catalogDigest = 'sha256:replaced'; },
    request => { request.context.dataVersion = 'catalog-two'; },
  ];
  for (const change of changes) {
    const p = protectedProviders(), request = p.add();
    const handle = p.issue(request);
    const wrong = clone(request);
    change(wrong);
    p.controls.coreOverride = () => wrong;
    unknown({ authority: p.authority, request: handle }, 'stale-or-foreign-core-request');
  }
});
test('printing reference must retain exact canonical encoding', () => {
  for (const suffix of [' ', '\n', '{}']) {
    const p = protectedProviders(), request = p.add();
    const malformed = clone(request);
    malformed.expectedProgramReference += suffix;
    p.refresh(malformed);
    p.captureJournal(malformed);
    unknown({ authority: p.authority, request: p.issue(malformed) }, 'unbound-source-local-program');
  }
});
test('registry response from another request cannot certify this printing', () => {
  const p = protectedProviders(), request = p.add();
  const handle = p.issue(request);
  p.controls.registryOverride = current => ({
    request: { ...clone(current), context: { ...clone(current.context), event: 'zone-transition' } },
    encodedProgramReference: current.expectedProgramReference,
    sourceLocal: p.controls.registry.sourceProgramPhaseScope('unit', 'hold'),
  });
  unknown({ authority: p.authority, request: handle }, 'unbound-source-local-program');
});
test('untrusted Core locator alone cannot issue a candidate or a catalog reference', () => {
  const p = protectedProviders(), request = p.add();
  assert.equal(issueDuelPhaseClosureRequestV2(p.authority, {
    matchId: 'one-match', taskId: request.context.taskId, uid: 'not-current',
  }), null);
  assert.equal(issueDuelPhaseClosureRequestV2(p.authority, {
    matchId: 'other-match', taskId: request.context.taskId, uid: request.source.uid,
  }), null);
  assert.equal(issueDuelPhaseClosureRequestV2(p.authority, {
    matchId: request.context.matchId, taskId: request.context.taskId,
    uid: request.source.uid, context: request.context, source: request.source,
  }), null);
});
test('candidate patch and catalog replacement cannot alter protected Core resolution', () => {
  const p = protectedProviders(), request = p.add();
  const handle = p.issue(request);
  for (const patch of [
    { ...clone(request.source), uid: 'foreign-uid' },
    { ...clone(request.source), controllerPlayerId: 'bob' },
    { ...clone(request.source), zoneEpoch: 999 },
  ]) unknown({ authority: p.authority, request: handle, candidate: patch }, 'invalid-assembly-input');
  p.controls.registry = catalog('sha256:replaced-catalog');
  unknown({ authority: p.authority, request: handle }, 'unbound-source-local-program');
});
test('invalid provider responses with accessor/extra coverage or missing journal revision fail closed', () => {
  const p = protectedProviders(), request = p.add();
  const handle = p.issue(request);
  p.controls.journalOverride = (current, required) => {
    const attested = {
      request: clone(current), proofId: 'getter-proof', journalRevision: 7,
      candidateSetRevision: 11, coverage: required.map(requirement => ({
        requirement, journalRevision: 7, proofId: `entry:${requirement}`,
      })),
    };
    Object.defineProperty(attested, 'proofId', { get() { throw Error('getter'); } });
    return attested;
  };
  unknown({ authority: p.authority, request: handle }, 'missing-or-foreign-global-attestation');
  p.controls.journalOverride = (current, required) => ({
    request: clone(current), proofId: 'extra-proof', journalRevision: 7,
    candidateSetRevision: 11, unknown: true,
    coverage: required.map(requirement => ({ requirement, journalRevision: 7, proofId: 'entry' })),
  });
  unknown({ authority: p.authority, request: handle }, 'missing-or-foreign-global-attestation');
  p.controls.journalOverride = (current, required) => ({
    request: clone(current), proofId: 'wrong-revision', journalRevision: 7,
    candidateSetRevision: 11,
    coverage: required.map(requirement => ({ requirement, journalRevision: 8, proofId: 'entry' })),
  });
  unknown({ authority: p.authority, request: handle }, 'missing-or-foreign-global-attestation');
});
test('forged global responses cannot come through assembly args; journal response is request-bound', () => {
  const p = protectedProviders(), request = p.add();
  const handle = p.issue(request);
  unknown({ authority: p.authority, request: handle, globalClosure: {
    proofId: 'raw', allSourceCandidateClosure: true,
  } }, 'invalid-assembly-input');
  p.controls.journalOverride = (current, required) => ({
    request: { ...clone(current), context: { ...clone(current.context), taskId: 'foreign-task' } },
    proofId: 'forged-journal', journalRevision: 7, candidateSetRevision: 11,
    coverage: required.map(requirement => ({ requirement, journalRevision: 7, proofId: 'forged' })),
  });
  unknown({ authority: p.authority, request: handle }, 'missing-or-foreign-global-attestation');
});
test('Gold and Recruit use lookup-backed births, canonical refs, current context and journal revision', () => {
  for (const kind of ['gold', 'recruit']) {
    const p = protectedProviders(), request = p.addToken(kind);
    const handle = p.issue(request);
    const result = success({ authority: p.authority, request: handle });
    assert.equal(result.decision, kind === 'gold' ? 'active' : 'inactive');
    assert.equal(result.cardId, null);
    assert.equal(result.zoneEpoch, null);
    p.tokenBirths.delete(request.source.uid);
    unknown({ authority: p.authority, request: handle }, 'unbound-token-intrinsic');
  }
  const p = protectedProviders(), request = p.addToken('gold');
  const handle = p.issue(request);
  p.tokenBirths.get(request.source.uid).journalRevision++;
  unknown({ authority: p.authority, request: handle }, 'unbound-token-intrinsic');
});
test('naked token active decision, wrong Gold ref and inconsistent birth are rejected', () => {
  const p = protectedProviders(), request = p.addToken('gold'), handle = p.issue(request);
  unknown({ authority: p.authority, request: handle, tokenIntrinsic: {
    programReference: 'attacker:gold:reference', sourceProofId: 'invented', decision: 'active',
  } }, 'invalid-assembly-input');
  p.tokenBirths.get(request.source.uid).sourceUID = 'other-source';
  unknown({ authority: p.authority, request: handle }, 'unbound-token-intrinsic');
  const wrong = protectedProviders(), wrongRequest = wrong.addToken('gold');
  wrongRequest.expectedProgramReference = 'attacker:gold:reference';
  wrong.refresh(wrongRequest);
  wrong.captureJournal(wrongRequest);
  unknown({ authority: wrong.authority, request: wrong.issue(wrongRequest) }, 'unbound-token-intrinsic');
  const recruit = protectedProviders(), recruitRequest = recruit.addToken('recruit');
  recruit.tokenBirths.get(recruitRequest.source.uid).birthEventId = 'foreign-birth';
  unknown({ authority: recruit.authority, request: recruit.issue(recruitRequest) }, 'unbound-token-intrinsic');
});
test('accessors, proxies and extra fields cannot yield complete at the public seam', () => {
  const p = protectedProviders(), request = p.add(), handle = p.issue(request);
  const getter = { authority: p.authority, request: handle };
  Object.defineProperty(getter, 'request', { get() { throw Error('unexpected getter'); } });
  unknown(getter, 'invalid-assembly-input');
  unknown({ authority: p.authority, request: handle, unexpected: true }, 'invalid-assembly-input');
  unknown(new Proxy({ authority: p.authority, request: handle }, {
    ownKeys() { throw Error('invalid proxy'); },
  }), 'invalid-assembly-input');
  assert.equal(issueDuelPhaseClosureRequestV2(p.authority, { ...locator(request), unknown: true }), null);
});
