import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../../card-dsl/test/fixtures/official-catalog.mjs';
import { createDuelOfficialProgramRegistry, duelAbilitySourceFromCatalog } from
  '../../card-dsl/dist/duel/official-programs.js';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2,
  adoptAdmittedDuelPlayingSessionV2, commitDuelCommandMutationV2 } from '../dist/duel/canonical-session-v2.js';
import { channelDuelRunesV2, commitDuelPlayingMutationV2,
  referenceDuelPhysicalCardV2 } from '../dist/duel/core-v2.js';
import { createDuelCostResolverAuthorityV2,
  fingerprintDuelCostCoverageV2 } from '../dist/duel/cost-resolver-v2.js';
import { createDuelUnitPlaySessionV2, playDuelNoAbilityUnitToBaseV2, advanceDuelUnitCommandSessionV2 } from
  '../dist/duel/cardplay-unit-v2.js';
import { applyDuelUnitResourceCommandV2 } from '../dist/duel/cardplay-unit-v2.js';
import { startDuelUnitTurnV2, endDuelUnitTurnV2, resumeDuelUnitTurnV2,
  applyDuelUnitStandardMoveV2, resumeDuelUnitStandardMoveV2 } from
  '../dist/duel/cardplay-unit-v2.js';
import { createDuelPhaseSourceRegistryV2 } from '../dist/duel/phase-source-authority-v2.js';
import { enumerateDuelObjectsV2 } from '../dist/duel/core-v2.js';

const CARD = 'syn-unit-printed-empty';
const programs = createDuelOfficialProgramRegistry(duelAbilitySourceFromCatalog(CATALOG));
const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: CARD })),
  champion: { uid: `${playerId}-champion`, cardId: 'champion-printing' },
  legend: { uid: `${playerId}-legend`, cardId: 'legend-printing' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
    cardId: 'rune-printing', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
    cardId: `field-printing-${i}` })),
}));
const metadata = { matchId: 'unit-cardplay-test', dataVersion: CATALOG.dataVersion,
  catalogDigest: CATALOG.digest,
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const types = cardId => cardId === 'champion-printing' ? 'Champion' :
  cardId === 'legend-printing' ? 'Legend' : cardId === 'rune-printing' ? 'Rune' :
    cardId.startsWith('field-printing-') ? 'Battlefield' : 'Unit';

function playing({ energy = 4, priority = 'alice', open = true,
  phase = 'main', cardType = types } = {}) {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, cardType);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(session, actor, {
      commandId: `mulligan-${actor}`, expectedVersion: session.match.stateVersion,
      command: { type: 'mulligan', selectedUIDs: [] },
    });
    assert.equal(result.outcome.status, 'applied');
    session = result.session;
  }
  let match = channelDuelRunesV2(session.match, 'alice', 4);
  match = commitDuelPlayingMutationV2(match, draft => ({ match: {
    ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, old]) =>
      [uid, { ...old, readiness: 'ready' }])),
    frame: { ...draft.frame, phase, stateOpen: open, priorityPlayerId: priority },
  }, transitions: [] }));
  session = adoptAdmittedDuelPlayingSessionV2(match);
  for (let i = 0; i < energy; i++) {
    const uid = session.match.resources.bases.find(base => base.playerId === 'alice').baseRunes[i].uid;
    const result = applyDuelResourceCommandV2(session, 'alice', {
      commandId: `energy-${i}`, expectedVersion: session.match.stateVersion,
      command: { type: 'rune-energy', uid },
    });
    assert.equal(result.outcome.status, 'applied');
    session = result.session;
  }
  return session;
}

function services(match, { costEnergy = 3, entryOverride, costBindingOverride,
  programsOverride, serviceThrows = false, allowSuccessor = false } = {}) {
  const uid = match.players[0].hand[0].uid;
  const epoch = referenceDuelPhysicalCardV2(match, uid).zoneEpoch;
  const requestCheck = request => {
    const tuple = JSON.parse(request.transactionId);
    assert.equal(tuple[0], match.matchId);
    assert.equal(tuple[2], 'alice');
    if (!allowSuccessor) assert.equal(tuple[1], match.stateVersion);
    assert.deepEqual(tuple.slice(4), [uid, epoch,
      match.board.bases.find(base => base.ownerPlayerId === 'alice').locationId]);
    assert.equal(request.subjectId, CARD);
    assert.equal(request.kind, 'card-play');
  };
  const baseCost = { energy: costEnergy, power: [] };
  const revision = { registryRevision: 'fixture-registry:1', catalogRevision: CATALOG.digest };
  const verified = request => {
    requestCheck(request);
    return { ...revision, nonResourceCosts: 'none',
      base: { cost: structuredClone(baseCost), sourceUid: uid, sourceEpoch: epoch },
      candidates: [], orderedModifiers: [] };
  };
  const decision = request => {
    if (serviceThrows) throw Error('private provider diagnostic');
    requestCheck(request);
    const snapshot = verified(request);
    return { request,
      base: { request, status: 'complete', proofId: 'base-proof', cost: structuredClone(baseCost),
        ...revision, sourceUid: uid, sourceEpoch: epoch },
      coverage: { request, proofId: 'coverage-proof', status: 'complete',
        allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: 'none',
        ...revision, ...fingerprintDuelCostCoverageV2(snapshot) },
      proofs: [], modifiers: [] };
  };
  return {
    programs: programsOverride ?? programs,
    cost: createDuelCostResolverAuthorityV2(decision, verified),
    costBinding: request => costBindingOverride ? costBindingOverride(request) :
      { ...request, status: 'complete' },
    entry: request => {
      const { match: ignored, ...tuple } = request;
      if (!allowSuccessor) assert.strictEqual(ignored, match);
      const facts = { ...tuple, sourceCensus: 'complete', sources: [],
        scopes: { play: 'clear', replacement: 'clear', static: 'clear',
          trigger: 'clear', pendingTasks: 'clear', chain: 'clear' } };
      return entryOverride ? entryOverride(facts, request) : facts;
    },
  };
}
const envelope = (session, commandId = 'play-1', command = {}) => ({ commandId,
  expectedVersion: session.commandSession.match.stateVersion,
  command: { cardUID: session.commandSession.match.players[0].hand[0].uid, ...command } });

test('parent handoff to a native canonical descendant retains Unit receipts and consumes the old action branch', () => {
  const base = playing();
  const action = createDuelUnitPlaySessionV2(base, services(base.match));
  const play = envelope(action, 'retained-play');
  const played = playDuelNoAbilityUnitToBaseV2(action, 'alice', play);
  assert.equal(played.outcome.status, 'applied');
  const before = played.session;
  const external = commitDuelCommandMutationV2(before.commandSession, d => ({ match: { ...d,
    players: d.players.map(p => p.playerId === 'alice' ? { ...p, hand: [...p.hand].reverse() } : p) }, transitions: [] })).session;
  const next = advanceDuelUnitCommandSessionV2(before, external);
  assert.strictEqual(next.commandSession, external);
  assert.strictEqual(next.receipts, before.receipts);
  assert.strictEqual(next.commandSession.receipts, before.commandSession.receipts);
  const duplicate = playDuelNoAbilityUnitToBaseV2(next, 'alice', play);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.outcome.status, 'applied');
  assert.equal(next.commandSession.match.board.units.length, 1);
  assert.throws(() => advanceDuelUnitCommandSessionV2(before, external), /inactive/);
});

test('parent handoff rejects a fresh ledger adoption, clone and already-owned sibling', () => {
  const base = playing();
  const action = createDuelUnitPlaySessionV2(base, services(base.match));
  const cleared = adoptAdmittedDuelPlayingSessionV2(base.match);
  assert.throws(() => advanceDuelUnitCommandSessionV2(action, cleared), /origin/);
  assert.throws(() => advanceDuelUnitCommandSessionV2(action, structuredClone(base)), /unadmitted/);
  const child = commitDuelCommandMutationV2(base, d => ({ match: { ...d,
    frame: { ...d.frame, stateOpen: false } }, transitions: [] })).session;
  createDuelUnitPlaySessionV2(child, services(child.match));
  assert.throws(() => advanceDuelUnitCommandSessionV2(action, child), /already has/);
  assert.strictEqual(advanceDuelUnitCommandSessionV2(action, base), action);
});

test('parent handoff refuses a canonical resource receipt colliding with an existing blocked Unit command', () => {
  const base = playing({ energy: 0 });
  const action = createDuelUnitPlaySessionV2(base, services(base.match, {
    costBindingOverride: request => ({ ...request, status: 'unknown' }),
  }));
  const blocked = playDuelNoAbilityUnitToBaseV2(action, 'alice', envelope(action, 'same-command-id'));
  assert.equal(blocked.outcome.status, 'blocked');
  const unit = blocked.session;
  const uid = unit.commandSession.match.resources.bases[0].baseRunes[0].uid;
  const resource = applyDuelResourceCommandV2(unit.commandSession, 'alice', {
    commandId: 'same-command-id', expectedVersion: unit.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid },
  });
  assert.equal(resource.outcome.status, 'applied');
  assert.throws(() => advanceDuelUnitCommandSessionV2(unit, resource.session), /receipt conflicts/);
  assert.equal(unit.commandSession.match.resources.players[0].runePool.energy, 0);
  const retry = playDuelNoAbilityUnitToBaseV2(unit, 'alice', envelope(action, 'same-command-id'));
  assert.equal(retry.duplicate, true);
  assert.equal(retry.outcome.status, 'blocked');
});
function attempt(base, options = {}, command = {}) {
  const action = createDuelUnitPlaySessionV2(base, services(base.match, options));
  const result = playDuelNoAbilityUnitToBaseV2(action, 'alice', envelope(action, 'play-1', command));
  return { action, result };
}

function attemptWithResource(base, options = {}, resourceCommand) {
  const action = createDuelUnitPlaySessionV2(base, services(base.match,
    { ...options, allowSuccessor: true }));
  const beforeResource = action.commandSession.match;
  const resource = applyDuelUnitResourceCommandV2(action, 'alice', {
    commandId: 'shared-resource', expectedVersion: beforeResource.stateVersion,
    command: resourceCommand,
  });
  assert.equal(resource.outcome.status, 'applied');
  const unit = playDuelNoAbilityUnitToBaseV2(resource.session, 'alice',
    envelope(resource.session, 'shared-unit'));
  return { action, resource, unit };
}
function unchanged(action, result) {
  assert.notEqual(result.outcome.status, 'applied');
  assert.strictEqual(result.session.commandSession.match, action.commandSession.match);
  assert.equal(result.session.commandSession.match.stateVersion, action.commandSession.match.stateVersion);
  assert.equal(result.session.commandSession.match.resources.players[0].runePool.energy,
    action.commandSession.match.resources.players[0].runePool.energy);
  assert.equal(result.session.commandSession.match.players[0].hand.length,
    action.commandSession.match.players[0].hand.length);
  assert.equal(result.session.commandSession.match.board.units.length,
    action.commandSession.match.board.units.length);
}

test('admitted V2 no-ability Unit pays resolved cost and enters own base in one clock', () => {
  const base = playing();
  const { action, result } = attempt(base);
  const before = action.commandSession.match, after = result.session.commandSession.match;
  const uid = before.players[0].hand[0].uid;
  assert.deepEqual(result.outcome, { status: 'applied', appliedVersion: before.stateVersion + 1,
    eventSeq: before.eventSeq + 1 });
  assert.equal(after.resources.players[0].runePool.energy, 1);
  assert.equal(before.resources.players[0].runePool.energy, 4);
  assert.equal(after.players[0].hand.some(card => card.uid === uid), false);
  assert.equal(after.board.units.find(unit => unit.objectId === uid).locationId,
    after.board.bases.find(base => base.ownerPlayerId === 'alice').locationId);
  assert.equal(after.unitMeta[uid].readied, false);
  assert.equal(after.unitMeta[uid].trait.cardId, CARD);
  assert.equal(after.physicalCardsByUID[uid].zoneEpoch,
    before.physicalCardsByUID[uid].zoneEpoch + 2);
  assert.deepEqual(after.provenance.transitions.at(-1), { uid,
    from: { kind: 'chain', zonePlayerId: 'alice' },
    to: { kind: 'board-base', locationId: after.board.bases[0].locationId } });
  assert.deepEqual(after.provenance.transitions.at(-2), { uid,
    from: { kind: 'hand', zonePlayerId: 'alice' }, to: { kind: 'chain', zonePlayerId: 'alice' } });
  assert.equal(result.persistRequired, true);
  const retry = playDuelNoAbilityUnitToBaseV2(result.session, 'alice', envelope(action));
  assert.equal(retry.duplicate, true);
  assert.strictEqual(retry.outcome, result.outcome);
  assert.strictEqual(retry.session, result.session);
  assert.equal(retry.persistRequired, false);
  assert.deepEqual(playDuelNoAbilityUnitToBaseV2(result.session, 'alice',
    envelope(action, 'play-1', { paymentPlan: { power: [] } })).outcome,
  { status: 'rejected', reason: 'command-conflict' });
  assert.throws(() => createDuelUnitPlaySessionV2(base, services(base.match)), /already has an action branch/);
  assert.throws(() => playDuelNoAbilityUnitToBaseV2(action, 'alice', envelope(action)), /spent action session/);
});

test('resource forwarding and Unit share one canonical session, clock, and actor command namespace', () => {
  const base = playing({ energy: 0 });
  const { action, resource, unit } = attemptWithResource(base, { costEnergy: 1 }, { type: 'rune-energy',
    uid: base.match.resources.bases.find(item => item.playerId === 'alice').baseRunes[0].uid });
  assert.equal(resource.session.commandSession.match.stateVersion, action.commandSession.match.stateVersion + 1);
  assert.equal(resource.session.commandSession.match.resources.players[0].runePool.energy, 1);
  assert.equal(unit.outcome.status, 'applied');
  assert.equal(unit.session.commandSession.match.stateVersion,
    resource.session.commandSession.match.stateVersion + 1);
  assert.equal(unit.session.commandSession.match.resources.players[0].runePool.energy, 0);
  const after = applyDuelUnitResourceCommandV2(unit.session, 'alice', {
    commandId: 'after-unit', expectedVersion: unit.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: unit.session.commandSession.match.resources.bases
      .find(item => item.playerId === 'alice').baseRunes[1].uid },
  });
  assert.equal(after.outcome.status, 'applied');
  assert.equal(after.session.commandSession.match.stateVersion,
    unit.session.commandSession.match.stateVersion + 1);
  assert.equal(after.session.commandSession.match.resources.players[0].runePool.energy, 1);
  const conflict = applyDuelUnitResourceCommandV2(after.session, 'alice', {
    commandId: 'shared-unit', expectedVersion: after.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: after.session.commandSession.match.resources.bases
      .find(item => item.playerId === 'alice').baseRunes[2].uid },
  });
  assert.deepEqual(conflict.outcome, { status: 'rejected', reason: 'command-conflict' });
  assert.equal(conflict.persistRequired, false);
});

test('different actors may reuse a command ID while each remains authenticated', () => {
  const setup = playing({ energy: 0 });
  const action = createDuelUnitPlaySessionV2(setup, services(setup.match,
    { allowSuccessor: true }));
  const first = applyDuelUnitResourceCommandV2(action, 'alice', {
    commandId: 'same-id', expectedVersion: setup.match.stateVersion,
    command: { type: 'rune-energy', uid: setup.match.resources.bases
      .find(item => item.playerId === 'alice').baseRunes[0].uid },
  });
  assert.equal(first.outcome.status, 'applied');
  const second = applyDuelUnitResourceCommandV2(first.session, 'bob', {
    commandId: 'same-id', expectedVersion: first.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: first.session.commandSession.match.resources.bases
      .find(item => item.playerId === 'alice').baseRunes[1].uid },
  });
  assert.deepEqual(second.outcome, { status: 'rejected', reason: 'no-permission' });
  assert.equal(second.session.commandSession.receipts.filter(r => r.commandId === 'same-id').length, 2);
});

test('inherited resource receipts conflict with Unit and resource retries stay sticky', () => {
  const base = playing();
  const action = createDuelUnitPlaySessionV2(base, services(base.match));
  const inherited = playDuelNoAbilityUnitToBaseV2(action, 'alice',
    envelope(action, 'energy-0'));
  assert.deepEqual(inherited.outcome, { status: 'rejected', reason: 'command-conflict' });
  const failedEnvelope = { commandId: 'failed-resource',
    expectedVersion: action.commandSession.match.stateVersion - 1,
    command: { type: 'rune-energy', uid: action.commandSession.match.resources.bases[0].baseRunes[0].uid } };
  const failure = applyDuelUnitResourceCommandV2(action, 'alice', failedEnvelope);
  assert.deepEqual(failure.outcome, { status: 'rejected', reason: 'stale-version' });
  const retry = applyDuelUnitResourceCommandV2(failure.session, 'alice', failedEnvelope);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.persistRequired, false);
  assert.strictEqual(retry.session, failure.session);
  assert.deepEqual(playDuelNoAbilityUnitToBaseV2(failure.session, 'alice',
    envelope(failure.session, 'failed-resource')).outcome,
  { status: 'rejected', reason: 'command-conflict' });
});


test('insufficient pool and malformed payment plan cannot consume card or energy', () => {
  for (const variant of [
    { options: { costEnergy: 5 }, command: {} },
    { options: {}, command: { paymentPlan: { power: [{ requirementIndex: 0,
      from: 'Fury', amount: 1 }] } } },
  ]) {
    const { action, result } = attempt(playing(), variant.options, variant.command);
    unchanged(action, result);
    assert.equal(result.outcome.status, 'blocked');
  }
});

test('actor, phase, priority, stale version and global command ID deny without mutation', () => {
  const base = playing();
  let action = createDuelUnitPlaySessionV2(base, services(base.match));
  for (const [actor, change, reason] of [
    ['stranger', { commandId: 'wrong-actor' }, 'unknown-actor'],
    ['bob', { commandId: 'wrong-priority' }, 'no-permission'],
    ['alice', { commandId: 'stale', expectedVersion: base.match.stateVersion - 1 }, 'stale-version'],
    ['alice', { commandId: 'energy-0' }, 'command-conflict'],
  ]) {
    const result = playDuelNoAbilityUnitToBaseV2(action, actor,
      { ...envelope(action), ...change });
    assert.equal(result.outcome.reason, reason);
    assert.strictEqual(result.session.commandSession.match, base.match);
    if (result.persistRequired) action = result.session;
  }
  const closed = playing({ open: false, energy: 0 });
  const { action: closedAction, result: closedResult } = attempt(closed);
  unchanged(closedAction, closedResult);
  assert.equal(closedResult.outcome.reason, 'invalid-phase');
  const otherPhase = playing({ phase: 'ending', energy: 0 });
  const { action: phaseAction, result: phaseResult } = attempt(otherPhase);
  unchanged(phaseAction, phaseResult);
  assert.equal(phaseResult.outcome.reason, 'invalid-phase');
});

test('wrong physical printing, absent hand UID and incomplete entry facts fail closed', () => {
  const wrong = playing({ cardType: cardId => cardId === CARD ? 'Other' : types(cardId) });
  const wrongResult = attempt(wrong);
  unchanged(wrongResult.action, wrongResult.result);
  assert.equal(wrongResult.result.outcome.status, 'blocked');
  const base = playing();
  for (const entryOverride of [
    facts => ({ ...facts, sourceEpoch: facts.sourceEpoch + 1 }),
    facts => ({ ...facts, sourceCensus: 'unknown' }),
    facts => ({ ...facts, scopes: { ...facts.scopes, replacement: 'unknown' } }),
    facts => ({ ...facts, scopes: { ...facts.scopes, static: 'effect' } }),
    facts => ({ ...facts, scopes: { ...facts.scopes, trigger: 'effect' } }),
    facts => ({ ...facts, scopes: { ...facts.scopes, pendingTasks: 'effect' } }),
    facts => ({ ...facts, sources: [{ uid: 'other-source', zoneEpoch: 0,
      programId: 'unknown', disposition: 'unknown' }] }),
    (facts, request) => ({ ...facts, sources: [{ uid: request.uid,
      zoneEpoch: request.sourceEpoch + 1, programId: request.programId,
      disposition: 'known-no-effect' }] }),
  ]) {
    const copy = playing();
    const { action, result } = attempt(copy, { entryOverride });
    unchanged(action, result);
    assert.deepEqual(result.outcome, { status: 'blocked', reason: 'source-or-entry-unproved' });
  }
  const action = createDuelUnitPlaySessionV2(base, services(base.match));
  const missing = playDuelNoAbilityUnitToBaseV2(action, 'alice',
    envelope(action, 'missing', { cardUID: 'bob-main-0' }));
  unchanged(action, missing);
});

test('unknown source program, provider throw and recursive entry cannot commit', () => {
  const base = playing();
  const unknown = attempt(base, { programsOverride: { getProgram: () => undefined } });
  unchanged(unknown.action, unknown.result);
  const throwing = attempt(playing(), { serviceThrows: true });
  unchanged(throwing.action, throwing.result);
  let action;
  const match = playing();
  const configured = services(match.match, { entryOverride: facts => {
    const nested = playDuelNoAbilityUnitToBaseV2(action, 'alice', envelope(action));
    assert.equal(nested.outcome.status, 'blocked');
    return facts;
  } });
  action = createDuelUnitPlaySessionV2(match, configured);
  const reentered = playDuelNoAbilityUnitToBaseV2(action, 'alice', envelope(action));
  unchanged(action, reentered);
  assert.equal(reentered.outcome.reason, 'source-or-entry-unproved');
  assert.equal(playDuelNoAbilityUnitToBaseV2(reentered.session, 'alice', envelope(action)).duplicate, true);
});

test('independent cost source binding rejects a different epoch or proof before payment', () => {
  for (const costBindingOverride of [
    request => ({ ...request, sourceEpoch: request.sourceEpoch + 1, status: 'complete' }),
    request => ({ ...request, baseProofId: 'unrelated-proof', status: 'complete' }),
    request => ({ ...request, status: 'unknown' }),
  ]) {
    const { action, result } = attempt(playing(), { costBindingOverride });
    unchanged(action, result);
    assert.deepEqual(result.outcome, { status: 'blocked', reason: 'cost-or-payment-unproved' });
  }
});

function beforeTurn() {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, types);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(session, actor, {
      commandId: `mulligan-${actor}`, expectedVersion: session.match.stateVersion,
      command: { type: 'mulligan', selectedUIDs: [] },
    });
    assert.equal(result.outcome.status, 'applied');
    session = result.session;
  }
  return session;
}
const printings = [...new Set(seats.flatMap(seat => [
  ...seat.mainDeck.map(card => card.cardId), seat.champion.cardId, seat.legend.cardId,
  ...seat.runeDeck.map(card => card.cardId),
  ...seat.battlefields.map(field => field.cardId),
]))];
function turnServices(match, evidence = () => ({})) {
  const refs = new Map(printings.map(cardId => [cardId, `whole:${cardId}`]));
  return { sources: createDuelPhaseSourceRegistryV2({ matchId: match.matchId,
    dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    printings: [...refs].map(([cardId, programReference]) => ({ cardId, programReference })) },
  request => ({ status: 'complete', matchId: request.matchId,
    dataVersion: request.dataVersion, catalogDigest: request.catalogDigest,
    turn: request.turn, taskId: request.taskId, uid: request.source.uid,
    zoneEpoch: request.source.zoneEpoch, controllerPlayerId: request.source.controllerPlayerId,
    cardId: request.source.cardId, programReference: refs.get(request.source.cardId),
    event: request.event, eventSupported: true, scope: 'known-no-handler',
    replacementsCovered: true, staticCovered: true, continuousCovered: true,
    triggersCovered: true, ...evidence(request) })),
  fepr: () => ({ status: 'none' }),
  lethalEvaluators: {
    currentMight: unit => programs.getProgram(unit.trait.cardId).source.might,
    lethalDamageThreshold: (_unit, might) => might,
  } };
}
function moveServices({ pending = false } = {}) {
  let unavailable = pending;
  return { service: {
    timing: match => ({ phase: match.frame.phase === 'main' ? 'main' : 'other',
      stateOpen: match.frame.stateOpen, turnPlayerId: match.frame.turnPlayerId,
      priorityPlayerId: match.frame.priorityPlayerId }),
    ganking: (match, actor, uid) => {
      const unit = match.board.units.find(item => item.objectId === uid);
      assert.equal(unit.controllerPlayerId, actor);
      assert.equal(match.unitMeta[uid].trait.cardId, CARD);
      assert.equal(programs.getProgram(CARD).semantics.kind, 'no-ability');
      return false;
    },
    triggers: ({ movedState, obligation }) => {
      const sources = enumerateDuelObjectsV2(movedState).filter(item =>
        ['unit', 'rune', 'gold', 'gear', 'legend', 'battlefield'].includes(item.kind));
      assert.ok(sources.length > 0);
      assert.ok(sources.every(item => item.cardId === null || printings.includes(item.cardId)));
      assert.ok(obligation.events.every(event => sources.some(item => item.uid === event.objectId)));
      if (unavailable) return { status: 'unknown' };
      return { status: 'settled', taskId: obligation.taskId,
        movedVersion: obligation.movedVersion, events: obligation.events,
        disposition: 'no-triggers' };
    },
  }, release: () => { unavailable = false; } };
}
const turnEnvelope = (session, type, commandId = type) => ({ commandId,
  expectedVersion: session.commandSession.match.stateVersion, command: { type } });
const runeEnvelope = (session, commandId, index) => ({ commandId,
  expectedVersion: session.commandSession.match.stateVersion,
  command: { type: 'rune-energy', uid: session.commandSession.match.resources.bases
    .find(base => base.playerId === 'alice').baseRunes[index].uid } });

test('one owned session carries genuine turn, Rune, Unit, Rune and paid Move group', () => {
  const base = beforeTurn();
  const movement = moveServices();
  let session = createDuelUnitPlaySessionV2(base, {
    ...services(base.match, { costEnergy: 1, allowSuccessor: true }),
    turn: turnServices(base.match), move: movement.service });
  const started = startDuelUnitTurnV2(session, 'alice', turnEnvelope(session, 'start-turn'));
  assert.equal(started.outcome.status, 'applied');
  assert.equal(started.outcome.phase, 'main');
  assert.equal(started.session.commandSession.turnCursorV2.step, 'main');
  session = started.session;
  const rune = applyDuelUnitResourceCommandV2(session, 'alice', runeEnvelope(session, 'rune-1', 0));
  assert.equal(rune.outcome.status, 'applied');
  assert.equal(rune.session.commandSession.turnCursorV2.step, 'main');
  session = rune.session;
  const unit = playDuelNoAbilityUnitToBaseV2(session, 'alice', envelope(session, 'unit-1'));
  assert.equal(unit.outcome.status, 'applied');
  session = unit.session;
  const uid = session.commandSession.match.board.units[0].objectId;
  const secondRune = applyDuelUnitResourceCommandV2(session, 'alice',
    runeEnvelope(session, 'rune-2', 1));
  assert.equal(secondRune.outcome.status, 'applied');
  session = secondRune.session;
  const conflict = endDuelUnitTurnV2(session, 'alice',
    turnEnvelope(session, 'end-turn', 'unit-1'));
  assert.equal(conflict.outcome.reason, 'command-conflict');
  const old = session;
  const ending = endDuelUnitTurnV2(session, 'alice', turnEnvelope(session, 'end-turn', 'end-a'));
  assert.equal(ending.outcome.phase, 'awaiting-turn-start', ending.outcome.reason);
  assert.throws(() => applyDuelUnitResourceCommandV2(old, 'alice',
    runeEnvelope(old, 'stale-branch', 0)), /spent action session/);
  session = ending.session;
  const bob = startDuelUnitTurnV2(session, 'bob', turnEnvelope(session, 'start-turn', 'start-b'));
  assert.equal(bob.outcome.phase, 'main', bob.outcome.reason);
  session = bob.session;
  const bobEnd = endDuelUnitTurnV2(session, 'bob', turnEnvelope(session, 'end-turn', 'end-b'));
  assert.equal(bobEnd.outcome.phase, 'awaiting-turn-start', bobEnd.outcome.reason);
  session = bobEnd.session;
  const alice = startDuelUnitTurnV2(session, 'alice', turnEnvelope(session, 'start-turn', 'start-a2'));
  assert.equal(alice.outcome.phase, 'main', alice.outcome.reason);
  session = alice.session;
  assert.equal(session.commandSession.match.unitMeta[uid].readied, true);
  const field = session.commandSession.match.board.battlefields[0].locationId;
  const before = session.commandSession.match;
  const moveEnvelope = { commandId: 'move-1', expectedVersion: before.stateVersion,
    command: { unitUIDs: [uid], destinationLocationId: field } };
  const move = applyDuelUnitStandardMoveV2(session, 'alice', moveEnvelope);
  assert.equal(move.outcome.status, 'applied', move.outcome.reason);
  assert.equal(move.session.commandSession.match.board.units.find(item => item.objectId === uid).locationId,
    field);
  assert.equal(move.session.commandSession.match.unitMeta[uid].readied, false);
  assert.ok(move.session.commandSession.match.stateVersion >= before.stateVersion + 1);
  assert.equal(move.session.commandSession.match.eventSeq,
    move.session.commandSession.match.stateVersion);
  assert.deepEqual(move.session.commandSession.match.provenance.transitions.at(-1), {
    uid, from: { kind: 'board-base', locationId: before.board.bases[0].locationId },
    to: { kind: 'board-battlefield', locationId: field } });
  const retry = applyDuelUnitStandardMoveV2(move.session, 'alice', moveEnvelope);
  assert.equal(retry.duplicate, true);
  assert.strictEqual(retry.outcome, move.outcome);
  assert.equal(startDuelUnitTurnV2(move.session, 'alice',
    turnEnvelope(move.session, 'start-turn', 'move-1')).outcome.reason, 'command-conflict');
});

test('pending Move trigger closure resumes exact task; missing services stay blocked', () => {
  const played = attempt(playing({ energy: 0 }), { costEnergy: 0 });
  assert.equal(played.result.outcome.status, 'applied');
  const uid = played.result.session.commandSession.match.board.units[0].objectId;
  const settled = commitDuelPlayingMutationV2(played.result.session.commandSession.match,
    draft => ({ match: { ...draft,
      unitMeta: { ...draft.unitMeta, [uid]: { ...draft.unitMeta[uid], readied: true } } },
    transitions: [] }));
  const canonical = adoptAdmittedDuelPlayingSessionV2(settled);
  const movement = moveServices({ pending: true });
  const session = createDuelUnitPlaySessionV2(canonical, {
    ...services(canonical.match), move: movement.service });
  const missing = endDuelUnitTurnV2(session, 'alice', turnEnvelope(session, 'end-turn'));
  assert.equal(missing.outcome.reason, 'turn-services-unavailable');
  const field = session.commandSession.match.board.battlefields[0].locationId;
  const command = { commandId: 'move-pending', expectedVersion: settled.stateVersion,
    command: { unitUIDs: [uid], destinationLocationId: field } };
  const first = applyDuelUnitStandardMoveV2(session, 'alice', command);
  assert.equal(first.outcome.status, 'pending', first.outcome.reason);
  assert.equal(first.persistRequired, true);
  assert.equal(first.session.commandSession.match.stateVersion, settled.stateVersion + 1);
  assert.equal(applyDuelUnitResourceCommandV2(first.session, 'alice',
    runeEnvelope(first.session, 'rune-while-pending', 0)).outcome.status, 'blocked');
  assert.equal(resumeDuelUnitStandardMoveV2(first.session, 'alice', 'move-pending',
    'wrong-task').outcome.reason, 'wrong-task-or-session');
  movement.release();
  const finished = resumeDuelUnitStandardMoveV2(first.session, 'alice', 'move-pending',
    first.outcome.taskId);
  assert.equal(finished.outcome.status, 'applied', finished.outcome.reason);
  assert.ok(finished.session.commandSession.match.stateVersion >= settled.stateVersion + 1);
  assert.throws(() => resumeDuelUnitStandardMoveV2(first.session, 'alice', 'move-pending',
    first.outcome.taskId), /spent action session/);
});

test('bound turn cursor keeps a pending source task until exact retry', () => {
  const base = beforeTurn();
  let unavailable = true;
  const session = createDuelUnitPlaySessionV2(base, {
    ...services(base.match), turn: turnServices(base.match,
      () => unavailable ? { status: 'unknown' } : {}) });
  const command = turnEnvelope(session, 'start-turn', 'start-pending');
  const first = startDuelUnitTurnV2(session, 'alice', command);
  assert.equal(first.outcome.status, 'pending');
  assert.equal(first.persistRequired, true);
  assert.equal(first.session.commandSession.turnCursorV2.pendingTaskID, first.outcome.taskId);
  assert.equal(resumeDuelUnitTurnV2(first.session, 'alice', 'start-pending',
    'wrong-task').outcome.reason, 'wrong-task-or-session');
  const duplicate = startDuelUnitTurnV2(first.session, 'alice', command);
  assert.equal(duplicate.duplicate, true);
  assert.strictEqual(duplicate.outcome, first.outcome);
  unavailable = false;
  const resumed = resumeDuelUnitTurnV2(first.session, 'alice', 'start-pending',
    first.outcome.taskId);
  assert.equal(resumed.outcome.phase, 'main', resumed.outcome.reason);
  assert.equal(resumed.session.commandSession.turnCursorV2.step, 'main');
  assert.equal(playDuelNoAbilityUnitToBaseV2(resumed.session, 'alice',
    envelope(resumed.session, 'start-pending')).outcome.reason, 'command-conflict');
});

test('missing Move authority and recursive trigger provider cannot certify an action', () => {
  const base = playing({ energy: 0 });
  const noMove = createDuelUnitPlaySessionV2(base, services(base.match));
  const raw = { commandId: 'move-no-service', expectedVersion: base.match.stateVersion,
    command: { unitUIDs: ['absent'], destinationLocationId: base.match.board.battlefields[0].locationId } };
  assert.equal(applyDuelUnitStandardMoveV2(noMove, 'alice', raw).outcome.reason,
    'move-services-unavailable');
  const played = attempt(playing({ energy: 0 }), { costEnergy: 0 });
  const uid = played.result.session.commandSession.match.board.units[0].objectId;
  const ready = commitDuelPlayingMutationV2(played.result.session.commandSession.match,
    draft => ({ match: { ...draft,
      unitMeta: { ...draft.unitMeta, [uid]: { ...draft.unitMeta[uid], readied: true } } },
    transitions: [] }));
  const movement = moveServices();
  let action;
  let nestedStatus;
  const command = { commandId: 'move-reenter', expectedVersion: ready.stateVersion,
    command: { unitUIDs: [uid], destinationLocationId: ready.board.battlefields[0].locationId } };
  action = createDuelUnitPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(ready), {
    ...services(ready), move: { ...movement.service, ganking: (match, actor, unitUID) => {
      nestedStatus = applyDuelUnitStandardMoveV2(action, actor, command).outcome.status;
      return movement.service.ganking(match, actor, unitUID);
    } } });
  const first = applyDuelUnitStandardMoveV2(action, 'alice', command);
  assert.equal(nestedStatus, 'blocked');
  assert.equal(first.outcome.reason, 'move-or-ganking-unproved');
  assert.strictEqual(first.session.commandSession.match, ready);
});
