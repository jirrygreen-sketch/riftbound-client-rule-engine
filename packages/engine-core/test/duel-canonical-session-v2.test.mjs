import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelCommandSessionV2, adoptAdmittedDuelPlayingSessionV2,
  applyDuelResourceCommandV2 as apply, commitDuelCommandFrameV2,
  issueDuelRequiredCostTaskV2, prepareDuelRequiredCostPaymentV2,
  commitDuelPriorityPaymentV2,
} from '../dist/duel/canonical-session-v2.js';
import {
  commitDuelPlayingMutationV2, channelDuelRunesV2, referenceDuelPhysicalCardV2,
  assertCurrentDuelPhysicalReferenceV2, restoreDuelPlayingStateV2,
} from '../dist/duel/core-v2.js';
import { createDuelMatch } from '../dist/duel/match-state.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: `print-main-${i}` })),
  champion: { uid: `${playerId}-champion`, cardId: 'print-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'print-legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: `print-rune-${i}`,
    domain: i % 2 === 0 ? 'Fury' : 'Calm' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `print-field-${i}` })),
}));
const metadata = { matchId: 'session-v2-match', dataVersion: 'catalog-v2', catalogDigest: 'sha256:test',
  roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) };
const types = cardId => cardId === 'print-champion' ? 'Champion'
  : cardId === 'print-legend' ? 'Legend'
    : cardId.startsWith('print-rune-') ? 'Rune'
      : cardId.startsWith('print-field-') ? 'Battlefield' : 'Unit';
const create = () => createDuelCommandSessionV2(seats, metadata, () => 0, types);
const submit = (s, actor, commandId, command, expectedVersion = s.match.stateVersion, trusted) =>
  apply(s, actor, { commandId, expectedVersion, command }, trusted);
function ok(r, previous) {
  assert.equal(r.outcome.status, 'applied');
  assert.equal(r.match.stateVersion, previous.match.stateVersion + 1);
  assert.equal(r.match.eventSeq, previous.match.eventSeq + 1);
  assert.equal(r.outcome.appliedVersion, r.match.stateVersion);
  assert.equal(r.outcome.eventSeq, r.match.eventSeq);
  assert.equal(r.duplicate, false);
  assert.equal(r.persistRequired, true);
  assert.strictEqual(r.match, r.session.match);
  assert.equal(r.match.schemaVersion, 2);
  return r.session;
}
function fail(r, s, reason, persisted = true) {
  assert.deepEqual(r.outcome, { status: 'rejected', reason });
  assert.strictEqual(r.match, s.match);
  assert.equal(r.persistRequired, persisted);
  assert.equal(r.session.receipts.length, s.receipts.length + Number(persisted));
  assert.deepEqual(r.session.requiredTasks, s.requiredTasks);
  return r.session;
}
function playing() {
  let s = create();
  s = ok(submit(s, 'alice', 'mulligan-a', { type: 'mulligan', selectedUIDs: [] }), s);
  s = ok(submit(s, 'bob', 'mulligan-b', { type: 'mulligan', selectedUIDs: [] }), s);
  assert.equal(s.match.stage, 'playing');
  return s;
}
/** TEST FIXTURE ONLY: this is NOT production turn start/Main, IR resolution or a no-effect provider.
 * Explicitly resolve first Awaken's Legend readiness as a trusted mutation before setting a
 * Main frame; a server must run the actual V2-aware turn executor/phase providers instead. */
function mainFixture(s, { priority = 'alice', open = true, channel = [0, 0] } = {}) {
  assert.equal(s.match.stage, 'playing');
  let match = s.match;
  for (let i = 0; i < channel.length; i++) if (channel[i])
    match = channelDuelRunesV2(match, seats[i].playerId, channel[i]);
  match = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates)
      .map(([uid, old]) => [uid, { ...old, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', priorityPlayerId: priority, stateOpen: open } },
    transitions: [] }));
  return adoptAdmittedDuelPlayingSessionV2(match);
}
const rune = (s, actor, index) => s.match.resources.bases.find(b => b.playerId === actor).baseRunes[index];
const pool = (s, actor = 'alice') => s.match.resources.players.find(p => p.playerId === actor).runePool;
const src = (s, actor = 'alice', ref = 'fixture-registered-effect') => ({
  kind: 'effect', referenceId: ref, sourceUID: s.match.players.find(p => p.playerId === actor).hand[0].uid,
});
const EMPTY = { energy: 0, power: [] };
/** TEST FIXTURE ONLY: independently registered source/effect IDs, payer, final cost and
 * optional task/continuation. Not a production card resolver or unconditional allow callback. */
function registry(s, { actor = 'alice', paymentId = 'p1', cost = EMPTY, source = src(s, actor),
  taskId, continuationId, preExit = false } = {}) {
  const expected = { matchId: s.match.matchId, actor, paymentId,
    sourceReference: source, finalResolvedCost: cost, taskId, continuationId };
  const epoch = s.match.physicalCardsByUID[source.sourceUID]?.zoneEpoch;
  assert.equal(typeof epoch, 'number');
  let calls = 0;
  const attest = request => {
    calls++;
    assert.equal(request.match.matchId, expected.matchId);
    assert.equal(request.actor, expected.actor);
    assert.equal(request.paymentId, expected.paymentId);
    assert.deepEqual(request.sourceReference, expected.sourceReference);
    assert.deepEqual(request.finalResolvedCost, expected.finalResolvedCost);
    assert.equal(request.taskId, expected.taskId);
    assert.equal(request.continuationId, expected.continuationId);
    if (preExit) {
      // Independent event record: actual source left hand after registered pre-exit event.
      assert.ok(request.match.provenance.transitions.some(step => step.uid === source.sourceUID &&
        step.from.kind === 'hand' && step.to.kind === 'main-deck'));
      assert.ok(request.match.physicalCardsByUID[source.sourceUID].zoneEpoch > epoch);
    } else assert.equal(request.match.physicalCardsByUID[source.sourceUID].zoneEpoch, epoch);
    return { matchId: expected.matchId, actor, paymentId, sourceReference: { ...source },
      sourceProofId: `registered:${paymentId}`, mode: preExit ? 'pre-exit' : 'current',
      sourceZoneEpoch: epoch, ...(taskId ? { taskId, continuationId } : {}) };
  };
  return { attest, get calls() { return calls; } };
}

 test('factory-backed V2 session: genuine two mulligans, ordered nonzero trace and epochs, RNG only on actual path', () => {
  let s = create();
  const first = s.match.setup.players[0].hand.slice(0, 2).map(c => c.uid);
  const replaced = s.match.setup.players[0].remainingMainDeck.slice(0, 2).map(c => c.uid);
  let rng = 0;
  const command = { type: 'mulligan', selectedUIDs: first };
  s = ok(submit(s, 'alice', 'm-a', command, 0, { randomIndex: bound => { rng++; assert.equal(bound, 2); return 1; } }), s);
  assert.equal(rng, 1);
  assert.deepEqual(s.match.provenance.transitions.map(step => step.uid), [...first, ...replaced]);
  assert.deepEqual(s.match.provenance.transitions.map(step => [step.from.kind, step.to.kind]), [
    ['hand', 'main-deck'], ['hand', 'main-deck'], ['main-deck', 'hand'], ['main-deck', 'hand'],
  ]);
  const replay = submit(s, 'alice', 'm-a', { selectedUIDs: [...first], type: 'mulligan' }, 0,
    { randomIndex: () => { throw Error('RNG on retry'); } });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.persistRequired, false);
  assert.equal(rng, 1);
  s = ok(submit(s, 'bob', 'm-b', { type: 'mulligan', selectedUIDs: [] }), s);
  assert.equal(s.match.schemaVersion, 2);
  assert.equal(s.match.frame.phase, 'awaiting-turn-start');
  assert.equal(s.match.frame.priorityPlayerId, null);
  for (const uid of [...first, ...replaced]) assert.equal(s.match.physicalCardsByUID[uid].zoneEpoch, 1);
  assert.equal(s.match.provenance.transitions.length, 4);
  assert.deepEqual(s.receipts.map(x => x.actor), ['alice', 'bob']);
  assert.throws(() => { s.match.provenance.transitions.push({}); }, TypeError);
});

test('stale/actor namespaces/conflict/invalid schema command and sticky failures never consume RNG', () => {
  let s = create(), rng = 0;
  const cmd = { type: 'mulligan', selectedUIDs: [] };
  s = fail(submit(s, 'bob', 'not-due', cmd, 0, { randomIndex: () => { rng++; return 0; } }), s, 'mulligan-rejected');
  s = ok(submit(s, 'alice', 'same-id', cmd), s);
  const old = submit(s, 'bob', 'not-due', cmd, 1, { randomIndex: () => { rng++; return 0; } });
  assert.equal(old.duplicate, true); assert.equal(old.outcome.reason, 'mulligan-rejected');
  s = fail(submit(s, 'bob', 'stale', cmd, 0), s, 'stale-version');
  assert.equal(submit(s, 'bob', 'stale', cmd, 1).duplicate, true);
  fail(submit(s, 'alice', 'same-id', { type: 'mulligan', selectedUIDs: ['different'] }, 0), s, 'command-conflict', false);
  fail(submit(s, 'stranger', 'invalid-actor', cmd), s, 'unknown-actor', false);
  fail(submit(s, 'bob', 'extra', { type: 'mulligan', selectedUIDs: [], taskId: 'forged' }),
    s, 'invalid-command', false);
  fail(submit(s, 'bob', 'schema-v1', { type: 'rune-energy', uid: 'x', schemaVersion: 1 }),
    s, 'invalid-command', false);
  s = ok(submit(s, 'bob', 'same-id', cmd), s); // same ID, different actor's namespace
  assert.equal(rng, 0);
  assert.equal(s.match.schemaVersion, 2);
});

test('reject raw JSON V2 clone, V1 aggregate and session clone: neither JSON nor projection grants WeakMap admission', () => {
  const s = playing();
  assert.throws(() => adoptAdmittedDuelPlayingSessionV2(structuredClone(s.match)), /untrusted V2 state/);
  assert.throws(() => adoptAdmittedDuelPlayingSessionV2(JSON.parse(JSON.stringify(s.match))), /untrusted V2 state/);
  assert.throws(() => restoreDuelPlayingStateV2(structuredClone(s.match)), /independent|trusted/);
  assert.throws(() => adoptAdmittedDuelPlayingSessionV2(createDuelMatch(seats, metadata, () => 0)),
    /untrusted|V2|playing/);
  assert.throws(() => apply(structuredClone(s), 'alice', { commandId: 'cloned',
    expectedVersion: 2, command: { type: 'mulligan', selectedUIDs: [] } }), /unadmitted V2 session/);
  assert.throws(() => { s.match.physicalCardsByUID['alice-main-0'].ownerPlayerId = 'bob'; }, TypeError);
  assert.throws(() => { s.match.provenance.originalPhysicalCards[0].ownerPlayerId = 'bob'; }, TypeError);
  assert.equal(s.match.schemaVersion, 2);
});

test('pre-turn and ended block resource permissions, Main cannot be manufactured by frame setter without Awaken', () => {
  const s = playing(), early = submit(s, 'alice', 'early', { type: 'rune-power', uid: 'alice-rune-0' });
  fail(early, s, 'invalid-phase');
  assert.throws(() => commitDuelCommandFrameV2(s, { ...s.match.frame, phase: 'main',
    priorityPlayerId: 'alice' }, () => { throw Error('fixture denies Main before turn executor'); }),
    /fixture denies Main/);
  let m = mainFixture(s, { channel: [1, 0] });
  const ended = commitDuelCommandFrameV2(m, { ...m.match.frame, phase: 'ended', priorityPlayerId: null },
    (before, proposed) => { assert.equal(before.frame.phase, 'main'); assert.equal(proposed.phase, 'ended'); });
  assert.equal(ended.session.match.stateVersion, m.match.stateVersion + 1);
  m = ended.session;
  fail(submit(m, 'alice', 'late', { type: 'rune-energy', uid: rune(m, 'alice', 0).uid }), m, 'invalid-phase');
});

test('Main fixture uses one V2 match: wrong Priority/owner deny, Closed Priority rune-energy exhausts once', () => {
  let s = mainFixture(playing(), { channel: [2, 2], priority: 'bob', open: false });
  const uid = rune(s, 'alice', 0).uid;
  s = fail(submit(s, 'alice', 'wrong-priority', { type: 'rune-energy', uid }), s, 'no-permission');
  s = fail(submit(s, 'bob', 'foreign', { type: 'rune-energy', uid }), s, 'resource-rejected');
  const changed = commitDuelCommandFrameV2(s, { ...s.match.frame, priorityPlayerId: 'alice' },
    (before, proposed) => { assert.equal(before.frame.priorityPlayerId, 'bob');
      assert.equal(proposed.priorityPlayerId, 'alice'); });
  s = changed.session;
  assert.equal(changed.persistRequired, true);
  s = ok(submit(s, 'alice', 'energy', { type: 'rune-energy', uid }), s);
  assert.equal(pool(s).energy, 1);
  assert.equal(rune(s, 'alice', 0).readied, false);
  assert.equal(s.match.physicalCardsByUID[uid].zoneEpoch, 1);
  s = fail(submit(s, 'alice', 'exhausted-energy', { type: 'rune-energy', uid }), s, 'resource-rejected');
  assert.equal(pool(s).energy, 1);
  assert.throws(() => { s.match.resources.players[0].runePool.energy = 900; }, TypeError);
});

test('Recycle exhausted Basic Rune appends ordered base→rune-deck trace and invalidates old physical reference', () => {
  let s = mainFixture(playing(), { channel: [2, 0], open: false });
  const uid = rune(s, 'alice', 0).uid;
  const ref = referenceDuelPhysicalCardV2(s.match, uid);
  const domain = rune(s, 'alice', 0).domain;
  s = ok(submit(s, 'alice', 'exhaust', { type: 'rune-energy', uid }), s);
  s = ok(submit(s, 'alice', 'recycle', { type: 'rune-power', uid }), s);
  assert.equal(pool(s).power[domain], 1);
  assert.equal(s.match.resources.players[0].runeDeck.at(-1).uid, uid);
  assert.equal(s.match.resources.bases[0].baseRunes.some(x => x.uid === uid), false);
  assert.deepEqual(s.match.provenance.transitions.at(-1), { uid,
    from: { kind: 'board-base', locationId: s.match.board.bases[0].locationId },
    to: { kind: 'rune-deck', zonePlayerId: 'alice' } });
  assert.equal(s.match.physicalCardsByUID[uid].zoneEpoch, ref.zoneEpoch + 1);
  assert.throws(() => assertCurrentDuelPhysicalReferenceV2(s.match, ref), /stale physical reference/);
  s = fail(submit(s, 'alice', 'double-recycle', { type: 'rune-power', uid }), s, 'resource-rejected');
});

test('Gold cannot be fabricated from base; no effect-creation proof or V2 token-retirement API means fail closed', () => {
  let s = mainFixture(playing(), { channel: [1, 0] });
  const before = JSON.stringify(s.match);
  s = fail(submit(s, 'alice', 'gold', { type: 'gold-power', uid: 'unproved-gold' }), s, 'resource-rejected');
  assert.equal(JSON.stringify(s.match), before);
  assert.equal(s.match.resources.retiredGoldUids.length, 0);
  assert.equal(pool(s).power.any, 0);
});

test('ordinary Priority payment must have registered source/final cost, exact multi-domain+Any plan keeps surplus', () => {
  let s = mainFixture(playing(), { channel: [4, 0], open: false });
  for (const [id, uid, type] of [
    ['energy-a', rune(s, 'alice', 0).uid, 'rune-energy'],
    ['energy-b', rune(s, 'alice', 3).uid, 'rune-energy'],
    ['power-calm', rune(s, 'alice', 1).uid, 'rune-power'],
    ['power-fury', rune(s, 'alice', 2).uid, 'rune-power'],


  ]) s = ok(submit(s, 'alice', id, { type, uid }), s);
  const finalCost = { energy: 1, power: [
    { allowedDomains: ['Fury'], amount: 1 }, { allowedDomains: ['Calm', 'Mind'], amount: 1 },
  ] };
  const proof = registry(s, { paymentId: 'ordinary', cost: finalCost });
  assert.throws(() => commitDuelPriorityPaymentV2(s, 'alice', 'ordinary', finalCost,
    src(s), () => true), /plain record/);
  const before = s.match.stateVersion;
  s = commitDuelPriorityPaymentV2(s, 'alice', 'ordinary', finalCost, src(s), proof.attest).session;
  assert.equal(s.match.stateVersion, before + 1);
  assert.throws(() => commitDuelPriorityPaymentV2(s, 'alice', 'ordinary', EMPTY,
    src(s), proof.attest), /pending/);
  assert.equal(s.match.eventSeq, s.match.stateVersion);
  assert.equal(proof.calls, 1);
  const invalid = submit(s, 'alice', 'bad-plan', { type: 'pay-pending', paymentId: 'ordinary',
    plan: { power: [{ requirementIndex: 0, from: 'Calm', amount: 1 },
      { requirementIndex: 1, from: 'Fury', amount: 1 }] } }, undefined,
  { sourceAttestor: proof.attest });
  s = fail(invalid, s, 'payment-rejected');
  assert.equal(pool(s).energy, 2);
  assert.equal(s.match.frame.pendingPayment.paymentId, 'ordinary');
  const plan = { power: [{ requirementIndex: 0, from: 'Fury', amount: 1 },
    { requirementIndex: 1, from: 'Calm', amount: 1 }] };
  const payment = submit(s, 'alice', 'pay', { type: 'pay-pending', paymentId: 'ordinary', plan },
    undefined, { sourceAttestor: proof.attest });
  assert.equal(payment.outcome.status, 'applied', JSON.stringify({ reason: payment.outcome.reason,
    pool: pool(s), sourceCalls: proof.calls, plan }));
  s = ok(payment, s);
  assert.equal(pool(s).energy, 1);
  assert.equal(pool(s).power.Fury, 0);
  assert.equal(pool(s).power.Calm, 0);
  assert.deepEqual(payment.outcome.paymentCompleted.plan, plan);
  assert.equal(s.match.frame.pendingPayment, null);
  assert.equal(s.priorityPayments[0].status, 'completed');
  assert.throws(() => commitDuelPriorityPaymentV2(s, 'alice', 'ordinary', EMPTY,
    src(s), proof.attest), /reserved or completed/);
  const duplicate = submit(s, 'alice', 'pay', { type: 'pay-pending', paymentId: 'ordinary', plan }, 0,
    { sourceAttestor: () => { throw Error('never re-attest on replay'); } });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.persistRequired, false);
  assert.equal(duplicate.outcome.appliedVersion, payment.outcome.appliedVersion);
  assert.strictEqual(duplicate.match, s.match);
});

test('atomic insufficient payment leaves pools/pending, sticky failure cannot later complete cost', () => {
  let s = mainFixture(playing(), { channel: [1, 0] });
  s = ok(submit(s, 'alice', 'e', { type: 'rune-energy', uid: rune(s, 'alice', 0).uid }), s);
  const final = { energy: 2, power: [{ allowedDomains: ['Mind'], amount: 1 }] };
  const proof = registry(s, { paymentId: 'too-expensive', cost: final });
  s = commitDuelPriorityPaymentV2(s, 'alice', 'too-expensive', final, src(s), proof.attest).session;
  const before = JSON.stringify(s.match), version = s.match.stateVersion;
  s = fail(submit(s, 'alice', 'insufficient', { type: 'pay-pending', paymentId: 'too-expensive' },
    undefined, { sourceAttestor: proof.attest }), s, 'payment-rejected');
  assert.equal(JSON.stringify(s.match), before);
  assert.equal(s.match.stateVersion, version);
  assert.equal(s.priorityPayments[0].status, 'active');
  assert.equal(submit(s, 'alice', 'insufficient', { type: 'pay-pending', paymentId: 'too-expensive' },
    undefined, { sourceAttestor: () => { throw Error('retry invoked attestor'); } }).duplicate, true);
});

test('payment with no source UID is pending until an independent binding exists; no default attestor', () => {
  const s = mainFixture(playing());
  assert.throws(() => commitDuelPriorityPaymentV2(s, 'alice', 'unbound', EMPTY,
    { kind: 'effect', referenceId: 'unbound-effect' }, () => ({
      matchId: s.match.matchId, actor: 'alice', paymentId: 'unbound',
      sourceReference: { kind: 'effect', referenceId: 'unbound-effect' },
      sourceProofId: 'unbound', mode: 'current',
    })), /independently provable physical source/);
  assert.equal(s.match.frame.pendingPayment, null);
  assert.equal(s.match.eventSeq, s.match.stateVersion);
});

test('malformed typed cost rejected before commit; cost/source aliases copied and immutable', () => {
  const s = mainFixture(playing());
  for (const invalid of [
    { energy: -1, power: [] },
    { energy: 0, power: [{ allowedDomains: ['Fury', 'Fury'], amount: 1 }] },
    { energy: 0, power: [{ allowedDomains: ['wrong-domain'], amount: 1 }] },
    { energy: 0, power: [{ allowedDomains: [], amount: 1 }] },
  ]) assert.throws(() => commitDuelPriorityPaymentV2(s, 'alice', 'typed-cost', invalid,
    src(s), () => { throw Error('cost validator should run first'); }), /cost|Power|integer/);
  const original = { energy: 1, power: [{ allowedDomains: ['Fury'], amount: 1 }] };
  const source = src(s);
  const proof = registry(s, { paymentId: 'mutable-input', cost: original, source });
  const prepared = commitDuelPriorityPaymentV2(s, 'alice', 'mutable-input', original, source, proof.attest).session;
  original.power[0].allowedDomains[0] = 'Chaos'; source.referenceId = 'changed';
  assert.equal(prepared.match.frame.pendingPayment.resolvedCost.power[0].allowedDomains[0], 'Fury');
  assert.equal(prepared.match.frame.pendingPayment.sourceReference.referenceId, 'fixture-registered-effect');
  assert.throws(() => { prepared.match.frame.pendingPayment.resolvedCost.energy = 9; }, TypeError);
});

test('required cost capability: issued/active/completed, payer exclusive over Priority, private continuation consumed once', () => {
  let s = mainFixture(playing(), { channel: [2, 2], priority: 'bob', open: false });
  const task = { matchId: s.match.matchId, expectedVersion: s.match.stateVersion,
    taskId: 'trusted-task', paymentId: 'required-payment', actor: 'alice',
    finalResolvedCost: { energy: 1, power: [] }, opaqueSource: src(s), continuationId: 'secret-continuation' };
  const proof = registry(s, { actor: task.actor, paymentId: task.paymentId,
    cost: task.finalResolvedCost, source: task.opaqueSource,
    taskId: task.taskId, continuationId: task.continuationId });
  assert.throws(() => commitDuelPriorityPaymentV2(s, 'alice', 'wrong', EMPTY, src(s), proof.attest),
    /Priority/);
  const issued = issueDuelRequiredCostTaskV2(s, task, proof.attest);
  assert.equal(issued.session.match.stateVersion, task.expectedVersion);
  assert.equal(issued.session.requiredTasks[0].status, 'issued');
  fail(submit(issued.session, 'bob', 'issued-freeze', { type: 'rune-energy',
    uid: rune(issued.session, 'bob', 0).uid }), issued.session, 'no-permission');
  assert.throws(() => commitDuelCommandFrameV2(issued.session,
    { ...issued.session.match.frame, priorityPlayerId: 'alice' }, () => {
      throw Error('must not call attestor while task issued'); }), /issued task blocks/);
  assert.throws(() => issueDuelRequiredCostTaskV2(issued.session, { ...task, taskId: 'other' }, proof.attest),
    /reserved|another task is issued/);
  assert.throws(() => prepareDuelRequiredCostPaymentV2(issued.session, structuredClone(issued.authority),
    proof.attest), /unissued/);
  s = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, proof.attest).session;
  assert.equal(s.match.stateVersion, task.expectedVersion + 1);
  assert.equal(s.match.frame.priorityPlayerId, 'bob');
  assert.equal(s.requiredTasks[0].status, 'active');
  assert.throws(() => prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, proof.attest), /unissued/);
  assert.throws(() => commitDuelPriorityPaymentV2(s, 'bob', 'interrupt', EMPTY,
    src(s, 'bob'), proof.attest), /pending|Priority/);
  const bobUid = rune(s, 'bob', 0).uid;
  s = fail(submit(s, 'bob', 'bob-blocked', { type: 'rune-energy', uid: bobUid }), s, 'no-permission');
  s = fail(submit(s, 'bob', 'bob-pay', { type: 'pay-pending', paymentId: task.paymentId }), s, 'no-permission');
  s = fail(submit(s, 'alice', 'wire-task', { type: 'pay-pending', paymentId: task.paymentId,
    continuationId: task.continuationId }), s, 'invalid-command', false);
  s = ok(submit(s, 'alice', 'alice-energy', { type: 'rune-energy', uid: rune(s, 'alice', 0).uid }), s);
  const pay = submit(s, 'alice', 'once', { type: 'pay-pending', paymentId: task.paymentId },
    undefined, { sourceAttestor: proof.attest });
  s = ok(pay, s);
  assert.deepEqual(pay.outcome.paymentCompleted.requiredTask,
    { taskId: task.taskId, continuationId: task.continuationId });
  assert.equal(s.requiredTasks[0].status, 'completed');
  assert.equal(s.match.frame.pendingPayment, null);
  assert.equal(pool(s).energy, 0);
  assert.equal(s.match.frame.priorityPlayerId, 'bob');
  const calls = proof.calls;
  const retry = submit(s, 'alice', 'once', { type: 'pay-pending', paymentId: task.paymentId }, 0,
    { sourceAttestor: () => { throw Error('duplicate re-attested'); } });
  assert.equal(retry.duplicate, true); assert.strictEqual(retry.match, s.match);
  assert.equal(proof.calls, calls);
  s = ok(submit(s, 'bob', 'bob-after', { type: 'rune-energy', uid: bobUid }), s);
  assert.equal(pool(s, 'bob').energy, 1);
  assert.equal(submit(s, 'alice', 'once', { type: 'pay-pending', paymentId: task.paymentId }, 0).duplicate, true);
  assert.throws(() => issueDuelRequiredCostTaskV2(s, { ...task, expectedVersion: s.match.stateVersion },
    proof.attest), /reserved/);
});

test('source/task mismatch or missing attestor cannot pay, cannot advance continuation or clear pending', () => {
  let s = mainFixture(playing());
  const task = { matchId: s.match.matchId, expectedVersion: s.match.stateVersion,
    taskId: 'valid-task', paymentId: 'valid-payment', actor: 'alice',
    finalResolvedCost: EMPTY, opaqueSource: src(s), continuationId: 'only-once' };
  assert.throws(() => issueDuelRequiredCostTaskV2(s, task, undefined), /attestor/);
  assert.throws(() => issueDuelRequiredCostTaskV2(s, task, () => ({ matchId: task.matchId,
    actor: task.actor, paymentId: task.paymentId, sourceReference: task.opaqueSource,
    sourceProofId: 'proof', mode: 'current', sourceZoneEpoch: s.match.physicalCardsByUID[task.opaqueSource.sourceUID].zoneEpoch,
    taskId: task.taskId, continuationId: 'not-bound' })), /mismatch/);
  const proof = registry(s, { actor: task.actor, paymentId: task.paymentId,
    cost: task.finalResolvedCost, source: task.opaqueSource,
    taskId: task.taskId, continuationId: task.continuationId });
  const issued = issueDuelRequiredCostTaskV2(s, task, proof.attest);
  assert.throws(() => prepareDuelRequiredCostPaymentV2(issued.session, issued.authority,
    () => ({ ...proof.attest({ match: issued.session.match, actor: task.actor, paymentId: task.paymentId,
      sourceReference: task.opaqueSource, finalResolvedCost: EMPTY, taskId: task.taskId,
      continuationId: task.continuationId }), sourceProofId: 'changed-binding' })), /attestation changed/);
  s = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, proof.attest).session;
  const before = JSON.stringify(s.match);
  s = fail(submit(s, 'alice', 'no-validator', { type: 'pay-pending', paymentId: task.paymentId }),
    s, 'payment-rejected');
  s = fail(submit(s, 'alice', 'bad-guard', { type: 'pay-pending', paymentId: task.paymentId },
    undefined, { sourceAttestor: () => true }), s, 'payment-rejected');
  s = fail(submit(s, 'alice', 'bad-source', { type: 'pay-pending', paymentId: task.paymentId },
    undefined, { sourceAttestor: req => ({ ...proof.attest(req), sourceReference: {
      ...req.sourceReference, referenceId: 'forged' } }) }), s, 'payment-rejected');
  assert.equal(JSON.stringify(s.match), before);
  assert.equal(s.requiredTasks[0].status, 'active');
  s = ok(submit(s, 'alice', 'legitimate', { type: 'pay-pending', paymentId: task.paymentId },
    undefined, { sourceAttestor: proof.attest }), s);
  assert.equal(s.requiredTasks[0].status, 'completed');
});

test('pre-exit trigger payment uses independent pre-exit attestation, not current-epoch equality', () => {
  let s = mainFixture(playing());
  const source = src(s), uid = source.sourceUID;
  const original = referenceDuelPhysicalCardV2(s.match, uid);
  const registered = registry(s, { source, preExit: true, paymentId: 'pre-exit' });
  const changed = commitDuelPlayingMutationV2(s.match, draft => ({
    match: { ...draft, players: draft.players.map(player => player.playerId === 'alice'
      ? { ...player, hand: player.hand.filter(card => card.uid !== uid),
        remainingMainDeck: [...player.remainingMainDeck, { uid, cardId: draft.physicalCardsByUID[uid].cardId }] }
      : player) },
    transitions: [{ uid, from: { kind: 'hand', zonePlayerId: 'alice' },
      to: { kind: 'main-deck', zonePlayerId: 'alice' } }],
  }));
  s = adoptAdmittedDuelPlayingSessionV2(changed);
  assert.throws(() => assertCurrentDuelPhysicalReferenceV2(s.match, original), /stale physical reference/);
  s = commitDuelPriorityPaymentV2(s, 'alice', 'pre-exit', EMPTY, source, registered.attest).session;
  const paid = submit(s, 'alice', 'pay-preexit', { type: 'pay-pending', paymentId: 'pre-exit' },
    undefined, { sourceAttestor: registered.attest });
  s = ok(paid, s);
  assert.equal(paid.outcome.paymentCompleted.sourceProofId, 'registered:pre-exit');
  assert.equal(s.match.physicalCardsByUID[uid].zoneEpoch, original.zoneEpoch + 1);
});

test('transaction candidate failure/no-op and original frozen snapshot cannot mutate proof or allocate clocks', () => {
  const s = mainFixture(playing(), { channel: [1, 0] });
  const original = JSON.stringify(s.match), length = s.match.provenance.transitions.length;
  let trapped;
  assert.throws(() => commitDuelPlayingMutationV2(s.match, draft => {
    try { s.match.provenance.transitions.push({}); } catch (e) { trapped = e; }
    throw Error('candidate failed after mutable draft');
  }), /candidate failed/);
  assert.equal(trapped.name, 'TypeError');
  assert.equal(JSON.stringify(s.match), original);
  assert.strictEqual(commitDuelPlayingMutationV2(s.match, draft => ({ match: draft, transitions: [] })), s.match);
  assert.throws(() => commitDuelPlayingMutationV2(s.match, draft => ({ match: {
    ...draft, resources: { ...draft.resources, players: draft.resources.players.map(player => ({
      ...player, runePool: { ...player.runePool, energy: player.runePool.energy + 1 } })) },
    physicalCardsByUID: { ...draft.physicalCardsByUID,
      'alice-rune-0': { ...draft.physicalCardsByUID['alice-rune-0'], zoneEpoch: 77 } } },
    transitions: [] })), /epoch|history|independently/);
  assert.equal(s.match.provenance.transitions.length, length);
  assert.equal(JSON.stringify(s.match), original);
  assert.equal(s.match.eventSeq, s.match.stateVersion);
});
