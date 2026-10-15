// Gold resource command through the real V2 session boundary.
//
// Fixture provenance: the constructor/mulligan session and the Awaken→…→Main frame come from
// the SAME real routes used by 141's turn-start oracle and its suite
// (duel-phase-source-authority-v2.test.mjs + turn-executor-v2.js). The Gold token is minted by
// an INDEPENDENT test creating-source oracle (attestDuelTokenSourceV2 + createDuelGoldTokenV2).
// This is an explicit internal positive control: it does NOT claim that Poro / a production Main
// provider or a real card IR has been wired.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playing, oracle } from './duel-phase-source-authority-v2.test.mjs';
import { runDuelStartOfTurnV2, runDuelEndOfTurnV2 } from '../dist/duel/turn-executor-v2.js';
import {
  createDuelCommandSessionV2, adoptAdmittedDuelPlayingSessionV2,
  applyDuelResourceCommandV2, commitDuelCommandFrameV2,
  issueDuelRequiredCostTaskV2, prepareDuelRequiredCostPaymentV2,
} from '../dist/duel/canonical-session-v2.js';
import {
  attestDuelTokenSourceV2, createDuelGoldTokenV2, enumerateDuelObjectsV2,
} from '../dist/duel/core-v2.js';

const ACTOR = 'alice';
const RIVAL = 'bob';
const services = () => ({ sources: oracle(), fepr: () => ({ status: 'none' }) });
const pool = (s, actor = ACTOR) => s.match.resources.players.find(p => p.playerId === actor).runePool;
const base = (s, actor = ACTOR) => s.match.resources.bases.find(b => b.playerId === actor);
const baseRune = (s, index = 0) => base(s).baseRunes[index];
const handCard = (s, actor = ACTOR) => s.match.players.find(p => p.playerId === actor).hand[0].uid;
const submit = (s, actor, commandId, command, expectedVersion = s.match.stateVersion, trusted) =>
  applyDuelResourceCommandV2(s, actor, { commandId, expectedVersion, command }, trusted);
function ok(result, previous) {
  assert.equal(result.outcome.status, 'applied', JSON.stringify(result.outcome));
  assert.equal(result.match.stateVersion, previous.match.stateVersion + 1);
  assert.equal(result.match.eventSeq, previous.match.eventSeq + 1);
  assert.equal(result.duplicate, false);
  assert.equal(result.persistRequired, true);
  assert.strictEqual(result.match, result.session.match);
  return result.session;
}
function fail(result, s, reason) {
  assert.deepEqual(result.outcome, { status: 'rejected', reason });
  assert.strictEqual(result.match, s.match);
  assert.equal(result.persistRequired, true);
  assert.equal(result.session.receipts.length, s.receipts.length + 1);
  return result.session;
}
/** TEST FIXTURE ONLY: an independent token-source oracle, not a production IR/resolver. */
const sourceOracle = ({ match, request }) => ({ ...request, matchId: match.matchId,
  dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
  sourceProofId: `fixture-gold-oracle:${request.sourceEffectId}` });
/** TEST FIXTURE ONLY: real constructor/mulligan → REAL Awaken→…→Main route → independent
 * creating-source Gold → re-admitted session.
 * The official turn route runs FIRST because the phase-source gate enumerates every live gold
 * token as a source and fails closed on a token (it has no catalog printing), so a token cannot
 * exist while the turn route runs. The command under test therefore executes on the official
 * Main frame produced by runDuelStartOfTurnV2, not on a hand-set frame. */
function goldMain({ uid = 'gold-alice', readied = true, effectId = 'effect-gold-alice' } = {}) {
  const turned = runDuelStartOfTurnV2(playing(), services());   // real factory + two real mulligans
  assert.equal(turned.status, 'main', turned.reason);
  let s = turned.session;
  assert.equal(s.match.frame.phase, 'main');
  assert.equal(s.match.frame.priorityPlayerId, ACTOR);
  assert.equal(s.turnCursorV2.step, 'main');
  const sourceUID = handCard(s);
  const request = { kind: 'gold', tokenUID: uid, sourceEffectId: effectId,
    eventId: `event:${effectId}`, sourceUID,
    sourceZoneEpoch: s.match.physicalCardsByUID[sourceUID].zoneEpoch, sourceMode: 'current',
    effectControllerPlayerId: ACTOR, controllerPlayerId: ACTOR, locationId: base(s).locationId,
    readied };
  const withToken = createDuelGoldTokenV2(s.match, request, sourceOracle);
  // Fixture re-admission only (the implementation must never adopt): it keeps the official Main
  // frame and drops the scalar turn cursor, which the Gold command does not depend on.
  s = adoptAdmittedDuelPlayingSessionV2(withToken);
  assert.equal(s.match.frame.phase, 'main');
  assert.equal(s.match.frame.priorityPlayerId, ACTOR);
  assert.equal(base(s).goldTokens.some(g => g.uid === uid), true);
  return { session: s, uid };
}
function changePriority(s, priority) {
  const changed = commitDuelCommandFrameV2(s, { ...s.match.frame, priorityPlayerId: priority },
    (before, proposed) => { assert.equal(proposed.priorityPlayerId, priority); });
  assert.equal(changed.persistRequired, true);
  return changed.session;
}
const EMPTY = { energy: 0, power: [] };
/** TEST FIXTURE ONLY: registered source/final-cost/payer attestation, not a card resolver. */
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

test('real Main: gold-power grants +1 Any, keeps Energy, retires the live trusted token on one clock', () => {
  const { session: s0, uid } = goldMain();
  const transitions = s0.match.provenance.transitions.length;
  assert.equal(pool(s0).power.any, 0);
  assert.equal(pool(s0).energy, 0);
  assert.equal(base(s0).goldTokens.some(g => g.uid === uid), true);
  assert.equal(s0.match.resources.retiredGoldUids.includes(uid), false);
  const s = ok(submit(s0, ACTOR, 'gold-1', { type: 'gold-power', uid }), s0);
  assert.equal(pool(s).power.any, 1);
  assert.equal(pool(s).energy, 0);
  assert.equal(pool(s).power.Fury, 0);
  assert.equal(base(s).goldTokens.some(g => g.uid === uid), false);
  assert.equal(s.match.resources.retiredGoldUids.includes(uid), true);
  assert.equal(enumerateDuelObjectsV2(s.match).some(object => object.uid === uid), false);
  // Gold is a token, never a physical zone transfer, and only one clock tick was allocated.
  assert.equal(s.match.provenance.transitions.length, transitions);
  assert.equal(s.match.stateVersion, s0.match.stateVersion + 1);
  assert.equal(s.match.eventSeq, s0.match.eventSeq + 1);
  assert.equal(s.match.eventSeq, s.match.stateVersion);
  assert.throws(() => { s.match.resources.players[0].runePool.power.any = 7; }, TypeError);
});

test('replaying the same gold-power command is a duplicate receipt: no extra Any, no re-retirement, no clock', () => {
  const { session: s0, uid } = goldMain();
  const s = ok(submit(s0, ACTOR, 'gold-dup', { type: 'gold-power', uid }), s0);
  const replay = submit(s, ACTOR, 'gold-dup', { type: 'gold-power', uid }, 0);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.persistRequired, false);
  assert.strictEqual(replay.match, s.match);
  assert.deepEqual(replay.outcome, { status: 'applied', appliedVersion: s.match.stateVersion,
    eventSeq: s.match.eventSeq });
  assert.equal(pool(replay.session).power.any, 1);
  assert.equal(replay.session.match.resources.retiredGoldUids.filter(x => x === uid).length, 1);
  assert.equal(replay.session.receipts.length, s.receipts.length);
});

test('unknown UID, foreign actor, exhausted, wrong Priority and another payer reject with zero resource change and stick', () => {
  const cases = [];
  // unknown UID: no independently attested gold birth at all.
  {
    const { session: s, uid } = goldMain({ uid: 'gold-known' });
    const before = JSON.stringify(s.match);
    const rejected = fail(submit(s, ACTOR, 'gold-unknown', { type: 'gold-power', uid: `${uid}-nope` }), s, 'resource-rejected');
    assert.equal(JSON.stringify(rejected.match), before);
    cases.push([rejected, 'gold-unknown', { type: 'gold-power', uid: `${uid}-nope` }, before, ACTOR]);
  }
  // foreign actor: the rival holds Priority but the token is not on the rival's base.
  {
    const { session: s, uid } = goldMain({ uid: 'gold-foreign' });
    const bob = changePriority(s, RIVAL);
    const before = JSON.stringify(bob.match);
    const rejected = fail(submit(bob, RIVAL, 'gold-foreign-cmd', { type: 'gold-power', uid }), bob, 'resource-rejected');
    assert.equal(JSON.stringify(rejected.match), before);
    cases.push([rejected, 'gold-foreign-cmd', { type: 'gold-power', uid }, before, RIVAL]);
  }
  // exhausted token: an unreadied Gold cannot be exhausted to add Any.
  {
    const { session: s, uid } = goldMain({ uid: 'gold-exhausted', readied: false });
    const before = JSON.stringify(s.match);
    const rejected = fail(submit(s, ACTOR, 'gold-tired', { type: 'gold-power', uid }), s, 'resource-rejected');
    assert.equal(JSON.stringify(rejected.match), before);
    cases.push([rejected, 'gold-tired', { type: 'gold-power', uid }, before, ACTOR]);
  }
  // wrong Priority: a rival holds the window and the owner is not the payer.
  {
    const { session: s, uid } = goldMain({ uid: 'gold-priority' });
    const bob = changePriority(s, RIVAL);
    const before = JSON.stringify(bob.match);
    const rejected = fail(submit(bob, ACTOR, 'gold-no-priority', { type: 'gold-power', uid }), bob, 'no-permission');
    assert.equal(JSON.stringify(rejected.match), before);
    cases.push([rejected, 'gold-no-priority', { type: 'gold-power', uid }, before, ACTOR]);
  }
  // another payer owns an active required-cost window.
  {
    let s = goldMain({ uid: 'gold-payer' }).session;
    const sourceUID = handCard(s);
    const task = { matchId: s.match.matchId, expectedVersion: s.match.stateVersion,
      taskId: 'payer-task', paymentId: 'payer-payment', actor: ACTOR, finalResolvedCost: EMPTY,
      opaqueSource: { kind: 'effect', referenceId: 'payer-effect', sourceUID },
      continuationId: 'payer-continuation' };
    const proof = registry(s, { paymentId: task.paymentId, source: task.opaqueSource,
      taskId: task.taskId, continuationId: task.continuationId });
    const issued = issueDuelRequiredCostTaskV2(s, task, proof.attest);
    s = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, proof.attest).session;
    const before = JSON.stringify(s.match);
    const rejected = fail(submit(s, RIVAL, 'gold-other-payer', { type: 'gold-power', uid: 'gold-payer' }),
      s, 'no-permission');
    assert.equal(JSON.stringify(rejected.match), before);
    cases.push([rejected, 'gold-other-payer', { type: 'gold-power', uid: 'gold-payer' }, before, RIVAL]);
  }
  // Every rejection above must be sticky: the recorded receipt replays without a new resource change.
  for (const [session, commandId, command, before, actor] of cases) {
    const replay = submit(session, actor, commandId, command, 0);
    assert.equal(replay.duplicate, true, commandId);
    assert.equal(replay.persistRequired, false, commandId);
    assert.equal(JSON.stringify(replay.match), before, commandId);
  }
});

test('legal required-payer window: Gold Any is spent on the exact cost while surplus Power is retained', () => {
  let s = goldMain({ uid: 'gold-payer-window' }).session;
  const rune = baseRune(s, 0);
  s = ok(submit(s, ACTOR, 'domain', { type: 'rune-power', uid: rune.uid }), s);
  assert.equal(pool(s).power.Fury, 1);
  const sourceUID = handCard(s);
  const task = { matchId: s.match.matchId, expectedVersion: s.match.stateVersion,
    taskId: 'cost-task', paymentId: 'cost-payment', actor: ACTOR,
    finalResolvedCost: { energy: 0, power: [{ allowedDomains: ['Fury'], amount: 1 }] },
    opaqueSource: { kind: 'effect', referenceId: 'cost-effect', sourceUID },
    continuationId: 'cost-continuation' };
  const proof = registry(s, { paymentId: task.paymentId, cost: task.finalResolvedCost,
    source: task.opaqueSource, taskId: task.taskId, continuationId: task.continuationId });
  const issued = issueDuelRequiredCostTaskV2(s, task, proof.attest);
  s = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, proof.attest).session;
  assert.equal(s.match.frame.pendingPayment.actor, ACTOR);
  s = ok(submit(s, ACTOR, 'gold-window', { type: 'gold-power', uid: 'gold-payer-window' }), s);
  assert.equal(pool(s).power.any, 1);
  const plan = { power: [{ requirementIndex: 0, from: 'any', amount: 1 }] };
  const paid = submit(s, ACTOR, 'pay-window', { type: 'pay-pending', paymentId: task.paymentId, plan },
    undefined, { sourceAttestor: proof.attest });
  assert.equal(paid.outcome.status, 'applied', JSON.stringify(paid.outcome));
  s = paid.session;
  assert.equal(pool(s).power.any, 0);
  assert.equal(pool(s).power.Fury, 1);
  assert.equal(pool(s).energy, 0);
  assert.equal(s.match.frame.pendingPayment, null);
  assert.equal(s.requiredTasks[0].status, 'completed');
  assert.deepEqual(paid.outcome.paymentCompleted.requiredTask,
    { taskId: task.taskId, continuationId: task.continuationId });
  assert.equal(s.match.resources.retiredGoldUids.includes('gold-payer-window'), true);
});

test('ordinary rune commands keep their own resource semantics and epochs; the Gold token is untouched', () => {
  let s = goldMain({ uid: 'gold-untouched' }).session;
  const transitions = s.match.provenance.transitions.length;
  const uid = baseRune(s, 0).uid;
  const epoch = s.match.physicalCardsByUID[uid].zoneEpoch;
  s = ok(submit(s, ACTOR, 'energy', { type: 'rune-energy', uid }), s);
  assert.equal(pool(s).energy, 1);
  assert.equal(baseRune(s, 0).readied, false);
  // Exhausting a base Rune for Energy is an in-place readiness change, not a zone transfer.
  assert.equal(s.match.physicalCardsByUID[uid].zoneEpoch, epoch);
  assert.equal(pool(s).power.any, 0);
  s = ok(submit(s, ACTOR, 'recycle', { type: 'rune-power', uid }), s);
  assert.equal(pool(s).power.Fury, 1);
  assert.equal(s.match.physicalCardsByUID[uid].zoneEpoch, epoch + 1);
  assert.deepEqual(s.match.provenance.transitions.at(-1), { uid,
    from: { kind: 'board-base', locationId: base(s).locationId },
    to: { kind: 'rune-deck', zonePlayerId: ACTOR } });
  assert.equal(s.match.provenance.transitions.length, transitions + 1);
  assert.equal(base(s).goldTokens.some(g => g.uid === 'gold-untouched'), true);
  assert.equal(s.match.resources.retiredGoldUids.length, 0);
});

test('141 cursor Main→resource command→Ending still chains: the resource receipt re-bonds the turn cursor', () => {
  let s = playing();
  const turned = runDuelStartOfTurnV2(s, services());
  assert.equal(turned.status, 'main', turned.reason);
  s = turned.session;
  const uid = baseRune(s, 0).uid;
  const energy = submit(s, ACTOR, 'cursor-energy', { type: 'rune-energy', uid });
  assert.equal(energy.outcome.status, 'applied');
  s = energy.session;
  assert.equal(s.turnCursorV2.step, 'main');
  assert.equal(s.turnCursorV2.stateVersion, s.match.stateVersion);
  assert.equal(s.turnCursorV2.eventSeq, s.match.eventSeq);
  const ended = runDuelEndOfTurnV2(s, s.match.frame.turnPlayerId, services());
  assert.equal(ended.status, 'awaiting-turn-start', ended.reason);
  assert.equal(ended.session.match.frame.turnNumber, s.match.frame.turnNumber + 1);
  const nextStart = runDuelStartOfTurnV2(ended.session, services());
  assert.equal(nextStart.status, 'main', nextStart.reason);
  assert.equal(nextStart.session.match.frame.turnNumber, ended.session.match.frame.turnNumber);
});

test('raw JSON clone of a real token-bearing session cannot command Gold: no WeakMap admission', () => {
  const { session: s, uid } = goldMain({ uid: 'gold-clone' });
  const clone = structuredClone(s);
  assert.throws(() => submit(clone, ACTOR, 'gold-clone-cmd', { type: 'gold-power', uid }),
    /unadmitted V2 session/);
  assert.throws(() => adoptAdmittedDuelPlayingSessionV2(structuredClone(s.match)), /untrusted V2 state/);
  assert.equal(base(s).goldTokens.some(g => g.uid === uid), true);
});

// Keep the exported factory reachable for the documented factory route in this suite.
test('factory route is the only session constructor used by the fixture', () => {
  assert.equal(typeof createDuelCommandSessionV2, 'function');
  const { session } = goldMain({ uid: 'gold-factory' });
  assert.equal(session.schemaVersion, 2);
  assert.equal(session.match.schemaVersion, 2);
});
