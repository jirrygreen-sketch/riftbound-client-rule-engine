import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelMatch, resolveDuelMulligan } from '../dist/duel/match-state.js';
import { runDuelStartOfTurn } from '../dist/duel/turn-flow.js';
import { runDuelEndOfTurn, resumeDuelEndOfTurn } from '../dist/duel/ending.js';
import { activateBasicRuneEnergy, activateBasicRunePower, channelDuelRunes } from '../dist/duel/resources.js';
import { materializeDuelUnitFromSettledSource, recordResolvedDuelDamage } from '../dist/duel/unit-lifecycle.js';
import { commitDuelPlayingMutation } from '../dist/duel/canonical-transaction.js';
const clone = value => JSON.parse(JSON.stringify(value));
const seats = ['alice', 'bob'].map(playerId => ({ playerId,
  mainDeck: Array.from({ length: 9 }, (_, index) => ({ uid: `${playerId}:main:${index}`, cardId: `unit:${playerId}:${index}` })),
  champion: { uid: `${playerId}:champion`, cardId: `champion:${playerId}` },
  legend: { uid: `${playerId}:legend`, cardId: `legend:${playerId}` },
  runeDeck: Array.from({ length: 7 }, (_, index) => ({ uid: `${playerId}:rune:${index}`, cardId: `rune:${index}`,
    domain: index % 2 ? 'Calm' : 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, index) => ({ instanceId: `${playerId}:bf:${index}`, cardId: `bf:${index}` })),
}));
const metadata = { matchId: 'ending-suite', dataVersion: 'v1', catalogDigest: 'fixture',
  roster: ['alice', 'bob'].map(playerId => ({ playerId, displayName: playerId })) };
const certified = () => ({ status: 'verified-no-effect' });
function startServices(extra = {}) {
  return { readiness: () => ({ status: 'ready', unitUIDs: [], runeUIDs: [], goldUIDs: [] }),
    otherPermanents: certified, beginningEffects: certified, holdEffects: certified,
    channelEffects: certified, drawEffects: certified, mainEffects: certified, ...extra };
}
function endingServices(extra = {}) {
  return { endingEffects: certified, requiredCleanup: certified,
    simultaneousThisTurnExpiration: certified, remainingCleanup: certified, fepr: certified,
    ...extra };
}
function started() {
  let match = createDuelMatch(seats, metadata, () => 0);
  for (const actor of match.turnOrder) match = resolveDuelMulligan(match, actor, []);
  assert.equal(match.frame.phase, 'awaiting-turn-start');
  const main = runDuelStartOfTurn({ match, receipts: [] }, startServices());
  assert.equal(main.status, 'main', main.reason);
  return main.session;
}
const actor = session => session.match.frame.turnPlayerId;
const other = session => session.match.turnOrder.find(player => player !== actor(session));
function addUnit(match, owner, controller, uid, locationId) {
  return commitDuelPlayingMutation(match, draft => materializeDuelUnitFromSettledSource(draft, {
    kind: 'token', uid, unitType: 'Unit', name: 'fixture token', baseMight: 3, tags: [],
    ownerPlayerId: owner, controllerPlayerId: controller, locationId,
  }, () => true));
}
function mark(match, uid, amount = 1) {
  return commitDuelPlayingMutation(match, draft => recordResolvedDuelDamage(draft, uid,
    { amount, responsiblePlayerId: draft.turnOrder[0], sourceObjectIds: ['damage:fixture'] }));
}
const pool = (match, playerId) => match.resources.players.find(seat => seat.playerId === playerId).runePool;
const empty = pool => pool.energy === 0 && Object.values(pool.power).every(value => value === 0);
const readyEnding = session => runDuelEndOfTurn(session, actor(session), endingServices());

test('actual constructor + 83 Main => Ending => next actual start; two clocks, both rune pools, first-Channel fact', () => {
  const initial = started();
  const turnPlayer = actor(initial), nextPlayer = other(initial);
  let match = commitDuelPlayingMutation(initial.match, draft => ({ ...draft,
    resources: channelDuelRunes(draft.resources, nextPlayer, 2) }));
  match = commitDuelPlayingMutation(match, draft => {
    const own = draft.resources.bases.find(base => base.playerId === turnPlayer).baseRunes;
    const their = draft.resources.bases.find(base => base.playerId === nextPlayer).baseRunes;
    const timing = { stateOpen: true, priorityPlayerId: turnPlayer, resourcePaymentPlayerId: null };
    let resources = activateBasicRuneEnergy(draft.resources, turnPlayer, own[0].uid, timing);
    resources = activateBasicRunePower(resources, turnPlayer, own[1].uid, timing);
    resources = activateBasicRuneEnergy(resources, nextPlayer, their[0].uid,
      { stateOpen: true, priorityPlayerId: nextPlayer, resourcePaymentPlayerId: null });
    return { ...draft, resources };
  });
  const charged = { ...initial, match };
  assert.equal(pool(match, turnPlayer).energy, 1);
  assert.equal(pool(match, turnPlayer).power.Fury, 1);
  assert.equal(pool(match, nextPlayer).energy, 1);
  let witnessedEnding = false, witnessedExpiration = false;
  const result = runDuelEndOfTurn(charged, turnPlayer, endingServices({
    endingEffects: ctx => { witnessedEnding = ctx.match.frame.phase === 'ending'; return certified(); },
    simultaneousThisTurnExpiration: ctx => {
      witnessedExpiration = ctx.match.frame.phase === 'expiration';
      assert.equal(pool(ctx.match, turnPlayer).energy, 1);
      assert.equal(pool(ctx.match, nextPlayer).energy, 1);
      return certified();
    },
  }));
  assert.equal(result.status, 'awaiting-turn-start', result.reason);
  assert.equal(witnessedEnding && witnessedExpiration, true);
  assert.equal(result.session.match.frame.phase, 'awaiting-turn-start');
  assert.equal(result.session.match.frame.turnNumber, 2);
  assert.equal(result.session.match.frame.turnPlayerId, nextPlayer);
  assert.equal(result.session.match.scoring.turnNumber, 1);
  assert.equal(empty(pool(result.session.match, turnPlayer)), true);
  assert.equal(empty(pool(result.session.match, nextPlayer)), true);
  assert.equal(result.session.match.stateVersion - match.stateVersion,
    result.session.match.eventSeq - match.eventSeq);
  assert.equal(result.session.turnFlow.step, 'main');
  const next = runDuelStartOfTurn(result.session, startServices());
  assert.equal(next.status, 'main', next.reason);
  assert.equal(next.session.match.frame.turnNumber, 2);
  assert.equal(next.session.match.scoring.turnNumber, 2);
  assert.deepEqual(next.session.turnFlow.firstChannelProcessedPlayerIDs, [nextPlayer]);
  assert.equal(next.session.match.resources.bases.find(base => base.playerId === nextPlayer).baseRunes.length, 5);
});

test('wrong actor, fake Main cursor, closed state, payment, required task and engagement reject without mutation', () => {
  const initial = started();
  const expectRejected = (session, who, reason) => {
    const before = JSON.stringify(session);
    const result = runDuelEndOfTurn(session, who, endingServices());
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, reason);
    assert.strictEqual(result.session, session);
    assert.equal(result.persistRequired, false);
    assert.equal(JSON.stringify(session), before);
  };
  expectRejected(initial, other(initial), 'invalid-phase');
  expectRejected({ ...initial, turnFlow: undefined }, actor(initial), 'invalid-session');
  expectRejected({ ...initial, match: { ...initial.match, frame: { ...initial.match.frame, stateOpen: false } } }, actor(initial), 'invalid-phase');
  const pending = { paymentId: 'payment:fixture', actor: actor(initial), resolvedCost: { energy: 1, power: [] },
    sourceReference: { kind: 'effect', referenceId: 'fixture' } };
  expectRejected({ ...initial, match: { ...initial.match,
    frame: { ...initial.match.frame, pendingPayment: pending } } }, actor(initial), 'invalid-phase');
  expectRejected({ ...initial, requiredTasks: [{ status: 'active' }] }, actor(initial), 'task-conflict');
  const field = initial.match.board.battlefields[0];
  const contested = { ...field, contested: true, contestingPlayerId: other(initial), showdown: 'staged' };
  expectRejected({ ...initial, match: { ...initial.match, board: { ...initial.match.board,
    battlefields: initial.match.board.battlefields.map(item => item === field ? contested : item) } } },
  actor(initial), 'engagement-in-progress');
});

test('missing actual ending-effects provider pends at real Ending phase and resumes once', () => {
  const initial = started();
  const pending = runDuelEndOfTurn(initial, actor(initial), endingServices({ endingEffects: undefined }));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.pending.kind, 'ending-effects');
  assert.equal(pending.session.match.frame.phase, 'ending');
  assert.equal(pending.session.match.frame.priorityPlayerId, null);
  assert.equal(pending.session.match.stateVersion, initial.match.stateVersion + 1);
  const resumed = resumeDuelEndOfTurn(pending.session, pending.pending.taskId,
    certified(), endingServices());
  assert.equal(resumed.status, 'awaiting-turn-start', resumed.reason);
  assert.equal(resumed.session.match.frame.turnNumber, 2);
  const duplicate = resumeDuelEndOfTurn(resumed.session, pending.pending.taskId,
    { status: 'applied', match: null }, endingServices());
  assert.equal(duplicate.status, 'duplicate');
  assert.strictEqual(duplicate.session, resumed.session);
  assert.equal(duplicate.persistRequired, false);
});

test('wrong task, malformed resolution, duplicate current task and JSON scalar sidecar retain latest state', () => {
  const initial = started();
  let actual = runDuelEndOfTurn(initial, actor(initial), endingServices({ requiredCleanup: undefined }));
  assert.equal(actual.status, 'pending');
  assert.equal(actual.pending.kind, 'required-cleanup');
  assert.equal(actual.session.match.frame.phase, 'expiration');
  const before = JSON.stringify(actual.session);
  const wrong = resumeDuelEndOfTurn(actual.session, actual.pending.taskId + ':other', certified(), endingServices());
  assert.equal(wrong.status, 'rejected');
  assert.strictEqual(wrong.session, actual.session);
  const invalid = resumeDuelEndOfTurn(actual.session, actual.pending.taskId,
    { status: 'applied', match: actual.session.match }, endingServices());
  assert.equal(invalid.status, 'rejected');
  assert.strictEqual(invalid.session, actual.session);
  assert.equal(JSON.stringify(actual.session), before);
  assert.deepEqual(Object.keys(actual.session.endingProgress).sort(),
    ['kind', 'turn', 'rootTaskID', 'step', 'expirationIteration', 'cleanupRound', 'cleanupChanged',
      'feprProcessed', 'pendingTaskID', 'consumedIDs', 'stateVersion', 'eventSeq'].sort());
  assert.equal(JSON.stringify(actual.session.endingProgress).includes('runePool'), false);
  actual = resumeDuelEndOfTurn(clone(actual.session), actual.pending.taskId,
    certified(), endingServices({ simultaneousThisTurnExpiration: undefined }));
  assert.equal(actual.status, 'pending');
  assert.equal(actual.pending.kind, 'simultaneous-this-turn-expiration');
  const same = resumeDuelEndOfTurn(actual.session,
    `${actual.session.endingProgress.rootTaskID}:expiration-0:cleanup-0:special-designations`,
    { status: 'applied', match: null }, endingServices());
  assert.equal(same.status, 'duplicate');
  assert.strictEqual(same.session, actual.session);
  const done = resumeDuelEndOfTurn(clone(actual.session), actual.pending.taskId,
    certified(), endingServices());
  assert.equal(done.status, 'awaiting-turn-start', done.reason);
});

test('323.3a prekill snapshot occurs before healing; real 323.3b lethal card goes to owner Trash', () => {
  const initial = started();
  const owner = other(initial), controller = actor(initial);
  const ownBase = initial.match.board.bases.find(base => base.ownerPlayerId === controller).locationId;
  const card = initial.match.players.find(player => player.playerId === owner).hand[0];
  let match = commitDuelPlayingMutation(initial.match, draft => {
    const players = draft.players.map(player => player.playerId === owner
      ? { ...player, hand: player.hand.filter(item => item.uid !== card.uid) } : player);
    return materializeDuelUnitFromSettledSource({ ...draft, players }, {
      kind: 'card', uid: card.uid, cardId: card.cardId, cardType: 'Unit', ownerPlayerId: owner,
      controllerPlayerId: controller, locationId: ownBase,
    }, () => true);
  });
  match = mark(match, card.uid, 3);
  const observed = [];
  const services = endingServices({
    lethalEvaluators: { currentMight: unit => { assert.equal(unit.trait.kind, 'card'); return 3; },
      lethalDamageThreshold: (_unit, might) => might },
    lethalKillApproval: ctx => { observed.push({ plan: ctx.plan, damage: ctx.match.unitMeta[card.uid].damageMarks });
      return { status: 'approved', approvedUnitUIDs: [card.uid] }; },
    simultaneousThisTurnExpiration: ctx => {
      assert.equal(ctx.match.board.units.length, 0);
      assert.equal(ctx.match.players.find(player => player.playerId === owner).trash.some(item => item.uid === card.uid), true);
      return certified();
    },
  });
  const done = runDuelEndOfTurn({ ...initial, match }, controller, services);
  assert.equal(done.status, 'awaiting-turn-start', done.reason);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].plan.snapshots[0].totalDamage, 3);
  assert.equal(observed[0].damage[0].amount, 3);
  assert.equal(done.session.match.board.units.length, 0);
  assert.equal(done.session.match.players.find(player => player.playerId === owner).trash.some(item => item.uid === card.uid), true);
  assert.equal(done.session.match.stateVersion - match.stateVersion,
    done.session.match.eventSeq - match.eventSeq);
});

test('nonlethal real unit heals all damage; unknown Might requires pending instead of guessing printed value', () => {
  const initial = started(), owner = actor(initial);
  const base = initial.match.board.bases.find(item => item.ownerPlayerId === owner).locationId;
  const match = mark(addUnit(initial.match, owner, owner, 'token:survivor', base), 'token:survivor', 2);
  const pending = runDuelEndOfTurn({ ...initial, match }, owner, endingServices());
  assert.equal(pending.status, 'pending');
  assert.equal(pending.pending.kind, 'lethal-kill');
  assert.equal(pending.session.match.unitMeta['token:survivor'].damageMarks.length, 1);
  const services = endingServices({ lethalEvaluators: { currentMight: () => 3,
    lethalDamageThreshold: (_unit, might) => might } });
  const done = resumeDuelEndOfTurn(pending.session, pending.pending.taskId,
    { status: 'verified-no-effect' }, services);
  assert.equal(done.status, 'awaiting-turn-start', done.reason);
  assert.deepEqual(done.session.match.unitMeta['token:survivor'].damageMarks, []);
  assert.equal(done.session.match.board.units.some(unit => unit.objectId === 'token:survivor'), true);
});

test('expiration effect mutation invokes ordinary cleanup only, no repeat of special Heal', () => {
  const initial = started();
  const base = initial.match.board.bases.find(item => item.ownerPlayerId === actor(initial)).locationId;
  const match = addUnit(initial.match, actor(initial), actor(initial), 'token:expiry', base);
  const sequence = [];
  const services = endingServices({
    lethalEvaluators: { currentMight: () => 3, lethalDamageThreshold: (_, might) => might },
    requiredCleanup: ctx => { sequence.push(`${ctx.cleanupKind}:designation:${ctx.cleanupRound}`); return certified(); },
    simultaneousThisTurnExpiration: ctx => {
      sequence.push('expire');
      const changed = commitDuelPlayingMutation(ctx.match, draft => recordResolvedDuelDamage(draft,
        'token:expiry', { amount: 1, responsiblePlayerId: actor(initial), sourceObjectIds: ['expiry:fixture'] }));
      return { status: 'applied', match: { ...changed,
        stateVersion: ctx.match.stateVersion, eventSeq: ctx.match.eventSeq } };
    },
    remainingCleanup: ctx => { sequence.push(`${ctx.cleanupKind}:remaining:${ctx.cleanupRound}`);
      if (ctx.cleanupKind === 'ordinary') assert.equal(ctx.match.unitMeta['token:expiry'].damageMarks.length, 1);
      return certified(); },
    fepr: ctx => { sequence.push(`${ctx.cleanupKind}:fepr:${ctx.cleanupRound}`); return certified(); },
  });
  const done = runDuelEndOfTurn({ ...initial, match }, actor(initial), services);
  assert.equal(done.status, 'awaiting-turn-start', done.reason);
  assert.deepEqual(sequence, [
    'special:designation:0', 'expire', 'special:remaining:0',
    'ordinary:designation:1', 'ordinary:remaining:1', 'ordinary:fepr:1',
  ]);
  assert.equal(done.session.match.unitMeta['token:expiry'].damageMarks.length, 1,
    'ordinary cleanup cannot re-heal damage introduced by expiry');
});

test('FEPR processing a real changed aggregate replays special Expiration, not Ending effects', () => {
  const initial = started();
  let endings = 0, expirations = 0, feprs = 0;
  const done = runDuelEndOfTurn(initial, actor(initial), endingServices({
    endingEffects: () => { endings++; return certified(); },
    simultaneousThisTurnExpiration: () => { expirations++; return certified(); },
    fepr: ctx => {
      feprs++;
      if (feprs > 1) return certified();
      const current = ctx.match;
      const resources = channelDuelRunes(current.resources, current.frame.turnPlayerId, 1);
      return { status: 'processed', match: { ...current, resources } };
    },
  }));
  assert.equal(done.status, 'awaiting-turn-start', done.reason);
  assert.equal(endings, 1);
  assert.equal(expirations, 2);
  assert.equal(feprs, 3, 'a processed FEPR item triggers ordinary cleanup before replay');
  assert.equal(done.session.endingProgress.expirationIteration, 1);
  assert.equal(done.session.match.stateVersion - initial.match.stateVersion,
    done.session.match.eventSeq - initial.match.eventSeq);
});

test('FEPR processed after ordinary cleanup replays Expiration; no extra ordinary Heal', () => {
  const initial = started();
  const base = initial.match.board.bases.find(item => item.ownerPlayerId === actor(initial)).locationId;
  const match = addUnit(initial.match, actor(initial), actor(initial), 'token:fepr', base);
  let expires = 0, ordinary = 0, fepr = 0;
  const done = runDuelEndOfTurn({ ...initial, match }, actor(initial), endingServices({
    lethalEvaluators: { currentMight: () => 5, lethalDamageThreshold: (_, might) => might },
    simultaneousThisTurnExpiration: ctx => {
      expires++;
      if (expires !== 1) return certified();
      const proposed = commitDuelPlayingMutation(ctx.match, draft => recordResolvedDuelDamage(draft,
        'token:fepr', { amount: 1, responsiblePlayerId: actor(initial), sourceObjectIds: ['expiry:fepr'] }));
      return { status: 'applied', match: { ...proposed,
        stateVersion: ctx.match.stateVersion, eventSeq: ctx.match.eventSeq } };
    },
    requiredCleanup: ctx => { if (ctx.cleanupKind === 'ordinary') ordinary++; return certified(); },
    fepr: ctx => {
      fepr++;
      if (ctx.cleanupKind === 'ordinary' && fepr === 1) {
        assert.equal(ctx.match.unitMeta['token:fepr'].damageMarks.length, 1);
        return { status: 'processed', match: { ...ctx.match,
          resources: channelDuelRunes(ctx.match.resources, ctx.turnPlayerId, 1) } };
      }
      return certified();
    },
  }));
  assert.equal(done.status, 'awaiting-turn-start', done.reason);
  assert.equal(expires, 2);
  assert.equal(ordinary, 3, 'FEPR mutation itself invokes the next ordinary cleanup before replay');
  assert.equal(fepr, 3);
  assert.equal(done.session.endingProgress.expirationIteration, 1);
  assert.deepEqual(done.session.match.unitMeta['token:fepr'].damageMarks, []);
});

test('provider throw, boolean applied and wrong aggregate reject atomically; clocks do not double count', () => {
  const initial = started();
  const before = JSON.stringify(initial);
  const fail = provider => {
    const result = runDuelEndOfTurn(initial, actor(initial), endingServices({ endingEffects: provider }));
    assert.equal(result.status, 'rejected');
    assert.strictEqual(result.session, initial);
    assert.equal(result.persistRequired, false);
    assert.equal(JSON.stringify(initial), before);
  };
  fail(() => { throw Error('fixture provider failed'); });
  fail(() => ({ status: 'applied', changed: true }));
  fail(ctx => ({ status: 'applied', match: { ...ctx.match,
    frame: { ...ctx.match.frame, turnNumber: ctx.match.frame.turnNumber + 1 } } }));
  fail(ctx => ({ status: 'applied', match: ctx.match }));
  const applied = runDuelEndOfTurn(initial, actor(initial), endingServices({
    endingEffects: ctx => ({ status: 'applied', match: { ...ctx.match,
      resources: channelDuelRunes(ctx.match.resources, ctx.turnPlayerId, 1) } }),
  }));
  assert.equal(applied.status, 'awaiting-turn-start', applied.reason);
  assert.equal(applied.session.match.stateVersion - initial.match.stateVersion,
    applied.session.match.eventSeq - initial.match.eventSeq);
});

test('323.1 winner ends match before cleanup hooks; overflow and unknown providers do not advance', () => {
  const initial = started();
  const match = commitDuelPlayingMutation(initial.match, draft => ({ ...draft,
    scoring: { ...draft.scoring, players: draft.scoring.players.map(seat => seat.playerId === draft.frame.turnPlayerId
      ? { ...seat, points: draft.scoring.victoryScore } : seat) } }));
  const won = runDuelEndOfTurn({ ...initial, match }, actor(initial), endingServices({
    requiredCleanup: () => { throw Error('must not run after win'); },
  }));
  assert.equal(won.status, 'ended', won.reason);
  assert.equal(won.session.match.frame.phase, 'ended');
  const missing = runDuelEndOfTurn(initial, actor(initial), {});
  assert.equal(missing.status, 'pending');
  assert.equal(missing.pending.kind, 'ending-effects');
  const afterEnding = runDuelEndOfTurn(initial, actor(initial), endingServices({ requiredCleanup: undefined }));
  assert.equal(afterEnding.status, 'pending');
  assert.equal(afterEnding.pending.kind, 'required-cleanup');
  const overflow = { ...initial, match: { ...initial.match,
    frame: { ...initial.match.frame, turnNumber: Number.MAX_SAFE_INTEGER },
    scoring: { ...initial.match.scoring, turnNumber: Number.MAX_SAFE_INTEGER },
    stateVersion: Number.MAX_SAFE_INTEGER - 4,
    eventSeq: Number.MAX_SAFE_INTEGER - 4 },
    turnProgress: undefined,
    turnFlow: { ...initial.turnFlow, turn: Number.MAX_SAFE_INTEGER,
      rootTaskID: `duel-turn-start:${initial.match.matchId}:turn-${Number.MAX_SAFE_INTEGER}`,
      consumedIDs: ['channel-effects', 'draw-effects', 'main-effects'].map(name =>
        `duel-turn-start:${initial.match.matchId}:turn-${Number.MAX_SAFE_INTEGER}:flow:${name}`) } };
  const before = JSON.stringify(overflow);
  const blocked = readyEnding(overflow);
  assert.equal(blocked.status, 'rejected');
  assert.strictEqual(blocked.session, overflow);
  assert.equal(JSON.stringify(overflow), before);
});

test('pending after multiple committed steps exposes latest session, never the original or synthetic Main', () => {
  const initial = started();
  const pending = runDuelEndOfTurn(initial, actor(initial), endingServices({ remainingCleanup: undefined }));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.pending.kind, 'remaining-cleanup');
  assert.equal(pending.session.match.frame.phase, 'expiration');
  assert.notStrictEqual(pending.session, initial);
  assert.equal(pending.session.match.stateVersion > initial.match.stateVersion, true);
  const duplicate = resumeDuelEndOfTurn(pending.session,
    `${pending.session.endingProgress.rootTaskID}:expiration-0:cleanup-0:special-designations`,
    certified(), endingServices());
  assert.equal(duplicate.status, 'duplicate');
  assert.strictEqual(duplicate.session, pending.session);
  const end = resumeDuelEndOfTurn(clone(pending.session), pending.pending.taskId,
    certified(), endingServices());
  assert.equal(end.status, 'awaiting-turn-start', end.reason);
});

test('actual constructor + both mulligans + four 83/88 turns: exactly-one advance, rune 3 then 2 and pool clearing', () => {
  let session = started();
  const first = actor(session), second = other(session);
  for (let turn = 1; turn <= 3; turn++) {
    assert.equal(session.match.frame.turnNumber, turn);
    assert.equal(actor(session), turn % 2 ? first : second);
    const runes = session.match.resources.bases.find(base => base.playerId === actor(session)).baseRunes;
    assert.equal(runes.length, turn === 1 ? 2 : turn === 2 ? 3 : 4);
    const readyRune = runes.find(rune => rune.readied);
    assert.ok(readyRune);
    session = { ...session, match: commitDuelPlayingMutation(session.match, draft => ({ ...draft,
      resources: activateBasicRuneEnergy(draft.resources, actor(session), readyRune.uid,
        { stateOpen: true, priorityPlayerId: actor(session), resourcePaymentPlayerId: null }) })) };
    const ending = readyEnding(session);
    assert.equal(ending.status, 'awaiting-turn-start', ending.reason);
    assert.equal(ending.session.match.frame.turnNumber, turn + 1);
    assert.equal(actor(ending.session), turn % 2 ? second : first);
    assert.equal(ending.session.match.scoring.turnNumber, turn);
    assert.equal(ending.session.match.stateVersion - session.match.stateVersion,
      ending.session.match.eventSeq - session.match.eventSeq);
    for (const player of ending.session.match.turnOrder)
      assert.equal(empty(pool(ending.session.match, player)), true);
    const next = runDuelStartOfTurn(clone(ending.session), startServices());
    assert.equal(next.status, 'main', next.reason);
    assert.equal(next.session.match.frame.turnNumber, turn + 1);
    assert.equal(next.session.match.scoring.turnNumber, turn + 1);
    assert.equal(next.session.match.stateVersion - ending.session.match.stateVersion,
      next.session.match.eventSeq - ending.session.match.eventSeq);
    assert.deepEqual(next.session.turnFlow.firstChannelProcessedPlayerIDs,
      turn === 1 ? [second] : [second]);
    assert.equal(next.session.match.resources.bases.find(base => base.playerId === actor(next.session)).baseRunes.length,
      turn === 1 ? 3 : turn === 2 ? 4 : 5);
    session = next.session;
  }
  assert.equal(session.match.frame.turnNumber, 4);
  assert.equal(session.priorEndingTurns.length, 2);
  assert.deepEqual(session.priorEndingTurns.map(entry => entry.turn), [1, 2]);
});

test('old completed task IDs return latest duplicate after replacement, even while new Ending is pending', () => {
  const initial = started();
  const old = runDuelEndOfTurn(initial, actor(initial), endingServices({ endingEffects: undefined }));
  assert.equal(old.status, 'pending');
  const end1 = resumeDuelEndOfTurn(clone(old.session), old.pending.taskId, certified(), endingServices());
  assert.equal(end1.status, 'awaiting-turn-start', end1.reason);
  const start2 = runDuelStartOfTurn(clone(end1.session), startServices());
  assert.equal(start2.status, 'main', start2.reason);
  let providerCalls = 0;
  const hooks = endingServices({ endingEffects: () => { providerCalls++; return { status: 'pending' }; } });
  const pending = runDuelEndOfTurn(start2.session, actor(start2.session), hooks);
  assert.equal(pending.status, 'pending', pending.reason);
  assert.equal(pending.pending.turn, 2);
  assert.notEqual(pending.pending.taskId, old.pending.taskId);
  assert.equal(providerCalls, 1);
  assert.equal(pending.session.priorEndingTurns.length, 1);
  assert.equal(pending.session.priorEndingTurns[0].turn, 1);
  assert.deepEqual(pending.session.priorEndingTurns[0].consumedIDs, end1.session.endingProgress.consumedIDs);
  assert.equal(JSON.stringify(pending.session.priorEndingTurns).includes('runePool'), false);
  const saved = JSON.stringify(pending.session), clocks = [pending.session.match.stateVersion, pending.session.match.eventSeq];
  const duplicate = resumeDuelEndOfTurn(pending.session, old.pending.taskId,
    { status: 'applied', match: null }, hooks);
  assert.equal(duplicate.status, 'duplicate');
  assert.strictEqual(duplicate.session, pending.session);
  assert.equal(duplicate.persistRequired, false);
  assert.deepEqual([pending.session.match.stateVersion, pending.session.match.eventSeq], clocks);
  assert.equal(providerCalls, 1);
  assert.equal(JSON.stringify(pending.session), saved);
  const unknown = resumeDuelEndOfTurn(pending.session, `${old.pending.taskId}:unknown`, certified(), hooks);
  assert.equal(unknown.status, 'rejected');
  assert.equal(unknown.reason, 'wrong-task');
  assert.strictEqual(unknown.session, pending.session);
  const restart = runDuelEndOfTurn(pending.session, actor(pending.session), hooks);
  assert.equal(restart.status, 'rejected');
  assert.equal(restart.reason, 'task-conflict');
  assert.equal(JSON.stringify(pending.session), saved);
  const end2 = resumeDuelEndOfTurn(clone(pending.session), pending.pending.taskId,
    certified(), endingServices());
  assert.equal(end2.status, 'awaiting-turn-start', end2.reason);
  const start3 = runDuelStartOfTurn(end2.session, startServices());
  assert.equal(start3.status, 'main', start3.reason);
  const postStart = resumeDuelEndOfTurn(start3.session, old.pending.taskId,
    { status: 'applied', match: null }, hooks);
  assert.equal(postStart.status, 'duplicate');
  assert.strictEqual(postStart.session, start3.session);
  assert.equal(providerCalls, 1);
  assert.equal(start3.session.match.frame.turnNumber, 3);
});

test('prior terminal root/turn/history/clocks, Main proof, cross-match and safe overflow reject atomically', () => {
  const end1 = readyEnding(started());
  assert.equal(end1.status, 'awaiting-turn-start');
  const start2 = runDuelStartOfTurn(end1.session, startServices());
  assert.equal(start2.status, 'main', start2.reason);
  const original = start2.session;
  const old = original.endingProgress;
  const rejectWithoutMutation = (session, reason) => {
    const bytes = JSON.stringify(session);
    const attempt = readyEnding(session);
    assert.equal(attempt.status, 'rejected');
    if (reason) assert.equal(attempt.reason, reason);
    assert.strictEqual(attempt.session, session);
    assert.equal(attempt.persistRequired, false);
    assert.equal(JSON.stringify(session), bytes);
  };
  const changeOld = fields => ({ ...original, endingProgress: { ...old, ...fields } });
  rejectWithoutMutation(changeOld({ turn: 2 }));
  rejectWithoutMutation(changeOld({ rootTaskID: `${old.rootTaskID}:foreign` }));
  rejectWithoutMutation(changeOld({ consumedIDs: [...old.consumedIDs.slice(0, -1), 'fake-task'] }));
  rejectWithoutMutation(changeOld({ stateVersion: original.match.stateVersion + 1 }));
  rejectWithoutMutation(changeOld({ eventSeq: original.match.eventSeq + 1 }));
  rejectWithoutMutation({ ...original, match: { ...original.match,
    stateVersion: old.stateVersion, eventSeq: old.eventSeq } });
  rejectWithoutMutation(changeOld({ pendingTaskID: `${old.rootTaskID}:unfinished` }));
  rejectWithoutMutation(changeOld({ step: 'special-fepr' }));
  rejectWithoutMutation({ ...original, match: { ...original.match,
    frame: { ...original.match.frame, phase: 'awaiting-turn-start' } } });
  rejectWithoutMutation({ ...original, turnFlow: { ...original.turnFlow, step: 'channel-effects' } });
  rejectWithoutMutation({ ...original, turnProgress: { ...original.turnProgress,
    consumedIDs: original.turnProgress.consumedIDs.slice(0, -1) } }, 'task-conflict');
  rejectWithoutMutation({ ...original, turnProgress: undefined }, 'task-conflict');
  rejectWithoutMutation({ ...original, match: { ...original.match, matchId: 'other-match' } });
  rejectWithoutMutation(changeOld({ turn: Number.MAX_SAFE_INTEGER }));
  rejectWithoutMutation({ ...original, match: { ...original.match,
    frame: { ...original.match.frame, turnNumber: Number.MAX_SAFE_INTEGER },
    scoring: { ...original.match.scoring, turnNumber: Number.MAX_SAFE_INTEGER } } });
  const awaitingReplay = readyEnding(end1.session);
  rejectWithoutMutation(end1.session, 'invalid-phase');
  assert.equal(awaitingReplay.status, 'rejected');
  assert.equal(JSON.stringify(original), JSON.stringify(start2.session));
});
