import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2,
  inspectDuelNativeCommandSessionPathV2 } from '../dist/duel/canonical-session-v2.js';
import { createDuelPhaseSourceRegistryV2 } from '../dist/duel/phase-source-authority-v2.js';
import { inspectDuelNativeCommitPathV2 } from '../dist/duel/core-v2.js';
import { runDuelStartOfTurnV2, resumeDuelStartOfTurnV2, runDuelEndOfTurnV2,
  resumeDuelEndOfTurnV2 } from '../dist/duel/turn-executor-v2.js';

function fixture() {
  const seats = ['alice', 'bob'].map(playerId => ({ playerId,
    mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-card-${i}`, cardId: 'unit' })),
    champion: { uid: `${playerId}-champion`, cardId: 'champion' },
    legend: { uid: `${playerId}-legend`, cardId: 'legend' },
    runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'rune', domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `field-${i}` })),
  }));
  const metadata = { matchId: 'turn-checkpoints', dataVersion: 'test-data', catalogDigest: 'sha256:test',
    roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) };
  const types = id => id.startsWith('field-') ? 'Battlefield' :
    ({ champion: 'Champion', legend: 'Legend', rune: 'Rune', unit: 'Unit' })[id];
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, types);
  for (const actor of ['alice', 'bob']) session = applyDuelResourceCommandV2(session, actor,
    { commandId: `mulligan-${actor}`, expectedVersion: session.match.stateVersion,
      command: { type: 'mulligan', selectedUIDs: [] } }).session;
  let current = session.match;
  const checks = [];
  const sources = createDuelPhaseSourceRegistryV2({ ...metadata,
    printings: ['unit', 'champion', 'legend', 'rune', 'field-0', 'field-1', 'field-2'].map(cardId =>
      ({ cardId, programReference: `test:${cardId}` })) }, request => {
    checks.push(request);
    if (request.match !== current) return { status: 'unknown' };
    return { status: 'complete', matchId: request.matchId, dataVersion: request.dataVersion,
      catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
      uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
      controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
      programReference: `test:${request.source.cardId}`, event: request.event, eventSupported: true,
      scope: 'known-no-handler', replacementsCovered: true, staticCovered: true,
      continuousCovered: true, triggersCovered: true };
  });
  const checkpoints = [];
  const services = { sources, fepr: () => ({ status: 'none' }), observeCheckpoint: checkpoint => {
    assert.equal(Object.isFrozen(checkpoint), true);
    inspectDuelNativeCommitPathV2(current, checkpoint.match);
    current = checkpoint.match;
    checkpoints.push(checkpoint);
    return true;
  } };
  return { session, services, checkpoints, checks, current: () => current };
}

test('actual intermediate heads reach the source gate before inspection and include the final handoff', () => {
  const f = fixture();
  const stale = runDuelStartOfTurnV2(f.session, { ...f.services, observeCheckpoint: undefined });
  assert.equal(stale.status, 'pending');
  assert.equal(stale.pending.step, 'begin');
  const result = runDuelStartOfTurnV2(f.session, f.services);
  assert.equal(result.status, 'main', result.reason);
  assert.strictEqual(f.current(), result.session.match);
  assert.equal(f.checkpoints.at(-1).step, 'main');
  assert.equal(f.checkpoints.at(-1).taskId.includes('turn-1:main:'), true);
  const path = inspectDuelNativeCommitPathV2(f.session.match, result.session.match);
  // Cursor-only executor progress is private continuation state. It must not add
  // reachable session successors for intrinsic steps that did not commit a match.
  const sessionPath = inspectDuelNativeCommandSessionPathV2(f.session, result.session);
  assert.equal(path.length, result.session.match.stateVersion - f.session.match.stateVersion);
  assert.equal(sessionPath.filter(item => item.before.match === item.after.match).length, 3);
  assert.equal(path.at(-1).after, result.session.match);
  assert.equal(f.checkpoints.length, 13);
  assert.equal(path.flatMap(commit => commit.transitions).filter(t => t.from.kind === 'rune-deck').length, 2);
  assert.equal(path.flatMap(commit => commit.transitions).filter(t => t.from.kind === 'main-deck' && t.to.kind === 'hand').length, 1);
  for (const request of f.checks.slice(f.checks.findIndex(r => r.taskId === f.checkpoints[0].taskId))) {
    if (request.match === stale.session.match) continue;
    assert.equal(f.checkpoints.some(c => c.match === request.match && c.taskId === request.taskId), true);
  }
  const ending = runDuelEndOfTurnV2(result.session, 'alice', f.services);
  assert.equal(ending.status, 'awaiting-turn-start', ending.reason);
  const endPath = inspectDuelNativeCommitPathV2(result.session.match, ending.session.match);
  const endSessionPath = inspectDuelNativeCommandSessionPathV2(result.session, ending.session);
  assert.equal(endSessionPath.filter(item => item.before.match === item.after.match).length, 3);
  assert.equal(endPath.length, ending.session.match.stateVersion - result.session.match.stateVersion);
  assert.equal(endPath.length, 3);
  assert.equal(f.checkpoints.length, 24);
  assert.strictEqual(f.current(), ending.session.match);
  assert.equal(f.checkpoints.at(-1).step, 'awaiting-turn-start');
  assert.equal(f.checkpoints.at(-1).turn, 2);
});

test('observer refusal preserves the actual committed head and exact continuation instead of rolling back', () => {
  const f = fixture();
  const refusing = { ...f.services, observeCheckpoint: c => c.step === 'begin' ? false : f.services.observeCheckpoint(c) };
  const pending = runDuelStartOfTurnV2(f.session, refusing);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.pending.step, 'begin');
  assert.equal(pending.session.match.stateVersion, f.session.match.stateVersion + 1);
  assert.equal(pending.session.match.frame.phase, 'awaken');
  const resumed = resumeDuelStartOfTurnV2(pending.session, pending.pending.taskId,
    { status: 'retry', matchId: pending.session.match.matchId, turn: 1, taskId: pending.pending.taskId }, f.services);
  assert.equal(resumed.status, 'main', resumed.reason);
  assert.strictEqual(f.current(), resumed.session.match);
});

test('a terminal handoff refused by the observer remains pending and can resume without another turn increment', () => {
  const f = fixture();
  const main = runDuelStartOfTurnV2(f.session, f.services);
  const blocked = runDuelEndOfTurnV2(main.session, 'alice', { ...f.services,
    observeCheckpoint: c => c.step === 'awaiting-turn-start' ? false : f.services.observeCheckpoint(c) });
  assert.equal(blocked.status, 'pending');
  assert.equal(blocked.session.match.frame.turnNumber, 2);
  const resumed = resumeDuelEndOfTurnV2(blocked.session, blocked.pending.taskId,
    { status: 'retry', matchId: blocked.session.match.matchId, turn: 2, taskId: blocked.pending.taskId }, f.services);
  assert.equal(resumed.status, 'awaiting-turn-start', resumed.reason);
  assert.strictEqual(resumed.session.match, blocked.session.match);
  assert.strictEqual(f.current(), resumed.session.match);
});

test('observer exceptions fail closed and a cloned cursor cannot invoke the observer', () => {
  const f = fixture();
  const pending = runDuelStartOfTurnV2(f.session, { ...f.services, observeCheckpoint: () => { throw Error('journal unavailable'); } });
  assert.equal(pending.status, 'pending');
  assert.strictEqual(pending.session.match, f.session.match);
  let calls = 0;
  const clone = structuredClone(pending.session);
  const result = resumeDuelStartOfTurnV2(clone, pending.pending.taskId,
    { status: 'retry', matchId: f.session.match.matchId, turn: 1, taskId: pending.pending.taskId },
    { ...f.services, observeCheckpoint: () => { calls++; return true; } });
  assert.equal(result.status, 'rejected');
  assert.equal(calls, 0);
});
