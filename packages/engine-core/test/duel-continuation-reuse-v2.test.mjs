// Continuation-ID one-shot acceptance for the V2 required-cost session boundary.
//
// Fixture provenance: the constructor/mulligan session and the Awaken→…→Main frame come from the
// SAME real routes used by 141's turn-start oracle and its suite
// (duel-phase-source-authority-v2.test.mjs + turn-executor-v2.js). A required-cost task is opened
// by the trusted TaskExecutor route with an independent registered source attestor; the final
// resolved cost is supplied by that trusted provider, never a printed base cost or client field.
// This is an explicit internal positive control: it does NOT claim that Poro / a production Main
// provider / a real card IR has been wired.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playing, oracle } from './duel-phase-source-authority-v2.test.mjs';
import { runDuelStartOfTurnV2 } from '../dist/duel/turn-executor-v2.js';
import {
  applyDuelResourceCommandV2, issueDuelRequiredCostTaskV2, prepareDuelRequiredCostPaymentV2,
} from '../dist/duel/canonical-session-v2.js';

const ACTOR = 'alice';
const EMPTY = { energy: 0, power: [] };
const services = () => ({ sources: oracle(), fepr: () => ({ status: 'none' }) });
const pool = (s, actor = ACTOR) => s.match.resources.players.find(p => p.playerId === actor).runePool;
const handCard = (s, actor = ACTOR) => s.match.players.find(p => p.playerId === actor).hand[0].uid;

/** REAL factory + two real mulligans + REAL Awaken→…→Main turn route. Never a hand-set frame. */
function main() {
  const turned = runDuelStartOfTurnV2(playing(), services());
  assert.equal(turned.status, 'main', turned.reason);
  assert.equal(turned.session.match.frame.phase, 'main');
  assert.equal(turned.session.match.frame.priorityPlayerId, ACTOR);
  assert.equal(turned.session.turnCursorV2.step, 'main');
  return turned.session;
}
/** TEST FIXTURE ONLY: registered source/final-cost attestation, not a card resolver. It counts
 * every invocation so a rejected issue can be shown to never reach the independent callback. */
function registry(s, { actor = ACTOR, paymentId, cost = EMPTY, source, taskId, continuationId } = {}) {
  const epoch = s.match.physicalCardsByUID[source.sourceUID]?.zoneEpoch;
  assert.equal(typeof epoch, 'number');
  let calls = 0;
  const attest = request => {
    calls++;
    assert.equal(request.match.matchId, s.match.matchId);
    assert.equal(request.actor, actor);
    assert.equal(request.paymentId, paymentId);
    assert.deepEqual(request.sourceReference, source);
    assert.deepEqual(request.finalResolvedCost, cost);
    assert.equal(request.taskId, taskId);
    assert.equal(request.continuationId, continuationId);
    return { matchId: s.match.matchId, actor, paymentId, sourceReference: { ...source },
      sourceProofId: `fixture-registered:${paymentId}`, mode: 'current', sourceZoneEpoch: epoch,
      ...(taskId ? { taskId, continuationId } : {}) };
  };
  return { attest, get calls() { return calls; } };
}
/** TEST FIXTURE ONLY: a task descriptor; opaqueSource references a real live physical source. */
function descriptor(s, { taskId, paymentId, continuationId, cost = EMPTY, actor = ACTOR } = {}) {
  const sourceUID = handCard(s, actor);
  return { matchId: s.match.matchId, expectedVersion: s.match.stateVersion, taskId, paymentId,
    actor, finalResolvedCost: cost,
    opaqueSource: { kind: 'effect', referenceId: `${taskId}-effect`, sourceUID }, continuationId };
}
/** Open the required-cost window through the issuing capability, then close it by paying EMPTY. */
function issuedActiveToCompleted(s0) {
  const task = descriptor(s0, { taskId: 'c-task', paymentId: 'c-payment', continuationId: 'cont-1' });
  const proof = registry(s0, { paymentId: task.paymentId, source: task.opaqueSource,
    taskId: task.taskId, continuationId: task.continuationId });
  const issued = issueDuelRequiredCostTaskV2(s0, task, proof.attest);
  assert.equal(issued.session.requiredTasks[0].status, 'issued');
  const prepared = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, proof.attest);
  assert.equal(prepared.session.requiredTasks[0].status, 'active');
  const paid = applyDuelResourceCommandV2(prepared.session, ACTOR,
    { commandId: 'c-pay', expectedVersion: prepared.session.match.stateVersion,
      command: { type: 'pay-pending', paymentId: task.paymentId } },
    { sourceAttestor: proof.attest });
  assert.equal(paid.outcome.status, 'applied', JSON.stringify(paid.outcome));
  assert.equal(paid.session.requiredTasks[0].status, 'completed');
  return { session: paid.session, task };
}
function snapshot(s) {
  return { bytes: JSON.stringify(s.match), stateVersion: s.match.stateVersion,
    eventSeq: s.match.eventSeq, pool: JSON.stringify(pool(s)) };
}
/** Assert a NEW task/payment under an already-used continuation is rejected BEFORE the independent
 * source callback runs, and that bytes/clock/pool are byte-identical afterwards. */
function assertReuseRejected(s, { label, continuationId, actor = ACTOR }) {
  const before = snapshot(s);
  const fresh = descriptor(s, { taskId: `${label}-task`, paymentId: `${label}-payment`,
    continuationId, actor });
  const proof = registry(s, { paymentId: fresh.paymentId, source: fresh.opaqueSource,
    taskId: fresh.taskId, continuationId, actor });
  assert.throws(() => issueDuelRequiredCostTaskV2(s, fresh, proof.attest), /Duel V2 session/);
  assert.equal(proof.calls, 0, `${label}: source callback must not run`);
  const after = snapshot(s);
  assert.equal(after.bytes, before.bytes, `${label}: match bytes unchanged`);
  assert.equal(after.stateVersion, before.stateVersion, `${label}: stateVersion unchanged`);
  assert.equal(after.eventSeq, before.eventSeq, `${label}: eventSeq unchanged`);
  assert.equal(after.pool, before.pool, `${label}: rune pool unchanged`);
}

test('issued continuation: a new task/payment reusing the ID is rejected with zero callback', () => {
  let s = main();
  const task = descriptor(s, { taskId: 'i-task', paymentId: 'i-payment', continuationId: 'cont-issued' });
  const proof = registry(s, { paymentId: task.paymentId, source: task.opaqueSource,
    taskId: task.taskId, continuationId: task.continuationId });
  s = issueDuelRequiredCostTaskV2(s, task, proof.attest).session;
  assert.equal(s.requiredTasks[0].status, 'issued');
  assert.equal(proof.calls, 1);
  assertReuseRejected(s, { label: 'issued-reuse', continuationId: 'cont-issued' });
  // The original issued task is untouched and still owns the window.
  assert.equal(s.requiredTasks.length, 1);
  assert.equal(s.requiredTasks[0].taskId, 'i-task');
});

test('active continuation: a new task/payment reusing the ID is rejected with zero callback', () => {
  let s = main();
  const task = descriptor(s, { taskId: 'a-task', paymentId: 'a-payment', continuationId: 'cont-active' });
  const proof = registry(s, { paymentId: task.paymentId, source: task.opaqueSource,
    taskId: task.taskId, continuationId: task.continuationId });
  const issued = issueDuelRequiredCostTaskV2(s, task, proof.attest);
  s = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, proof.attest).session;
  assert.equal(s.requiredTasks[0].status, 'active');
  assert.equal(s.match.frame.pendingPayment.paymentId, 'a-payment');
  assertReuseRejected(s, { label: 'active-reuse', continuationId: 'cont-active' });
  assert.equal(s.requiredTasks.length, 1);
});

test('completed continuation: reusing the ID for a NEW task/payment hits the one-shot guard', () => {
  const { session: s } = issuedActiveToCompleted(main());
  assert.equal(s.requiredTasks[0].continuationId, 'cont-1');
  assert.equal(s.requiredTasks[0].status, 'completed');
  // A brand-new taskId/paymentId under the SAME continuation must still fail, specifically at the
  // continuation guard, and never reach the independent source attestor.
  const before = snapshot(s);
  const fresh = descriptor(s, { taskId: 'c2-task', paymentId: 'c2-payment', continuationId: 'cont-1' });
  const proof = registry(s, { paymentId: fresh.paymentId, source: fresh.opaqueSource,
    taskId: fresh.taskId, continuationId: 'cont-1' });
  assert.throws(() => issueDuelRequiredCostTaskV2(s, fresh, proof.attest),
    /continuation ID already issued/);
  assert.equal(proof.calls, 0);
  assert.equal(snapshot(s).bytes, before.bytes);
  assert.equal(snapshot(s).stateVersion, before.stateVersion);
});

test('a completed continuation cannot be recalled by another actor with new task/payment IDs', () => {
  // The one-shot continuation is session-global, not actor-scoped: a different seat with its own
  // real hand source still cannot reopen the spent continuation.
  const { session: s } = issuedActiveToCompleted(main());
  assertReuseRejected(s, { label: 'rival-reuse', continuationId: 'cont-1', actor: 'bob' });
  const before = snapshot(s);
  const proof = registry(s, { actor: 'bob', paymentId: 'rival-payment',
    source: { kind: 'effect', referenceId: 'rival-effect', sourceUID: handCard(s, 'bob') },
    taskId: 'rival-task', continuationId: 'cont-1' });
  assert.equal(proof.calls, 0);
  assert.equal(snapshot(s).bytes, before.bytes);
});

test('a fresh unique continuation issues and pays normally; the same command replays as duplicate', () => {
  const { session: s0 } = issuedActiveToCompleted(main());
  // A genuinely new one-shot continuation is legal.
  const task = descriptor(s0, { taskId: 'u-task', paymentId: 'u-payment', continuationId: 'cont-unique' });
  const proof = registry(s0, { paymentId: task.paymentId, source: task.opaqueSource,
    taskId: task.taskId, continuationId: task.continuationId });
  const issued = issueDuelRequiredCostTaskV2(s0, task, proof.attest);
  assert.equal(issued.session.requiredTasks.filter(e => e.continuationId === 'cont-unique').length, 1);
  const prepared = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, proof.attest);
  const command = { commandId: 'u-pay', expectedVersion: prepared.session.match.stateVersion,
    command: { type: 'pay-pending', paymentId: task.paymentId } };
  const paid = applyDuelResourceCommandV2(prepared.session, ACTOR, command, { sourceAttestor: proof.attest });
  assert.equal(paid.outcome.status, 'applied', JSON.stringify(paid.outcome));
  assert.deepEqual(paid.outcome.paymentCompleted.requiredTask,
    { taskId: 'u-task', continuationId: 'cont-unique' });
  assert.equal(paid.session.requiredTasks.find(e => e.taskId === 'u-task').status, 'completed');
  // The very same command (same actor/commandId/payload) is a sticky duplicate: no new clock, no
  // extra callback, identical receipt outcome.
  const replay = applyDuelResourceCommandV2(paid.session, ACTOR, command, { sourceAttestor: proof.attest });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.persistRequired, false);
  assert.strictEqual(replay.match, paid.session.match);
  assert.deepEqual(replay.outcome, paid.outcome);
  assert.equal(replay.session.receipts.length, paid.session.receipts.length);
});

test('a JSON clone of a real continuation ledger cannot issue or command: no WeakMap admission', () => {
  const { session: s } = issuedActiveToCompleted(main());
  const clone = structuredClone(s);
  const task = descriptor(clone, { taskId: 'z-task', paymentId: 'z-payment', continuationId: 'cont-clone' });
  const proof = registry(clone, { paymentId: task.paymentId, source: task.opaqueSource,
    taskId: task.taskId, continuationId: task.continuationId });
  assert.throws(() => issueDuelRequiredCostTaskV2(clone, task, proof.attest),
    /unadmitted V2 session/);
  assert.equal(proof.calls, 0);
  // A forged clone also cannot be used to spend the saved continuation.
  assert.throws(() => applyDuelResourceCommandV2(clone, ACTOR,
    { commandId: 'clone-cmd', expectedVersion: clone.match.stateVersion,
      command: { type: 'pay-pending', paymentId: 'c-payment' } }), /unadmitted V2 session/);
});
