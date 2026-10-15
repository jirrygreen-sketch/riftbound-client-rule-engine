import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDuelMatch, resolveDuelMulligan, projectDuelMatch } from '../dist/duel/match-state.js';
import { createDuelSetup, mulliganDuelSetup, completeDuelSetup } from '../dist/duel/setup.js';
import { payDuelRuneCost, activateBasicRuneEnergy } from '../dist/duel/resources.js';

function fixtures() {
  const seats = ['alice', 'bob'].map(id => ({
    playerId: id,
    mainDeck: Array.from({ length: 8 }, (_, n) => ({ uid: `${id}-main-${n}`, cardId: `${id}-main-print-${n}` })),
    champion: { uid: `${id}-champion`, cardId: `${id}-champion-print` },
    legend: { uid: `${id}-legend`, cardId: `${id}-legend-print` },
    runeDeck: Array.from({ length: 5 }, (_, n) => ({ uid: `${id}-rune-${n}`, cardId: `${id}-rune-print-${n}`, domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, n) => ({ instanceId: `${id}-field-${n}`, cardId: `${id}-field-print-${n}` })),
  }));
  const metadata = { matchId: 'duel-1', dataVersion: 'catalog-2026', catalogDigest: 'sha256:abc',
    roster: [{ playerId: 'alice', displayName: 'Alice' }, { playerId: 'bob', displayName: 'Bob' }] };
  return { seats, metadata };
}
function starting(select = () => 0) {
  const { seats, metadata } = fixtures();
  const calls = [];
  const state = createDuelMatch(seats, metadata, bound => {
    calls.push(bound);
    return select(bound, calls.length);
  });
  return { state, seats, metadata, calls };
}
function transition(state, rng = undefined) {
  const first = state.turnOrder[0], second = state.turnOrder[1];
  const one = resolveDuelMulligan(state, first, [], rng);
  const playing = resolveDuelMulligan(one, second, [], rng);
  assert.equal(playing.stage, 'playing');
  return { one, playing };
}

test('real setup consumes exact RNG sequence for four decks and selection; full second transition consumes no RNG', () => {
  const { state, seats, calls } = starting();
  assert.equal(state.stage, 'setup');
  assert.deepEqual(calls, [8, 7, 6, 5, 4, 3, 2, 5, 4, 3, 2,
    8, 7, 6, 5, 4, 3, 2, 5, 4, 3, 2, 2, 3, 3]);
  assert.deepEqual(state.setup.playerIds, ['alice', 'bob']);
  const reference = createDuelSetup(seats, () => 0);
  assert.deepEqual(state.setup, reference);
  const { one, playing } = transition(state, () => { throw new Error('unexpected RNG'); });
  assert.equal(state.stateVersion, 0);
  assert.equal(state.eventSeq, 0);
  assert.equal(one.stage, 'setup');
  assert.equal(one.setup.players.filter(player => player.mulliganStatus === 'complete').length, 1);
  assert.equal(one.stateVersion, 1);
  assert.equal(one.eventSeq, 1);
  assert.equal(playing.stateVersion, 2);
  assert.equal(playing.eventSeq, 2);
  assert.deepEqual(playing.turnOrder, reference.turnOrder);
  assert.deepEqual(playing.players.map(player => player.playerId), ['alice', 'bob']);
  assert.deepEqual(playing.board.playerIds, ['alice', 'bob']);
  assert.deepEqual(playing.resources.playerIds, ['alice', 'bob']);
  assert.deepEqual(playing.scoring.playerIds, ['alice', 'bob']);
  assert.equal(playing.scoring.turnNumber, 0); // the trusted executor has not begun turn 1
  assert.deepEqual(playing.scoring.players.map(player => player.points), [0, 0]);
  assert.deepEqual(playing.board.units, []);
  assert.deepEqual(playing.unitMeta, {});
  assert.deepEqual(playing.retiredUnitTokenUIDs, []);
  assert.ok(playing.players.every(player => player.champion !== null));
  assert.deepEqual(playing.players.map(player => player.trash), [[], []]);
  assert.equal(playing.board.battlefields.length, 2);
  assert.equal(playing.board.bases.length, 2);
  assert.deepEqual(playing.board.battlefields.map(field => field.instanceId), reference.selection.selected.map(field => field.instanceId));
  assert.deepEqual(playing.resources.bases.map(base => base.locationId), playing.board.bases.map(base => base.locationId));
  assert.deepEqual(playing.resources.players.map(player => player.runeDeck), reference.players.map(player => player.shuffledRuneDeck));
  assert.deepEqual(playing.players.map(player => player.hand), reference.players.map(player => player.hand));
  assert.deepEqual(playing.players.map(player => player.remainingMainDeck), reference.players.map(player => player.remainingMainDeck));
  assert.ok(!Object.hasOwn(playing, 'setup'));
  assert.ok(!Object.hasOwn(playing, 'selection'));
  assert.ok(!Object.hasOwn(playing, 'shuffledRuneDeck'));
  assert.ok(playing.players.every(player => !Object.hasOwn(player, 'shuffledRuneDeck') && !Object.hasOwn(player, 'runeDeck') && !Object.hasOwn(player, 'runePool')));
  assert.ok(playing.board.units.every(unit => Object.keys(unit).includes('locationId')));
  assert.equal(calls.length, 25);
});

test('two selected mulligan cards recycle once per actor after replacements; no completion RNG', () => {
  const { state } = starting();
  const owner1 = state.turnOrder[0], owner2 = state.turnOrder[1];
  const selected = id => state.setup.players.find(player => player.playerId === id).hand.slice(0, 2).map(card => card.uid);
  const calls = [];
  const rng = bound => { calls.push(bound); return 0; };
  const one = resolveDuelMulligan(state, owner1, selected(owner1), rng);
  assert.deepEqual(calls, [2]);
  const two = resolveDuelMulligan(one, owner2, selected(owner2), rng);
  assert.deepEqual(calls, [2, 2]);
  const reference1 = mulliganDuelSetup(state.setup, owner1, selected(owner1), () => 0);
  const reference2 = mulliganDuelSetup(reference1, owner2, selected(owner2), () => 0);
  const transferred = completeDuelSetup(reference2);
  assert.deepEqual(two.players.map(player => player.hand), transferred.players.map(player => player.hand));
  assert.deepEqual(two.players.map(player => player.remainingMainDeck), transferred.players.map(player => player.remainingMainDeck));
  assert.deepEqual(two.resources.players.map(player => player.runeDeck), transferred.runeDecks);
  assert.equal(two.stateVersion, 2);
});

test('turn-order-first may differ from seat order; frame cannot grant pre-turn payment or Rune reactions', () => {
  const { state } = starting((bound, call) => call === 23 ? 1 : 0);
  assert.deepEqual(state.turnOrder, ['bob', 'alice']);
  const { playing } = transition(state);
  assert.deepEqual(playing.players.map(p => p.playerId), ['alice', 'bob']);
  assert.deepEqual(playing.frame, { phase: 'awaiting-turn-start', turnNumber: 1,
    turnPlayerId: 'bob', priorityPlayerId: null, focusPlayerId: null,
    stateOpen: true, pendingPayment: null });
  const timing = { stateOpen: playing.frame.stateOpen, priorityPlayerId: playing.frame.priorityPlayerId,
    resourcePaymentPlayerId: playing.frame.pendingPayment };
  assert.throws(() => payDuelRuneCost(playing.resources, 'bob', { energy: 0, power: [] }, timing), /no active resource payment window/);
  assert.throws(() => activateBasicRuneEnergy(playing.resources, 'bob', 'bob-rune-0', timing));
  assert.deepEqual(playing.resources.players.map(p => p.runePool.energy), [0, 0]);
  assert.ok(playing.resources.bases.every(base => base.baseRunes.length === 0 && base.goldTokens.length === 0));
});

test('public projections expose only owner hand and public Trash faces; no hidden setup, deck order or private rune UID', () => {
  const { state } = starting();
  const privateHand = state.setup.players[0].hand[0].uid;
  const runeUID = state.setup.players[0].shuffledRuneDeck[0].uid;
  const removedUID = state.setup.selection.removedByPlayer[0].battlefields[0].instanceId;
  for (const viewer of [null, 'alice', 'bob']) {
    const setupView = projectDuelMatch(state, viewer);
    assert.equal(setupView.stage, 'setup');
    assert.equal(setupView.setup.players[0].handCount, 4);
    assert.equal(setupView.setup.players[0].mainDeckCount, 4);
    assert.equal(setupView.setup.players[0].runeDeckCount, 5);
    assert.equal(Object.hasOwn(setupView.setup.players[0], 'hand'), viewer === 'alice');
    assert.ok(!JSON.stringify(setupView).includes(removedUID));
    assert.ok(!JSON.stringify(setupView).includes(runeUID));
    if (viewer !== 'alice') assert.ok(!JSON.stringify(setupView).includes(privateHand));
  }
  const one = resolveDuelMulligan(state, state.turnOrder[0], [privateHand]);
  const hiddenAside = projectDuelMatch(one, 'bob');
  assert.ok(!JSON.stringify(hiddenAside).includes(privateHand));
  const playing = resolveDuelMulligan(one, state.turnOrder[1], []);
  assert.equal(playing.stage, 'playing');
  for (const viewer of [null, 'alice', 'bob']) {
    const view = projectDuelMatch(playing, viewer);
    assert.equal(view.stage, 'playing');
    assert.equal(Object.hasOwn(view.players[0], 'hand'), viewer === 'alice');
    assert.equal(Object.hasOwn(view.players[1], 'hand'), viewer === 'bob');
    assert.equal(view.resources.players[0].runeDeckCount, 5);
    assert.equal(view.players[0].mainDeckCount, 4);
    assert.equal(view.board.units.length, 0);
    // Trash is Public Information (CR 108.2.d): both seats and spectators receive a Trash face list.
    assert.ok(Array.isArray(view.players[0].trash) && Array.isArray(view.players[1].trash));
    assert.deepEqual(view.players[0].trash, []);
    assert.deepEqual(view.players[1].trash, []);
    const text = JSON.stringify(view);
    assert.ok(!text.includes('remainingMainDeck'));
    assert.ok(!text.includes('runeDeck\"'));
    assert.ok(!text.includes(runeUID));
    assert.ok(!text.includes(removedUID));
    assert.ok(!text.includes('retiredGoldUids'));
    assert.ok(!text.includes('unitMeta'));
    if (viewer === null) assert.ok(!text.includes(playing.players[0].hand[0].uid));
  }
  assert.throws(() => projectDuelMatch(playing, 'unauthenticated'), /unknown viewer/);
  assert.throws(() => projectDuelMatch(state, ''), /unknown viewer/);
});

test('returns and projections detach mutable input, previous state, and projected array/object references', () => {
  const { state, seats, metadata } = starting();
  const original = structuredClone(state);
  seats[0].mainDeck[0].uid = 'corrupt-main';
  seats[1].runeDeck[0].uid = 'corrupt-rune';
  seats[0].battlefields[0].cardId = 'corrupt-field';
  metadata.roster[0].displayName = 'corrupt-name';
  assert.deepEqual(state, original);
  const one = resolveDuelMulligan(state, state.turnOrder[0], []);
  const two = resolveDuelMulligan(one, state.turnOrder[1], []);
  const beforeOne = structuredClone(one), beforeTwo = structuredClone(two);
  state.setup.players[0].hand[0].uid = 'corrupt-setup';
  state.setup.players[0].shuffledRuneDeck[0].uid = 'corrupt-setup-rune';
  state.setup.selection.selected[0].instanceId = 'corrupt-selected';
  state.roster[0].displayName = 'corrupt-roster';
  assert.deepEqual(one, beforeOne);
  assert.deepEqual(two, beforeTwo);
  one.setup.players[0].hand[0].uid = 'corrupt-intermediate';
  one.setup.selection.selected[0].cardId = 'corrupt-intermediate-field';
  assert.deepEqual(two, beforeTwo);
  const view = projectDuelMatch(two, 'alice');
  view.players[0].hand[0].uid = 'corrupt-view';
  view.board.bases[0].occupancy.push('corrupt-view');
  view.resources.players[0].runePool.power.Fury = 20;
  view.roster[0].displayName = 'corrupt-view';
  assert.deepEqual(two, beforeTwo);
});

test('invalid metadata, seats and mulligans reject atomically; playing rejects repeated mulligans', () => {
  const { seats, metadata } = fixtures();
  for (const invalid of [
    { ...metadata, matchId: '  ' }, { ...metadata, dataVersion: '' },
    { ...metadata, catalogDigest: '' }, { ...metadata, roster: [metadata.roster[0], metadata.roster[0]] },
    { ...metadata, roster: [metadata.roster[1], metadata.roster[0]] },
    { ...metadata, roster: [{ ...metadata.roster[0], displayName: '' }, metadata.roster[1]] },
    { ...metadata, stateVersion: -1 },
  ]) {
    let rngCalls = 0;
    assert.throws(() => createDuelMatch(seats, invalid, () => { rngCalls++; return 0; }));
    assert.equal(rngCalls, 0);
  }
  const duplicated = structuredClone(seats);
  duplicated[0].mainDeck[0].uid = duplicated[0].champion.uid;
  let inputRng = 0;
  assert.throws(() => createDuelMatch(duplicated, metadata, () => { inputRng++; return 0; }), /duplicates/);
  assert.equal(inputRng, 0);
  const { state } = starting();
  const before = structuredClone(state);
  const due = state.turnOrder[0], late = state.turnOrder[1];
  let failRng = 0;
  const rng = () => { failRng++; return 0; };
  for (const [actor, picked] of [
    [late, []], ['stranger', []], [due, ['foreign-card']],
    [due, [state.setup.players.find(p => p.playerId === due).hand[0].uid, 'foreign-card']],
    [due, [state.setup.players.find(p => p.playerId === due).hand[0].uid, state.setup.players.find(p => p.playerId === due).hand[0].uid]],
  ]) assert.throws(() => resolveDuelMulligan(state, actor, picked, rng));
  assert.equal(failRng, 0);
  assert.deepEqual(state, before);
  assert.throws(() => resolveDuelMulligan(state, due, state.setup.players.find(p => p.playerId === due).hand.slice(0, 2).map(card => card.uid)), /randomIndex/);
  const { one, playing } = transition(state);
  const beforeOne = structuredClone(one), beforePlaying = structuredClone(playing);
  assert.throws(() => resolveDuelMulligan(one, due, []), /not current mulligan owner/);
  assert.deepEqual(one, beforeOne);
  assert.throws(() => resolveDuelMulligan(playing, late, [], () => { throw new Error('RNG used'); }), /only allowed during setup/);
  assert.deepEqual(playing, beforePlaying);
  let badRngCalls = 0;
  const chosen = state.setup.players.find(player => player.playerId === due).hand.slice(0, 2).map(card => card.uid);
  assert.throws(() => resolveDuelMulligan(state, due, chosen, bound => {
    badRngCalls++;
    assert.equal(bound, 2);
    return 2; // invalid exclusive index, after validation but before any state commits
  }), /randomIndex/);
  assert.equal(badRngCalls, 1);
  assert.deepEqual(state, before);
});

test('Trash faces are public to both seats and spectators, projected as uid/cardId only, and detached from the source zone', () => {
  const { state } = starting();
  const { playing } = transition(state);
  // The constructor starts every Trash empty and only a future trusted executor writes the
  // authoritative private zone; seed it here as that executor so the CR 108.2.d public projection
  // can be exercised against populated Trash, including private annotations that must not leak.
  playing.players[0].trash = [
    { uid: 'alice-trash-0', cardId: 'alice-trash-print-0', privateNote: 'hidden-note', ownerOnly: 'secret-marker' },
  ];
  playing.players[1].trash = [{ uid: 'bob-trash-0', cardId: 'bob-trash-print-0' }];
  const snapshot = structuredClone(playing);
  for (const viewer of [null, 'alice', 'bob']) {
    const view = projectDuelMatch(playing, viewer);
    assert.deepEqual(view.players[0].trash, [{ uid: 'alice-trash-0', cardId: 'alice-trash-print-0' }]);
    assert.deepEqual(view.players[1].trash, [{ uid: 'bob-trash-0', cardId: 'bob-trash-print-0' }]);
    assert.deepEqual(Object.keys(view.players[0].trash[0]).sort(), ['cardId', 'uid']);
    const text = JSON.stringify(view);
    assert.ok(text.includes('alice-trash-0') && text.includes('bob-trash-0'));
    assert.ok(!text.includes('hidden-note') && !text.includes('privateNote') &&
      !text.includes('ownerOnly') && !text.includes('secret-marker'));
  }
  const view = projectDuelMatch(playing, null);
  view.players[0].trash[0].uid = 'corrupt-trash-uid';
  view.players[0].trash.push({ uid: 'corrupt-trash', cardId: 'corrupt-trash-print' });
  assert.deepEqual(playing, snapshot);
});
