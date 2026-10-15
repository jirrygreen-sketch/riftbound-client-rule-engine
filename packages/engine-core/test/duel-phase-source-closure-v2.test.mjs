import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelCommandSessionV2,
  applyDuelResourceCommandV2,
} from '../dist/duel/canonical-session-v2.js';
import {
  createDuelGoldTokenV2,
  enumerateDuelObjectsV2,
} from '../dist/duel/core-v2.js';
import {
  createDuelPhaseSourceClosureRegistryV2,
  createDuelPhaseSourceClosureJournalV2,
  inspectDuelPhaseSourceClosureV2,
  enumerateDuelPhaseSourceClosureCandidatesV2,
} from '../dist/duel/phase-source-closure-v2.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-card-${i}`, cardId: 'plain-unit' })),
  champion: { uid: `${playerId}-champion`, cardId: 'plain-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'plain-legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'plain-rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `plain-field-${i}` })),
}));
const metadata = {
  matchId: 'closure-v2',
  dataVersion: 'catalog-closure-v2',
  catalogDigest: 'sha256:closure-v2',
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })),
};
const cardType = id => id === 'plain-champion' ? 'Champion' : id === 'plain-legend' ? 'Legend' :
  id === 'plain-rune' ? 'Rune' : id.startsWith('plain-field-') ? 'Battlefield' : 'Unit';

function playing(selectionByPlayer = {}, randomIndex = () => 0) {
  let session = createDuelCommandSessionV2(seats, metadata, randomIndex, cardType);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(session, actor, {
      commandId: `mulligan-${actor}`,
      expectedVersion: session.match.stateVersion,
      command: { type: 'mulligan', selectedUIDs: selectionByPlayer[actor] ?? [] },
    });
    assert.equal(result.outcome.status, 'applied', JSON.stringify(result.outcome));
    session = result.session;
  }
  return session;
}

const printingIds = [...new Set(seats.flatMap(seat => [
  seat.champion.cardId,
  seat.legend.cardId,
  ...seat.mainDeck.map(card => card.cardId),
  ...seat.runeDeck.map(card => card.cardId),
  ...seat.battlefields.map(field => field.cardId),
]))];
const indexFor = (session, omitted = []) => ({
  matchId: session.match.matchId,
  dataVersion: session.match.dataVersion,
  catalogDigest: session.match.catalogDigest,
  printings: printingIds.filter(cardId => !omitted.includes(cardId)).map(cardId => ({
    cardId,
    programReference: `whole-program:${cardId}`,
  })),
});

function contextFor(session, event = 'awaken', patch = {}) {
  const phase = patch.phase ?? (event === 'draw-subject' ? 'draw' : event === 'pre-exit' ? 'ending' : event === 'zone-transition' ? 'ending' : event);
  const turn = session.match.frame.turnNumber;
  return {
    matchId: session.match.matchId,
    dataVersion: session.match.dataVersion,
    catalogDigest: session.match.catalogDigest,
    turn,
    taskId: `duel-v2:${session.match.matchId}:turn-${turn}:${event}:0`,
    phase,
    event,
    clock: { stateVersion: session.match.stateVersion, eventSeq: session.match.eventSeq },
    ...patch,
  };
}

function emptyLedger(session, context, name, patch = {}) {
  return {
    status: 'empty',
    ledgerId: `${name}:${session.match.matchId}`,
    revision: 0,
    proofId: `ledger-proof:${name}:${session.match.stateVersion}`,
    matchId: context.matchId,
    dataVersion: context.dataVersion,
    catalogDigest: context.catalogDigest,
    turn: context.turn,
    taskId: context.taskId,
    clock: { ...context.clock },
    entries: [],
    ...patch,
  };
}

function baseJournal(session, context, patch = {}) {
  return {
    ...context,
    tokenReferences: [],
    preExitSources: [],
    drawSubjects: [],
    transitions: [],
    activeEffects: emptyLedger(session, context, 'activeEffects'),
    chain: emptyLedger(session, context, 'chain'),
    effectQueue: emptyLedger(session, context, 'effectQueue'),
    feprOutstanding: emptyLedger(session, context, 'feprOutstanding'),
    ...patch,
  };
}

function evidence(request, patch = {}) {
  return {
    status: 'complete',
    matchId: request.context.matchId,
    dataVersion: request.context.dataVersion,
    catalogDigest: request.context.catalogDigest,
    turn: request.context.turn,
    taskId: request.context.taskId,
    phase: request.context.phase,
    event: request.context.event,
    clock: { ...request.context.clock },
    uid: request.source.uid,
    kind: request.source.kind,
    cardId: request.source.cardId,
    zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId,
    zone: { ...request.source.zone },
    programReference: request.expectedProgramReference,
    referenceKind: request.referenceKind,
    proofId: `program-proof:${request.source.uid}`,
    eventSupported: true,
    decision: 'inactive',
    coverage: {
      wholeProgram: true,
      zoneScope: 'whole-program',
      eventScope: 'whole-program',
      static: true,
      replacements: true,
      continuous: true,
      triggers: true,
    },
    ...patch,
  };
}

function registryFor(session, modify = () => ({}), omitted = []) {
  return createDuelPhaseSourceClosureRegistryV2(indexFor(session, omitted), request => {
    const patch = modify(request) ?? {};
    return patch.status === 'unknown' ? patch : { ...evidence(request), ...patch };
  });
}
function inspect(session, context = contextFor(session), registry = registryFor(session), journal = createDuelPhaseSourceClosureJournalV2(baseJournal(session, context))) {
  return inspectDuelPhaseSourceClosureV2(session.match, context, registry, journal);
}
function allCandidates(session) {
  return enumerateDuelPhaseSourceClosureCandidatesV2(session.match);
}
function sourceAt(session, uid) {
  return allCandidates(session).find(source => source.uid === uid);
}
function historyStep(session, predicate) {
  const step = session.match.provenance.transitions.find(predicate);
  assert.ok(step, 'expected a protected provenance transition');
  return step;
}
function transitionFor(session, step, eventId, fromZoneEpoch, toZoneEpoch) {
  return {
    eventId,
    uid: step.uid,
    from: { ...step.from },
    to: { ...step.to },
    fromZoneEpoch,
    toZoneEpoch,
    proofId: `transition-proof:${eventId}`,
  };
}
function preExitRecord(session) {
  const step = historyStep(session, value => value.from.kind === 'hand' && value.to.kind === 'main-deck');
  const current = sourceAt(session, step.uid);
  assert.ok(current);
  const transition = transitionFor(session, step, 'pre-exit-1', 0, 1);
  return {
    eventId: transition.eventId,
    source: {
      ...current,
      zone: { ...step.from },
      zoneEpoch: 0,
      carrier: 'pre-exit',
    },
    transition,
    proofId: transition.proofId,
  };
}
function drawRecord(session) {
  const step = historyStep(session, value => value.from.kind === 'main-deck' && value.to.kind === 'hand');
  const current = sourceAt(session, step.uid);
  assert.ok(current);
  assert.equal(current.zone.kind, 'hand');
  return transitionFor(session, step, 'draw-1', 0, 1);
}

function addGoldToken(session) {
  const source = session.match.players[0].legend;
  const sourceEpoch = session.match.physicalCardsByUID[source.uid].zoneEpoch;
  const locationId = session.match.board.bases.find(base => base.ownerPlayerId === 'alice').locationId;
  const request = {
    kind: 'gold',
    tokenUID: 'gold-closure-1',
    sourceEffectId: 'effect-gold-closure-1',
    eventId: 'event-gold-closure-1',
    sourceUID: source.uid,
    sourceZoneEpoch: sourceEpoch,
    sourceMode: 'current',
    effectControllerPlayerId: 'alice',
    controllerPlayerId: 'alice',
    locationId,
    readied: false,
  };
  const next = createDuelGoldTokenV2(session.match, request, ({ match, request: inner }) => ({
    ...inner,
    matchId: match.matchId,
    dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest,
    sourceProofId: 'gold-source-proof-1',
  }));
  return {
    session: { ...session, match: next },
    tokenReference: {
      uid: request.tokenUID,
      kind: 'gold',
      sourceEffectId: request.sourceEffectId,
      eventId: request.eventId,
      sourceUID: request.sourceUID,
      sourceZoneEpoch: request.sourceZoneEpoch,
      sourceMode: 'current',
      controllerPlayerId: request.controllerPlayerId,
      referenceKind: 'gold-cr-intrinsic',
      programReference: 'gold-cr:intrinsic',
      sourceProofId: 'gold-source-proof-1',
    },
  };
}

function tokenRegistry(session, tokenReference, modify = () => ({})) {
  return createDuelPhaseSourceClosureRegistryV2(indexFor(session), request => {
    const reference = request.referenceKind === 'gold-cr-intrinsic' ? tokenReference.programReference : request.expectedProgramReference;
    return evidence({ ...request, expectedProgramReference: reference }, modify(request));
  });
}

function runtimeEntry(session, context, source, kind = 'continuous-effect') {
  return {
    effectId: `runtime-${kind}`,
    kind,
    eventId: `runtime-event-${kind}`,
    sourceUID: source.uid,
    sourceZoneEpoch: source.zoneEpoch,
    cardId: source.cardId,
    controllerPlayerId: source.controllerPlayerId,
    zone: { ...source.zone },
    programReference: `whole-program:${source.cardId}`,
  };
}

// 1. Enumeration is over actual carriers, not merely current board/legend objects.
test('enumerates hidden and non-board carriers with private identity and epoch', () => {
  const session = playing();
  const actual = enumerateDuelObjectsV2(session.match);
  const closure = allCandidates(session);
  assert.equal(closure.length, actual.length);
  for (const zoneKind of ['hand', 'main-deck', 'champion-zone', 'rune-deck'])
    assert.ok(closure.some(source => source.zone.kind === zoneKind), `missing ${zoneKind}`);
  assert.ok(closure.some(source => source.kind === 'champion'));
  assert.ok(closure.every(source => source.visibility === 'internal'));
  assert.ok(closure.every(source => typeof source.uid === 'string' && source.zoneEpoch !== null));
});

// 2. An explicit inactive decision is accepted, while the candidate remains auditable.
test('whole-program inactive proof is ready without treating every zone as active', () => {
  const session = playing();
  const out = inspect(session);
  assert.equal(out.status, 'ready');
  assert.equal(out.candidates.length, allCandidates(session).length);
  assert.equal(out.activeSources.length, 0);
  assert.equal(out.handlers.length, 0);
  assert.ok(out.candidates.some(source => source.zone.kind === 'main-deck'));
});

// 3. The trusted producer—not a keyword heuristic—decides zone/event capability.
test('producer can distinguish hidden-zone handler from board inactive source', () => {
  const session = playing();
  const registry = registryFor(session, request => request.source.zone.kind === 'main-deck'
    ? { decision: 'handler' }
    : request.source.kind === 'legend'
      ? { decision: 'active' }
      : {});
  const out = inspect(session, contextFor(session), registry);
  assert.equal(out.status, 'ready');
  assert.ok(out.activeSources.some(source => source.kind === 'legend'));
  assert.ok(out.handlers.some(source => source.zone.kind === 'main-deck'));
  assert.ok(out.activeSources.every(source => source.kind === 'legend'));
  assert.ok(out.handlers.every(source => source.zone.kind === 'main-deck'));
});

// 4. Whole-program unknown is pending; the hidden candidate is not silently dropped.
test('unknown hidden whole program stays pending and preserves the candidate set', () => {
  const session = playing();
  const target = sourceAt(session, session.match.players[0].remainingMainDeck[0].uid);
  const registry = registryFor(session, request => request.source.uid === target.uid ? { status: 'unknown', reason: 'unknown IR family' } : {});
  const out = inspect(session, contextFor(session), registry);
  assert.equal(out.status, 'pending');
  assert.equal(out.reason, 'unknown-whole-program');
  assert.ok(out.candidates.some(source => source.uid === target.uid));
});

// 5. A missing printing is a source-closure failure, even if other printings are known.
test('omitted catalog printing fails closed', () => {
  const session = playing();
  const out = inspect(session, contextFor(session), registryFor(session, () => ({}), ['plain-legend']));
  assert.equal(out.status, 'pending');
  assert.equal(out.reason, 'missing-printing-program');
});

// 6. Missing runtime journals are not equivalent to a proven empty runtime ledger.
test('missing or mismatched active-effect ledger fails closed', () => {
  const session = playing();
  const context = contextFor(session, 'awaken');
  const missing = baseJournal(session, context, {
    activeEffects: emptyLedger(session, context, 'activeEffects', { clock: { stateVersion: context.clock.stateVersion + 1, eventSeq: context.clock.eventSeq } }),
  });
  const out = inspect(session, context, registryFor(session), createDuelPhaseSourceClosureJournalV2(missing));
  assert.equal(out.status, 'pending');
  assert.equal(out.reason, 'missing-activeEffects-coverage');
  assert.equal(inspect(session, context).status, 'ready', 'independent explicit empty ledgers are valid');
});

// 7. An independent empty effect queue is valid evidence, not a default [] assumption.
test('all four explicit empty ledgers certify no runtime carriers', () => {
  const session = playing();
  const context = contextFor(session, 'fepr');
  const out = inspect(session, context, registryFor(session), createDuelPhaseSourceClosureJournalV2(baseJournal(session, context)));
  assert.equal(out.status, 'ready');
  assert.equal(out.runtimeSources.length, 0);
  assert.equal(out.reason, undefined);
});

// 8. A real queue entry is included and must bind to an existing source/program.
test('active effect and queue entries become protected runtime candidates', () => {
  const session = playing();
  const context = contextFor(session, 'main');
  const source = sourceAt(session, session.match.players[0].legend.uid);
  const active = runtimeEntry(session, context, source, 'continuous-effect');
  const queue = runtimeEntry(session, context, source, 'queued-effect');
  queue.effectId = 'runtime-queued-effect';
  const journal = baseJournal(session, context, {
    activeEffects: emptyLedger(session, context, 'activeEffects', { status: 'entries', revision: 1, entries: [active] }),
    effectQueue: emptyLedger(session, context, 'effectQueue', { status: 'entries', revision: 1, entries: [queue] }),
  });
  const out = inspect(session, context, registryFor(session), createDuelPhaseSourceClosureJournalV2(journal));
  assert.equal(out.status, 'ready');
  assert.equal(out.runtimeSources.length, 2);
  assert.deepEqual(out.runtimeSources.map(source => source.effectId).sort(), ['runtime-continuous-effect', 'runtime-queued-effect']);
});

// 9. A queue carrier without a source journal binding cannot certify the phase.
test('forged runtime carrier and wrong program reference stay pending', () => {
  const session = playing();
  const context = contextFor(session, 'main');
  const source = sourceAt(session, session.match.players[0].legend.uid);
  const forged = { ...runtimeEntry(session, context, source, 'queued-effect'), effectId: 'forged-runtime', programReference: 'foreign-program' };
  const journal = baseJournal(session, context, {
    effectQueue: emptyLedger(session, context, 'effectQueue', { status: 'entries', entries: [forged], revision: 1 }),
  });
  const out = inspect(session, context, registryFor(session), createDuelPhaseSourceClosureJournalV2(journal));
  assert.equal(out.status, 'pending');
  assert.equal(out.reason, 'runtime-ledger-source-mismatch');
});

// 10. A draw subject is a concrete Main Deck -> Hand transition, not the current hand alone.
test('draw boundary requires an independently journaled draw subject', () => {
  const session = playing({ alice: [seats[0].mainDeck[1].uid] });
  const context = contextFor(session, 'draw');
  const missing = inspect(session, context);
  assert.equal(missing.status, 'pending');
  assert.equal(missing.reason, 'missing-draw-subject');
  const subject = drawRecord(session);
  const journal = baseJournal(session, context, { drawSubjects: [subject] });
  const ready = inspect(session, context, registryFor(session), createDuelPhaseSourceClosureJournalV2(journal));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.drawSubjects.length, 1);
  assert.equal(ready.drawSubjects[0].uid, subject.uid);
});

// 11. Pre-exit is bound to the old carrier and transition journal, never current().
test('pre-exit source requires an old-zone event journal and is not a current reference', () => {
  const session = playing({ alice: [seats[0].mainDeck[1].uid] });
  const context = contextFor(session, 'pre-exit');
  const record = preExitRecord(session);
  const missing = inspect(session, context);
  assert.equal(missing.status, 'pending');
  assert.equal(missing.reason, 'missing-pre-exit-journal');
  const journal = baseJournal(session, context, { preExitSources: [record] });
  const out = inspect(session, context, registryFor(session), createDuelPhaseSourceClosureJournalV2(journal));
  assert.equal(out.status, 'ready');
  assert.equal(out.preExitSources.length, 1);
  assert.equal(out.preExitSources[0].zone.kind, 'hand');
  assert.notEqual(out.preExitSources[0].zoneEpoch, sourceAt(session, record.source.uid).zoneEpoch);
});

// 12. Reusing a current source as pre-exit proof is specifically rejected.
test('pre-exit journal cannot reuse current zone/epoch as its source proof', () => {
  const session = playing({ alice: [seats[0].mainDeck[1].uid] });
  const context = contextFor(session, 'pre-exit');
  const record = preExitRecord(session);
  const current = sourceAt(session, record.source.uid);
  const forged = { ...record, source: { ...current, carrier: 'pre-exit' } };
  const journal = baseJournal(session, context, { preExitSources: [forged] });
  const out = inspect(session, context, registryFor(session), createDuelPhaseSourceClosureJournalV2(journal));
  assert.equal(out.status, 'pending');
  assert.equal(out.reason, 'pre-exit-transition-binding');
});

// 13. Null cardId is certifiable only through a protected intrinsic token reference.
test('Gold null-cardId candidate uses protected CR intrinsic reference', () => {
  const original = playing();
  const { session, tokenReference } = addGoldToken(original);
  const context = contextFor(session, 'main');
  const journal = baseJournal(session, context, { tokenReferences: [tokenReference] });
  const out = inspect(session, context, tokenRegistry(session, tokenReference), createDuelPhaseSourceClosureJournalV2(journal));
  assert.equal(out.status, 'ready');
  const gold = out.candidates.find(source => source.uid === tokenReference.uid);
  assert.ok(gold);
  assert.equal(gold.cardId, null);
  assert.equal(out.activeSources.length, 0);
});

// 14. Omitting the token lifecycle reference cannot be replaced by a fake printing.
test('missing Gold lifecycle reference fails closed', () => {
  const original = playing();
  const { session, tokenReference } = addGoldToken(original);
  const context = contextFor(session, 'main');
  const out = inspect(session, context, registryFor(session), createDuelPhaseSourceClosureJournalV2(baseJournal(session, context)));
  assert.equal(out.status, 'pending');
  assert.equal(out.reason, 'missing-token-reference');
  assert.ok(tokenReference.uid);
});

// 15. Cloned opaque capabilities are not accepted as registry/journal authority.
test('forged and structured-cloned registry or journal handles are rejected', () => {
  const session = playing();
  const context = contextFor(session);
  const registry = registryFor(session);
  const journal = createDuelPhaseSourceClosureJournalV2(baseJournal(session, context));
  const clonedRegistry = structuredClone(registry);
  const clonedJournal = structuredClone(journal);
  assert.equal(inspect(session, context, clonedRegistry, journal).reason, 'foreign-or-cloned-opaque-authority');
  assert.equal(inspect(session, context, registry, clonedJournal).reason, 'foreign-or-cloned-opaque-authority');
});

// 16. Evidence identity, epoch, event, and reference are all bound to one closure request.
test('stale or forged whole-program evidence cannot certify a source', () => {
  const session = playing();
  const target = session.match.players[0].legend.uid;
  const faults = [
    { uid: 'foreign-uid' },
    { zoneEpoch: 999 },
    { event: 'draw' },
    { programReference: 'foreign-program' },
    { cardId: 'foreign-card' },
  ];
  for (const fault of faults) {
    const registry = registryFor(session, request => fault);
    const out = inspect(session, contextFor(session), registry);
    assert.equal(out.status, 'pending', JSON.stringify(fault));
    assert.ok(out.reason === 'foreign-or-incomplete-whole-program-proof' || out.reason === 'malformed-whole-program-evidence');
  }
  assert.equal(target, 'alice-legend');
});

// 17. Transition event coverage is separate from the current source set.
test('zone-transition event requires a protected transition journal', () => {
  const session = playing({ alice: [seats[0].mainDeck[1].uid] });
  const context = contextFor(session, 'zone-transition');
  const missing = inspect(session, context);
  assert.equal(missing.status, 'pending');
  assert.equal(missing.reason, 'missing-transition-journal');
  const step = historyStep(session, value => value.from.kind === 'hand' && value.to.kind === 'main-deck');
  const item = transitionFor(session, step, 'transition-1', 0, 1);
  const journal = baseJournal(session, context, { transitions: [item] });
  const ready = inspect(session, context, registryFor(session), createDuelPhaseSourceClosureJournalV2(journal));
  assert.equal(ready.status, 'ready');
});

// 18. Wrong task/clock/match boundaries cannot be authorized by source content.
test('wrong task, clock, or phase boundary fails closed', () => {
  const session = playing();
  const base = contextFor(session);
  for (const patch of [
    { taskId: 'client-filled-index' },
    { clock: { stateVersion: base.clock.stateVersion + 1, eventSeq: base.clock.eventSeq } },
    { matchId: 'foreign-match' },
  ]) {
    const context = { ...base, ...patch };
    const out = inspect(session, context, registryFor(session), createDuelPhaseSourceClosureJournalV2(baseJournal(session, context)));
    assert.equal(out.status, 'pending', JSON.stringify(patch));
  }
  assert.throws(() => createDuelPhaseSourceClosureJournalV2(baseJournal(session, { ...base, phase: 'ending' })), /phase\/event mismatch/);
});
