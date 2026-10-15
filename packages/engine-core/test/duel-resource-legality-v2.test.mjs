// Controlled native constructor/source-oracle differential regression; not an official catalog or production restore proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDuelPhaseSourceRegistryV2 } from '../dist/duel/phase-source-authority-v2.js';
import { runDuelStartOfTurnV2 } from '../dist/duel/turn-executor-v2.js';
import {
  createDuelCommandSessionV2, applyDuelResourceCommandV2,
  adoptAdmittedDuelPlayingSessionV2, inspectDuelResourceCommandV2,
  commitDuelCommandFrameV2, commitDuelCommandMutationV2,
  issueDuelRequiredCostTaskV2, prepareDuelRequiredCostPaymentV2,
} from '../dist/duel/canonical-session-v2.js';
import {
  createDuelGoldTokenV2, inspectDuelNativeTokenHistoryV2,
  inspectDuelNativeCommitPathV2, restoreDuelPlayingStateV2,
} from '../dist/duel/core-v2.js';


test('resource inspector matches 34 fresh command cases without query side effects', () => {
  const seats = ['alice', 'bob'].map(playerId => ({ playerId,
    mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-card-${i}`, cardId: 'plain-unit' })),
    champion: { uid: `${playerId}-champion`, cardId: 'plain-champion' },
    legend: { uid: `${playerId}-legend`, cardId: 'plain-legend' },
    runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'plain-rune', domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `plain-field-${i}` })),
  }));
  const metadata = { matchId: 'independent-legality-probe', dataVersion: 'catalog-v2',
    catalogDigest: 'sha256:independent-legality-probe',
    roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) };
  const types = id => id === 'plain-champion' ? 'Champion' : id === 'plain-legend' ? 'Legend' :
    id === 'plain-rune' ? 'Rune' : id.startsWith('plain-field-') ? 'Battlefield' : 'Unit';
  let rngCalls = 0, providerCalls = 0, attestorCalls = 0, commandSeq = 0;
  const printings = [...new Set(seats.flatMap(s => [s.champion.cardId, s.legend.cardId,
    ...s.mainDeck.map(c => c.cardId), ...s.runeDeck.map(c => c.cardId), ...s.battlefields.map(c => c.cardId)]))]
    .map(cardId => ({ cardId, programReference: `fixture:${cardId}` }));
  const phaseOracle = () => createDuelPhaseSourceRegistryV2({ ...metadata, printings }, request => {
    providerCalls++;
    return { status: 'complete', matchId: request.matchId, dataVersion: request.dataVersion,
      catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
      uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
      controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
      programReference: `fixture:${request.source.cardId ?? request.source.uid}`,
      event: request.event, eventSupported: true, scope: 'known-no-handler',
      replacementsCovered: true, staticCovered: true, continuousCovered: true, triggersCovered: true };
  });
  const services = () => ({ sources: phaseOracle(), fepr: () => ({ status: 'none' }) });
  const sourceOracle = ({ match, request }) => {
    attestorCalls++;
    return { ...request, matchId: match.matchId, dataVersion: match.dataVersion,
      catalogDigest: match.catalogDigest, sourceProofId: `fixture:${request.sourceEffectId}` };
  };
  function setup() {
    let session = createDuelCommandSessionV2(seats, metadata, () => { rngCalls++; return 0; }, types);
    for (const actor of ['alice', 'bob']) {
      const result = applyDuelResourceCommandV2(session, actor, { commandId: `mulligan-${actor}`,
        expectedVersion: session.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
      assert.equal(result.outcome.status, 'applied'); session = result.session;
    }
    return session;
  }
  function main() {
    const result = runDuelStartOfTurnV2(setup(), services());
    assert.equal(result.status, 'main', result.reason);
    return result.session;
  }
  function gold(session, uid, options = {}) {
    const match = session.match;
    const sourceUID = match.players.find(p => p.playerId === 'alice').hand[0].uid;
    const request = { kind: 'gold', tokenUID: uid, sourceEffectId: `effect:${uid}`,
      eventId: `event:${uid}`, sourceUID,
      sourceZoneEpoch: options.sourceZoneEpoch ?? match.physicalCardsByUID[sourceUID].zoneEpoch,
      sourceMode: options.sourceMode ?? 'current', effectControllerPlayerId: 'alice',
      controllerPlayerId: 'alice', locationId: match.resources.bases[0].locationId,
      readied: options.readied ?? true };
    return adoptAdmittedDuelPlayingSessionV2(createDuelGoldTokenV2(match, request, sourceOracle));
  }
  const cases = [];
  function compare(label, session, actor, command, version = session.match.stateVersion) {
    const before = JSON.stringify(session);
    const history = inspectDuelNativeTokenHistoryV2(session.match);
    const receipts = session.receipts;
    const counters = [rngCalls, providerCalls, attestorCalls];
    const inspected = inspectDuelResourceCommandV2(session, actor, version, command);
    assert.equal(JSON.stringify(session), before, `${label}: query changed session`);
    assert.strictEqual(session.receipts, receipts, `${label}: query changed receipts`);
    assert.strictEqual(inspectDuelNativeTokenHistoryV2(session.match), history, `${label}: query changed journal`);
    assert.deepEqual(inspectDuelNativeCommitPathV2(session.match, session.match), [], `${label}: query changed native path`);
    assert.deepEqual([rngCalls, providerCalls, attestorCalls], counters, `${label}: query called provider/RNG`);
    const actual = applyDuelResourceCommandV2(session, actor, {
      commandId: `fresh-probe-${++commandSeq}`, expectedVersion: version, command });
    const actualClass = actual.outcome.status === 'applied' ? 'legal' : actual.outcome.reason;
    const queryClass = inspected.status === 'legal' ? 'legal' : inspected.reason;
    cases.push({ label, queryClass, actualClass, equal: queryClass === actualClass,
      actualPersist: actual.persistRequired, actualDuplicate: actual.duplicate });
    return actual;
  }
  function priority(session, actor) {
    return commitDuelCommandFrameV2(session, { ...session.match.frame, priorityPlayerId: actor }, () => {}).session;
  }
  function taskBinding(session, actor = 'alice') {
    const sourceUID = session.match.players.find(p => p.playerId === 'alice').hand[0].uid;
    const sourceReference = { kind: 'effect', referenceId: `task:${++commandSeq}`, sourceUID };
    const paymentId = `payment:${commandSeq}`, taskId = `task:${commandSeq}`;
    const task = { matchId: session.match.matchId, expectedVersion: session.match.stateVersion,
      taskId, paymentId, actor, finalResolvedCost: { energy: 0, power: [] },
      opaqueSource: sourceReference, continuationId: `continuation:${commandSeq}` };
    const attestor = request => {
      attestorCalls++;
      return { matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
        sourceReference: request.sourceReference, sourceProofId: `fixture:${paymentId}`, mode: 'current',
        sourceZoneEpoch: request.match.physicalCardsByUID[sourceUID].zoneEpoch,
        taskId: request.taskId, continuationId: request.continuationId };
    };
    return { task, attestor };
  }
  
  const setupSession = setup();
  compare('setup-stage', setupSession, 'alice', { type: 'rune-energy', uid: 'alice-rune-0' });
  let base = main();
  const rune = base.match.resources.bases[0].baseRunes[0].uid;
  compare('rune-energy-ready', base, 'alice', { type: 'rune-energy', uid: rune });
  compare('rune-power-ready', base, 'alice', { type: 'rune-power', uid: rune });
  compare('rune-foreign-actor', base, 'bob', { type: 'rune-energy', uid: rune });
  compare('rune-unknown-actor', base, 'outsider', { type: 'rune-energy', uid: rune });
  compare('rune-stale', base, 'alice', { type: 'rune-power', uid: rune }, base.match.stateVersion - 1);
  compare('rune-invalid', base, 'alice', { type: 'rune-power', uid: '' });
  let getterCalls = 0;
  const accessor = { type: 'rune-energy' };
  Object.defineProperty(accessor, 'uid', { enumerable: true, get() { getterCalls++; return rune; } });
  compare('rune-accessor-rejected', base, 'alice', accessor);
  assert.equal(getterCalls, 0, 'query or command called accessor');
  const exhausted = applyDuelResourceCommandV2(base, 'alice', { commandId: 'exhaust-rune',
    expectedVersion: base.match.stateVersion, command: { type: 'rune-energy', uid: rune } });
  assert.equal(exhausted.outcome.status, 'applied');
  compare('rune-energy-exhausted', exhausted.session, 'alice', { type: 'rune-energy', uid: rune });
  compare('rune-power-after-energy', exhausted.session, 'alice', { type: 'rune-power', uid: rune });
  const recycled = applyDuelResourceCommandV2(base, 'alice', { commandId: 'recycle-rune',
    expectedVersion: base.match.stateVersion, command: { type: 'rune-power', uid: rune } });
  assert.equal(recycled.outcome.status, 'applied');
  compare('rune-power-retired-from-base', recycled.session, 'alice', { type: 'rune-power', uid: rune });
  compare('rune-energy-retired-from-base', recycled.session, 'alice', { type: 'rune-energy', uid: rune });
  const otherPriority = priority(base, 'bob');
  compare('rune-wrong-priority', otherPriority, 'alice', { type: 'rune-energy', uid: rune });
  const closed = commitDuelCommandFrameV2(base, { ...base.match.frame, stateOpen: false }, () => {}).session;
  compare('rune-closed-reaction', closed, 'alice', { type: 'rune-energy', uid: rune });
  const ended = commitDuelCommandFrameV2(base, { ...base.match.frame, phase: 'ended' }, () => {}).session;
  compare('rune-ended-phase', ended, 'alice', { type: 'rune-energy', uid: rune });
  const issuedBinding = taskBinding(base);
  const issued = issueDuelRequiredCostTaskV2(base, issuedBinding.task, issuedBinding.attestor);
  compare('rune-issued-task', issued.session, 'alice', { type: 'rune-energy', uid: rune });
  const active = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, issuedBinding.attestor).session;
  compare('rune-active-payer', active, 'alice', { type: 'rune-energy', uid: rune });
  compare('rune-active-other-actor', active, 'bob', { type: 'rune-energy', uid: rune });
  const activeOtherPriority = priority(base, 'bob');
  const otherBinding = taskBinding(activeOtherPriority, 'alice');
  const otherIssued = issueDuelRequiredCostTaskV2(activeOtherPriority, otherBinding.task, otherBinding.attestor);
  const otherActive = prepareDuelRequiredCostPaymentV2(otherIssued.session, otherIssued.authority, otherBinding.attestor).session;
  compare('rune-active-payer-without-priority', otherActive, 'alice', { type: 'rune-energy', uid: rune });
  compare('rune-active-priority-not-payer', otherActive, 'bob', { type: 'rune-energy', uid: 'bob-rune-0' });
  
  const ready = gold(base, 'gold-ready');
  compare('gold-ready', ready, 'alice', { type: 'gold-power', uid: 'gold-ready' });
  compare('gold-unknown-birth', ready, 'alice', { type: 'gold-power', uid: 'gold-never-born' });
  compare('gold-foreign-base', priority(ready, 'bob'), 'bob', { type: 'gold-power', uid: 'gold-ready' });
  compare('gold-wrong-priority', priority(ready, 'bob'), 'alice', { type: 'gold-power', uid: 'gold-ready' });
  const tired = gold(base, 'gold-tired', { readied: false });
  compare('gold-exhausted', tired, 'alice', { type: 'gold-power', uid: 'gold-tired' });
  const spent = applyDuelResourceCommandV2(ready, 'alice', { commandId: 'consume-gold',
    expectedVersion: ready.match.stateVersion, command: { type: 'gold-power', uid: 'gold-ready' } });
  assert.equal(spent.outcome.status, 'applied');
  compare('gold-retired', spent.session, 'alice', { type: 'gold-power', uid: 'gold-ready' });
  const goldBinding = taskBinding(ready);
  const goldIssued = issueDuelRequiredCostTaskV2(ready, goldBinding.task, goldBinding.attestor);
  compare('gold-issued-task', goldIssued.session, 'alice', { type: 'gold-power', uid: 'gold-ready' });
  const goldActive = prepareDuelRequiredCostPaymentV2(goldIssued.session, goldIssued.authority, goldBinding.attestor).session;
  compare('gold-active-payer', goldActive, 'alice', { type: 'gold-power', uid: 'gold-ready' });
  compare('gold-active-other-actor', goldActive, 'bob', { type: 'gold-power', uid: 'gold-ready' });
  
  // Reuse the explicit Core fixture's legal physical hand-to-deck move before a pre-exit source grant.
  const movingSource = base.match.players[0].hand[0].uid;
  const oldEpoch = base.match.physicalCardsByUID[movingSource].zoneEpoch;
  const moved = commitDuelCommandMutationV2(base, draft => ({
    match: { ...draft, players: draft.players.map(player => player.playerId === 'alice' ? {
      ...player, hand: player.hand.filter(card => card.uid !== movingSource),
      remainingMainDeck: [...player.remainingMainDeck, player.hand.find(card => card.uid === movingSource)],
    } : player) },
    transitions: [{ uid: movingSource, from: { kind: 'hand', zonePlayerId: 'alice' },
      to: { kind: 'main-deck', zonePlayerId: 'alice' } }],
  })).session;
  const preExitRequest = { kind: 'gold', tokenUID: 'gold-pre-exit', sourceEffectId: 'effect:gold-pre-exit',
    eventId: 'event:gold-pre-exit', sourceUID: movingSource, sourceZoneEpoch: oldEpoch,
    sourceMode: 'pre-exit', effectControllerPlayerId: 'alice', controllerPlayerId: 'alice',
    locationId: moved.match.resources.bases[0].locationId, readied: true };
  const preExit = adoptAdmittedDuelPlayingSessionV2(createDuelGoldTokenV2(moved.match, preExitRequest, sourceOracle));
  compare('gold-pre-exit-source-moved', preExit, 'alice', { type: 'gold-power', uid: 'gold-pre-exit' });
  
  // Restore inputs follow the existing Core fixture shape; lifecycle history is read from a real native grant.
  const nativeHistory = inspectDuelNativeTokenHistoryV2(ready.match);
  const snapshot = structuredClone(ready.match);
  const originalCards = snapshot.provenance.originalPhysicalCards;
  const inventory = {
    matchId: snapshot.matchId, dataVersion: snapshot.dataVersion, catalogDigest: snapshot.catalogDigest,
    rosterPlayerIds: snapshot.roster.map(p => p.playerId), originalPhysicalCards: originalCards,
    submittedBattlefieldUIDs: snapshot.provenance.submittedBattlefieldUIDs,
    expectedZoneEpochByUID: Object.fromEntries(originalCards.map(card =>
      [card.uid, snapshot.physicalCardsByUID[card.uid]?.zoneEpoch ?? 0])),
    retiredPhysicalUIDs: snapshot.retiredPhysicalUIDs,
    goldOwnersByUID: { 'gold-ready': 'alice' }, unitTokenOwnersByUID: {},
  };
  const restoreHistory = { matchId: snapshot.matchId, dataVersion: snapshot.dataVersion,
    catalogDigest: snapshot.catalogDigest, rosterPlayerIds: inventory.rosterPlayerIds,
    originalPhysicalCards: originalCards, submittedBattlefieldUIDs: snapshot.provenance.submittedBattlefieldUIDs,
    retiredPhysicalUIDs: snapshot.retiredPhysicalUIDs,
    initialZonesByUID: snapshot.provenance.initialZonesByUID,
    transitions: snapshot.provenance.transitions };
  const restored = restoreDuelPlayingStateV2(snapshot, inventory, restoreHistory, nativeHistory);
  const restoredSession = adoptAdmittedDuelPlayingSessionV2(restored);
  compare('gold-restored-valid', restoredSession, 'alice', { type: 'gold-power', uid: 'gold-ready' });
  inventory.goldOwnersByUID['gold-ready'] = 'bob';
  const restoredRune = restoredSession.match.resources.bases[0].baseRunes[0].uid;
  for (const [kind, uid] of [['gold-power', 'gold-ready'],
    ['rune-energy', restoredRune], ['rune-power', restoredRune]])
    compare(`restored-private-inventory-mutated-${kind}`, restoredSession, 'alice', { type: kind, uid });
  
  let copiedQuery = '', copiedActual = '';
  const copied = structuredClone(restoredSession);
  try { inspectDuelResourceCommandV2(copied, 'alice', copied.match.stateVersion,
    { type: 'gold-power', uid: 'gold-ready' }); } catch (error) { copiedQuery = error.message; }
  try { applyDuelResourceCommandV2(copied, 'alice', { commandId: 'copied',
    expectedVersion: copied.match.stateVersion, command: { type: 'gold-power', uid: 'gold-ready' } });
  } catch (error) { copiedActual = error.message; }
  assert.match(copiedQuery, /unadmitted/);
  assert.equal(copiedQuery, copiedActual);
  
  assert.equal(cases.length, 34);
  assert.deepEqual(cases.filter(value => !value.equal), [], 'every query must match its fresh actual command');
});
