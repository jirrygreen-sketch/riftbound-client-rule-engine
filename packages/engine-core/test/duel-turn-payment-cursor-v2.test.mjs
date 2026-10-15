// Internal integration fixture only: catalog-bound known-no-handler coverage and a physical
// source attestor stand in for trusted full-program/Cost Resolver implementations. This does
// not claim a public Main command provider or a production card-program registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelCommandSessionV2 as create, applyDuelResourceCommandV2 as command,
  issueDuelRequiredCostTaskV2 as issue, prepareDuelRequiredCostPaymentV2 as prepare,
  commitDuelPriorityPaymentV2 as priority, commitDuelCommandMutationV2 as mutate } from '../dist/duel/canonical-session-v2.js';
import { createDuelPhaseSourceRegistryV2 as registry } from '../dist/duel/phase-source-authority-v2.js';
import { runDuelStartOfTurnV2 as start, resumeDuelStartOfTurnV2 as resumeStart,
  runDuelEndOfTurnV2 as end, resumeDuelEndOfTurnV2 as resumeEnd } from '../dist/duel/turn-executor-v2.js';
import { referenceDuelPhysicalCardV2 as ref } from '../dist/duel/core-v2.js';
import { placeDuelUnit } from '../dist/duel/battlefields.js';

const seats = ['alice', 'bob'].map(playerId => ({ playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-c${i}`, cardId: 'plain' })),
  champion: { uid: `${playerId}-champ`, cardId: 'champ' },
  legend: { uid: `${playerId}-legend`, cardId: 'legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-r${i}`, cardId: 'rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-f${i}`, cardId: `field${i}` })),
}));
const metadata = { matchId: 'cursor-payment-v2', dataVersion: 'fixture-v2', catalogDigest: 'sha256:fixture-v2',
  roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) };
const types = cardId => cardId === 'champ' ? 'Champion' : cardId === 'legend' ? 'Legend' :
  cardId === 'rune' ? 'Rune' : cardId.startsWith('field') ? 'Battlefield' : 'Unit';
function factory() {
  let s = create(seats, metadata, () => 0, types);
  for (const actor of ['alice', 'bob']) {
    const r = submit(s, actor, `m-${actor}`, { type: 'mulligan', selectedUIDs: [] });
    assert.equal(r.outcome.status, 'applied'); s = r.session;
  }
  assert.equal(s.match.stage, 'playing');
  return s;
}
function sources(s, modify = () => ({})) {
  return registry({ matchId: s.match.matchId, dataVersion: s.match.dataVersion,
    catalogDigest: s.match.catalogDigest,
    printings: ['plain', 'champ', 'legend', 'rune', 'field0', 'field1', 'field2']
      .map(cardId => ({ cardId, programReference: `fixture:${cardId}` })) }, request => ({
    status: 'complete', matchId: request.matchId, dataVersion: request.dataVersion,
    catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
    uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
    programReference: `fixture:${request.source.cardId}`, event: request.event,
    eventSupported: true, scope: 'known-no-handler', replacementsCovered: true,
    staticCovered: true, continuousCovered: true, triggersCovered: true, ...modify(request) }));
}
function services(s, modify) { return { sources: sources(s, modify), fepr: () => ({ status: 'none' }) }; }
function submit(s, actor, commandId, payload, trusted, expectedVersion = s.match.stateVersion) {
  return command(s, actor, { commandId, expectedVersion, command: payload }, trusted);
}
function main(s) {
  const r = start(s, services(s)); assert.equal(r.status, 'main', r.reason); return r.session;
}
function pool(s, actor = 'alice') { return s.match.resources.players.find(p => p.playerId === actor).runePool; }
function rune(s, index = 0) {
  return s.match.resources.bases.find(b => b.playerId === s.match.frame.turnPlayerId).baseRunes[index].uid;
}
function clock(s) { return [s.match.stateVersion, s.match.eventSeq]; }
function noTick(r, before, status = 'rejected') {
  assert.equal(r.status, status); assert.strictEqual(r.session, before);
  assert.deepEqual(clock(r.session), clock(before)); assert.equal(r.persistRequired, false);
}
function costTask(s, id, finalResolvedCost = { energy: 0, power: [] }) {
  const sourceUID = s.match.players.find(p => p.playerId === s.match.frame.turnPlayerId).hand[0].uid;
  return { matchId: s.match.matchId, expectedVersion: s.match.stateVersion, taskId: `task-${id}`,
    paymentId: `payment-${id}`, actor: s.match.frame.turnPlayerId, finalResolvedCost,
    opaqueSource: { kind: 'card', referenceId: `fixture-source-${id}`, sourceUID },
    continuationId: `continuation-${id}` };
}
function attestor(task) {
  let calls = 0;
  return { get calls() { return calls; }, verify: r => {
    calls++;
    assert.equal(r.actor, task.actor); assert.equal(r.paymentId, task.paymentId);
    assert.deepEqual(r.sourceReference, task.opaqueSource);
    assert.deepEqual(r.finalResolvedCost, task.finalResolvedCost);
    assert.equal(r.taskId, task.taskId); assert.equal(r.continuationId, task.continuationId);
    return { matchId: r.match.matchId, actor: r.actor, paymentId: r.paymentId,
      sourceReference: r.sourceReference, sourceProofId: `fixture-proof-${task.taskId}`,
      mode: 'current', sourceZoneEpoch: ref(r.match, task.opaqueSource.sourceUID).zoneEpoch,
      taskId: r.taskId, continuationId: r.continuationId };
  } };
}
function required(s, id, cost) {
  const task = costTask(s, id, cost), proof = attestor(task);
  const issued = issue(s, task, proof.verify);
  assert.equal(issued.persistRequired, true); assert.equal(issued.session.requiredTasks.at(-1).status, 'issued');
  return { task, proof, issued };
}
function payRequired(s, task, proof, id = task.taskId) {
  const paid = submit(s, task.actor, `pay-${id}`, { type: 'pay-pending', paymentId: task.paymentId },
    { sourceAttestor: proof.verify });
  assert.equal(paid.outcome.status, 'applied', JSON.stringify(paid.outcome));
  assert.equal(paid.outcome.appliedVersion, s.match.stateVersion + 1);
  assert.deepEqual(paid.outcome.paymentCompleted.requiredTask,
    { taskId: task.taskId, continuationId: task.continuationId });
  assert.equal(paid.session.requiredTasks.at(-1).status, 'completed');
  assert.equal(paid.session.match.frame.pendingPayment, null);
  assert.equal(paid.session.turnCursorV2.stateVersion, paid.session.match.stateVersion);
  return paid;
}

test('factory Main → paid zero-cost required task → Ending preserves source, ledger, receipt, physical history', () => {
  let s = main(factory());
  const energised = submit(s, 'alice', 'gain-energy', { type: 'rune-energy', uid: rune(s) });
  assert.equal(energised.outcome.status, 'applied'); s = energised.session;
  const { task, proof, issued } = required(s, 'zero');
  const active = prepare(issued.session, issued.authority, proof.verify);
  assert.equal(active.session.turnCursorV2.stateVersion, active.session.match.stateVersion);
  const paid = payRequired(active.session, task, proof); s = paid.session;
  assert.equal(pool(s).energy, 1);
  const before = s.match.provenance.transitions;
  const ending = end(s, 'alice', services(s));
  assert.equal(ending.status, 'awaiting-turn-start', ending.reason);
  assert.equal(ending.session.match.frame.turnNumber, 2);
  assert.equal(pool(ending.session).energy, 0); // real Expiration, not a forged Main reset
  assert.deepEqual(ending.session.match.provenance.transitions, before);
  assert.strictEqual(ending.session.receipts.at(-1), paid.session.receipts.at(-1));
  assert.strictEqual(ending.session.requiredTasks.at(-1), paid.session.requiredTasks.at(-1));
  assert.equal(ending.session.match.eventSeq, ending.session.match.stateVersion);
});

test('paid required task plus resource balance survives until legal cleanup over two consecutive turns', () => {
  let s = main(factory());
  for (const turn of [1, 2]) {
    assert.equal(s.match.frame.turnNumber, turn);
    const actor = s.match.frame.turnPlayerId;
    const acquired = submit(s, actor, `energy-${turn}`, { type: 'rune-energy', uid: rune(s) });
    assert.equal(acquired.outcome.status, 'applied'); s = acquired.session;
    const { task, proof, issued } = required(s, `turn-${turn}`);
    s = prepare(issued.session, issued.authority, proof.verify).session;
    s = payRequired(s, task, proof).session;
    assert.equal(pool(s, actor).energy, 1);
    assert.equal(s.match.frame.phase, 'main');
    assert.equal(start(s, services(s)).status, 'main'); // no extra clock, no double channel
    const next = end(s, actor, services(s));
    assert.equal(next.status, 'awaiting-turn-start', next.reason);
    assert.equal(pool(next.session, actor).energy, 0);
    assert.equal(next.session.match.frame.turnNumber, turn + 1);
    s = main(next.session);
  }
  assert.deepEqual(s.requiredTasks.map(t => t.status), ['completed', 'completed']);
  assert.equal(s.turnCursorV2.turn, 3);
});

test('issued task blocks End/Start and trusted mutation with no clock; keep private bond', () => {
  const s = main(factory()), { task, proof, issued } = required(s, 'issued');
  const w = issued.session;
  assert.equal(w.turnCursorV2.step, 'main');
  assert.deepEqual(clock(w), clock(s));
  noTick(end(w, 'alice', services(w)), w);
  noTick(start(w, services(w)), w);
  assert.throws(() => mutate(w, d => ({ match: d, transitions: [] })), /issued|pending/);
  const active = prepare(w, issued.authority, proof.verify).session;
  assert.equal(active.turnCursorV2.stateVersion, active.match.stateVersion);
  assert.equal(active.requiredTasks.at(-1).taskId, task.taskId);
  noTick(end(active, 'alice', services(active)), active);
  noTick(start(active, services(active)), active);
  assert.throws(() => mutate(active, d => ({ match: d, transitions: [] })), /issued|pending/);
  assert.deepEqual(clock(issued.session), clock(s));
});

test('required payer may acquire a real Rune source in active window and pay resolved cost', () => {
  const s = main(factory());
  const cost = { energy: 1, power: [] }, { task, proof, issued } = required(s, 'payer', cost);
  let active = prepare(issued.session, issued.authority, proof.verify).session;
  const uid = rune(active), epoch = ref(active.match, uid).zoneEpoch;
  const gained = submit(active, 'alice', 'payer-source', { type: 'rune-energy', uid });
  assert.equal(gained.outcome.status, 'applied'); active = gained.session;
  assert.equal(ref(active.match, uid).zoneEpoch, epoch);
  assert.equal(pool(active).energy, 1);
  const paid = payRequired(active, task, proof);
  assert.equal(pool(paid.session).energy, 0);
  assert.equal(end(paid.session, 'alice', services(s)).status, 'awaiting-turn-start');
  assert.equal(proof.calls, 3); // issue, prepare and actual payment; resource command does not attest
});

test('duplicate paid command and reserved task ID/continuation cannot mint clocks or authorities', () => {
  const s = main(factory()), { task, proof, issued } = required(s, 'dup');
  let active = prepare(issued.session, issued.authority, proof.verify).session;
  const paid = payRequired(active, task, proof); active = paid.session;
  const calls = proof.calls;
  const duplicate = submit(active, 'alice', `pay-${task.taskId}`,
    { type: 'pay-pending', paymentId: task.paymentId }, { sourceAttestor: () => { throw Error('duplicate attested'); } }, 0);
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.persistRequired, false);
  assert.strictEqual(duplicate.session, active); assert.strictEqual(duplicate.outcome, paid.outcome);
  assert.equal(proof.calls, calls); assert.deepEqual(clock(duplicate.session), clock(active));
  const copiedTask = { ...task, expectedVersion: active.match.stateVersion,
    taskId: 'different-task', paymentId: 'different-payment' };
  assert.throws(() => issue(active, copiedTask, () => { throw Error('must reject before attestor'); }),
    /continuation ID already issued/);
  assert.throws(() => issue(active, { ...copiedTask, continuationId: 'new-continuation',
    taskId: task.taskId }, proof.verify), /task ID reserved/);
});

test('foreign actor and wrong payment/version are sticky rejections; valid payer later succeeds', () => {
  const s = main(factory()), { task, proof, issued } = required(s, 'foreign');
  const active = prepare(issued.session, issued.authority, proof.verify).session;
  const other = submit(active, 'bob', 'foreign-pay', { type: 'pay-pending', paymentId: task.paymentId });
  assert.deepEqual(other.outcome, { status: 'rejected', reason: 'no-permission' });
  assert.strictEqual(other.match, active.match);
  const stale = submit(other.session, 'alice', 'stale-pay',
    { type: 'pay-pending', paymentId: task.paymentId }, { sourceAttestor: proof.verify }, 0);
  assert.deepEqual(stale.outcome, { status: 'rejected', reason: 'stale-version' });
  assert.strictEqual(stale.match, active.match);
  const wrong = submit(stale.session, 'alice', 'wrong-payment', { type: 'pay-pending', paymentId: 'foreign-id' });
  assert.deepEqual(wrong.outcome, { status: 'rejected', reason: 'no-permission' });
  const paid = payRequired(wrong.session, task, proof);
  assert.equal(end(paid.session, 'alice', services(s)).status, 'awaiting-turn-start');
  assert.deepEqual(clock(paid.session), [active.match.stateVersion + 1, active.match.eventSeq + 1]);
});

test('priority payment preparation and completed receipt also preserve Main bond', () => {
  const s = main(factory());
  const uid = s.match.players[0].hand[0].uid;
  const source = { kind: 'card', referenceId: 'fixture-priority', sourceUID: uid };
  let calls = 0;
  const attest = r => { calls++; return { matchId: r.match.matchId, actor: r.actor,
    paymentId: r.paymentId, sourceReference: r.sourceReference, sourceProofId: 'fixture-priority-proof',
    mode: 'current', sourceZoneEpoch: ref(r.match, uid).zoneEpoch }; };
  const active = priority(s, 'alice', 'priority-pay', { energy: 0, power: [] }, source, attest).session;
  assert.equal(active.priorityPayments.at(-1).status, 'active');
  assert.equal(active.turnCursorV2.stateVersion, active.match.stateVersion);
  noTick(end(active, 'alice', services(active)), active);
  const paid = submit(active, 'alice', 'priority-payment',
    { type: 'pay-pending', paymentId: 'priority-pay' }, { sourceAttestor: attest });
  assert.equal(paid.outcome.status, 'applied'); assert.equal(calls, 2);
  assert.equal(paid.session.priorityPayments.at(-1).status, 'completed');
  assert.equal(end(paid.session, 'alice', services(s)).status, 'awaiting-turn-start');
});

test('pending Begin cannot be run directly or End-ed; only exact retry consumes task', () => {
  const s = factory();
  const r = start(s, services(s, request => request.event === 'begin' ? { status: 'unknown' } : {}));
  assert.equal(r.status, 'pending'); assert.equal(r.pending.step, 'begin');
  const pending = r.session, id = r.pending.taskId;
  noTick(start(pending, services(s)), pending);
  noTick(end(pending, 'alice', services(s)), pending);
  noTick(resumeStart(pending, 'foreign', { status: 'retry', matchId: s.match.matchId,
    turn: 1, taskId: 'foreign' }, services(s)), pending);
  noTick(resumeStart(pending, id, { status: 'retry', matchId: s.match.matchId,
    turn: 2, taskId: id }, services(s)), pending);
  noTick(resumeStart(pending, id, { status: 'retry', matchId: 'foreign',
    turn: 1, taskId: id }, services(s)), pending);
  noTick(resumeStart(pending, id, undefined, services(s)), pending);
  const resumed = resumeStart(pending, id, { status: 'retry', matchId: s.match.matchId,
    turn: 1, taskId: id }, services(s));
  assert.equal(resumed.status, 'main', resumed.reason);
  assert.equal(resumed.session.turnCursorV2.consumedIDs.includes(id), true);
  noTick(resumeStart(resumed.session, id, {}, services(s)), resumed.session, 'duplicate');
  assert.equal(resumed.session.match.eventSeq, resumed.session.match.stateVersion);
});

test('same-boundary old handler is not replayed while a newly entered source executes once', () => {
  let s = factory(), calls = [], entered = s.match.players[0].hand[0];
  const sourceService = request => ({ status: 'complete', matchId: request.matchId,
    dataVersion: request.dataVersion, catalogDigest: request.catalogDigest, turn: request.turn,
    taskId: request.taskId, uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
    programReference: `fixture:${request.source.cardId}`, event: request.event,
    eventSupported: true,
    scope: request.event === 'awaken' && (request.source.kind === 'legend' || request.source.uid === entered.uid)
      ? 'handlers-or-modifiers' : 'known-no-handler', replacementsCovered: true,
    staticCovered: true, continuousCovered: true, triggersCovered: true });
  const sourceRegistry = registry({ matchId: s.match.matchId, dataVersion: s.match.dataVersion,
    catalogDigest: s.match.catalogDigest,
    printings: ['plain', 'champ', 'legend', 'rune', 'field0', 'field1', 'field2']
      .map(cardId => ({ cardId, programReference: `fixture:${cardId}` })) }, sourceService);
  const first = start(s, { sources: sourceRegistry, fepr: () => ({ status: 'none' }),
    resolveHandlers: ({ match, sources: handlers }) => {
      calls.push(handlers.map(h => h.uid));
      const locationId = match.board.bases[0].locationId;
      if (calls.length === 1) return { status: 'applied', match: { ...match,
        board: placeDuelUnit(match.board, { objectId: entered.uid, controllerPlayerId: 'alice', locationId }),
        players: match.players.map(p => p.playerId === 'alice' ?
          { ...p, hand: p.hand.filter(card => card.uid !== entered.uid) } : p),
        unitMeta: { ...match.unitMeta, [entered.uid]: { ownerPlayerId: 'alice', readied: true,
          damageMarks: [], trait: { kind: 'card', cardId: entered.cardId } } } },
        transitions: [{ uid: entered.uid, from: { kind: 'hand', zonePlayerId: 'alice' },
          to: { kind: 'board-base', locationId } }] };
      return { status: 'applied', match: { ...match, scoring: { ...match.scoring,
        players: match.scoring.players.map(p => p.playerId === 'bob' ?
          { ...p, points: p.points + 1 } : p) } }, transitions: [] };
    } });
  assert.equal(first.status, 'main', first.reason);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['alice-legend', 'bob-legend']);
  assert.deepEqual(calls[1], [entered.uid]);
  assert.equal(new Set(calls.flat()).size, 3);
  s = first.session;
  assert.equal(s.match.board.units.some(u => u.objectId === entered.uid), true);
});

test('End pending rejects direct Start/End and wrong retry; exact resume preserves clock', () => {
  const s = main(factory());
  const unknown = services(s, r => r.event === 'ending' ? { status: 'unknown' } : {});
  const r = end(s, 'alice', unknown); assert.equal(r.status, 'pending');
  assert.equal(r.pending.step, 'ending'); const pending = r.session, id = r.pending.taskId;
  noTick(end(pending, 'alice', services(s)), pending);
  noTick(start(pending, services(s)), pending);
  noTick(resumeEnd(pending, 'foreign', { status: 'retry', matchId: s.match.matchId,
    turn: 1, taskId: 'foreign' }, services(s)), pending);
  noTick(resumeEnd(pending, id, { status: 'retry', matchId: s.match.matchId,
    turn: 1, taskId: 'other' }, services(s)), pending);
  const result = resumeEnd(pending, id, { status: 'retry', matchId: s.match.matchId,
    turn: 1, taskId: id }, services(s));
  assert.equal(result.status, 'awaiting-turn-start', result.reason);
  assert.equal(result.session.match.frame.turnNumber, 2);
  noTick(resumeEnd(result.session, id, {}, services(s)), result.session);
});

test('JSON or structured clones cannot borrow private cursor admission or pay with a copied ledger', () => {
  const s = main(factory()), { task, proof, issued } = required(s, 'clone');
  const active = prepare(issued.session, issued.authority, proof.verify).session;
  for (const cloned of [structuredClone(active), JSON.parse(JSON.stringify(active))]) {
    noTick(end(cloned, 'alice', services(s)), cloned);
    noTick(start(cloned, services(s)), cloned);
    assert.throws(() => submit(cloned, 'alice', 'fake-pay',
      { type: 'pay-pending', paymentId: task.paymentId }, { sourceAttestor: proof.verify }), /unadmitted/);
  }
  const paid = payRequired(active, task, proof);
  const clonedPaid = structuredClone(paid.session);
  noTick(end(clonedPaid, 'alice', services(s)), clonedPaid);
  assert.equal(end(paid.session, 'alice', services(s)).status, 'awaiting-turn-start');
});
