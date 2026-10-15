import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelMatch, resolveDuelMulligan } from '../dist/duel/match-state.js';
import { runDuelStartOfTurn, resumeDuelStartOfTurn } from '../dist/duel/turn-flow.js';
import { commitDuelPlayingMutation } from '../dist/duel/canonical-transaction.js';
import { activateBasicRuneEnergy, activateBasicRunePower, channelDuelRunes } from '../dist/duel/resources.js';
import { materializeDuelUnitFromSettledSource } from '../dist/duel/unit-lifecycle.js';
import { placeDuelUnit, applyOpenDuelCleanup, beginDuelShowdown,
  endDuelNonCombatShowdown } from '../dist/duel/battlefields.js';
import { scoreDuelBattlefield } from '../dist/duel/scoring.js';

const clone = input => JSON.parse(JSON.stringify(input));
const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}:main:${i}`, cardId: `unit:${i}` })),
  champion: { uid: `${playerId}:champion`, cardId: `champion:${playerId}` },
  legend: { uid: `${playerId}:legend`, cardId: `legend:${playerId}` },
  runeDeck: Array.from({ length: 5 }, (_, i) => ({ uid: `${playerId}:rune:${i}`,
    cardId: `rune:${i}`, domain: i % 2 ? 'Calm' : 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}:bf:${i}`, cardId: `bf:${i}` })),
}));
const metadata = { matchId: 'flow-test', dataVersion: 'v1', catalogDigest: 'fixture',
  roster: ['alice', 'bob'].map(playerId => ({ playerId, displayName: playerId })) };
function setup() {
  let match = createDuelMatch(seats, metadata, () => 0);
  for (const actor of match.turnOrder) match = resolveDuelMulligan(match, actor, []);
  assert.equal(match.stage, 'playing');
  assert.equal(match.frame.phase, 'awaiting-turn-start');
  return { match, receipts: [] };
}
function services(extra = {}) {
  // Only this explicit fixture certifies otherwise-unimplemented IR as considered and absent.
  return { readiness: () => ({ status: 'ready', unitUIDs: [], runeUIDs: [], goldUIDs: [] }),
    otherPermanents: () => ({ status: 'verified-no-effect' }),
    beginningEffects: () => ({ status: 'verified-no-effect' }),
    holdEffects: () => ({ status: 'verified-no-effect' }),
    channelEffects: () => ({ status: 'verified-no-effect' }),
    drawEffects: () => ({ status: 'verified-no-effect' }),
    mainEffects: () => ({ status: 'verified-no-effect' }),
    burnoutIntervention: () => ({ status: 'verified-no-effect' }),
    firstBurnout: () => ({ status: 'first-burnout', kind: 'scored' }), ...extra };
}
function player(match, actor = match.frame.turnPlayerId) { return match.players.find(entry => entry.playerId === actor); }
function resources(match, actor = match.frame.turnPlayerId) {
  return match.resources.players.find(entry => entry.playerId === actor);
}
function nextTurn(session, actor) {
  const match = commitDuelPlayingMutation(session.match, draft => ({ ...draft,
    frame: { ...draft.frame, phase: 'awaiting-turn-start', turnNumber: draft.frame.turnNumber + 1,
      turnPlayerId: actor, priorityPlayerId: null, focusPlayerId: null, stateOpen: true, pendingPayment: null } }));
  return { ...session, match };
}
function holdBoard(match) {
  return commitDuelPlayingMutation(match, draft => {
    const actor = draft.frame.turnPlayerId;
    let current = draft;
    for (let i = 0; i < draft.board.battlefields.length; i++) {
      const locationId = draft.board.battlefields[i].locationId;
      const card = player(current).hand[0];
      current = { ...current, players: current.players.map(p => p.playerId === actor
        ? { ...p, hand: p.hand.slice(1) } : p) };
      current = materializeDuelUnitFromSettledSource(current, { kind: 'card',
        uid: card.uid, cardId: card.cardId, cardType: 'Unit', ownerPlayerId: actor,
        controllerPlayerId: actor, locationId }, () => true);
      let board = applyOpenDuelCleanup(current.board);
      board = beginDuelShowdown(board, locationId);
      board = endDuelNonCombatShowdown(board, locationId);
      current = { ...current, board };
    }
    return { ...current, stateVersion: draft.stateVersion };
  });
}

test('both mulligans -> genuine Awaken/Beginning/Channel/Draw/Main: 2 readied Runes, five cards, neutral priority', () => {
  const initial = setup();
  const actor = initial.match.frame.turnPlayerId;
  assert.equal(player(initial.match).hand.length, 4);
  const result = runDuelStartOfTurn(initial, services());
  assert.equal(result.status, 'main', result.reason);
  assert.equal(result.persistRequired, true);
  assert.equal(result.session.match.frame.phase, 'main');
  assert.deepEqual(result.session.match.frame, { phase: 'main', turnNumber: 1, turnPlayerId: actor,
    priorityPlayerId: actor, focusPlayerId: null, stateOpen: true, pendingPayment: null });
  assert.equal(result.session.match.scoring.turnNumber, 1);
  assert.equal(player(result.session.match).hand.length, 5);
  assert.equal(player(result.session.match).remainingMainDeck.length, 3);
  assert.equal(resources(result.session.match).runeDeck.length, 3);
  assert.equal(result.session.match.resources.bases.find(base => base.playerId === actor).baseRunes.length, 2);
  assert.equal(result.session.match.resources.bases.find(base => base.playerId === actor).baseRunes.every(rune => rune.readied), true);
  assert.equal(result.session.match.stateVersion - initial.match.stateVersion,
    result.session.match.eventSeq - initial.match.eventSeq);
  assert.deepEqual(Object.keys(result.session.match.frame).sort(), ['focusPlayerId', 'pendingPayment',
    'phase', 'priorityPlayerId', 'stateOpen', 'turnNumber', 'turnPlayerId']);
  assert.equal(JSON.stringify(result.session.turnFlow).includes('main:0'), false);
});

test('second player first Channel is 3 even on an extra-turn index; later phases 2, deck-short and zero are as possible', () => {
  let latest = runDuelStartOfTurn(setup(), services());
  const second = latest.session.match.turnOrder[1];
  latest = runDuelStartOfTurn(nextTurn(latest.session, second), services());
  assert.equal(latest.status, 'main', latest.reason);
  assert.equal(latest.session.match.resources.bases.find(base => base.playerId === second).baseRunes.length, 3);
  assert.deepEqual(latest.session.turnFlow.firstChannelProcessedPlayerIDs, [second]);
  latest = runDuelStartOfTurn(nextTurn(latest.session, second), services());
  assert.equal(latest.status, 'main', latest.reason);
  assert.equal(latest.session.match.resources.bases.find(base => base.playerId === second).baseRunes.length, 5);
  assert.equal(resources(latest.session.match).runeDeck.length, 0);
  latest = runDuelStartOfTurn(nextTurn(latest.session, second), services());
  assert.equal(latest.status, 'main', latest.reason);
  assert.equal(resources(latest.session.match).runeDeck.length, 0);
  assert.equal(latest.session.match.resources.bases.find(base => base.playerId === second).baseRunes.length, 5);
});

test('two controlled fields Hold once each, required effect pends; resume re-reads latest and does not score twice', () => {
  const initial = setup();
  const staged = { ...initial, match: holdBoard(initial.match) };
  const noHooks = services({ holdEffects: undefined });
  const waiting = runDuelStartOfTurn(staged, noHooks);
  assert.equal(waiting.status, 'pending', waiting.reason);
  assert.equal(waiting.pending.kind, 'hold-effects');
  assert.equal(waiting.session.match.scoring.players.find(p => p.playerId === staged.match.frame.turnPlayerId).points, 1);
  const mismatch = resumeDuelStartOfTurn(waiting.session, 'wrong',
    { status: 'verified-no-effect' }, services());
  assert.equal(mismatch.status, 'rejected');
  assert.strictEqual(mismatch.session, waiting.session);
  const completed = resumeDuelStartOfTurn(waiting.session, waiting.pending.taskId,
    { status: 'verified-no-effect' }, services());
  assert.equal(completed.status, 'main', completed.reason);
  const actor = staged.match.frame.turnPlayerId;
  assert.equal(completed.session.match.scoring.players.find(p => p.playerId === actor).points, 2);
  assert.equal(completed.session.match.scoring.players.find(p => p.playerId === actor).scoredBattlefieldLocationIds.length, 2);
  const duplicate = resumeDuelStartOfTurn(completed.session, waiting.pending.taskId,
    { status: 'applied', match: null }, services());
  assert.equal(duplicate.status, 'duplicate');
  assert.strictEqual(duplicate.session, completed.session);
});

test('Main clears both pools, including unspent Energy/Power, before Main-start hook and priority', () => {
  const start = setup();
  // To exercise the exact clearing order, prepare pools before Main by pausing Draw effects.
  const drawPending = runDuelStartOfTurn(setup(), services({ drawEffects: undefined }));
  assert.equal(drawPending.pending.kind, 'draw-effects');
  const preMain = commitDuelPlayingMutation(drawPending.session.match, match => {
    const actor = match.frame.turnPlayerId;
    const runes = match.resources.bases.find(base => base.playerId === actor).baseRunes;
    const timing = { stateOpen: false, priorityPlayerId: actor, resourcePaymentPlayerId: null };
    return { ...match, resources: activateBasicRunePower(
      activateBasicRuneEnergy(match.resources, actor, runes[0].uid, timing), actor, runes[1].uid, timing) };
  });
  const extra = { ...drawPending.session, match: preMain };
  let observed;
  const cleared = resumeDuelStartOfTurn(extra, drawPending.pending.taskId,
    { status: 'verified-no-effect' }, services({ mainEffects: context => {
      observed = context.match;
      return { status: 'pending' };
    } }));
  assert.equal(cleared.status, 'pending', cleared.reason);
  assert.equal(cleared.pending.kind, 'main-effects');
  assert.equal(resources(cleared.session.match).runePool.energy, 0);
  assert.equal(Object.values(resources(cleared.session.match).runePool.power).every(value => value === 0), true);
  assert.equal(cleared.session.match.frame.priorityPlayerId, null);
  const main = resumeDuelStartOfTurn(cleared.session, cleared.pending.taskId,
    { status: 'verified-no-effect' }, services());
  assert.equal(main.status, 'main', main.reason);
  assert.equal(main.session.match.frame.priorityPlayerId, main.session.match.frame.turnPlayerId);
  assert.equal(observed.frame.priorityPlayerId, null);
  assert.equal(observed.resources.players.every(p => p.runePool.energy === 0), true);
});

test('missing required hooks, malformed applied result and duplicate resume never consume RNG or forge clocks', () => {
  const initial = setup();
  const missing = runDuelStartOfTurn(initial, {});
  assert.equal(missing.status, 'pending');
  assert.equal(missing.pending.kind, 'readiness');
  const wrong = resumeDuelStartOfTurn(missing.session, 'wrong', {}, {});
  assert.equal(wrong.status, 'rejected');
  assert.strictEqual(wrong.session, missing.session);
  const pending = runDuelStartOfTurn(setup(), services({ channelEffects: undefined }));
  assert.equal(pending.pending.kind, 'channel-effects');
  const before = JSON.stringify(pending.session);
  const bad = resumeDuelStartOfTurn(pending.session, pending.pending.taskId,
    { status: 'applied', match: pending.session.match }, services());
  assert.equal(bad.status, 'rejected');
  assert.equal(JSON.stringify(pending.session), before);
  let rngCalls = 0;
  const done = resumeDuelStartOfTurn(pending.session, pending.pending.taskId,
    { status: 'verified-no-effect' }, services({ randomIndex: () => { rngCalls++; return 0; } }));
  assert.equal(done.status, 'main', done.reason);
  const state = done.session.match;
  const repeat = resumeDuelStartOfTurn(done.session, pending.pending.taskId,
    { status: 'verified-no-effect' }, services({ randomIndex: () => { rngCalls++; return 0; } }));
  assert.equal(repeat.status, 'duplicate');
  assert.strictEqual(repeat.session.match, state);
  assert.equal(rngCalls, 0);
});

test('Burn Out first point is a trusted pending boundary; recycle once, score once, then Draw 1', () => {
  const initial = setup();
  const empty = commitDuelPlayingMutation(initial.match, match => ({ ...match,
    players: match.players.map(p => p.playerId === match.frame.turnPlayerId ? {
      ...p, trash: p.remainingMainDeck, remainingMainDeck: [],
    } : p) }));
  let rngCalls = 0;
  const waiting = runDuelStartOfTurn({ ...initial, match: empty }, services({ firstBurnout: undefined,
    randomIndex: bound => { rngCalls++; return 0; } }));
  assert.equal(waiting.status, 'pending', waiting.reason);
  assert.equal(waiting.pending.kind, 'burnout-first');
  assert.equal(waiting.session.match.frame.phase, 'draw');
  assert.equal(waiting.session.turnFlow.drawCursor.step, 'awaiting-first-resolution');
  assert.equal(player(waiting.session.match).trash.length, 0);
  assert.equal(resources(waiting.session.match).runeDeck.length, 3);
  const before = rngCalls;
  const rejected = resumeDuelStartOfTurn(waiting.session, waiting.pending.taskId,
    { status: 'first-burnout', kind: 'scored', scoring: {} }, services());
  assert.equal(rejected.status, 'rejected');
  assert.equal(rngCalls, before);
  const next = resumeDuelStartOfTurn(clone(waiting.session), waiting.pending.taskId,
    { status: 'first-burnout', kind: 'scored' }, services({ burnoutIntervention: undefined,
      randomIndex: () => { rngCalls++; return 0; } }));
  assert.equal(next.status, 'pending', next.reason);
  assert.equal(next.pending.kind, 'burnout-intervention');
  assert.equal(next.session.turnFlow.drawCursor.step, 'awaiting-intervention');
  const opponent = next.session.match.turnOrder.find(seat => seat !== next.session.match.frame.turnPlayerId);
  assert.equal(next.session.match.scoring.players.find(seat => seat.playerId === opponent).points, 1);
  assert.equal(rngCalls, before);
  const done = resumeDuelStartOfTurn(next.session, next.pending.taskId,
    { status: 'verified-no-effect' }, services({ randomIndex: () => { rngCalls++; return 0; } }));
  assert.equal(done.status, 'main', done.reason);
  assert.equal(player(done.session.match).hand.length, 5);
  assert.equal(player(done.session.match).remainingMainDeck.length, 3);
  assert.equal(done.session.match.scoring.players.find(seat => seat.playerId === opponent).points, 1);
  assert.equal(rngCalls, before);
});

test('subsequent empty-deck Burn Outs award exactly one fixed point per intervention; only beneficiary wins immediately', () => {
  const start = setup();
  const exhausted = commitDuelPlayingMutation(start.match, match => ({ ...match,
    players: match.players.map(p => p.playerId === match.frame.turnPlayerId
      ? { ...p, remainingMainDeck: [] } : p),
    scoring: { ...match.scoring, players: match.scoring.players.map(p => ({ ...p, points: 7 })) } }));
  const first = runDuelStartOfTurn({ ...start, match: exhausted }, services({ firstBurnout: undefined,
    burnoutIntervention: undefined }));
  assert.equal(first.pending.kind, 'burnout-first');
  const prevented = resumeDuelStartOfTurn(first.session, first.pending.taskId,
    { status: 'first-burnout', kind: 'prevented' }, services({ burnoutIntervention: undefined }));
  assert.equal(prevented.pending.kind, 'burnout-intervention');
  const opponent = prevented.session.match.turnOrder.find(p => p !== prevented.session.match.frame.turnPlayerId);
  assert.equal(prevented.session.match.scoring.players.find(p => p.playerId === opponent).points, 7);
  const noWin = resumeDuelStartOfTurn(prevented.session, prevented.pending.taskId,
    { status: 'verified-no-effect' }, services());
  // Both players had seven: the fixed point makes the beneficiary unique at eight.
  assert.equal(noWin.status, 'ended', noWin.reason);
  assert.equal(noWin.session.match.scoring.players.find(p => p.playerId === opponent).points, 8);
  assert.equal(noWin.session.match.frame.phase, 'ended');
});

test('Begin turn ledger resets before beginning hook; trusted Beginning control + Conquer remains scored at Scoring', () => {
  const initial = setup();
  const controlled = { ...initial, match: holdBoard(initial.match) };
  const actor = controlled.match.frame.turnPlayerId;
  const field = controlled.match.board.battlefields[0].locationId;
  const result = runDuelStartOfTurn(controlled, services({
    beginningEffects: context => {
      assert.equal(context.match.scoring.turnNumber, context.match.frame.turnNumber);
      const match = commitDuelPlayingMutation(context.match, draft => ({ ...draft,
        scoring: scoreDuelBattlefield(draft.scoring, draft.board, actor, field, 'conquer', {
          phase: 'other', turnPlayerId: actor, controlEstablishedForPlayerId: actor,
          controlEstablishedLocationId: field,
        }).state }));
      // Provider returns a detached *unclocked* aggregate; executor allocates the clock exactly once.
      return { status: 'applied', match: { ...match,
        stateVersion: context.match.stateVersion, eventSeq: context.match.eventSeq } };
    },
  }));
  assert.equal(result.status, 'main', result.reason);
  const scored = result.session.match.scoring.players.find(p => p.playerId === actor);
  assert.equal(scored.points, 2);
  assert.equal(scored.scoredBattlefieldLocationIds.length, 2);
  assert.equal(scored.scoredBattlefieldLocationIds.includes(field), true);
});
