import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2 } from '../dist/duel/canonical-session-v2.js';
import { createDuelPhaseSourceRegistryV2 } from '../dist/duel/phase-source-authority-v2.js';
import { runDuelStartOfTurnV2 } from '../dist/duel/turn-executor-v2.js';
import { commitDuelPlayingMutationV2, inspectDuelNativeCommitPathV2,
  moveDuelUnitV2, enumerateDuelObjectsV2 } from '../dist/duel/core-v2.js';
import { applyOpenDuelCleanup, placeDuelUnit } from '../dist/duel/battlefields.js';
import { startDuelEngagementV2, advanceDuelEngagementV2,
  DuelEngagementBlockedErrorV2 } from '../dist/duel/engagement-executor-v2.js';
import { gainDuelPoints } from '../dist/duel/scoring.js';

const seats = ['a', 'b'].map(playerId => ({ playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-${i}`, cardId: 'unit' })),
  champion: { uid: `${playerId}-champ`, cardId: 'champ' },
  legend: { uid: `${playerId}-legend`, cardId: 'legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
    cardId: 'rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
    cardId: `field-${i}` })),
}));
const metadata = { matchId: 'engagement-fixture', dataVersion: 'fixture', catalogDigest: 'sha256:fixture',
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const types = cardId => cardId.startsWith('field-') ? 'Battlefield' :
  ({ unit: 'Unit', champ: 'Champion', legend: 'Legend', rune: 'Rune' })[cardId];
const proof = () => ({ currentMight: 'validated', assignmentModifier: 'proven-none',
  preventionReplacement: 'proven-none', keywordPriority: 'proven-none' });
const amount = (uid, value) => ({ uid, amount: value });

function fixture({ both = true, might = { a: 3, b: 1 }, scoreA = 0,
  deplete = null } = {}) {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, types);
  for (const actor of ['a', 'b']) session = applyDuelResourceCommandV2(session, actor,
    { commandId: `mulligan-${actor}`, expectedVersion: session.match.stateVersion,
      command: { type: 'mulligan', selectedUIDs: [] } }).session;
  let head = session.match;
  const sources = createDuelPhaseSourceRegistryV2({ ...metadata,
    printings: ['unit', 'champ', 'legend', 'rune', 'field-0', 'field-1', 'field-2']
      .map(cardId => ({ cardId, programReference: `fixture:${cardId}` })) }, request => {
    if (request.match !== head) return { status: 'unknown' };
    return { status: 'complete', matchId: request.matchId, dataVersion: request.dataVersion,
      catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
      uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
      controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
      programReference: `fixture:${request.source.cardId}`, event: request.event,
      eventSupported: true, scope: 'known-no-handler', replacementsCovered: true,
      staticCovered: true, continuousCovered: true, triggersCovered: true };
  });
  const turn = runDuelStartOfTurnV2(session, { sources, fepr: () => ({ status: 'none' }),
    observeCheckpoint: checkpoint => {
      inspectDuelNativeCommitPathV2(head, checkpoint.match);
      head = checkpoint.match;
      return true;
    } });
  assert.equal(turn.status, 'main', turn.reason);
  head = turn.session.match;
  const fieldId = head.board.battlefields[0].locationId;
  const units = Object.fromEntries(head.players.map(player => [player.playerId, player.hand[0].uid]));
  for (const actor of both ? ['a', 'b'] : ['a']) {
    const uid = units[actor];
    const baseId = head.board.bases.find(base => base.ownerPlayerId === actor).locationId;
    const placed = commitDuelPlayingMutationV2(head, draft => ({ match: { ...draft,
      board: placeDuelUnit(draft.board, { objectId: uid, controllerPlayerId: actor,
        locationId: baseId }),
      unitMeta: { ...draft.unitMeta, [uid]: { ownerPlayerId: actor, readied: false,
        damageMarks: [], trait: { kind: 'card', cardId: 'unit' } } },
      players: draft.players.map(player => ({ ...player,
        hand: player.hand.filter(card => card.uid !== uid) })) },
    transitions: [{ uid, from: { kind: 'hand', zonePlayerId: actor },
      to: { kind: 'board-base', locationId: baseId } }] }));
    assert.equal(inspectDuelNativeCommitPathV2(head, placed).length, 1);
    head = moveDuelUnitV2(placed, uid, fieldId);
    assert.equal(inspectDuelNativeCommitPathV2(placed, head).length, 1);
  }
  const staged = commitDuelPlayingMutationV2(head, draft => ({ match: { ...draft,
    board: applyOpenDuelCleanup(draft.board) }, transitions: [] }));
  assert.equal(inspectDuelNativeCommitPathV2(head, staged).length, 1);
  head = staged;
  if (scoreA) head = commitDuelPlayingMutationV2(head, draft => ({ match: { ...draft,
    scoring: gainDuelPoints(draft.scoring, draft.board, 'a', scoreA).state }, transitions: [] }));
  if (deplete) head = commitDuelPlayingMutationV2(head, draft => {
    const player = draft.players.find(value => value.playerId === 'a');
    const to = deplete === 'trash' ? 'trash' : 'hand';
    return { match: { ...draft, players: draft.players.map(value => value.playerId !== 'a' ? value : {
      ...value, remainingMainDeck: [], [to]: [...value[to], ...player.remainingMainDeck] }) },
      transitions: player.remainingMainDeck.map(card => ({ uid: card.uid,
        from: { kind: 'main-deck', zonePlayerId: 'a' },
        to: { kind: to, zonePlayerId: 'a' } })) };
  });
  let pendingEffect = false;
  let pendingFepr = false;
  let pendingKill = false;
  const drawProof = request => ({ status: 'ready', matchId: request.match.matchId,
    stateVersion: request.match.stateVersion, eventSeq: request.match.eventSeq,
    fieldId: request.fieldId, taskId: request.taskId, scorePlayerId: request.score.playerId });
  const services = { readHead: () => head, sources,
    inspectEffects: request => pendingEffect ? { status: 'pending' } : {
      status: 'none', matchId: request.match.matchId, stateVersion: request.match.stateVersion,
      eventSeq: request.match.eventSeq, boundary: request.boundary, taskId: request.taskId,
      sourceUIDs: [...request.sourceUIDs] },
    combat: { proveBasicCombat: proof, currentMight: unit =>
      might[Object.keys(units).find(actor => units[actor] === unit.uid)] },
    lethalEvaluators: { currentMight: unit =>
      might[Object.keys(units).find(actor => units[actor] === unit.objectId)],
      lethalDamageThreshold: (_unit, currentMight) => currentMight },
    approveLethal: plan => pendingKill ? { status: 'pending' } : {
      status: 'approved', approvedUnitUIDs: plan.snapshots.map(unit => unit.objectId),
      preExitSettled: true, deathknellSettled: true },
    fepr: () => ({ status: pendingFepr ? 'pending' : 'none' }),
    sourceDraw: drawProof,
    firstBurnout: request => ({ ...drawProof(request), firstBurnoutResolution: {
      kind: 'scored', scoring: gainDuelPoints(request.match.scoring, request.match.board, 'b', 1).state } }),
    intervention: drawProof,
    randomIndex: () => 0,
  };
  const publish = step => {
    if (step.match !== head) {
      assert.equal(inspectDuelNativeCommitPathV2(head, step.match).length, 1);
      head = step.match;
    }
    return step;
  };
  const start = () => publish(startDuelEngagementV2(head, fieldId, services));
  const advance = (step, command) => publish(advanceDuelEngagementV2(step.cursor, command));
  const pass = (step, actor) => advance(step, { kind: 'pass-focus', actorPlayerId: actor,
    expectedStateVersion: step.match.stateVersion });
  const cont = step => advance(step, { kind: 'continue', expectedStateVersion: step.match.stateVersion });
  const deal = (step, actor, assignments) => advance(step, { kind: 'assign-damage',
    choice: { actorPlayerId: actor, orderedUIDAmounts: assignments,
      expectedStateVersion: step.match.stateVersion } });
  return { fieldId, units, services, start, pass, cont, deal, drawProof,
    current: () => head, setHead: value => { head = value; },
    pendingEffect: value => { pendingEffect = value; },
    pendingFepr: value => { pendingFepr = value; }, pendingKill: value => { pendingKill = value; } };
}

test('real turn, placement and native move lead to a two-pass non-combat Conquer', () => {
  const f = fixture({ both: false });
  let step = f.start();
  assert.equal(step.match.board.battlefields[0].showdown, 'active');
  assert.equal(step.cursor.expectedActorPlayerId, 'a');
  step = f.pass(step, 'a');
  assert.equal(step.cursor.expectedActorPlayerId, 'b');
  step = f.pass(step, 'b');
  assert.equal(step.match.frame.stateOpen, false);
  assert.equal(step.match.board.battlefields[0].controllerPlayerId, 'a');
  assert.equal(step.score.pointsGained, 1);
  step = f.cont(step);
  assert.equal(step.status, 'complete');
  assert.equal(step.match.frame.stateOpen, true);
  assert.equal(step.match.scoring.players.find(player => player.playerId === 'a').points, 1);
  assert.equal(step.match.board.battlefields[0].contested, false);
});

test('actual two-sided Deal, lethal pre-exit approval, heal and Combat Conquer', () => {
  const f = fixture();
  let step = f.start();
  step = f.pass(step, 'a');
  step = f.pass(step, 'b');
  assert.equal(step.cursor.phase, 'damage');
  assert.equal(step.match.frame.stateOpen, false);
  step = f.deal(step, 'a', [amount(f.units.b, 3)]);
  assert.equal(step.cursor.expectedActorPlayerId, 'b');
  const before = step.match;
  step = f.deal(step, 'b', [amount(f.units.a, 1)]);
  assert.equal(step.match.eventSeq, before.eventSeq + 1);
  assert.equal(step.match.board.units.length, 2);
  assert.equal(step.match.unitMeta[f.units.b].damageMarks.at(-1).amount, 3);
  step = f.cont(step); // Kill
  assert.equal(step.match.board.units.length, 1);
  assert.equal(step.match.players.find(player => player.playerId === 'b').trash.some(
    card => card.uid === f.units.b), true);
  step = f.cont(step); // Heal
  assert.deepEqual(step.match.unitMeta[f.units.a].damageMarks, []);
  step = f.cont(step); // No recall
  step = f.cont(step); // FEPR
  step = f.cont(step); // Result + Conquer
  assert.equal(step.score.pointsGained, 1);
  assert.deepEqual(step.combatResult, undefined);
  step = f.cont(step); // Post-result FEPR and Open cleanup
  assert.equal(step.status, 'complete');
  assert.equal(step.match.frame.stateOpen, true);
  assert.deepEqual(step.combatResult, { winnerPlayerId: 'a' });
  assert.equal(step.match.board.battlefields[0].controllerPlayerId, 'a');
});

test('zero Deal still consumes a native clock; remaining defenders cause a real recall', () => {
  const f = fixture({ might: { a: 0, b: 0 } });
  let step = f.pass(f.start(), 'a');
  step = f.pass(step, 'b');
  step = f.deal(step, 'a', []);
  const before = step.match;
  step = f.deal(step, 'b', []);
  assert.equal(step.match.eventSeq, before.eventSeq + 1);
  assert.deepEqual(step.match.unitMeta, before.unitMeta);
  for (let i = 0; i < 4; i++) step = f.cont(step);
  assert.equal(step.cursor.phase, 'result');
  step = f.cont(step);
  step = f.cont(step);
  assert.equal(step.status, 'complete');
  assert.equal(step.combatResult, 'no-result');
  assert.equal(step.match.board.units.find(unit => unit.objectId === f.units.a).locationId,
    step.match.board.bases.find(base => base.ownerPlayerId === 'a').locationId);
});

test('pending source, Kill and FEPR keep the exact head and resume without redoing a choice', () => {
  const f = fixture();
  f.pendingEffect(true);
  let step = f.start();
  assert.equal(step.status, 'pending');
  assert.equal(step.cursor.phase, 'open');
  assert.throws(() => f.start(), /invalid-field/);
  const staged = step.match;
  f.pendingEffect(false);
  step = f.cont(step);
  assert.equal(step.match.board.battlefields[0].combat, 'active');
  assert.notStrictEqual(step.match, staged);
  step = f.pass(step, 'a');
  step = f.pass(step, 'b');
  const combat = f.services.combat;
  f.services.combat = null;
  const waitingDamage = step.match;
  step = f.deal(step, 'a', [amount(f.units.b, 3)]);
  assert.equal(step.status, 'pending');
  assert.strictEqual(step.match, waitingDamage);
  f.services.combat = combat;
  step = f.deal(step, 'a', [amount(f.units.b, 3)]);
  step = f.deal(step, 'b', [amount(f.units.a, 1)]);
  f.pendingKill(true);
  const dealt = step.match;
  step = f.cont(step);
  assert.equal(step.status, 'pending');
  assert.strictEqual(step.match, dealt);
  f.pendingKill(false);
  step = f.cont(step);
  step = f.cont(step);
  step = f.cont(step);
  f.pendingFepr(true);
  step = f.cont(step);
  assert.equal(step.status, 'pending');
  f.pendingFepr(false);
  assert.equal(f.cont(step).cursor.phase, 'result');
});

test('wrong actor, stale head, cloned cursor and duplicate choice fail closed', () => {
  const f = fixture();
  let step = f.start();
  assert.throws(() => f.pass(step, 'b'), error =>
    error instanceof DuelEngagementBlockedErrorV2 && error.code === 'wrong-actor');
  assert.throws(() => advanceDuelEngagementV2(structuredClone(step.cursor),
    { kind: 'pass-focus', actorPlayerId: 'a', expectedStateVersion: step.match.stateVersion }),
    /invalid-authority/);
  const old = step;
  const foreign = commitDuelPlayingMutationV2(step.match, draft => ({ match: { ...draft,
    frame: { ...draft.frame, priorityPlayerId: 'b' } }, transitions: [] }));
  f.setHead(foreign);
  assert.throws(() => f.pass(step, 'a'), /stale-head/);
  f.setHead(old.match);
  step = f.pass(step, 'a');
  assert.throws(() => f.pass(old, 'a'), /consumed/);
  assert.throws(() => f.start(), /invalid-field|stale-head/);
  step = f.pass(step, 'b');
  const first = step;
  step = f.deal(step, 'a', [amount(f.units.b, 3)]);
  assert.throws(() => f.deal(first, 'a', [amount(f.units.b, 3)]), /consumed/);
  assert.throws(() => f.deal(step, 'a', [amount(f.units.b, 3)]), /unexpected-actor/);
});

test('real Conquer Final Point substitutes one top-deck Draw and then completes cleanup', () => {
  const f = fixture({ both: false, scoreA: 7 });
  let step = f.pass(f.start(), 'a');
  step = f.pass(step, 'b');
  assert.equal(step.cursor.phase, 'draw-required');
  assert.equal(step.score.drawRequired, 1);
  assert.equal(step.score.pointsGained, 0);
  assert.equal(step.match.scoring.players[0].points, 7);
  const scored = step.match;
  const player = scored.players.find(value => value.playerId === 'a');
  const top = player.remainingMainDeck[0];
  const previousEpoch = enumerateDuelObjectsV2(scored).find(value => value.uid === top.uid).zoneEpoch;
  step = f.cont(step);
  assert.equal(step.cursor.phase, 'after-result');
  assert.equal(step.match.stateVersion, scored.stateVersion + 1);
  assert.equal(step.match.eventSeq, scored.eventSeq + 1);
  assert.deepEqual(inspectDuelNativeCommitPathV2(scored, step.match)[0].transitions,
    [{ uid: top.uid, from: { kind: 'main-deck', zonePlayerId: 'a' },
      to: { kind: 'hand', zonePlayerId: 'a' } }]);
  assert.equal(enumerateDuelObjectsV2(step.match).find(value => value.uid === top.uid).zoneEpoch,
    previousEpoch + 1);
  assert.equal(step.match.players[0].hand.at(-1).uid, top.uid);
  assert.equal(step.match.players[0].remainingMainDeck.length, player.remainingMainDeck.length - 1);
  assert.equal(step.match.scoring.players[0].points, 7);
  assert.throws(() => f.cont({ cursor: structuredClone(step.cursor), match: step.match }), /invalid-authority/);
  step = f.cont(step);
  assert.equal(step.status, 'complete');
  assert.equal(step.match.frame.stateOpen, true);
  assert.equal(step.match.scoring.players[0].points, 7);
});

test('Draw source closure is required and bound to the exact Core head', () => {
  const f = fixture({ both: false, scoreA: 7 });
  let step = f.pass(f.pass(f.start(), 'a'), 'b');
  const source = f.services.sourceDraw;
  f.services.sourceDraw = undefined;
  const scored = step.match;
  step = f.cont(step);
  assert.equal(step.status, 'pending');
  assert.equal(step.reason, 'final-point-source-pending');
  assert.strictEqual(step.match, scored);
  const old = step;
  f.services.sourceDraw = request => ({ ...f.drawProof(request), stateVersion: -1 });
  step = f.cont(step);
  assert.equal(step.status, 'pending');
  assert.strictEqual(step.match, scored);
  assert.throws(() => f.cont(old), /consumed/);
  f.services.sourceDraw = request => {
    assert.throws(() => f.cont(step), /reentrant/);
    return source(request);
  };
  step = f.cont(step);
  assert.equal(step.cursor.phase, 'after-result');
});

test('empty deck waits for first Burn Out provider and intervention; fixed points end the match', () => {
  const f = fixture({ both: false, scoreA: 7, deplete: 'empty' });
  let step = f.pass(f.pass(f.start(), 'a'), 'b');
  const scored = step.match;
  const first = f.services.firstBurnout;
  step = f.cont(step);
  assert.equal(step.status, 'pending');
  assert.equal(step.reason, 'first-burnout-pending');
  assert.strictEqual(step.match, scored);
  f.services.firstBurnout = undefined;
  const old = step;
  step = f.cont(step);
  assert.equal(step.status, 'pending');
  assert.strictEqual(step.match, scored);
  assert.throws(() => f.cont(old), /consumed/);
  f.services.firstBurnout = first;
  step = f.cont(step);
  assert.equal(step.reason, 'burnout-intervention-pending');
  assert.equal(step.match.scoring.players[1].points, 1);
  assert.equal(step.match.stateVersion, scored.stateVersion + 1);
  const intervention = f.services.intervention;
  f.services.intervention = undefined;
  const afterFirst = step.match;
  step = f.cont(step);
  assert.equal(step.status, 'pending');
  assert.strictEqual(step.match, afterFirst);
  f.services.intervention = intervention;
  for (let point = 2; point <= 8; point++) {
    const before = step.match;
    step = f.cont(step);
    assert.equal(step.match.scoring.players[1].points, point);
    assert.equal(step.match.stateVersion, before.stateVersion + 1);
    assert.equal(step.match.eventSeq, before.eventSeq + 1);
    assert.equal(inspectDuelNativeCommitPathV2(before, step.match).length, 1);
    if (point < 8) assert.equal(step.reason, 'burnout-intervention-pending');
  }
  assert.equal(step.status, 'complete');
  assert.equal(step.winnerPlayerId, 'b');
  assert.equal(step.match.frame.phase, 'ended');
  assert.equal(step.match.scoring.players[0].points, 7);
});

test('Recycle has an ordered Core trace and resumes one Draw after first point cleanup', () => {
  const f = fixture({ both: false, scoreA: 7, deplete: 'trash' });
  let step = f.pass(f.pass(f.start(), 'a'), 'b');
  const scored = step.match;
  const recycled = scored.players[0].trash.map(card => card.uid);
  step = f.cont(step);
  assert.equal(step.reason, 'first-burnout-pending');
  assert.deepEqual(inspectDuelNativeCommitPathV2(scored, step.match)[0].transitions,
    recycled.map(uid => ({ uid, from: { kind: 'trash', zonePlayerId: 'a' },
      to: { kind: 'main-deck', zonePlayerId: 'a' } })));
  const afterRecycle = step.match;
  const top = afterRecycle.players[0].remainingMainDeck[0].uid;
  step = f.cont(step);
  assert.equal(step.match.scoring.players[1].points, 1);
  step = f.cont(step);
  assert.equal(step.cursor.phase, 'after-result');
  assert.equal(step.match.players[0].hand.at(-1).uid, top);
  step = f.cont(step);
  assert.equal(step.status, 'complete');
});

test('callback head drift blocks Draw without consuming the current continuation', () => {
  const f = fixture({ both: false, scoreA: 7 });
  let step = f.pass(f.pass(f.start(), 'a'), 'b');
  const scored = step.match;
  const source = f.services.sourceDraw;
  f.services.sourceDraw = request => {
    f.setHead(commitDuelPlayingMutationV2(request.match, draft => ({ match: { ...draft,
      frame: { ...draft.frame, priorityPlayerId: 'b' } }, transitions: [] })));
    return source(request);
  };
  assert.throws(() => f.cont(step), /stale-head/);
  f.setHead(scored);
  f.services.sourceDraw = source;
  step = f.cont(step);
  assert.equal(step.cursor.phase, 'after-result');
});
