import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelOfficialProgramRegistry, duelAbilitySourceFromCatalog, DUEL_PREMONITION_REACTION_TEXT } from '@riftbound/card-dsl/duel';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2, adoptAdmittedDuelPlayingSessionV2 } from '../dist/duel/canonical-session-v2.js';
import { channelDuelRunesV2, commitDuelPlayingMutationV2, moveDuelUnitV2 } from '../dist/duel/core-v2.js';
import { placeDuelUnit } from '../dist/duel/battlefields.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2 } from '../dist/duel/cost-resolver-v2.js';
import { createDuelPhaseSourceRegistryV2 } from '../dist/duel/phase-source-authority-v2.js';
import { startDuelEngagementV2, suspendDuelEngagementForSpellV2,
  resumeDuelEngagementAfterSpellV2 } from '../dist/duel/engagement-executor-v2.js';
import { applyDuelSpellResourceCommandV2, finalizeDuelSpellCardPlayV2,
  passDuelSpellPriorityV2, playDuelSpellCardV2, resolveDuelSpellCardPlayV2 } from '../dist/duel/cardplay-spell-v2.js';

const printing = { id: 'focus-draw', cardType: 'Spell', ability: DUEL_PREMONITION_REACTION_TEXT, energy: 1, power: null,
  might: null, domains: [], tags: [], canonicalCardId: 'focus-draw', name: 'Focus Draw',
  fullName: 'Focus Draw', localizedName: 'Focus Draw', setCode: 'TST', cardNumber: 'F1', variant: 'normal' };
const plain = { ...printing, id: 'focus-plain', canonicalCardId: 'focus-plain', ability: 'Draw 4.', cardNumber: 'F2' };
const catalog = { dataVersion: 'focus-v1', digest: 'focus-digest-v1', cards: [printing, plain] };
const programs = createDuelOfficialProgramRegistry(duelAbilitySourceFromCatalog(catalog));
const card = (uid, cardId = 'focus-draw') => ({ uid, cardId });
const seats = ['alice', 'bob'].map(playerId => ({ playerId,
  mainDeck: Array.from({ length: 11 }, (_, i) => card(`${playerId}:deck:${i}`, i === 1 ? 'focus-unit' : i === 2 ? 'focus-draw' : 'focus-plain')),
  champion: card(`${playerId}:champ`, `${playerId}:champ`), legend: card(`${playerId}:legend`, `${playerId}:legend`),
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ ...card(`${playerId}:rune:${i}`, `${playerId}:rune:${i}`), domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}:field:${i}`, cardId: `${playerId}:field:${i}` })) }));
const metadata = { matchId: 'showdown-focus-v1', dataVersion: catalog.dataVersion,
  catalogDigest: catalog.digest, roster: seats.map(({ playerId }) => ({ playerId, displayName: playerId })) };
const typeOf = id => id === printing.id || id === plain.id ? 'Other' : id === 'focus-unit' ? 'Unit' : id.includes(':champ') ? 'Champion' :
  id.includes(':legend') ? 'Legend' : id.includes(':rune:') ? 'Rune' : id.includes(':field:') ? 'Battlefield' : 'Unit';

function setup(combat = false) {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, typeOf);
  for (const actor of ['alice', 'bob']) session = applyDuelResourceCommandV2(session, actor,
    { commandId: `mulligan:${actor}`, expectedVersion: session.match.stateVersion,
      command: { type: 'mulligan', selectedUIDs: [] } }).session;
  let match = channelDuelRunesV2(session.match, 'alice', 1);
  match = channelDuelRunesV2(match, 'bob', 1);
  const fieldId = match.board.battlefields[0].locationId;
  const unit = match.players[0].hand.find(value => value.cardId === 'focus-unit');
  const baseId = match.board.bases.find(value => value.ownerPlayerId === 'alice').locationId;
  match = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
    board: placeDuelUnit(draft.board, { objectId: unit.uid, controllerPlayerId: 'alice', locationId: baseId }),
    unitMeta: { ...draft.unitMeta, [unit.uid]: { ownerPlayerId: 'alice', readied: false,
      damageMarks: [], trait: { kind: 'card', cardId: 'focus-unit' } } },
    players: draft.players.map(player => player.playerId === 'alice' ? { ...player,
      hand: player.hand.filter(value => value.uid !== unit.uid) } : player) }, transitions: [{ uid: unit.uid,
        from: { kind: 'hand', zonePlayerId: 'alice' }, to: { kind: 'board-base', locationId: baseId } }] }));
  match = moveDuelUnitV2(match, unit.uid, fieldId);
  if (combat) {
    const opposingUnit = match.players[1].hand.find(value => value.cardId === 'focus-unit');
    const opposingBaseId = match.board.bases.find(value => value.ownerPlayerId === 'bob').locationId;
    match = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
      board: placeDuelUnit(draft.board, { objectId: opposingUnit.uid, controllerPlayerId: 'bob', locationId: opposingBaseId }),
      unitMeta: { ...draft.unitMeta, [opposingUnit.uid]: { ownerPlayerId: 'bob', readied: false,
        damageMarks: [], trait: { kind: 'card', cardId: 'focus-unit' } } },
      players: draft.players.map(player => player.playerId === 'bob' ? { ...player,
        hand: player.hand.filter(value => value.uid !== opposingUnit.uid) } : player) },
      transitions: [{ uid: opposingUnit.uid, from: { kind: 'hand', zonePlayerId: 'bob' },
        to: { kind: 'board-base', locationId: opposingBaseId } }] }));
    match = moveDuelUnitV2(match, opposingUnit.uid, fieldId);
  }
  match = commitDuelPlayingMutationV2(match, draft => ({ match: {
    ...draft, legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, value]) =>
      [uid, { ...value, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', stateOpen: true, priorityPlayerId: 'alice', turnPlayerId: 'alice' },
    board: { ...draft.board, battlefields: draft.board.battlefields.map((field, index) => index ? field :
      { ...field, contested: true, contestingPlayerId: 'alice', showdown: 'staged', combat: combat ? 'staged' : 'none' }) },
  }, transitions: [] }));
  let head = match;
  const sourceIndex = { matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    printings: [...new Set(seats.flatMap(seat => [seat.champion.cardId, seat.legend.cardId, ...seat.mainDeck.map(c => c.cardId),
      ...seat.runeDeck.map(c => c.cardId), ...seat.battlefields.map(c => c.cardId)]))]
      .map(cardId => ({ cardId, programReference: `fixture:${cardId}` })) };
  const sources = createDuelPhaseSourceRegistryV2(sourceIndex, request => ({ status: 'complete',
    matchId: request.matchId, dataVersion: request.dataVersion, catalogDigest: request.catalogDigest,
    turn: request.turn, taskId: request.taskId, uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
    programReference: `fixture:${request.source.cardId ?? request.source.uid}`, event: request.event,
    eventSupported: true, scope: 'known-no-handler', replacementsCovered: true, staticCovered: true,
    continuousCovered: true, triggersCovered: true }));
  const engagement = { readHead: () => head, sources,
    inspectEffects: request => ({ status: 'none', matchId: request.match.matchId, stateVersion: request.match.stateVersion,
      eventSeq: request.match.eventSeq, boundary: request.boundary, taskId: request.taskId, sourceUIDs: [...request.sourceUIDs] }),
    combat: { proveBasicCombat: () => ({ currentMight: 'validated', assignmentModifier: 'proven-none',
      preventionReplacement: 'proven-none', keywordPriority: 'proven-none' }) },
    lethalEvaluators: { currentMight: () => 0, lethalDamageThreshold: () => 0 },
    approveLethal: plan => ({ status: 'approved', approvedUnitUIDs: plan.snapshots.map(unit => unit.objectId),
      preExitSettled: true, deathknellSettled: true }), fepr: () => ({ status: 'none' }) };
  const started = startDuelEngagementV2(head, match.board.battlefields[0].locationId, engagement);
  head = started.match;
  return { ...started, head: () => head, setHead: value => { head = value; }, engagement };
}

function spellServices(fixture, edit = {}) {
  const committed = new Map(), claims = new Map();
  const costForChain = request => {
    const facts = { registryRevision: 'focus-r1', catalogRevision: catalog.digest,
      nonResourceCosts: 'none', base: { cost: { energy: 1, power: [] }, sourceUid: request.cardUID, sourceEpoch: request.sourceEpoch },
      candidates: [], orderedModifiers: [] };
    const coverage = fingerprintDuelCostCoverageV2(facts);
    return createDuelCostResolverAuthorityV2(costRequest => ({ request: costRequest,
      base: { request: costRequest, cost: facts.base.cost, proofId: `base:${costRequest.transactionId}`, status: 'complete',
        sourceUid: facts.base.sourceUid, sourceEpoch: facts.base.sourceEpoch, registryRevision: facts.registryRevision, catalogRevision: facts.catalogRevision },
      coverage: { request: costRequest, proofId: `coverage:${costRequest.transactionId}`, status: 'complete', allModifierSourcesCovered: true,
        choicesResolved: true, nonResourceCosts: 'none', registryRevision: facts.registryRevision, catalogRevision: facts.catalogRevision, ...coverage },
      proofs: [], modifiers: [] }), () => facts);
  };
  return { programs, cardPlayOrder: 'showdown-focus-chain-first-v3', showdownFocus: {
    fieldId: fixture.match.board.battlefields[0].locationId, returnFocusPlayerId: 'alice' },
    cost: createDuelCostResolverAuthorityV2(() => { throw Error('legacy cost'); }, () => { throw Error('legacy verifier'); }), costForChain,
    costBinding: request => ({ ...request, status: 'complete' }),
    sourceAttestor: request => { edit.sourceAttestor?.(request); return ({ matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
    sourceReference: request.sourceReference, sourceProofId: `source:${request.paymentId}`, mode: 'current',
      sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID].zoneEpoch,
      ...(request.taskId ? { taskId: request.taskId } : {}), ...(request.continuationId ? { continuationId: request.continuationId } : {}) }); },
    dispatcher: { claim: request => { const key = `${request.actor}:${request.commandId}`; const prior = claims.get(key);
      if (prior) return prior.fingerprint === request.payloadFingerprint ? { status: 'duplicate', outcome: prior.outcome } : { status: 'conflict' };
      const claim = { key }; claims.set(key, { fingerprint: request.payloadFingerprint, claim }); return { status: 'new', claim }; },
      finish: request => { for (const row of claims.values()) if (row.claim === request.claim) row.outcome = request.outcome; },
      readCommitted: ticket => committed.get(ticket.idempotencyKey) ?? null,
      commitEffect: request => committed.set(request.ticket.idempotencyKey, request.receipt) },
    closure: edit.closure ?? { draw: { randomIndex: bound => bound - 1 } }, identityFactory: () => `focus-${Math.random()}` };
}

function payAndFinalize(result, commandId = 'focus-spell', actor = 'alice') {
  const rune = result.session.commandSession.match.resources.bases
    .find(baseValue => baseValue.playerId === actor).baseRunes.find(runeValue => runeValue.readied).uid;
  result = applyDuelSpellResourceCommandV2(result.session, actor, {
    commandId: `${commandId}-energy`, expectedVersion: result.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: rune } });
  assert.equal(result.outcome.status, 'pending');
  const payment = result.session.commandSession.requiredTasks.find(task => task.actor === actor && task.status === 'active');
  result = applyDuelSpellResourceCommandV2(result.session, actor, {
    commandId: `${commandId}-pay`, expectedVersion: result.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: payment.paymentId } });
  assert.equal(result.outcome.status, 'pending');
  assert.equal(result.outcome.step, 'priority');
  return finalizeDuelSpellCardPlayV2(result.session, actor);
}

test('opt-in Showdown Focus Reaction Spell uses native Chain and preserves the Focus handoff contract', () => {
  const fixture = setup();
  const base = adoptAdmittedDuelPlayingSessionV2(fixture.match);
  const action = suspendDuelEngagementForSpellV2(fixture.cursor, base, spellServices(fixture));
  const uid = fixture.match.players[0].hand.find(value => value.cardId === 'focus-draw').uid;
  let result = playDuelSpellCardV2(action.spell, 'alice', { commandId: 'focus-spell', expectedVersion: fixture.match.stateVersion,
    command: { cardUID: uid } });
  assert.equal(result.outcome.status, 'pending');
  assert.equal(result.session.chain.items.length, 1);
  assert.equal(result.session.commandSession.match.frame.stateOpen, false);
  assert.equal(result.outcome.step, 'payment');
  const bobUID = result.session.commandSession.match.players[1].hand.find(value => value.cardId === 'focus-draw').uid;
  const beforeFinalizeResponse = playDuelSpellCardV2(result.session, 'bob', {
    commandId: 'focus-pre-finalize-response', expectedVersion: result.session.commandSession.match.stateVersion,
    command: { cardUID: bobUID } });
  assert.deepEqual(beforeFinalizeResponse.outcome, { status: 'blocked', reason: 'outstanding-task-or-session' });
  assert.equal(beforeFinalizeResponse.session.chain.items.length, 1);
  result = payAndFinalize(result);
  result = passDuelSpellPriorityV2(result.session, 'alice');
  result = playDuelSpellCardV2(result.session, 'bob', {
    commandId: 'focus-reaction-bob', expectedVersion: result.session.commandSession.match.stateVersion,
    command: { cardUID: bobUID } });
  assert.equal(result.outcome.status, 'pending');
  result = payAndFinalize(result, 'focus-reaction-bob', 'bob');
  assert.equal(result.session.chain.items.length, 2);
  result = passDuelSpellPriorityV2(result.session, 'bob');
  result = passDuelSpellPriorityV2(result.session, 'alice');
  result = resolveDuelSpellCardPlayV2(result.session, 'bob');
  assert.equal(result.outcome.status, 'applied');
  assert.equal(result.session.chain.items.length, 1);
  result = passDuelSpellPriorityV2(result.session, 'alice');
  result = passDuelSpellPriorityV2(result.session, 'bob');
  result = resolveDuelSpellCardPlayV2(result.session, 'alice');
  assert.equal(result.outcome.status, 'applied');
  assert.equal(result.session.chain.items.length, 0);
  assert.equal(result.session.commandSession.match.chainCards.length, 0);
  assert.equal(result.session.commandSession.match.players[0].trash.some(value => value.uid === uid), true);
  fixture.setHead(result.session.commandSession.match);
  const resumed = resumeDuelEngagementAfterSpellV2(action.suspension, result.session);
  assert.equal(resumed.status, 'active');
  assert.equal(resumed.match.frame.focusPlayerId, 'bob');
  assert.equal(resumed.match.frame.priorityPlayerId, 'bob');
  assert.throws(() => resumeDuelEngagementAfterSpellV2(action.suspension, result.session), /consumed/);
});

test('combat Showdown Focus reuses the same Chain closure and returns to active combat', () => {
  const fixture = setup(true);
  const base = adoptAdmittedDuelPlayingSessionV2(fixture.match);
  const action = suspendDuelEngagementForSpellV2(fixture.cursor, base, spellServices(fixture));
  const uid = fixture.match.players[0].hand.find(value => value.cardId === 'focus-draw').uid;
  let result = playDuelSpellCardV2(action.spell, 'alice', { commandId: 'combat-focus-spell',
    expectedVersion: fixture.match.stateVersion, command: { cardUID: uid } });
  result = payAndFinalize(result, 'combat-focus-spell');
  result = passDuelSpellPriorityV2(result.session, 'alice');
  result = passDuelSpellPriorityV2(result.session, 'bob');
  result = resolveDuelSpellCardPlayV2(result.session, 'alice');
  assert.equal(result.outcome.status, 'applied');
  fixture.setHead(result.session.commandSession.match);
  const resumed = resumeDuelEngagementAfterSpellV2(action.suspension, result.session);
  const field = resumed.match.board.battlefields.find(value => value.locationId === fixture.match.board.battlefields[0].locationId);
  assert.equal(field.showdown, 'active');
  assert.equal(field.combat, 'active');
  assert.equal(resumed.match.frame.focusPlayerId, 'bob');
});

test('Showdown Focus mode rejects a non-Action Spell and leaves the engagement head untouched', () => {
  const fixture = setup();
  const base = adoptAdmittedDuelPlayingSessionV2(fixture.match);
  const services = spellServices(fixture);
  const action = suspendDuelEngagementForSpellV2(fixture.cursor, base, services);
  const denied = playDuelSpellCardV2(action.spell, 'alice', { commandId: 'focus-denied', expectedVersion: fixture.match.stateVersion,
    command: { cardUID: fixture.match.players[0].hand.find(value => value.cardId === 'focus-plain').uid } });
  assert.deepEqual(denied.outcome, { status: 'rejected', reason: 'no-permission' });
  assert.equal(denied.session.chain.items.length, 0);
});

test('Showdown Focus fails closed for foreign cursors, wrong actors, and a reentrant source attestor', () => {
  const fixture = setup();
  const base = adoptAdmittedDuelPlayingSessionV2(fixture.match);
  const services = spellServices(fixture);
  assert.throws(() => suspendDuelEngagementForSpellV2(structuredClone(fixture.cursor), base, services), /invalid-authority/);
  assert.throws(() => suspendDuelEngagementForSpellV2(fixture.cursor, structuredClone(base), services), /wrong-command/);
  const action = suspendDuelEngagementForSpellV2(fixture.cursor, base, services);
  const uid = fixture.match.players[0].hand.find(value => value.cardId === 'focus-draw').uid;
  const wrongActor = playDuelSpellCardV2(action.spell, 'bob', { commandId: 'focus-wrong-actor',
    expectedVersion: fixture.match.stateVersion, command: { cardUID: uid } });
  assert.deepEqual(wrongActor.outcome, { status: 'rejected', reason: 'no-permission' });
  assert.equal(wrongActor.session.chain.items.length, 0);

  const reentrantFixture = setup();
  const reentrantBase = adoptAdmittedDuelPlayingSessionV2(reentrantFixture.match);
  let reentrantAction;
  let calls = 0;
  const reentrantServices = spellServices(reentrantFixture, { sourceAttestor: () => {
    calls++;
    if (calls === 1) assert.throws(() => playDuelSpellCardV2(reentrantAction, 'alice', {
      commandId: 'focus-reentrant', expectedVersion: reentrantFixture.match.stateVersion, command: { cardUID: uid },
    }), /reentrant command/);
  } });
  reentrantAction = suspendDuelEngagementForSpellV2(reentrantFixture.cursor, reentrantBase, reentrantServices);
  const reentrant = playDuelSpellCardV2(reentrantAction.spell, 'alice', { commandId: 'focus-reentrant',
    expectedVersion: reentrantFixture.match.stateVersion,
    command: { cardUID: reentrantFixture.match.players[0].hand.find(value => value.cardId === 'focus-draw').uid } });
  assert.equal(reentrant.outcome.status, 'pending');
  assert.equal(reentrant.outcome.reason, 'cost-proof-pending');
  assert.equal(reentrant.session.commandSession.requiredTasks.length, 0);
  assert.equal(reentrant.session.chain.items.length, 1);
  assert.throws(() => resumeDuelEngagementAfterSpellV2(reentrantAction.suspension, reentrant.session), /wrong-command/);
});

test('Showdown Focus does not reclaim engagement after stale readHead or missing effect closure', () => {
  const fixture = setup();
  const base = adoptAdmittedDuelPlayingSessionV2(fixture.match);
  const action = suspendDuelEngagementForSpellV2(fixture.cursor, base, spellServices(fixture));
  const uid = fixture.match.players[0].hand.find(value => value.cardId === 'focus-draw').uid;
  let result = playDuelSpellCardV2(action.spell, 'alice', { commandId: 'focus-stale',
    expectedVersion: fixture.match.stateVersion, command: { cardUID: uid } });
  result = payAndFinalize(result, 'focus-stale');
  result = passDuelSpellPriorityV2(result.session, 'alice');
  result = passDuelSpellPriorityV2(result.session, 'bob');
  result = resolveDuelSpellCardPlayV2(result.session, 'alice');
  assert.equal(result.outcome.status, 'applied');
  fixture.setHead(fixture.match);
  assert.throws(() => resumeDuelEngagementAfterSpellV2(action.suspension, result.session), /stale-head/);

  const missingClosureFixture = setup();
  const missingBase = adoptAdmittedDuelPlayingSessionV2(missingClosureFixture.match);
  const missingAction = suspendDuelEngagementForSpellV2(missingClosureFixture.cursor, missingBase,
    spellServices(missingClosureFixture, { closure: {} }));
  const missingUID = missingClosureFixture.match.players[0].hand.find(value => value.cardId === 'focus-draw').uid;
  let missing = playDuelSpellCardV2(missingAction.spell, 'alice', { commandId: 'focus-missing-effect',
    expectedVersion: missingClosureFixture.match.stateVersion, command: { cardUID: missingUID } });
  missing = payAndFinalize(missing, 'focus-missing-effect');
  missing = passDuelSpellPriorityV2(missing.session, 'alice');
  missing = passDuelSpellPriorityV2(missing.session, 'bob');
  missing = resolveDuelSpellCardPlayV2(missing.session, 'alice');
  assert.equal(missing.outcome.status, 'pending');
  assert.equal(missing.outcome.reason, 'effect-proof-pending');
  missingClosureFixture.setHead(missing.session.commandSession.match);
  assert.throws(() => resumeDuelEngagementAfterSpellV2(missingAction.suspension, missing.session), /wrong-command/);
});
