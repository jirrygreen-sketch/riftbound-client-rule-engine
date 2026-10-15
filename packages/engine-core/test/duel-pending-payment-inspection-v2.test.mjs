import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelCommandSessionV2, adoptAdmittedDuelPlayingSessionV2,
  applyDuelResourceCommandV2, commitDuelPriorityPaymentV2,
  issueDuelRequiredCostTaskV2, prepareDuelRequiredCostPaymentV2,
  inspectDuelPendingPaymentV2,
} from '../dist/duel/canonical-session-v2.js';
import {
  channelDuelRunesV2, commitDuelPlayingMutationV2, createDuelGoldTokenV2,
  referenceDuelPhysicalCardV2,
} from '../dist/duel/core-v2.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: `print-main-${i}` })),
  champion: { uid: `${playerId}-champion`, cardId: 'print-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'print-legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: `print-rune-${i}`,
    domain: i % 2 === 0 ? 'Fury' : 'Calm' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `print-field-${i}` })),
}));
const metadata = { matchId: 'inspection-match', dataVersion: 'catalog-v2', catalogDigest: 'sha256:test',
  roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) };
const types = cardId => cardId === 'print-champion' ? 'Champion'
  : cardId === 'print-legend' ? 'Legend'
    : cardId.startsWith('print-rune-') ? 'Rune'
      : cardId.startsWith('print-field-') ? 'Battlefield' : 'Unit';
const EMPTY = { energy: 0, power: [] };
const pay = (paymentId, plan) => ({ type: 'pay-pending', paymentId,
  ...(plan === undefined ? {} : { plan }) });
const submit = (session, actor, commandId, command, attestor, version = session.match.stateVersion) =>
  applyDuelResourceCommandV2(session, actor, { commandId, expectedVersion: version, command },
    attestor === undefined ? undefined : { sourceAttestor: attestor });
const inspect = (session, actor, command, version = session.match.stateVersion) =>
  inspectDuelPendingPaymentV2(session, actor, version, command);
const blocked = reason => ({ status: 'blocked', reason });
const reattest = { status: 'requires-reattest', reason: 'source-reattest-required' };
function applySuccess(session, actor, commandId, command, attestor) {
  const result = submit(session, actor, commandId, command, attestor);
  assert.equal(result.outcome.status, 'applied', JSON.stringify(result.outcome));
  return result.session;
}
function main({ priority = 'alice', channel = [2, 0] } = {}) {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, types);
  session = applySuccess(session, 'alice', 'mulligan-a', { type: 'mulligan', selectedUIDs: [] });
  session = applySuccess(session, 'bob', 'mulligan-b', { type: 'mulligan', selectedUIDs: [] });
  let match = session.match;
  for (const [index, count] of channel.entries()) if (count) match = channelDuelRunesV2(match, seats[index].playerId, count);
  // Test fixture only: trusted frame preparation stands in for a real phase executor.
  match = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates)
      .map(([uid, old]) => [uid, { ...old, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', priorityPlayerId: priority } }, transitions: [] }));
  return adoptAdmittedDuelPlayingSessionV2(match);
}
const rune = (s, actor, index) => s.match.resources.bases.find(b => b.playerId === actor).baseRunes[index];
const pool = (s, actor = 'alice') => s.match.resources.players.find(p => p.playerId === actor).runePool;
const source = (s, actor = 'alice') => ({ kind: 'card', referenceId: 'test-registered-source',
  sourceUID: s.match.players.find(p => p.playerId === actor).hand[0].uid });
/** Test-only attestor: binds an existing, independently identified physical UID/epoch.
 * For pre-exit, the event proof is checked on each real call, not inferred from live position. */
function proof(s, { actor = 'alice', paymentId = 'p1', ref = source(s, actor),
  cost = EMPTY, taskId, continuationId, mode = 'current' } = {}) {
  const expectedEpoch = referenceDuelPhysicalCardV2(s.match, ref.sourceUID).zoneEpoch;
  let calls = 0;
  const attest = request => {
    calls++;
    assert.equal(request.match.matchId, s.match.matchId);
    assert.equal(request.actor, actor);
    assert.equal(request.paymentId, paymentId);
    assert.deepEqual(request.sourceReference, ref);
    assert.deepEqual(request.finalResolvedCost, cost);
    assert.equal(request.taskId, taskId);
    assert.equal(request.continuationId, continuationId);
    if (mode === 'pre-exit') {
      assert.ok(request.match.provenance.transitions.some(step => step.uid === ref.sourceUID &&
        step.from.kind === 'hand' && step.to.kind === 'main-deck'));
      assert.ok(request.match.physicalCardsByUID[ref.sourceUID].zoneEpoch > expectedEpoch);
    } else assert.equal(request.match.physicalCardsByUID[ref.sourceUID].zoneEpoch, expectedEpoch);
    return { matchId: request.match.matchId, actor, paymentId, sourceReference: { ...ref },
      sourceProofId: `registered:${paymentId}`, mode, sourceZoneEpoch: expectedEpoch,
      ...(taskId === undefined ? {} : { taskId, continuationId }) };
  };
  return { attest, get calls() { return calls; } };
}
function ordinary(s, paymentId = 'p1', cost = EMPTY, { ref = source(s), mode = 'current' } = {}) {
  const registered = proof(s, { paymentId, cost, ref, mode });
  const pending = commitDuelPriorityPaymentV2(s, 'alice', paymentId, cost, ref, registered.attest).session;
  assert.equal(registered.calls, 1);
  return { pending, registered };
}
function assertNotConsumed(session, read) {
  const match = session.match, resources = match.resources, receipts = session.receipts;
  const tasks = session.requiredTasks, priority = session.priorityPayments;
  const snapshot = JSON.stringify(session);
  const value = read();
  assert.strictEqual(session.match, match);
  assert.strictEqual(match.resources, resources);
  assert.strictEqual(session.receipts, receipts);
  assert.strictEqual(session.requiredTasks, tasks);
  assert.strictEqual(session.priorityPayments, priority);
  assert.equal(JSON.stringify(session), snapshot);
  return value;
}

test('inspector is callback/commandId-free, read-only; genuine one-use attestor runs only for fresh command', () => {
  const { pending, registered } = ordinary(main());
  const payment = pay('p1');
  const first = assertNotConsumed(pending, () => inspect(pending, 'alice', payment));
  const second = assertNotConsumed(pending, () => inspect(pending, 'alice', payment));
  assert.deepEqual(first, reattest);
  assert.deepEqual(second, first);
  assert.equal(registered.calls, 1); // issuance only
  let payCalls = 0;
  const oneUse = request => {
    payCalls++;
    if (payCalls !== 1) throw new Error('source proof already consumed');
    return registered.attest(request);
  };
  const applied = submit(pending, 'alice', 'fresh-payment', payment, oneUse);
  assert.equal(applied.outcome.status, 'applied');
  assert.equal(applied.session.priorityPayments[0].status, 'completed');
  assert.equal(applied.session.match.frame.pendingPayment, null);
  assert.equal(payCalls, 1);
  const duplicate = submit(applied.session, 'alice', 'fresh-payment', payment, oneUse, pending.match.stateVersion);
  assert.equal(duplicate.duplicate, true);
  assert.equal(payCalls, 1);
  assert.deepEqual(inspect(applied.session, 'alice', payment), blocked('no-permission'));
});

test('required payer differs from Priority, issued authority survives inspection, and gate matches fresh pay', () => {
  const s = main({ priority: 'bob', channel: [1, 0] });
  const cost = { energy: 1, power: [] }, ref = source(s);
  const task = { matchId: s.match.matchId, expectedVersion: s.match.stateVersion,
    taskId: 'required-task', paymentId: 'required-payment', actor: 'alice',
    finalResolvedCost: cost, opaqueSource: ref, continuationId: 'private-continuation' };
  const registered = proof(s, { paymentId: task.paymentId, cost, ref, taskId: task.taskId,
    continuationId: task.continuationId });
  const issued = issueDuelRequiredCostTaskV2(s, task, registered.attest);
  assert.deepEqual(assertNotConsumed(issued.session,
    () => inspect(issued.session, 'alice', pay(task.paymentId))), blocked('no-permission'));
  const pending = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, registered.attest).session;
  assert.equal(registered.calls, 2);
  assert.equal(pending.match.frame.priorityPlayerId, 'bob');
  assert.deepEqual(inspect(pending, 'bob', pay(task.paymentId)), blocked('no-permission'));
  assert.deepEqual(inspect(pending, 'alice', pay('wrong-id')), blocked('no-permission'));
  assert.deepEqual(inspect(pending, 'alice', pay(task.paymentId)), blocked('payment-rejected'));
  const ready = applySuccess(pending, 'alice', 'alice-energy', { type: 'rune-energy', uid: rune(pending, 'alice', 0).uid });
  assert.deepEqual(assertNotConsumed(ready, () => inspect(ready, 'alice', pay(task.paymentId))), reattest);
  assert.equal(registered.calls, 2);
  const wrong = submit(ready, 'bob', 'wrong-payer', pay(task.paymentId), registered.attest);
  assert.deepEqual(wrong.outcome, { status: 'rejected', reason: 'no-permission' });
  assert.equal(registered.calls, 2);
  const paid = submit(ready, 'alice', 'required-pay', pay(task.paymentId), registered.attest);
  assert.equal(paid.outcome.status, 'applied');
  assert.equal(registered.calls, 3);
  assert.deepEqual(paid.outcome.paymentCompleted.requiredTask,
    { taskId: task.taskId, continuationId: task.continuationId });
  assert.equal(paid.session.requiredTasks[0].status, 'completed');
  assert.deepEqual(inspect(paid.session, 'alice', pay(task.paymentId)), blocked('no-permission'));
});

test('current source original epoch is mandatory even when pool and pending ledger otherwise match', () => {
  const s = main({ channel: [1, 0] });
  const uid = rune(s, 'alice', 0).uid;
  const ref = { kind: 'card', referenceId: 'test-registered-source', sourceUID: uid };
  const { pending, registered } = ordinary(s, 'stale-current', EMPTY, { ref });
  assert.deepEqual(inspect(pending, 'alice', pay('stale-current')), reattest);
  const afterRecycle = applySuccess(pending, 'alice', 'recycle-source', { type: 'rune-power', uid });
  assert.ok(afterRecycle.match.physicalCardsByUID[uid].zoneEpoch >
    pending.priorityPayments[0].sourceBinding.sourceZoneEpoch);
  assert.deepEqual(assertNotConsumed(afterRecycle,
    () => inspect(afterRecycle, 'alice', pay('stale-current'))), blocked('payment-rejected'));
  assert.equal(registered.calls, 1);
  const actual = submit(afterRecycle, 'alice', 'stale-actual', pay('stale-current'), registered.attest);
  assert.deepEqual(actual.outcome, { status: 'rejected', reason: 'payment-rejected' });
  assert.equal(actual.persistRequired, true);
  assert.equal(registered.calls, 2);
});

test('pre-exit binding checks its saved journal epoch, never the current zone; actual pay re-attests', () => {
  let s = main();
  const ref = source(s), uid = ref.sourceUID;
  const registered = proof(s, { ref, paymentId: 'pre-exit', mode: 'pre-exit' });
  const initialEpoch = s.match.physicalCardsByUID[uid].zoneEpoch;
  const left = commitDuelPlayingMutationV2(s.match, draft => ({
    match: { ...draft, players: draft.players.map(player => player.playerId !== 'alice'
      ? player : { ...player, hand: player.hand.filter(card => card.uid !== uid),
        remainingMainDeck: [...player.remainingMainDeck,
          { uid, cardId: draft.physicalCardsByUID[uid].cardId }] }) },
    transitions: [{ uid, from: { kind: 'hand', zonePlayerId: 'alice' },
      to: { kind: 'main-deck', zonePlayerId: 'alice' } }],
  }));
  s = adoptAdmittedDuelPlayingSessionV2(left);
  const pending = commitDuelPriorityPaymentV2(s, 'alice', 'pre-exit', EMPTY, ref, registered.attest).session;
  assert.ok(pending.match.physicalCardsByUID[uid].zoneEpoch > initialEpoch);
  assert.deepEqual(assertNotConsumed(pending,
    () => inspect(pending, 'alice', pay('pre-exit'))), reattest);
  assert.equal(registered.calls, 1);
  const noAttestor = submit(pending, 'alice', 'no-attestor', pay('pre-exit'));
  assert.deepEqual(noAttestor.outcome, { status: 'rejected', reason: 'payment-rejected' });
  const actual = submit(pending, 'alice', 'journal-pay', pay('pre-exit'), registered.attest);
  assert.equal(actual.outcome.status, 'applied');
  assert.equal(registered.calls, 2);
  assert.equal(actual.outcome.paymentCompleted.sourceProofId, 'registered:pre-exit');
});

test('shared payment kernel enforces energy, max-flow and exact explicit plan without consuming attestor', () => {
  let s = main({ channel: [4, 0] });
  s = applySuccess(s, 'alice', 'energy-a', { type: 'rune-energy', uid: rune(s, 'alice', 0).uid });
  s = applySuccess(s, 'alice', 'energy-b', { type: 'rune-energy', uid: rune(s, 'alice', 3).uid });
  s = applySuccess(s, 'alice', 'power-fury', { type: 'rune-power', uid: rune(s, 'alice', 2).uid });
  s = applySuccess(s, 'alice', 'power-calm', { type: 'rune-power', uid: rune(s, 'alice', 1).uid });
  const cost = { energy: 1, power: [
    { allowedDomains: ['Fury', 'Calm'], amount: 1 }, { allowedDomains: ['Fury'], amount: 1 },
  ] };
  const registered = proof(s, { paymentId: 'maxflow', cost });
  const pending = commitDuelPriorityPaymentV2(s, 'alice', 'maxflow', cost, source(s), registered.attest).session;
  // Fury only has one unit: the flexible requirement must take Calm rather than greedily taking Fury.
  assert.deepEqual(assertNotConsumed(pending, () => inspect(pending, 'alice', pay('maxflow'))), reattest);
  const valid = { power: [{ requirementIndex: 0, from: 'Calm', amount: 1 },
    { requirementIndex: 1, from: 'Fury', amount: 1 }] };
  assert.deepEqual(inspect(pending, 'alice', pay('maxflow', valid)), reattest);
  const invalid = [
    { power: [{ requirementIndex: 0, from: 'Fury', amount: 1 },
      { requirementIndex: 1, from: 'Calm', amount: 1 }] }, // wrong domain
    { power: [{ requirementIndex: 0, from: 'Calm', amount: 1 },
      { requirementIndex: 0, from: 'Calm', amount: 1 },
      { requirementIndex: 1, from: 'Fury', amount: 1 }] }, // duplicate
    { power: [{ requirementIndex: 0, from: 'Calm', amount: 2 },
      { requirementIndex: 1, from: 'Fury', amount: 1 }] }, // source/requirement exceeded
    { power: [{ requirementIndex: 0, from: 'Calm', amount: 1 }] }, // missing
    { power: [{ requirementIndex: 9, from: 'Fury', amount: 1 }] }, // out of range
  ];
  for (const [index, plan] of invalid.entries()) {
    assert.deepEqual(assertNotConsumed(pending, () => inspect(pending, 'alice', pay('maxflow', plan))),
      blocked('payment-rejected'));
    const actual = submit(pending, 'alice', `bad-${index}`, pay('maxflow', plan), registered.attest);
    assert.deepEqual(actual.outcome, { status: 'rejected', reason: 'payment-rejected' });
    assert.equal(actual.persistRequired, true);
  }
  assert.equal(registered.calls, 1 + invalid.length); // every fresh actual attempt still re-attests first
  assert.equal(pool(pending).energy, 2);
  const paid = submit(pending, 'alice', 'valid-explicit', pay('maxflow', valid), registered.attest);
  assert.equal(paid.outcome.status, 'applied');
  assert.deepEqual(paid.outcome.paymentCompleted.plan, valid);
  assert.equal(pool(paid.session).energy, 1);
  assert.equal(pool(paid.session).power.Calm, 0);
  assert.equal(pool(paid.session).power.Fury, 0);
  assert.equal(registered.calls, 2 + invalid.length);

  const expensive = ordinary(main(), 'insufficient', { energy: 1, power: [] });
  assert.deepEqual(inspect(expensive.pending, 'alice', pay('insufficient')), blocked('payment-rejected'));
  assert.equal(expensive.registered.calls, 1);
  const tooExpensive = submit(expensive.pending, 'alice', 'insufficient-pay', pay('insufficient'),
    expensive.registered.attest);
  assert.deepEqual(tooExpensive.outcome, { status: 'rejected', reason: 'payment-rejected' });
  assert.equal(expensive.registered.calls, 2);
});

test('an independently issued Gold creates Any Power consumed by an exact mixed-domain plan', () => {
  let s = main({ channel: [2, 0] });
  const tokenSource = source(s), base = s.match.resources.bases.find(b => b.playerId === 'alice');
  const request = { kind: 'gold', tokenUID: 'attested-gold', sourceEffectId: 'test-gold-effect',
    eventId: 'test-gold-event', sourceUID: tokenSource.sourceUID,
    sourceZoneEpoch: s.match.physicalCardsByUID[tokenSource.sourceUID].zoneEpoch,
    sourceMode: 'current', effectControllerPlayerId: 'alice', controllerPlayerId: 'alice',
    locationId: base.locationId, readied: true };
  const created = createDuelGoldTokenV2(s.match, request, ({ match, request: entry }) => ({
    ...entry, matchId: match.matchId, dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest, sourceProofId: 'test-only-gold-birth',
  }));
  s = adoptAdmittedDuelPlayingSessionV2(created);
  s = applySuccess(s, 'alice', 'gold-power', { type: 'gold-power', uid: 'attested-gold' });
  s = applySuccess(s, 'alice', 'calm-power', { type: 'rune-power', uid: rune(s, 'alice', 0).uid });
  assert.equal(pool(s).power.any, 1);
  assert.equal(pool(s).power.Calm, 1);
  const cost = { energy: 0, power: [
    { allowedDomains: ['Fury'], amount: 1 }, { allowedDomains: ['Calm'], amount: 1 },
  ] };
  const { pending, registered } = ordinary(s, 'gold-any', cost);
  assert.deepEqual(assertNotConsumed(pending, () => inspect(pending, 'alice', pay('gold-any'))), reattest);
  const plan = { power: [
    { requirementIndex: 0, from: 'any', amount: 1 },
    { requirementIndex: 1, from: 'Calm', amount: 1 },
  ] };
  assert.deepEqual(inspect(pending, 'alice', pay('gold-any', plan)), reattest);
  assert.deepEqual(inspect(pending, 'alice', pay('gold-any', { power: [
    { requirementIndex: 0, from: 'Calm', amount: 1 },
    { requirementIndex: 1, from: 'any', amount: 1 },
  ] })), blocked('payment-rejected'));
  assert.equal(registered.calls, 1);
  const applied = submit(pending, 'alice', 'gold-any-pay', pay('gold-any', plan), registered.attest);
  assert.equal(applied.outcome.status, 'applied');
  assert.deepEqual(applied.outcome.paymentCompleted.plan, plan);
  assert.equal(pool(applied.session).power.any, 0);
  assert.equal(pool(applied.session).power.Calm, 0);
});

test('rejects cloned/unadmitted sessions, malformed input and stale version before local pay checks', () => {
  const { pending } = ordinary(main());
  const payment = pay('p1');
  assert.throws(() => inspect(structuredClone(pending), 'alice', payment), /unadmitted V2 session/);
  assert.throws(() => inspect(JSON.parse(JSON.stringify(pending)), 'alice', payment), /unadmitted V2 session/);
  assert.deepEqual(inspect(pending, 'alice', payment, pending.match.stateVersion - 1), blocked('stale-version'));
  assert.deepEqual(inspect(pending, 'outsider', payment), blocked('unknown-actor'));
  assert.deepEqual(inspect(pending, 'alice', { ...payment, taskId: 'forged' }), blocked('invalid-command'));
  assert.deepEqual(inspect(pending, 'alice', pay('p1', { power: [{ requirementIndex: -1,
    from: 'Fury', amount: 1 }] })), blocked('invalid-command'));
  assert.deepEqual(inspect(pending, 'alice', payment, Number.NaN), blocked('invalid-command'));
  assert.deepEqual(inspect(pending, 'alice', { type: 'rune-energy', uid: 'alice-rune-0' }), blocked('invalid-command'));
  assert.deepEqual(inspect(main(), 'alice', payment), blocked('no-permission'));
});
