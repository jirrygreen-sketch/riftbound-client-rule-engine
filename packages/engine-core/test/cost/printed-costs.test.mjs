// Verification for the printed base-cost binding kernel.
// The default suite reads ONLY the tracked minimal fixture at test/fixtures/printed-costs-cards.json,
// so it runs on a clean checkout where the gitignored official catalog is absent. The fixture records
// are field-for-field subsets of the official catalog; the full official-catalog sweep (every real
// printing, numeric and not-played) lives in test/duel-printed-costs.audit.mjs and is run explicitly.
// Payment assertions use the REAL compiled duel resources kernel; pool states are built through the
// trusted restoreDuelResources path, so this is an internal acceptance fixture, not an official match.
// Every binding assertion imports only the compiled formal duel module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DUEL_DOMAINS } from '../../dist/cost/resources.js';
import {
  createDuelResources, restoreDuelResources, createDuelGoldToken, activateDuelGoldPower, payDuelRuneCost,
} from '../../dist/cost/resources.js';
import { bindDuelPrintedCost, bindDuelPrintedCostRegistry } from '../../dist/cost/printed-costs.js';

/** Tracked minimal fixture: a projection of the official catalog, never the catalog itself. */
const FIXTURE_URL = new URL('../fixtures/printed-costs-cards.json', import.meta.url);
const fixture = JSON.parse(fs.readFileSync(FIXTURE_URL, 'utf8'));
const cards = fixture.cards;
const PLAYABLE_TYPES = ['Unit', 'Gear', 'Spell'];
const card = id => {
  const found = cards.find(entry => entry.id === id);
  assert.ok(found, `fixture is missing ${id}`);
  return found;
};
const playable = id => { const c = card(id); assert.ok(PLAYABLE_TYPES.includes(c.cardType)); return c; };

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const req = (domains, amount = 1) => ({ allowedDomains: domains, amount });
const expectNumeric = (binding, cardId, energy, power) => {
  assert.equal(binding.kind, 'numeric', `${cardId} should be numeric`);
  assert.equal(binding.cardId, cardId);
  assert.deepEqual(Object.keys(binding).sort(), ['cardId', 'cost', 'kind']);
  assert.deepEqual(Object.keys(binding.cost).sort(), ['energy', 'power']);
  assert.equal(binding.cost.energy, energy);
  assert.deepEqual(binding.cost.power, power);
  return binding.cost;
};
const expectNotPlayed = (binding, cardId, reason) => {
  assert.equal(binding.kind, 'not-played', `${cardId} should be not-played`);
  assert.equal(binding.cardId, cardId);
  assert.equal(binding.reason, reason);
  assert.deepEqual(Object.keys(binding).sort(), ['cardId', 'kind', 'reason']);
  return binding;
};

const locations = [{ playerId: 'p1', locationId: 'base:p1' }, { playerId: 'p2', locationId: 'base:p2' }];
const paymentWindow = { stateOpen: false, priorityPlayerId: null, resourcePaymentPlayerId: 'p1' };
/** Internal acceptance fixture: trusted restore constructs a pool. Never a client snapshot. */
function poolState({ energy = 0, power = {} }) {
  const raw = structuredClone(createDuelResources({ playerIds: ['p1', 'p2'], baseLocations: locations, runeDecks: [[], []] }));
  raw.players[0].runePool.energy = energy;
  for (const [source, amount] of Object.entries(power)) raw.players[0].runePool.power[source] += amount;
  return restoreDuelResources(raw, locations);
}
const poolOf = state => state.players[0].runePool;
const pay = (state, cost) => payDuelRuneCost(state, 'p1', cost, paymentWindow);
const deepFreeze = value => {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); }
  return value;
};

test('the default suite is self-contained: tracked fixture only, never the official catalog', () => {
  assert.ok(fs.statSync(FIXTURE_URL).isFile(), 'the tracked fixture must exist');
  assert.ok(cards.length > 0 && cards.length <= 30, 'the fixture stays minimal');
  // Guard against silently regressing to the gitignored official catalog: this very file must not
  // name it, and the fixture records must be the projected subset only.
  const selfSource = fs.readFileSync(new URL(import.meta.url), 'utf8');
  assert.ok(!selfSource.includes('deck' + '-catalog'), 'the default suite must not read the official catalog');
  const projected = [...fixture.projectedFields].sort();
  for (const c of cards) assert.deepEqual(Object.keys(c).sort(), projected, `${c.id} must be a plain projected record`);
  // The fixture keeps one representative per binding outcome the default suite asserts.
  assert.ok(cards.some(c => PLAYABLE_TYPES.includes(c.cardType) && c.energy !== null), 'fixture needs numeric printings');
  assert.ok(cards.some(c => c.energy === null), 'fixture needs null-Energy printings');
  assert.ok(cards.some(c => !PLAYABLE_TYPES.includes(c.cardType)), 'fixture needs unsupported-card-type printings');
});

test('five prototype hand cards bind to their exact printed base costs; Might is never a cost', () => {
  const ahri = playable('ogn-066-298');
  const foxFire = playable('ogn-256-298');
  const charm = playable('ogn-043-298');
  const emperor = playable('sfd-043-221');
  const navori = playable('sfd-037-221');

  // Real Might values must not leak into any cost dimension.
  assert.equal(ahri.might, 4);
  assert.equal(navori.might, 4);
  assert.equal(ahri.power, 1);
  assert.equal(foxFire.power, null);

  expectNumeric(bindDuelPrintedCost(ahri), 'ogn-066-298', 5, [req(['Calm'], 1)]);
  expectNumeric(bindDuelPrintedCost(foxFire), 'ogn-256-298', 3, []);
  expectNumeric(bindDuelPrintedCost(charm), 'ogn-043-298', 1, [req(['Calm'], 1)]);
  expectNumeric(bindDuelPrintedCost(emperor), 'sfd-043-221', 2, []);
  expectNumeric(bindDuelPrintedCost(navori), 'sfd-037-221', 4, []);

  // power=null is an absent Power cost (0), never the card's own Domain or its Might.
  for (const id of ['ogn-256-298', 'sfd-043-221', 'sfd-037-221']) {
    assert.deepEqual(bindDuelPrintedCost(card(id)).cost.power, []);
  }
});

test('Rune, Legend, Battlefield and Token are not normal-castable main cards', () => {
  const unsupported = cards.filter(c => !PLAYABLE_TYPES.includes(c.cardType));
  assert.ok(unsupported.length > 0);
  for (const c of unsupported) expectNotPlayed(bindDuelPrintedCost(c), c.id, 'unsupported-card-type');
  expectNotPlayed(bindDuelPrintedCost(card('rad-r01')), 'rad-r01', 'unsupported-card-type');       // Rune
  expectNotPlayed(bindDuelPrintedCost(card('ogn-247-298')), 'ogn-247-298', 'unsupported-card-type'); // Legend
  expectNotPlayed(bindDuelPrintedCost(card('ogn-275-298')), 'ogn-275-298', 'unsupported-card-type'); // Battlefield
  expectNotPlayed(bindDuelPrintedCost(card('unl-t04')), 'unl-t04', 'unsupported-card-type');         // Token
});

test('null Energy is not free 0: real Recruit/Sprite/Bird/Reflection/Gold printings are blocked', () => {
  const nullEnergy = cards.filter(c => ['Unit', 'Gear'].includes(c.cardType) && c.energy === null);
  assert.deepEqual(nullEnergy.map(c => c.id).sort(), [
    'ogn-271-298', 'ogn-272-298', 'ogn-273-298', 'ogn-274-298', 'sfd-t03',
    'unl-t02', 'unl-t05', 'unl-t06', 'unl-t07', 'ven-t04',
  ].sort());
  assert.ok(nullEnergy.every(c => c.domains.length === 1 && c.domains[0] === 'Colorless'));
  assert.deepEqual([...new Set(nullEnergy.map(c => c.fullName.split(' ')[0]))].sort(),
    ['Bird', 'Gold', 'Recruit', 'Reflection', 'Sprite']);
  assert.ok(nullEnergy.every(c => c.energy !== 0), 'null Energy must not be normalized into a literal 0');
  for (const c of nullEnergy) expectNotPlayed(bindDuelPrintedCost(c), c.id, 'no-printed-energy');
  // The same token printings are Gear/Unit, so only the Energy rule blocks them, not the card type.
  assert.ok(nullEnergy.every(c => c.cardType === 'Unit' || c.cardType === 'Gear'));

  // A printed literal 0 Energy is a legal numeric 0 (energy expects a real number, not "free").
  const seal = playable('ogn-040-298');
  assert.equal(seal.energy, 0);
  expectNumeric(bindDuelPrintedCost(seal), 'ogn-040-298', 0, [req(['Fury'], 1)]);
});

test('Power requirement flexes over a card multi-Domain set; Domainless [C] is processed as [A]', () => {
  const guerrilla = playable('ogn-264-298'); // Guerilla Warfare, Teemo: Mind, Chaos
  assert.deepEqual(guerrilla.domains, ['Mind', 'Chaos']);
  const guerrillaCost = expectNumeric(bindDuelPrintedCost(guerrilla), 'ogn-264-298', 2, [req(['Mind', 'Chaos'], 1)]);
  assert.notStrictEqual(guerrillaCost.power[0].allowedDomains, guerrilla.domains, 'output must be a deep copy');

  // Domainless card: [] (135.2.e.6.b) and the literal Colorless marker both mean all six Domains.
  const scorched = playable('rad-006-167');
  assert.deepEqual(scorched.domains, []);
  const scorchedCost = expectNumeric(bindDuelPrintedCost(scorched), 'rad-006-167', 4, [req([...DUEL_DOMAINS], 1)]);
  assert.notStrictEqual(scorchedCost.power[0].allowedDomains, DUEL_DOMAINS, 'must not alias the shared Domain list');

  const neeko = playable('rad-167-167'); // Unit, Colorless marker, energy 6 / power 1
  assert.deepEqual(neeko.domains, ['Colorless']);
  const neekoCost = expectNumeric(bindDuelPrintedCost(neeko), 'rad-167-167', 6, [req([...DUEL_DOMAINS], 1)]);

  // A scalar "total Power" is never produced: one allowedDomains requirement carries the amount.
  for (const cost of [guerrillaCost, scorchedCost, neekoCost]) {
    assert.equal(cost.power.length, 1);
    assert.equal(typeof cost.power[0].amount, 'number');
  }
});

test('malformed printed numbers and Domain lists are rejected, atomically, without mutation', () => {
  const base = () => ({ id: 'fixture:bad', cardType: 'Spell', domains: ['Calm'], energy: 1, power: null });
  const rejects = (card, label) => {
    assert.throws(() => bindDuelPrintedCost(card), /Duel printed cost/, label);
  };

  for (const bad of [-1, 1.5, NaN, Infinity, '5', undefined, true, -0.5, MAX_SAFE + 1]) {
    const c = { ...base(), energy: bad };
    rejects(c, `Energy ${String(bad)}`);
    assert.ok(Object.is(c.energy, bad), 'source Energy must be untouched');
    assert.deepEqual(c.domains, ['Calm']);
  }
  for (const bad of [-1, 2.5, NaN, Infinity, '1', undefined, MAX_SAFE + 1]) {
    const c = { ...base(), power: bad };
    rejects(c, `Power ${String(bad)}`);
    assert.ok(Object.is(c.power, bad), 'source Power must be untouched');
  }
  // Energy + Power total must stay a safe integer even when each component is safe.
  rejects({ ...base(), energy: MAX_SAFE, power: 1 }, 'total overflow');
  rejects({ ...base(), energy: MAX_SAFE - 1, power: 3 }, 'total overflow');
  // Malformed Domain labels: unknown, duplicate, Colorless mixed with a colored Domain, non-string.
  const domainCases = [['Weird'], ['Calm', 'Calm'], ['Colorless', 'Calm'], ['Calm', 'Colorless'], ['calm'], [42], [null], 'Calm'];
  for (const domains of domainCases) {
    const c = { ...base(), domains, power: 1 };
    rejects(c, `domains ${JSON.stringify(domains)}`);
    assert.deepEqual(c.domains, domains, 'source domains must be untouched');
  }
  // Missing tags are only rejected as records; card identity and cardType stay validated.
  for (const bad of [null, undefined, [], 7, 'x', Object.create({ energy: 1 })]) {
    assert.throws(() => bindDuelPrintedCost(bad), /Duel printed cost/);
  }
  rejects({ ...base(), id: '' }, 'empty id');
  rejects({ ...base(), id: 5 }, 'non-string id');
  rejects({ ...base(), cardType: '' }, 'empty cardType');
  rejects({ ...base(), cardType: 5 }, 'non-string cardType');
});

test('the registry binds each printing independently, keys by printing id, and rejects duplicate ids', () => {
  const cardsIn = [playable('ogn-066-298'), card('sfd-t03'), playable('ogn-256-298'), playable('ogn-264-298')];
  const frozen = deepFreeze(structuredClone(cardsIn));
  const registry = bindDuelPrintedCostRegistry(frozen);
  assert.ok(registry instanceof Map);
  assert.deepEqual([...registry.keys()], ['ogn-066-298', 'sfd-t03', 'ogn-256-298', 'ogn-264-298']);
  assert.equal(registry.get('ogn-066-298').kind, 'numeric');
  assert.equal(registry.get('sfd-t03').kind, 'not-played'); // a single token must not fail the batch
  assert.equal(registry.get('sfd-t03').reason, 'no-printed-energy');
  assert.deepEqual(frozen, cardsIn, 'registry must not mutate the fixture snapshot');

  // Printing identity is authoritative: distinct printings sharing one canonical card stay distinct.
  const seals = [playable('ogn-040-298'), playable('sfd-222-221')];
  assert.equal(seals[0].canonicalCardId, seals[1].canonicalCardId);
  const sealRegistry = bindDuelPrintedCostRegistry(seals);
  assert.deepEqual([...sealRegistry.keys()], ['ogn-040-298', 'sfd-222-221']);
  assert.ok(!sealRegistry.has(seals[0].canonicalCardId));

  assert.throws(() => bindDuelPrintedCostRegistry([playable('ogn-043-298'), playable('ogn-043-298')]), /duplicate printing ID/);
  assert.throws(() => bindDuelPrintedCostRegistry([card('sfd-t03'), card('sfd-t03')]), /duplicate printing ID/);
  assert.throws(() => bindDuelPrintedCostRegistry('nope'), /cards must be an array/);
  // Malformed numbers still propagate out of the registry (no silent partial registry).
  assert.throws(() => bindDuelPrintedCostRegistry([{ id: 'x', cardType: 'Spell', domains: ['Calm'], energy: -1, power: null }]),
    /Duel printed cost/);
});

test('real payDuelRuneCost consumes exactly the bound printed source costs', () => {
  const zeroPower = { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 };
  const pays = [
    ['ogn-066-298', { energy: 5, power: { Calm: 1 } }, zeroPower],
    // power=null spends no Power at all, even though matching Power sits in the pool.
    ['ogn-256-298', { energy: 3, power: { Calm: 2, Mind: 2 } }, { ...zeroPower, Calm: 2, Mind: 2 }],
    ['ogn-043-298', { energy: 1, power: { Calm: 1 } }, zeroPower],
    ['sfd-043-221', { energy: 2 }, zeroPower],
    ['sfd-037-221', { energy: 4 }, zeroPower],
  ];
  for (const [id, pool, expectedPower] of pays) {
    const binding = bindDuelPrintedCost(playable(id));
    const before = poolState(pool);
    const result = pay(before, binding.cost);
    assert.equal(poolOf(result.resources).energy, 0, `${id} Energy`);
    assert.deepEqual(poolOf(result.resources).power, expectedPower, `${id} Power`);
    assert.deepEqual(before, poolState(pool), 'payment must not mutate the source state');
  }

  // power=null cards never consume Power even when Power is available.
  const foxFire = bindDuelPrintedCost(playable('ogn-256-298'));
  const foxPool = poolState({ energy: 3, power: { Calm: 2 } });
  assert.equal(poolOf(pay(foxPool, foxFire.cost).resources).power.Calm, 2);

  // Energy checks are atomic: insufficient Energy fails before any Power is spent.
  assert.throws(() => pay(poolState({ energy: 2, power: { Calm: 1 } }), foxFire.cost), /insufficient Energy/);
});

test('real payment: multi-Domain Power flexes, a wrong Domain fails, and Gold any Power substitutes', () => {
  const rain = playable('ogn-248-298'); // Icathian Rain, Kai'Sa: Fury, Mind; energy 7 / power 3
  const rainCost = expectNumeric(bindDuelPrintedCost(rain), 'ogn-248-298', 7, [req(['Fury', 'Mind'], 3)]);

  const flexed = pay(poolState({ energy: 7, power: { Mind: 3 } }), rainCost);
  assert.deepEqual(poolOf(flexed.resources).power, { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 });
  const split = pay(poolState({ energy: 7, power: { Fury: 1, Mind: 2 } }), rainCost);
  assert.equal(poolOf(split.resources).power.Fury, 0);
  assert.equal(poolOf(split.resources).power.Mind, 0);

  // A Domain outside the requirement cannot pay it.
  assert.throws(() => pay(poolState({ energy: 7, power: { Body: 3 } }), rainCost), /insufficient matching Power/);
  assert.throws(() => pay(poolState({ energy: 7, power: { Body: 1, Mind: 2 } }), rainCost), /insufficient matching Power/);

  // Gold is a domainless Gear token that Adds [A]; an any Power pays a specific-Domain requirement.
  let goldState = poolState({ energy: 1 });
  goldState = createDuelGoldToken(goldState, { uid: 'gold:1', playerId: 'p1', locationId: 'base:p1', readied: true });
  goldState = activateDuelGoldPower(goldState, 'p1', 'gold:1', paymentWindow);
  assert.equal(poolOf(goldState).power.any, 1);
  const charmCost = bindDuelPrintedCost(playable('ogn-043-298')).cost;
  const paidByGold = pay(goldState, charmCost);
  assert.equal(poolOf(paidByGold.resources).energy, 0);
  assert.equal(poolOf(paidByGold.resources).power.any, 0);
  assert.equal(poolOf(paidByGold.resources).power.Calm, 0);
  assert.deepEqual(paidByGold.resources.bases[0].goldTokens, []);
  assert.deepEqual(paidByGold.resources.retiredGoldUids, ['gold:1']);

  // Without any Power, the same Charm cost still fails the Power check.
  assert.throws(() => pay(poolState({ energy: 1 }), charmCost), /insufficient matching Power/);
});
