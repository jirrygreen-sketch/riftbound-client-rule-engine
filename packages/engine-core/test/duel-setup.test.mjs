import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDuelSetup, mulliganDuelSetup, restoreDuelSetup,
  projectPublicDuelSetup, completeDuelSetup,
} from '../dist/duel/setup.js';

function seats(mainSize = 6, runeSize = 3) {
  return ['alice', 'bob'].map(playerId => ({
    playerId,
    mainDeck: Array.from({ length: mainSize }, (_, i) => ({ uid: `${playerId}-main-${i}`,
      cardId: `${playerId}-printing-${i}` })),
    champion: { uid: `${playerId}-champion`, cardId: `${playerId}-chosen-print` },
    legend: { uid: `${playerId}-legend`, cardId: `${playerId}-legend-print` },
    runeDeck: Array.from({ length: runeSize }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
      cardId: `${playerId}-rune-print-${i}`, domain: ['Fury', 'Calm', 'Mind'][i % 3] })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
      cardId: `${playerId}-field-print-${i}` })),
  }));
}
function clone(value) { return structuredClone(value); }
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function failNoRng(op, message) {
  let calls = 0;
  assert.throws(() => op(() => { calls++; return 0; }), message);
  assert.equal(calls, 0, 'validation must precede random consumption');
}
function allObjectIds(seat) {
  return [...seat.mainDeck.map(card => card.uid), ...seat.runeDeck.map(card => card.uid),
    seat.legend.uid, seat.champion.uid, ...seat.battlefields.map(field => field.instanceId)];
}
function allStateIds(player, selection) {
  return [player.legend.uid, player.champion.uid, ...player.hand.map(card => card.uid),
    ...player.remainingMainDeck.map(card => card.uid), ...player.shuffledRuneDeck.map(rune => rune.uid),
    selection.selected.instanceId, ...selection.removed.battlefields.map(field => field.instanceId)];
}
/** Rename one participant everywhere the state references that identity (a consistent archive edit). */
function renamePlayer(state, from, to) {
  const next = clone(state);
  next.playerIds = next.playerIds.map(value => value === from ? to : value);
  next.turnOrder = next.turnOrder.map(value => value === from ? to : value);
  if (next.firstPlayerId === from) next.firstPlayerId = to;
  next.players = next.players.map(player => player.playerId === from ? { ...player, playerId: to } : player);
  next.selection = {
    selected: next.selection.selected.map(value => value.playerId === from ? { ...value, playerId: to } : value),
    removedByPlayer: next.selection.removedByPlayer.map(value =>
      value.playerId === from ? { ...value, playerId: to } : value),
  };
  return next;
}

// With j=0 for every Fisher-Yates step, [0..5] -> [1,2,3,4,5,0].
test('separate persistent shuffles, initial hand 4, first player, chosen/legend and Battlefield identity', () => {
  const input = deepFreeze(seats());
  const before = clone(input);
  const bounds = [];
  const state = createDuelSetup(input, upper => { bounds.push(upper); return 0; });
  assert.deepEqual(input, before);
  assert.deepEqual(bounds, [6, 5, 4, 3, 2, 3, 2, 6, 5, 4, 3, 2, 3, 2, 2, 3, 3]);
  assert.deepEqual(state.turnOrder, ['alice', 'bob']);
  assert.equal(state.firstPlayerId, 'alice');
  assert.equal(state.stage, 'mulligan');
  assert.deepEqual(state.players.map(player => player.mulliganStatus), ['pending', 'pending']);
  for (const [i, player] of state.players.entries()) {
    const expected = input[i];
    assert.equal(player.playerId, expected.playerId);
    assert.deepEqual(player.hand.map(card => card.uid), [1, 2, 3, 4].map(n => `${player.playerId}-main-${n}`));
    assert.deepEqual(player.remainingMainDeck.map(card => card.uid),
      [5, 0].map(n => `${player.playerId}-main-${n}`));
    assert.deepEqual(player.shuffledRuneDeck.map(card => card.uid),
      [1, 2, 0].map(n => `${player.playerId}-rune-${n}`));
    assert.deepEqual(player.champion, expected.champion);
    assert.deepEqual(player.legend, expected.legend);
    assert.equal(state.selection.selected[i].playerId, player.playerId);
    assert.deepEqual(state.selection.selected[i], { playerId: player.playerId,
      ...expected.battlefields[0] });
    assert.deepEqual(state.selection.removedByPlayer[i].battlefields, expected.battlefields.slice(1));
    const identities = allStateIds(player, {
      selected: state.selection.selected[i], removed: state.selection.removedByPlayer[i],
    });
    assert.equal(new Set(identities).size, identities.length);
    assert.deepEqual(new Set(identities), new Set(allObjectIds(expected)));
    assert.notEqual(player.hand[0], input[i].mainDeck[1], 'cards must be detached');
  }
  assert.notEqual(state.players[0].hand[0].uid, state.players[1].hand[0].uid);
});

test('empty Rune Deck consumes no Rune-shuffle RNG; a single Rune is not shuffled either', () => {
  for (const size of [0, 1]) {
    const input = seats(6, size);
    const bounds = [];
    const state = createDuelSetup(input, upper => { bounds.push(upper); return 0; });
    assert.deepEqual(bounds, [6, 5, 4, 3, 2, 6, 5, 4, 3, 2, 2, 3, 3]);
    assert.deepEqual(state.players.map(player => player.shuffledRuneDeck.length), [size, size]);
  }
});

test('first seat may be seat 1; Battlefield picks use independent seat order, never cardId as identity', () => {
  const bounds = [];
  const state = createDuelSetup(seats(), upper => {
    bounds.push(upper);
    return bounds.length === 15 ? 1 : bounds.length === 16 ? 2 : bounds.length === 17 ? 1 : 0;
  });
  assert.deepEqual(state.turnOrder, ['bob', 'alice']);
  assert.equal(state.firstPlayerId, 'bob');
  assert.deepEqual(state.selection.selected.map(field => field.instanceId), ['alice-field-2', 'bob-field-1']);
  assert.deepEqual(state.selection.removedByPlayer.map(value => value.battlefields.map(field => field.instanceId)),
    [['alice-field-0', 'alice-field-1'], ['bob-field-0', 'bob-field-2']]);
  assert.equal(state.selection.selected[0].cardId, 'alice-field-print-2');
});

test('every initial structure/UID/domain/printing issue rejects before randomness', () => {
  const alter = [
    deck => { deck.pop(); },
    deck => { deck[0].playerId = deck[1].playerId; },
    deck => { deck[0].mainDeck = deck[0].mainDeck.slice(0, 5); },
    deck => { deck[0].runeDeck[0].domain = 'Fire'; },
    deck => { deck[0].runeDeck[0].uid = deck[1].mainDeck[0].uid; },
    deck => { deck[0].battlefields[0].instanceId = deck[1].legend.uid; },
    deck => { deck[1].champion.uid = deck[0].champion.uid; },
    deck => { deck[1].champion.uid = 'alice'; },
    deck => { deck[0].mainDeck[1].uid = deck[0].mainDeck[0].uid; },
    deck => { deck[0].battlefields[1].cardId = deck[0].battlefields[0].cardId; },
    deck => { deck[0].battlefields = deck[0].battlefields.slice(0, 2); },
    deck => { deck[0].mainDeck[0].extra = true; },
    deck => { deck[0].mainDeck[0].uid = JSON.stringify(['duel-base', 'alice']); },
    deck => { deck[1].battlefields[2].cardId = JSON.stringify(['duel-battlefield', 'alice-field-1']); },
    deck => { deck[0].runeDeck[0].uid = ''; },
    deck => { delete deck[0].champion.cardId; },
  ];
  for (const mutate of alter) {
    const input = seats(); mutate(input);
    const before = clone(input);
    failNoRng(random => createDuelSetup(input, random), TypeError);
    assert.deepEqual(input, before);
  }
  for (const invalid of [undefined, null, 'not-a-random-source']) {
    failNoRng(random => createDuelSetup(seats(), invalid), TypeError);
  }
});

test('RNG errors at all setup stages yield no returned partial state and never mutate inputs', () => {
  const input = deepFreeze(seats());
  for (let failedAt = 0; failedAt < 17; failedAt++) {
    let calls = 0;
    assert.throws(() => createDuelSetup(input, upper => {
      if (calls++ === failedAt) return upper;
      return 0;
    }), TypeError);
    assert.equal(calls, failedAt + 1);
  }
  for (const invalid of [-1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0']) {
    assert.throws(() => createDuelSetup(input, () => invalid), TypeError);
  }
  let calls = 0;
  assert.throws(() => createDuelSetup(input, () => {
    calls++; throw new Error('rng unavailable');
  }), /rng unavailable/);
  assert.equal(calls, 1);
  assert.deepEqual(input, seats());
});

test('0/1/2 mulligan: strict first-to-second order, replacement before randomized bottom recycle', () => {
  const initial = deepFreeze(createDuelSetup(seats(), () => 0));
  const initialBefore = clone(initial);
  let calls = 0;
  const first = mulliganDuelSetup(initial, 'alice',
    ['alice-main-1', 'alice-main-2'], bound => { calls++; assert.equal(bound, 2); return 0; });
  assert.equal(calls, 1);
  assert.deepEqual(initial, initialBefore);
  assert.deepEqual(first.players[0].hand.map(card => card.uid),
    ['alice-main-3', 'alice-main-4', 'alice-main-5', 'alice-main-0']);
  assert.deepEqual(first.players[0].remainingMainDeck.map(card => card.uid),
    ['alice-main-2', 'alice-main-1']);
  assert.deepEqual(first.players[1], initial.players[1]);
  assert.equal(first.stage, 'mulligan');
  assert.deepEqual(first.players.map(player => player.mulliganStatus), ['complete', 'pending']);
  const second = mulliganDuelSetup(first, 'bob', ['bob-main-1'],
    () => { throw new Error('one card may not consume RNG'); });
  assert.deepEqual(second.players[1].hand.map(card => card.uid),
    ['bob-main-2', 'bob-main-3', 'bob-main-4', 'bob-main-5']);
  assert.deepEqual(second.players[1].remainingMainDeck.map(card => card.uid),
    ['bob-main-0', 'bob-main-1']);
  assert.equal(second.stage, 'complete');
  const empty = mulliganDuelSetup(initial, 'alice', [],
    () => { throw new Error('zero cards may not consume RNG'); });
  assert.deepEqual(empty.players[0].hand, initial.players[0].hand);
  assert.deepEqual(empty.players[0].remainingMainDeck, initial.players[0].remainingMainDeck);
  const bothPass = mulliganDuelSetup(empty, 'bob', [],
    () => { throw new Error('zero cards may not consume RNG'); });
  assert.equal(bothPass.stage, 'complete');
  assert.deepEqual(initial, initialBefore);
});

test('seat 1 first must mulligan first; replay, wrong owner, and invalid choices reject without RNG/mutation', () => {
  const state = deepFreeze(createDuelSetup(seats(), upper => upper === 2 ? 1 : 0));
  assert.deepEqual(state.turnOrder, ['bob', 'alice']);
  const before = clone(state);
  const badRequests = [
    ['alice', []], ['nobody', []], ['bob', ['alice-main-1']], ['bob', ['missing']],
    ['bob', ['bob-main-1', 'bob-main-1']],
    ['bob', ['bob-main-1', 'bob-main-2', 'bob-main-3']],
    ['bob', [42]], ['bob', 'bob-main-1'],
  ];
  for (const [actor, chosen] of badRequests) {
    failNoRng(random => mulliganDuelSetup(state, actor, chosen, random), TypeError);
    assert.deepEqual(state, before);
  }
  const first = deepFreeze(mulliganDuelSetup(state, 'bob', ['bob-main-1'], () => 0));
  failNoRng(random => mulliganDuelSetup(first, 'bob', [], random), TypeError);
  const done = deepFreeze(mulliganDuelSetup(first, 'alice', [], () => 0));
  for (const actor of ['alice', 'bob']) {
    failNoRng(random => mulliganDuelSetup(done, actor, [], random), TypeError);
  }
});

test('two-card mulligan RNG failure is atomic; no recycling RNG until validation succeeds', () => {
  const state = deepFreeze(createDuelSetup(seats(), () => 0));
  const original = clone(state);
  let calls = 0;
  assert.throws(() => mulliganDuelSetup(state, 'alice',
    ['alice-main-1', 'alice-main-2'], upper => { calls++; assert.equal(upper, 2); return upper; }), TypeError);
  assert.equal(calls, 1);
  assert.throws(() => mulliganDuelSetup(state, 'alice',
    ['alice-main-1', 'alice-main-2'], () => { throw Error('bad RNG'); }), /bad RNG/);
  assert.deepEqual(state, original);
  const valid = mulliganDuelSetup(state, 'alice', ['alice-main-1', 'alice-main-2'], () => 1);
  assert.deepEqual(valid.players[0].remainingMainDeck.map(card => card.uid),
    ['alice-main-1', 'alice-main-2']);
});

test('a 0/1-card mulligan needs no RNG callback; only the 2-card recycle requires exactly one call', () => {
  const initial = deepFreeze(createDuelSetup(seats(), () => 0));
  const before = clone(initial);
  const original = Math.random;
  Math.random = () => { throw new Error('RNG must not be used'); };
  try {
    const passed = mulliganDuelSetup(initial, 'alice', []); // callback omitted entirely
    assert.deepEqual(passed.players[0].hand, initial.players[0].hand);
    assert.deepEqual(passed.players[0].remainingMainDeck, initial.players[0].remainingMainDeck);
    assert.equal(passed.players[0].mulliganStatus, 'complete');
    assert.equal(passed.stage, 'mulligan');
    const single = mulliganDuelSetup(initial, 'alice', ['alice-main-1']); // deterministic recycle
    assert.deepEqual(single.players[0].hand.map(card => card.uid),
      ['alice-main-2', 'alice-main-3', 'alice-main-4', 'alice-main-5']);
    assert.deepEqual(single.players[0].remainingMainDeck.map(card => card.uid),
      ['alice-main-0', 'alice-main-1']);
    assert.deepEqual(single.players[1], initial.players[1]);
    // An explicitly passed non-function callback is still rejected, whatever the selection size.
    for (const invalid of [null, 0, 'rng', {}]) {
      for (const chosen of [[], ['alice-main-1'], ['alice-main-1', 'alice-main-2']]) {
        assert.throws(() => mulliganDuelSetup(initial, 'alice', chosen, invalid), TypeError);
      }
    }
  } finally {
    Math.random = original;
  }
  assert.throws(() => mulliganDuelSetup(initial, 'alice', ['alice-main-1', 'alice-main-2']), TypeError);
  let calls = 0;
  const two = mulliganDuelSetup(initial, 'alice', ['alice-main-1', 'alice-main-2'],
    bound => { calls++; assert.equal(bound, 2); return 1; });
  assert.equal(calls, 1);
  assert.deepEqual(two.players[0].remainingMainDeck.map(card => card.uid),
    ['alice-main-1', 'alice-main-2']);
  assert.deepEqual(initial, before);
});

test('restore is RNG-free, preserves exact outcomes, deep-clones all secrets; no fabricated shuffle', () => {
  const starting = createDuelSetup(seats(8, 4), upper => upper - 1);
  const first = mulliganDuelSetup(starting, 'bob', [], () => 0);
  // Explicitly choose the player based on the stored turn order, not a regenerated coin flip.
  assert.equal(starting.turnOrder[0], 'bob');
  const second = mulliganDuelSetup(first, 'alice', [first.players[0].hand[0].uid], () => 0);
  const archive = deepFreeze(clone(second));
  const restored = restoreDuelSetup(archive);
  assert.deepEqual(restored, archive);
  assert.notEqual(restored, archive);
  assert.notEqual(restored.players[0].hand, archive.players[0].hand);
  assert.notEqual(restored.players[0].hand[0], archive.players[0].hand[0]);
  assert.notEqual(restored.players[0].shuffledRuneDeck[0], archive.players[0].shuffledRuneDeck[0]);
  assert.notEqual(restored.selection.removedByPlayer[0].battlefields[0],
    archive.selection.removedByPlayer[0].battlefields[0]);
  restored.players[0].hand[0].cardId = 'local-only';
  restored.selection.removedByPlayer[0].battlefields[0].cardId = 'local-only';
  assert.deepEqual(archive, second);
  assert.deepEqual(restoreDuelSetup(archive), archive);
});

test('64 deterministic RNG traces preserve all object identities and hand sizes after both mulligans', () => {
  for (let seed = 1; seed <= 64; seed++) {
    let words = seed;
    const bounds = [];
    const random = upper => {
      bounds.push(upper);
      words = (Math.imul(words, 1664525) + 1013904223) >>> 0;
      return words % upper;
    };
    const original = seats(9, 5);
    let state = createDuelSetup(original, random);
    const allBefore = original.flatMap(seat => allObjectIds(seat));
    for (const actor of state.turnOrder) {
      const chosen = state.players.find(player => player.playerId === actor).hand
        .slice(0, (seed + actor.length) % 3).map(card => card.uid);
      state = mulliganDuelSetup(state, actor, chosen, random);
      assert.equal(state.players.find(player => player.playerId === actor).mulliganStatus, 'complete');
      assert.equal(state.players.find(player => player.playerId === actor).hand.length, 4);
      assert.deepEqual(restoreDuelSetup(state), state);
    }
    assert.equal(state.stage, 'complete');
    const allAfter = state.players.flatMap((player, i) => allStateIds(player, {
      selected: state.selection.selected[i], removed: state.selection.removedByPlayer[i],
    }));
    assert.equal(new Set(allAfter).size, allBefore.length);
    assert.deepEqual(new Set(allAfter), new Set(allBefore));
    assert.ok(bounds.every(bound => Number.isSafeInteger(bound) && bound >= 2));
  }
});

test('restore rejects malformed/unreachable snapshots and cross-zone identity collisions', () => {
  const before = createDuelSetup(seats(), () => 0);
  const first = mulliganDuelSetup(before, 'alice', [], () => 0);
  const complete = mulliganDuelSetup(first, 'bob', [], () => 0);
  const alterations = [
    s => { s.stage = 'complete'; },
    s => { s.players[1].mulliganStatus = 'complete'; },
    s => { s.players[0].hand.pop(); },
    s => { s.players[0].remainingMainDeck.pop(); },
    s => { s.players[1].hand[0].uid = s.players[0].legend.uid; },
    s => { s.players[0].remainingMainDeck[0].uid = s.players[0].hand[0].uid; },
    s => { s.players[0].shuffledRuneDeck[0].uid = s.selection.selected[1].instanceId; },
    s => { s.selection.removedByPlayer[0].battlefields[0].instanceId = s.players[1].champion.uid; },
    s => { s.selection.removedByPlayer[1].battlefields[0].cardId = s.selection.selected[1].cardId; },
    s => { s.selection.selected.reverse(); },
    s => { s.selection.removedByPlayer.reverse(); },
    s => { s.turnOrder.reverse(); },
    s => { s.firstPlayerId = 'unknown'; },
    s => { s.playerIds.reverse(); },
    s => { s.players[0].shuffledRuneDeck[0].domain = 'any'; },
    s => { s.players[0].champion.hacked = true; },
    s => { s.players[0].legend.uid = 'alice'; },
    s => { s.players[0].hand[0].uid = JSON.stringify(['duel-base', 'alice']); },
    s => { s.selection.removedByPlayer[0].battlefields.push({ instanceId: 'new', cardId: 'new' }); },
  ];
  for (const alteration of alterations) {
    const value = clone(first); alteration(value);
    assert.throws(() => restoreDuelSetup(value), TypeError);
  }
  const corruptedComplete = clone(complete);
  corruptedComplete.players[1].mulliganStatus = 'pending';
  assert.throws(() => restoreDuelSetup(corruptedComplete), TypeError);
  const accessor = clone(before);
  Object.defineProperty(accessor.players[0].hand[0], 'uid', { get() { throw Error('accessor read'); } });
  assert.throws(() => restoreDuelSetup(accessor), TypeError);
  const sparse = clone(before);
  delete sparse.players[0].hand[0];
  assert.throws(() => restoreDuelSetup(sparse), TypeError);
  const roguePrototype = clone(before);
  Object.setPrototypeOf(roguePrototype.players[0].hand[0], { hacked: true });
  assert.throws(() => restoreDuelSetup(roguePrototype), TypeError);
});

test('a player ID may never equal another participant derived location, on create and on restore', () => {
  const colliding = seats();
  colliding[0].playerId = '["duel-base","bob"]';
  assert.equal(JSON.stringify(['duel-base', colliding[1].playerId]), colliding[0].playerId);
  failNoRng(random => createDuelSetup(colliding, random), TypeError);
  assert.deepEqual(colliding.map(seat => seat.playerId), ['["duel-base","bob"]', 'bob']);
  // Same string shape, no collision: opaque actor IDs keep working.
  const opaque = seats();
  opaque[0].playerId = '["duel-base","carol"]';
  assert.deepEqual(createDuelSetup(opaque, () => 0).playerIds, ['["duel-base","carol"]', 'bob']);
  const legal = createDuelSetup(seats(), () => 0);
  const legalBefore = clone(legal);
  const renamed = renamePlayer(legal, 'alice', '["duel-base","bob"]');
  assert.ok(!JSON.stringify(renamed).includes('"alice"'), 'every actor reference must be renamed');
  const original = Math.random;
  Math.random = () => { throw new Error('RNG must not be used'); };
  try {
    assert.throws(() => restoreDuelSetup(renamed), TypeError);
    assert.throws(() => mulliganDuelSetup(renamed, '["duel-base","bob"]', []), TypeError);
    assert.throws(() => projectPublicDuelSetup(renamed), TypeError);
    // The rename itself is what fails: the same edit to a non-colliding opaque ID restores.
    assert.deepEqual(restoreDuelSetup(renamePlayer(legal, 'alice', '["duel-base","carol"]')),
      renamePlayer(legal, 'alice', '["duel-base","carol"]'));
  } finally {
    Math.random = original;
  }
  assert.deepEqual(legal, legalBefore);
  assert.deepEqual(legal.playerIds, ['alice', 'bob']);
});

test('projection only exposes public printings/counts and matching viewer hand, never opponent/decks/removed', () => {
  const state = deepFreeze(createDuelSetup(seats(), () => 0));
  const spectator = projectPublicDuelSetup(state);
  const alice = projectPublicDuelSetup(state, 'alice');
  const bob = projectPublicDuelSetup(state, 'bob');
  const stranger = projectPublicDuelSetup(state, 'stranger');
  assert.deepEqual(stranger, spectator);
  assert.equal(spectator.currentMulliganOwner, 'alice');
  assert.equal(spectator.firstPlayerId, 'alice');
  assert.deepEqual(spectator.selectedBattlefields, state.selection.selected);
  for (const projection of [spectator, alice, bob]) {
    for (const player of projection.players) {
      assert.deepEqual(player.legend, { cardId: `${player.playerId}-legend-print` });
      assert.deepEqual(player.champion, { cardId: `${player.playerId}-chosen-print` });
      assert.equal(player.handCount, 4);
      assert.equal(player.mainDeckCount, 2);
      assert.equal(player.runeDeckCount, 3);
      assert.equal(JSON.stringify(projection).includes(`${player.playerId}-rune-0`), false);
      assert.equal(JSON.stringify(projection).includes(`${player.playerId}-field-1`), false);
      assert.equal(JSON.stringify(projection).includes(`${player.playerId}-legend\"`), false);
    }
  }
  assert.equal(spectator.players[0].hand, undefined);
  assert.equal(spectator.players[1].hand, undefined);
  assert.deepEqual(alice.players[0].hand, state.players[0].hand);
  assert.equal(alice.players[1].hand, undefined);
  assert.deepEqual(bob.players[1].hand, state.players[1].hand);
  assert.equal(bob.players[0].hand, undefined);
  assert.equal(JSON.stringify(alice).includes('bob-main-0'), false);
  assert.equal(JSON.stringify(bob).includes('alice-main-0'), false);
  alice.players[0].hand[0].cardId = 'changed-projection';
  alice.selectedBattlefields[0].cardId = 'changed-projection';
  assert.equal(state.players[0].hand[0].cardId, 'alice-printing-1');
  assert.equal(state.selection.selected[0].cardId, 'alice-field-print-0');
  const passed = mulliganDuelSetup(state, 'alice', [], () => 0);
  assert.equal(projectPublicDuelSetup(passed).currentMulliganOwner, 'bob');
  assert.equal(projectPublicDuelSetup(mulliganDuelSetup(passed, 'bob', [], () => 0)).currentMulliganOwner, null);
});

test('handoff is forbidden early; complete DTO provides one shuffled Rune authority and board selection seam', () => {
  const state = createDuelSetup(seats(), () => 0);
  assert.throws(() => completeDuelSetup(state), TypeError);
  const afterFirst = mulliganDuelSetup(state, 'alice', [], () => 0);
  assert.throws(() => completeDuelSetup(afterFirst), TypeError);
  const complete = deepFreeze(mulliganDuelSetup(afterFirst, 'bob', [], () => 0));
  const dto = completeDuelSetup(complete);
  assert.deepEqual(dto.playerIds, complete.playerIds);
  assert.deepEqual(dto.turnOrder, complete.turnOrder);
  assert.deepEqual(dto.runeDecks, complete.players.map(player => player.shuffledRuneDeck));
  assert.deepEqual(dto.selection, complete.selection);
  assert.deepEqual(dto.players.map(player => player.remainingMainDeck),
    complete.players.map(player => player.remainingMainDeck));
  assert.ok(dto.players.every(player => !('shuffledRuneDeck' in player)));
  assert.ok(!('stage' in dto));
  dto.runeDecks[0][0].uid = 'local-only';
  dto.selection.removedByPlayer[0].battlefields[0].cardId = 'local-only';
  assert.equal(complete.players[0].shuffledRuneDeck[0].uid, 'alice-rune-1');
  assert.equal(complete.selection.removedByPlayer[0].battlefields[0].cardId, 'alice-field-print-1');
});
