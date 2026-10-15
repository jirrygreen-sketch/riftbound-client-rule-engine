import test from 'node:test';
import assert from 'node:assert/strict';
import { playing, oracle } from './duel-phase-source-authority-v2.test.mjs';
import { runDuelStartOfTurnV2, runDuelEndOfTurnV2 } from '../dist/duel/turn-executor-v2.js';
import { applyDuelResourceCommandV2, advanceDuelCommandSessionNativeV2,
  issueDuelRequiredCostTaskV2, inspectDuelNativeCommandSessionPathV2,
  adoptAdmittedDuelPlayingSessionV2, checkpointDuelTurnCursorV2 } from '../dist/duel/canonical-session-v2.js';
import { commitDuelPlayingMutationV2, referenceDuelPhysicalCardV2 } from '../dist/duel/core-v2.js';

const services = () => ({ sources: oracle(), fepr: () => ({ status: 'none' }) });
const started = () => runDuelStartOfTurnV2(playing(), services()).session;
const change = state => commitDuelPlayingMutationV2(state, draft => ({ match: {
  ...draft, frame: { ...draft.frame, stateOpen: !draft.frame.stateOpen } }, transitions: [] }));

test('native effect successors preserve actual command receipts and Main cursor across multiple Core commits', () => {
  let session = started();
  const uid = session.match.resources.bases[0].baseRunes[0].uid;
  const envelope = { commandId: 'real-energy', expectedVersion: session.match.stateVersion,
    command: { type: 'rune-energy', uid } };
  session = applyDuelResourceCommandV2(session, 'alice', envelope).session;
  const before = session;
  const closed = change(before.match), reopened = change(closed);
  const adopted = advanceDuelCommandSessionNativeV2(before, reopened);
  assert.equal(adopted.persistRequired, true);
  assert.strictEqual(adopted.session.match, reopened);
  assert.strictEqual(adopted.session.receipts, before.receipts);
  assert.strictEqual(adopted.session.requiredTasks, before.requiredTasks);
  assert.strictEqual(adopted.session.priorityPayments, before.priorityPayments);
  assert.equal(adopted.session.turnCursorV2.stateVersion, reopened.stateVersion);
  const duplicate = applyDuelResourceCommandV2(adopted.session, 'alice', envelope);
  assert.equal(duplicate.duplicate, true);
  assert.strictEqual(duplicate.session, adopted.session);
  assert.equal(duplicate.session.match.resources.players[0].runePool.energy, 1);
  assert.equal(runDuelEndOfTurnV2(adopted.session, 'alice', services()).status, 'awaiting-turn-start');
});

test('equivalent factories, sibling/reverse and JSON successors cannot replace the private ledger head', () => {
  const session = started(), other = started();
  const child = change(session.match);
  const sibling = change(session.match);
  const childSession = advanceDuelCommandSessionNativeV2(session, child).session;
  for (const target of [other.match, sibling, session.match, structuredClone(child), JSON.parse(JSON.stringify(child))])
    assert.throws(() => advanceDuelCommandSessionNativeV2(childSession, target));
  assert.throws(() => advanceDuelCommandSessionNativeV2(structuredClone(session), child));
  const noop = advanceDuelCommandSessionNativeV2(session, session.match);
  assert.equal(noop.persistRequired, false);
  assert.strictEqual(noop.session, session);
});

test('an issued required-cost capability cannot be stripped by attaching a native successor', () => {
  const session = started();
  const uid = session.match.players[0].hand[0].uid;
  const task = { matchId: session.match.matchId, expectedVersion: session.match.stateVersion,
    taskId: 'actual-cost', paymentId: 'actual-payment', actor: 'alice', finalResolvedCost: { energy: 0, power: [] },
    opaqueSource: { kind: 'card', referenceId: 'fixture-source', sourceUID: uid }, continuationId: 'actual-continuation' };
  const issued = issueDuelRequiredCostTaskV2(session, task, request => ({ matchId: request.match.matchId,
    actor: request.actor, paymentId: request.paymentId, sourceReference: request.sourceReference,
    sourceProofId: 'fixture-proof', mode: 'current', sourceZoneEpoch: referenceDuelPhysicalCardV2(request.match, uid).zoneEpoch,
    taskId: request.taskId, continuationId: request.continuationId }));
  assert.throws(() => advanceDuelCommandSessionNativeV2(issued.session, change(session.match)), /issued task/);
  assert.strictEqual(issued.session.match, session.match);
  assert.equal(issued.session.requiredTasks[0].status, 'issued');
});

test('private session lineage includes real scalar checkpoints and refuses receipt-clearing adoption of the same match', () => {
  const session = started();
  const checkpoint = checkpointDuelTurnCursorV2(session, session.turnCursorV2);
  assert.strictEqual(checkpoint.match, session.match);
  const descendant = advanceDuelCommandSessionNativeV2(checkpoint, change(checkpoint.match)).session;
  const path = inspectDuelNativeCommandSessionPathV2(session, descendant);
  assert.equal(path.length, 2);
  assert.strictEqual(path[0].before, session);
  assert.strictEqual(path[0].after, checkpoint);
  assert.strictEqual(path[1].after, descendant);
  assert.equal(Object.isFrozen(path), true);
  assert.equal(path.every(p => Object.isFrozen(p)), true);
  const cleared = adoptAdmittedDuelPlayingSessionV2(descendant.match);
  assert.throws(() => inspectDuelNativeCommandSessionPathV2(session, cleared), /origin/);
  assert.throws(() => inspectDuelNativeCommandSessionPathV2(descendant, checkpoint), /descendant/);
  assert.throws(() => inspectDuelNativeCommandSessionPathV2(session, structuredClone(descendant)), /unadmitted/);
});
