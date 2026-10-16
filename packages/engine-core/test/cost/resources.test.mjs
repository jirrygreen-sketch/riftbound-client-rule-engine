import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DUEL_DOMAINS, createDuelResources, restoreDuelResources, assertDuelResources,
  channelDuelRunes, activateBasicRuneEnergy, activateBasicRunePower,
  createDuelGoldToken, activateDuelGoldPower, clearAllDuelRunePools,
  payDuelRuneCost, projectPublicDuelResources,
} from '../../dist/cost/resources.js';

const locs = [{ playerId: 'p1', locationId: 'base:p1' }, { playerId: 'p2', locationId: 'base:p2' }];
const payment = { stateOpen: false, priorityPlayerId: null, resourcePaymentPlayerId: 'p1' };
const priority = { stateOpen: true, priorityPlayerId: 'p1', resourcePaymentPlayerId: null };
const closed = { stateOpen: false, priorityPlayerId: 'p1', resourcePaymentPlayerId: null };
const noPriority = { stateOpen: false, priorityPlayerId: null, resourcePaymentPlayerId: null };
const otherPaying = { stateOpen: false, priorityPlayerId: null, resourcePaymentPlayerId: 'p2' };
const all = [...DUEL_DOMAINS];
const basic = (uid, domain) => ({ uid, domain, cardId: `print:${domain}` });
function initial(deck1 = [basic('r1', 'Calm'), basic('r2', 'Mind'), basic('r3', 'Order')], deck2 = [basic('r4', 'Fury')]) {
  return createDuelResources({ playerIds: ['p1', 'p2'], baseLocations: locs, runeDecks: [deck1, deck2] });
}
const acquire = (state, e = 0, powers = {}) => {
  const raw = structuredClone(state);
  raw.players[0].runePool.energy = e;
  Object.assign(raw.players[0].runePool.power, powers);
  return restoreDuelResources(raw, locs);
};
const req = (domains, amount = 1) => ({ allowedDomains: domains, amount });
const cost = (energy, power = []) => ({ energy, power });
const summary = state => state.players[0].runePool;
const json = value => structuredClone(value);

function unchangedOnError(state, action, pattern) {
  const original = json(state);
  assert.throws(action, pattern);
  assert.deepEqual(state, original);
}

test('exact seats, base binding, independent deep clones, all categories of globally unique UIDs', () => {
  assert.throws(() => createDuelResources({ playerIds: ['p1', 'p1'], baseLocations: locs, runeDecks: [[], []] }));
  assert.throws(() => createDuelResources({ playerIds: ['p1', 'p2'], baseLocations: locs, runeDecks: [[basic('z', 'Calm')], [basic('z', 'Mind')]] }), /duplicate/);
  const supplied = [basic('r1', 'Body')];
  const state = initial(supplied, []);
  supplied[0].uid = 'changed'; supplied.push(basic('added', 'Order'));
  assert.equal(state.players[0].runeDeck[0].uid, 'r1');
  assert.equal(state.players[0].runeDeck.length, 1);
  unchangedOnError(state, () => restoreDuelResources(state, [{ ...locs[0], locationId: 'wrong' }, locs[1]]), /base location/);
  const next = channelDuelRunes(state, 'p1', 1);
  assert.notStrictEqual(next.players[0].runePool, state.players[0].runePool);
  assert.notStrictEqual(next.players[1].runeDeck, state.players[1].runeDeck);
  assert.deepEqual(state.players[0].runeDeck.map(r => r.uid), ['r1']);
});

test('restore rejects malicious snapshot shapes, unknown keys, invalid numbers, cross-zone duplicates', () => {
  const state = initial();
  const variants = [
    s => { s.players[0].runePool.power.Gold = 4; },
    s => { s.players[0].runePool.power.any = -1; },
    s => { s.players[0].runePool.energy = 1.2; },
    s => { s.players[0].runePool.energy = NaN; },
    s => { s.players[0].runePool.energy = Number.MAX_SAFE_INTEGER + 1; },
    s => { s.players[0].runePool.energy = Number.MAX_SAFE_INTEGER; s.players[0].runePool.power.Calm = 1; },
    s => { s.players[0].runeDeck[0].uid = s.players[1].runeDeck[0].uid; },
    s => { s.bases[0].baseRunes.push({ ...s.players[0].runeDeck[0], readied: true, ownerPlayerId: 'p1', controllerPlayerId: 'p1', locationId: 'base:p1' }); },
    s => { s.bases[0].goldTokens.push({ uid: 'r4', readied: true, ownerPlayerId: 'p1', controllerPlayerId: 'p1', locationId: 'base:p1' }); },
    s => { s.retiredGoldUids.push('r1'); },
    s => { s.retiredGoldUids.push('g'); s.retiredGoldUids.push('g'); },
    s => { s.bases[0].locationId = 'base:p2'; },
    s => { s.players[0].runeDeck[0].domain = 'Gold'; },
    s => { s.players[0].runeDeck[0].cardId = null; },
    s => { s.bases[0].goldTokens.push({ uid: 'g', readied: true, ownerPlayerId: 'p2', controllerPlayerId: 'p1', locationId: 'base:p1' }); },
    s => { s.bases[0].baseRunes.push({ ...basic('new', 'Body'), readied: true, ownerPlayerId: 'p1', controllerPlayerId: 'p2', locationId: 'base:p1' }); },
    s => { s.bases[0].extra = 'private data'; },
    s => { s.players.pop(); },
  ];
  for (const change of variants) {
    const s = json(state); change(s);
    unchangedOnError(s, () => restoreDuelResources(s, locs));
  }
  let s = json(state); s.players[0].runeDeck[2].uid = 'r4';
  assert.throws(() => assertDuelResources(s));
  s = json(state); delete s.players[0].runePool.power.any;
  assert.throws(() => restoreDuelResources(s, locs));
  s = json(state); s.players[0].runeDeck.push({ ...basic('r9', 'Fury'), x: true });
  assert.throws(() => restoreDuelResources(s, locs));
  s = json(state); Object.defineProperty(s, 'private', { value: 7, enumerable: false });
  assert.throws(() => restoreDuelResources(s, locs), /unknown keys/);
  s = json(state); Object.defineProperty(s.players[0], 'runePool', { get: () => state.players[0].runePool, enumerable: true });
  assert.throws(() => restoreDuelResources(s, locs), /accessors/);
  s = json(state); s.players[0].runeDeck.length = 4; // sparse array
  assert.throws(() => restoreDuelResources(s, locs), /dense/);
  s = json(state); s.players[0].runeDeck.note = 'leak';
  assert.throws(() => restoreDuelResources(s, locs), /extra keys/);
});

test('channel consumes top in order, can take fewer, defaults ready, effect may explicitly exhaust; no energy added', () => {
  const state = initial();
  const after = channelDuelRunes(state, 'p1', 2);
  assert.deepEqual(after.bases[0].baseRunes.map(r => r.uid), ['r1', 'r2']);
  assert.deepEqual(after.players[0].runeDeck.map(r => r.uid), ['r3']);
  assert.ok(after.bases[0].baseRunes.every(r => r.readied && r.locationId === locs[0].locationId));
  const exhausted = channelDuelRunes(after, 'p1', 4, false);
  assert.deepEqual(exhausted.bases[0].baseRunes.map(r => [r.uid, r.readied]), [['r1', true], ['r2', true], ['r3', false]]);
  assert.equal(exhausted.players[0].runeDeck.length, 0);
  assert.equal(summary(exhausted).energy, 0);
  assert.equal(channelDuelRunes(exhausted, 'p1', 2).bases[0].baseRunes.length, 3);
  unchangedOnError(state, () => channelDuelRunes(state, 'p1', -1));
  unchangedOnError(state, () => channelDuelRunes(state, 'p1', 1.5));
  unchangedOnError(state, () => channelDuelRunes(state, 'intruder', 1));
});

test('reaction permissions: priority even Closed/Showdown or actor paying; foreign/no-priority/invalid denied', () => {
  const state = channelDuelRunes(initial(), 'p1', 1);
  for (const timing of [noPriority, otherPaying, { ...payment, resourcePaymentPlayerId: 'intruder' }, { ...payment, stateOpen: 1 },
    { ...payment, priorityPlayerId: 'intruder' }]) {
    unchangedOnError(state, () => activateBasicRuneEnergy(state, 'p1', 'r1', timing));
  }
  unchangedOnError(state, () => activateBasicRuneEnergy(state, 'p2', 'r1', priority));
  unchangedOnError(state, () => activateBasicRuneEnergy(state, 'p1', 'not-found', priority));
  const throughPriority = activateBasicRuneEnergy(state, 'p1', 'r1', priority);
  const throughClosedPriority = activateBasicRuneEnergy(state, 'p1', 'r1', closed);
  const throughPay = activateBasicRuneEnergy(state, 'p1', 'r1', payment);
  assert.deepEqual(throughPriority, throughClosedPriority);
  assert.deepEqual(throughPriority, throughPay);
  unchangedOnError(throughPay, () => activateBasicRuneEnergy(throughPay, 'p1', 'r1', payment), /exhausted/);
  assert.equal(summary(throughPay).energy, 1);
  assert.equal(state.bases[0].baseRunes[0].readied, true);
});

test('Rune recycling after exhaustion goes to bottom, adds its own Power, cannot reactivate absent source', () => {
  let state = channelDuelRunes(initial(), 'p1', 2);
  state = activateBasicRuneEnergy(state, 'p1', 'r1', priority);
  const recycled = activateBasicRunePower(state, 'p1', 'r1', payment);
  assert.deepEqual(recycled.players[0].runeDeck.map(r => r.uid), ['r3', 'r1']);
  assert.deepEqual(recycled.players[0].runeDeck.at(-1), basic('r1', 'Calm'));
  assert.deepEqual(recycled.bases[0].baseRunes.map(r => r.uid), ['r2']);
  assert.equal(summary(recycled).power.Calm, 1);
  assert.equal(summary(recycled).energy, 1);
  unchangedOnError(recycled, () => activateBasicRunePower(recycled, 'p1', 'r1', payment), /no such own/);
  const again = channelDuelRunes(recycled, 'p1', 2);
  assert.deepEqual(again.bases[0].baseRunes.map(r => r.uid), ['r2', 'r3', 'r1']);
  assert.ok(again.bases[0].baseRunes[2].readied);
});

test('Gold is a ready/exhausted Gear token, 0 Energy required, consumed once as any Power; tombstone prevents UID reuse', () => {
  const original = initial();
  unchangedOnError(original, () => createDuelGoldToken(original, { uid: 'g1', playerId: 'p1', locationId: 'base:p1' }), /missing/);
  unchangedOnError(original, () => createDuelGoldToken(original, { uid: 'r1', playerId: 'p1', locationId: 'base:p1', readied: true }), /reused/);
  unchangedOnError(original, () => createDuelGoldToken(original, { uid: 'g1', playerId: 'p1', locationId: 'base:p2', readied: true }));
  const exhausted = createDuelGoldToken(original, { uid: 'g2', playerId: 'p1', locationId: 'base:p1', readied: false });
  unchangedOnError(exhausted, () => activateDuelGoldPower(exhausted, 'p1', 'g2', priority), /exhausted/);
  let state = createDuelGoldToken(original, { uid: 'g1', playerId: 'p1', locationId: 'base:p1', readied: true });
  unchangedOnError(state, () => activateDuelGoldPower(state, 'p2', 'g1', payment));
  unchangedOnError(state, () => activateDuelGoldPower(state, 'p1', 'g1', noPriority));
  assert.equal(activateDuelGoldPower(state, 'p1', 'g1', closed).players[0].runePool.power.any, 1);
  state = activateDuelGoldPower(state, 'p1', 'g1', payment);
  assert.equal(summary(state).energy, 0);
  assert.equal(summary(state).power.any, 1);
  assert.deepEqual(state.bases[0].goldTokens, []);
  assert.deepEqual(state.retiredGoldUids, ['g1']);
  unchangedOnError(state, () => activateDuelGoldPower(state, 'p1', 'g1', payment), /no such own/);
  unchangedOnError(state, () => createDuelGoldToken(state, { uid: 'g1', playerId: 'p2', locationId: 'base:p2', readied: true }), /reused/);
  const paid = payDuelRuneCost(state, 'p1', cost(0, [req(['Order'])]), payment).resources;
  assert.equal(summary(paid).power.any, 0);
});

test('clear all players twice at official turn callsites; preserve exhausted runes and unspent tokens', () => {
  let state = channelDuelRunes(initial(), 'p1', 1);
  state = activateBasicRuneEnergy(state, 'p1', 'r1', priority);
  state = createDuelGoldToken(state, { uid: 'g', playerId: 'p1', locationId: 'base:p1', readied: false });
  const raw = json(state);
  raw.players[1].runePool.energy = 2;
  raw.players[1].runePool.power.Fury = 1;
  state = restoreDuelResources(raw, locs);
  for (const point of ['Main start', 'turn end']) {
    const next = clearAllDuelRunePools(state);
    for (const p of next.players) assert.deepEqual(p.runePool, initial([], []).players[0].runePool, point);
    assert.deepEqual(next.bases, state.bases);
    assert.deepEqual(next.players.map(p => p.runeDeck), state.players.map(p => p.runeDeck));
    assert.notStrictEqual(next.bases[0].goldTokens, state.bases[0].goldTokens);
    assert.equal(state.players[0].runePool.energy, 1);
  }
});

test('real 6/2 → 5/1 → 3/1 payment, real [C], null power, Might never enters cost', () => {
  const start = acquire(initial(), 6, { Calm: 2 });
  const charm = payDuelRuneCost(start, 'p1', cost(1, [req(['Calm'])]), payment).resources;
  const divide = payDuelRuneCost(charm, 'p1', cost(2), payment).resources;
  assert.deepEqual([summary(charm).energy, summary(charm).power.Calm], [5, 1]);
  assert.deepEqual([summary(divide).energy, summary(divide).power.Calm], [3, 1]);
  assert.equal(summary(start).energy, 6);
  const foxFire = payDuelRuneCost(start, 'p1', cost(3), payment).resources;
  assert.equal(summary(foxFire).power.Calm, 2);
  const ahri = payDuelRuneCost(start, 'p1', cost(5, [req(['Calm'])]), payment).resources;
  assert.deepEqual([summary(ahri).energy, summary(ahri).power.Calm], [1, 1]);
  const wrong = acquire(initial(), 0, { Fury: 1 });
  unchangedOnError(wrong, () => payDuelRuneCost(wrong, 'p1', cost(0, [req(['Calm'])]), payment), /insufficient/);
  assert.equal(payDuelRuneCost(wrong, 'p1', cost(0, [req(all)]), payment).resources.players[0].runePool.power.Fury, 0);
});

test('non-greedy matching: flexible multi-domain must leave Calm for strict Calm; [A] pooled shared once', () => {
  const state = acquire(initial(), 2, { Calm: 1, Mind: 1 });
  const r = payDuelRuneCost(state, 'p1', cost(2, [req(['Calm', 'Mind']), req(['Calm'])]), payment);
  assert.deepEqual(r.plan.power.map(a => [a.requirementIndex, a.from, a.amount]).sort(), [[0, 'Mind', 1], [1, 'Calm', 1]]);
  assert.equal(summary(r.resources).power.Calm, 0);
  assert.equal(summary(r.resources).power.Mind, 0);
  assert.equal(summary(r.resources).energy, 0);
  const shared = acquire(initial(), 0, { any: 1, Fury: 1 });
  const allocated = payDuelRuneCost(shared, 'p1', cost(0, [req(['Calm']), req(['Fury'])]), payment);
  assert.deepEqual([summary(allocated.resources).power.any, summary(allocated.resources).power.Fury], [0, 0]);
  unchangedOnError(acquire(initial(), 0, { any: 1 }), () =>
    payDuelRuneCost(acquire(initial(), 0, { any: 1 }), 'p1', cost(0, [req(['Calm']), req(['Fury'])]), payment), /insufficient/);
  const large = acquire(initial(), 0, { Calm: 1_000_000, Mind: 1_000_000 });
  const many = payDuelRuneCost(large, 'p1', cost(0, [req(['Calm', 'Mind'], 1_000_000), req(['Calm'], 1_000_000)]), payment);
  assert.equal(summary(many.resources).power.Calm, 0);
});

test('explicit complete plan verifies every requirement, domain, source, count and pair uniqueness', () => {
  const state = acquire(initial(), 1, { Calm: 1, Mind: 1, any: 1 });
  const c = cost(1, [req(['Calm']), req(['Mind', 'Calm'], 2)]);
  const ok = { power: [{ requirementIndex: 0, from: 'any', amount: 1 }, { requirementIndex: 1, from: 'Calm', amount: 1 }, { requirementIndex: 1, from: 'Mind', amount: 1 }] };
  assert.deepEqual(payDuelRuneCost(state, 'p1', c, payment, ok).plan, ok);
  const errors = [
    { power: [{ requirementIndex: 0, from: 'Mind', amount: 1 }, ...ok.power.slice(1)] },
    { power: [{ requirementIndex: 0, from: 'any', amount: 2 }, ...ok.power.slice(1)] },
    { power: [{ requirementIndex: 0, from: 'Calm', amount: 1 }, { requirementIndex: 1, from: 'Calm', amount: 1 }, { requirementIndex: 1, from: 'Mind', amount: 1 }] },
    { power: ok.power.slice(1) },
    { power: [ok.power[0], ok.power[0], ...ok.power.slice(1)] },
    { power: [{ requirementIndex: 2, from: 'any', amount: 1 }, ...ok.power] },
    { power: [...ok.power, { requirementIndex: 1, from: 'any', amount: 1 }] },
    { power: [{ requirementIndex: 0, from: 'Gold', amount: 1 }, ...ok.power.slice(1)] },
    { power: [{ requirementIndex: 0, from: 'any', amount: 0 }, ...ok.power.slice(1)] },
    { power: [{ requirementIndex: 0, from: 'any', amount: 1.1 }, ...ok.power.slice(1)] },
    { power: [{ requirementIndex: 0, from: 'any', amount: 1, extraneous: 1 }, ...ok.power.slice(1)] },
  ];
  for (const plan of errors) unchangedOnError(state, () => payDuelRuneCost(state, 'p1', c, payment, plan));
  unchangedOnError(state, () => payDuelRuneCost(state, 'p1', c, otherPaying, ok));
  unchangedOnError(state, () => payDuelRuneCost(state, 'p2', c, payment, ok));
  unchangedOnError(state, () => payDuelRuneCost(state, 'p1', c, priority, ok));
});

test('invalid costs, Energy short, Power short, unsafe amount/sum and pool overflow are atomic', () => {
  const state = acquire(initial(), 1, { Calm: 1 });
  const bad = [cost(2, [req(['Calm'])]), cost(1, [req(['Calm'], 2)]), cost(0, [req(['Mind'])]),
    cost(-1), cost(1.4), cost(Number.MAX_SAFE_INTEGER + 1), cost(0, [req(['Calm'], 0)]),
    cost(0, [req(['Calm', 'Calm'])]), cost(0, [req([])]),
    cost(0, [req(['Calm'], Number.MAX_SAFE_INTEGER + 1)]),
    cost(Number.MAX_SAFE_INTEGER, [req(['Calm'])]),
    { energy: 0, power: [{ allowedDomains: ['Calm'], amount: 1, extra: 1 }] },
  ];
  for (const c of bad) unchangedOnError(state, () => payDuelRuneCost(state, 'p1', c, payment));
  const max = acquire(initial(), Number.MAX_SAFE_INTEGER);
  const channeled = channelDuelRunes(max, 'p1', 1);
  unchangedOnError(channeled, () => activateBasicRuneEnergy(channeled, 'p1', 'r1', priority), /overflows/);
  const maxPower = acquire(initial(), 0, { Calm: Number.MAX_SAFE_INTEGER });
  const withRune = channelDuelRunes(maxPower, 'p1', 1);
  unchangedOnError(withRune, () => activateBasicRunePower(withRune, 'p1', 'r1', priority), /overflows/);
  const withGold = createDuelGoldToken(acquire(initial(), 0, { any: Number.MAX_SAFE_INTEGER }), { uid: 'g', playerId: 'p1', locationId: 'base:p1', readied: true });
  unchangedOnError(withGold, () => activateDuelGoldPower(withGold, 'p1', 'g', priority), /overflows/);
});

test('projection exposes only pool/count/public base objects; restoration detached and does not randomize', () => {
  let state = initial();
  state = createDuelGoldToken(state, { uid: 'g', playerId: 'p1', locationId: 'base:p1', readied: true });
  state = activateDuelGoldPower(state, 'p1', 'g', priority);
  state = channelDuelRunes(state, 'p1', 1);
  const raw = json(state);
  const restored = restoreDuelResources(raw, locs);
  raw.players[0].runeDeck[0].cardId = 'other';
  raw.retiredGoldUids[0] = 'other';
  assert.equal(restored.players[0].runeDeck[0].cardId, 'print:Mind');
  const view = projectPublicDuelResources(restored);
  assert.deepEqual(Object.keys(view).sort(), ['bases', 'players']);
  assert.deepEqual(Object.keys(view.players[0]).sort(), ['playerId', 'runeDeckCount', 'runePool']);
  assert.equal(view.players[0].runeDeckCount, 2);
  assert.equal(JSON.stringify(view).includes('print:Mind'), false);
  assert.equal(JSON.stringify(view).includes('print:Order'), false);
  assert.equal(JSON.stringify(view).includes('retiredGoldUids'), false);
  assert.equal(JSON.stringify(view).includes('"uid":"g"'), false);
  assert.equal(view.bases[0].baseRunes[0].cardId, 'print:Calm');
  view.players[0].runePool.power.any = 10;
  view.bases[0].baseRunes[0].uid = 'edited';
  assert.equal(restored.players[0].runePool.power.any, 1);
  assert.equal(restored.bases[0].baseRunes[0].uid, 'r1');
});

test('same source cannot be reused; distinct legitimate payments may spend available remainder (network replay is external)', () => {
  const base = acquire(initial(), 3, { Calm: 2 });
  const first = payDuelRuneCost(base, 'p1', cost(1, [req(['Calm'])]), payment).resources;
  const second = payDuelRuneCost(first, 'p1', cost(1, [req(['Calm'])]), payment).resources;
  assert.deepEqual([summary(first).energy, summary(first).power.Calm], [2, 1]);
  assert.deepEqual([summary(second).energy, summary(second).power.Calm], [1, 0]);
  // Replaying the first *command* against first state would still pay again; outer command/version prevents it.
  assert.deepEqual(payDuelRuneCost(first, 'p1', cost(1, [req(['Calm'])]), payment).resources, second);
});
