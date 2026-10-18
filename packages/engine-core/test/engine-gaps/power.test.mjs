import assert from 'node:assert/strict';
import test from 'node:test';
import butcher from '../../../card-dsl/dist/cards/ven/butcher-of-the-sands.js';
import gold from '../../../card-dsl/dist/cards/sfd/gold.js';
import renata from '../../../card-dsl/dist/cards/sfd/renata-glasc-mastermind.js';
import {
  addResourceSource, clearResourcePool, createResourcePool, payResourceCost,
  prepareResourcePayment, projectResourcePool, resourcePoolFromDomains, restoreResourcePool
} from '../../dist/cost/resource-provenance.js';
import { assessCostPayment, prepareCostPlanResourcePayment } from '../../dist/cost/payment.js';
import {
  DUEL_DOMAINS, activateBasicRunePower, activateDuelGoldPower, channelDuelRunes,
  createDuelGoldToken, createDuelResources, payDuelRuneCost, restoreDuelResources
} from '../../dist/cost/resources.js';
import costModify from '../../dist/effects/instructions/cost.modify.js';
import costPay from '../../dist/effects/instructions/cost.pay.js';
import { runInstruction, world } from '../../dist/effects/testing/index.js';

const constant = value => ({ kind: 'constant', value });
const req = (allowedDomains, amount = 1) => ({ allowedDomains, amount });
const cost = (power = [], energy = 0) => ({ energy, power });
const lot = (id, resource, amount = 1, restriction) => ({
  id, resource, amount, ...(restriction === undefined ? {} : { restriction })
});
const pool = (...lots) => lots.reduce(addResourceSource, createResourcePool());
const spend = (use, showdown = false) => ({ purpose: { use, showdown } });
const originalCost = (program, index = 0) => program.abilities.filter(ability => ability.kind === 'activated')[index].cost;

test('Universal lots pay each of the six Domains without becoming colored resources', () => {
  for (const spelling of ['any', 'universal', 'universal-power']) {
    const initial = pool(lot('wild', spelling, 7), lot('colored', 'Fury'));
    const before = structuredClone(initial);
    const paid = payResourceCost(initial, cost(DUEL_DOMAINS.map(domain => req([domain]))));
    assert.equal(paid.pool.sources.find(source => source.id === 'wild').resource, 'any');
    assert.equal(paid.pool.sources.find(source => source.id === 'wild').amount, 2);
    assert.equal(paid.pool.sources.find(source => source.id === 'colored').amount, 0);
    assert.equal(paid.payment.sources.reduce((n, entry) => n + entry.amount, 0), 6);
    assert.deepEqual(initial, before);
  }
});

test('[A] costs consume actual sources and cannot produce Universal Power', () => {
  const initial = resourcePoolFromDomains(0, ['Mind', 'Order']);
  const paid = payResourceCost(initial, cost([req(DUEL_DOMAINS, 2)]));
  assert.deepEqual(paid.payment.power.power, [
    { requirementIndex: 0, from: 'Mind', amount: 1 },
    { requirementIndex: 0, from: 'Order', amount: 1 }
  ]);
  assert.equal(projectResourcePool(initial).power.any, 0);
  assert.equal(projectResourcePool(paid.pool).power.any, 0);
  assert.deepEqual(projectResourcePool(paid.pool).power, Object.fromEntries([...DUEL_DOMAINS, 'any'].map(domain => [domain, 0])));
});

test('overlapping hybrid costs preserve the exact max-flow allocation with restricted lots', () => {
  const initial = pool(lot('fury', 'Fury', 1, { uses: ['play-spell'] }), lot('calm', 'Calm'));
  const paid = payResourceCost(initial, cost([req(['Fury', 'Calm']), req(['Fury'])]), spend('play-spell'));
  assert.deepEqual(paid.payment.sources, [
    { sourceId: 'fury', amount: 1, requirementIndex: 1 },
    { sourceId: 'calm', amount: 1, requirementIndex: 0 }
  ]);
  assert.deepEqual(paid.pool.sources.map(source => source.amount), [0, 0]);
});

test('2,560 source/purpose/cost combinations agree with an independent per-slot feasibility oracle', () => {
  const shapes = [['Fury'], ['Calm'], ['Fury', 'Calm']];
  const costs = [cost(), ...shapes.map(domains => cost([req(domains)])),
    ...shapes.flatMap(a => shapes.map(b => cost([req(a), req(b)]))),
    ...shapes.map(domains => cost([req(domains, 2)]))];
  const contexts = [
    { options: {}, eligible: [0, 2] },
    { options: spend('play-unit'), eligible: [0, 1, 2] },
    { options: spend('play-spell'), eligible: [0, 2, 3] },
    { options: spend('play-unit', true), eligible: [0, 1, 2, 4] },
    { options: spend('play-spell', true), eligible: [0, 2, 3, 4] }
  ];
  // Deliberately assign individual demand slots by backtracking. This oracle
  // neither aggregates source colors nor calls the production flow allocator.
  const feasible = (inventory, requirement, eligible) => {
    const slots = requirement.power.flatMap(entry => Array.from({ length: entry.amount }, () => entry.allowedDomains));
    const left = inventory.sources.map(source => source.amount);
    const fill = index => {
      if (index === slots.length) return true;
      for (const i of eligible) {
        const source = inventory.sources[i];
        if (!left[i] || source.resource !== 'any' && !slots[index].includes(source.resource)) continue;
        left[i]--;
        if (fill(index + 1)) return true;
        left[i]++;
      }
      return false;
    };
    return fill(0);
  };
  let cases = 0;
  for (let mask = 0; mask < 32; mask++) {
    const amount = i => mask >> i & 1;
    const initial = pool(lot('fury', 'Fury', amount(0)), lot('unit', 'Fury', amount(1), { uses: ['play-unit'] }),
      lot('calm', 'Calm', amount(2)), lot('spell', 'any', amount(3), { uses: ['play-spell'] }),
      lot('showdown', 'any', amount(4), { showdownOnly: true }));
    const before = structuredClone(initial);
    for (const { options, eligible } of contexts) for (const requirement of costs) {
      cases++;
      if (!feasible(initial, requirement, eligible)) {
        assert.throws(() => payResourceCost(initial, requirement, options), /insufficient matching Power/);
        continue;
      }
      const paid = payResourceCost(initial, requirement, options);
      const covered = requirement.power.map(() => 0);
      for (const allocation of paid.payment.sources) {
        const i = initial.sources.findIndex(source => source.id === allocation.sourceId);
        assert.ok(eligible.includes(i));
        covered[allocation.requirementIndex] += allocation.amount;
      }
      assert.deepEqual(covered, requirement.power.map(entry => entry.amount));
      assert.ok(paid.pool.sources.every(source => source.amount >= 0));
      assert.equal(paid.pool.sources.reduce((n, source) => n + source.amount, 0),
        initial.sources.reduce((n, source) => n + source.amount, 0) - covered.reduce((a, b) => a + b, 0));
      const explicit = payResourceCost(initial, requirement, { ...options, power: paid.payment.power, sources: paid.payment.sources });
      assert.deepEqual(explicit, paid);
    }
    assert.deepEqual(initial, before);
  }
  assert.equal(cases, 2560);
});

test('restricted Universal sources retain their independent limits when mixed with unrestricted Power', () => {
  const initial = pool(lot('spells', 'universal', 2, { uses: ['play-spell'] }), lot('free', 'Mind'));
  const requirement = cost([req(['Mind'])]);
  const unit = payResourceCost(initial, requirement, spend('play-unit'));
  assert.deepEqual(unit.payment.sources, [{ sourceId: 'free', amount: 1, requirementIndex: 0 }]);
  assert.equal(unit.pool.sources[0].amount, 2);
  const spell = payResourceCost(initial, cost([req(['Order'])]), spend('play-spell'));
  assert.deepEqual(spell.payment.sources, [{ sourceId: 'spells', amount: 1, requirementIndex: 0 }]);
  assert.equal(spell.pool.sources[0].amount, 1);
  assert.equal(spell.pool.sources[1].amount, 1);
  assert.throws(() => payResourceCost(initial, cost([req(['Order'])]), spend('play-unit')), /insufficient matching Power/);
  assert.throws(() => payResourceCost(initial, cost([req(['Order'])])), /insufficient matching Power/);
});

test('Energy restricted to showdowns is unavailable outside them and requires no activation-time restriction', () => {
  const initial = pool(lot('showdown', 'energy', 2, { showdownOnly: true }), lot('free', 'energy'));
  const before = structuredClone(initial);
  assert.throws(() => payResourceCost(initial, cost([], 2), spend('play-spell')), /insufficient Energy/);
  assert.throws(() => payResourceCost(initial, cost([], 2)), /insufficient Energy/);
  const paid = payResourceCost(initial, cost([], 2), spend('play-spell', true));
  assert.deepEqual(paid.payment.sources, [{ sourceId: 'showdown', amount: 2 }]);
  assert.deepEqual(paid.pool.sources.map(source => source.amount), [0, 1]);
  assert.deepEqual(initial, before);
});

test('uses are alternatives, while independent use/window limits must both hold (054.2)', () => {
  const initial = pool(lot('gear', 'any', 2, { uses: ['play-gear', 'activate-gear'], showdownOnly: true }));
  for (const use of ['play-gear', 'activate-gear']) {
    assert.equal(payResourceCost(initial, cost([req(['Chaos'])]), spend(use, true)).pool.sources[0].amount, 1);
    assert.throws(() => payResourceCost(initial, cost([req(['Chaos'])]), spend(use)), /insufficient matching Power/);
  }
  for (const use of ['play-unit', 'play-spell', 'activate-unit', 'activate-legend']) {
    assert.throws(() => payResourceCost(initial, cost([req(['Chaos'])]), spend(use, true)), /insufficient matching Power/);
  }
});

test('explicit source selection spends the chosen lot, preserving a same-color lot with a different purpose', () => {
  const initial = pool(lot('free', 'Fury', 2), lot('spells', 'Fury', 2, { uses: ['play-spell'] }));
  const paid = payResourceCost(initial, cost([req(['Fury'])]), {
    ...spend('play-spell'), sources: [{ sourceId: 'spells', amount: 1, requirementIndex: 0 }]
  });
  assert.deepEqual(paid.pool.sources.map(source => source.amount), [2, 1]);
  assert.deepEqual(paid.payment.power.power, [{ requirementIndex: 0, from: 'Fury', amount: 1 }]);
});

test('explicit Power and source plans must agree on every domain and requirement', () => {
  const initial = pool(lot('fury', 'Fury'), lot('wild', 'any'));
  const requirement = cost([req(DUEL_DOMAINS)]);
  const sources = [{ sourceId: 'wild', amount: 1, requirementIndex: 0 }];
  assert.throws(() => payResourceCost(initial, requirement, {
    power: { power: [{ requirementIndex: 0, from: 'Fury', amount: 1 }] }, sources
  }), /disagree/);
  const paid = payResourceCost(initial, requirement, {
    power: { power: [{ requirementIndex: 0, from: 'any', amount: 1 }] }, sources
  });
  assert.deepEqual(paid.pool.sources.map(source => source.amount), [1, 0]);
});

test('payment rechecks purpose and capacity instead of trusting a prepared or stale source selection', () => {
  const initial = pool(lot('wild', 'any', 1, { uses: ['play-spell'] }));
  const requirement = cost([req(['Order'])]);
  const prepared = prepareResourcePayment(initial, requirement, spend('play-spell'));
  const paid = payResourceCost(initial, requirement, { ...spend('play-spell'), sources: prepared.sources });
  const before = structuredClone(paid.pool);
  assert.throws(() => payResourceCost(paid.pool, requirement, { ...spend('play-spell'), sources: prepared.sources }), /insufficient matching Power/);
  assert.throws(() => payResourceCost(initial, requirement, { ...spend('play-unit'), sources: prepared.sources }), /insufficient matching Power/);
  assert.deepEqual(paid.pool, before);
});

test('forged, overallocated, duplicate, wrong-domain and cross-resource selections fail atomically', () => {
  const initial = pool(lot('energy', 'energy', 2), lot('fury', 'Fury', 2), lot('wild', 'any', 2));
  const requirement = cost([req(['Order'])], 1);
  const energy = { sourceId: 'energy', amount: 1 };
  const power = { sourceId: 'wild', amount: 1, requirementIndex: 0 };
  const invalid = [
    [energy], [power],
    [energy, { ...power, sourceId: 'missing' }],
    [energy, { ...power, sourceId: 'fury' }],
    [energy, { ...power, amount: 3 }],
    [energy, { ...power, amount: 0 }],
    [energy, power, power],
    [{ ...energy, amount: 2 }, power],
    [energy, { ...power, requirementIndex: 5 }],
    [energy, { ...power, sourceId: 'energy' }],
    [{ sourceId: 'fury', amount: 1 }, power],
    [energy, { ...power, extra: true }]
  ];
  const before = structuredClone(initial);
  for (const sources of invalid) {
    assert.throws(() => payResourceCost(initial, requirement, { sources }), TypeError);
    assert.deepEqual(initial, before);
  }
});

test('successful payment cannot spend a restricted lot through an unrestricted same-domain surrogate', () => {
  const initial = pool(lot('free', 'Order'), lot('spells', 'Order', 2, { uses: ['play-spell'] }));
  const before = structuredClone(initial);
  assert.throws(() => payResourceCost(initial, cost([req(['Order'])]), {
    ...spend('play-unit'), sources: [{ sourceId: 'spells', amount: 1, requirementIndex: 0 }]
  }), /unavailable source allocation/);
  assert.deepEqual(initial, before);
});

test('inventory restoration preserves source identity, restrictions and detached origin references', () => {
  const origin = { id: 'source', zoneEntryId: 3 };
  const limit = { uses: ['play-spell'] };
  const initial = addResourceSource(createResourcePool(), { ...lot('wild', 'universal-power', 3, limit), origin });
  origin.zoneEntryId = 9;
  limit.uses.push('play-unit');
  assert.deepEqual(initial.sources[0].origin, { id: 'source', zoneEntryId: 3 });
  assert.deepEqual(initial.sources[0].restriction, { uses: ['play-spell'] });
  const restored = restoreResourcePool(JSON.parse(JSON.stringify(initial)));
  assert.deepEqual(restored, initial);
  const paid = payResourceCost(restored, cost([req(['Mind'])]), spend('play-spell'));
  assert.equal(restored.sources[0].amount, 3);
  assert.equal(paid.pool.sources[0].amount, 2);
  assert.notStrictEqual(restored.sources[0].origin, paid.pool.sources[0].origin);
});

test('unknown restrictions/sources, null quantities and unsafe inventory cannot become unrestricted or zero', () => {
  const invalid = [
    lot('x', 'rainbow'), lot('x', 'Unknown'), lot('x', 'energy', null),
    lot('x', 'energy', -1), lot('x', 'energy', 0.5), lot('x', 'energy', Number.MAX_SAFE_INTEGER + 1),
    lot('x', 'any', 1, { kind: 'unknown' }), lot('x', 'any', 1, {}),
    lot('x', 'any', 1, { uses: [] }), lot('x', 'any', 1, { uses: ['unknown'] }),
    lot('x', 'any', 1, { uses: ['play-unit', 'play-unit'] }),
    lot('x', 'any', 1, { showdownOnly: 'true' }),
    { ...lot('x', 'any'), origin: { id: 'unit', zoneEntryId: null } }
  ];
  for (const source of invalid) assert.throws(() => pool(source), TypeError);
  assert.throws(() => pool(lot('same', 'any'), lot('same', 'energy')), /duplicate source ID/);
  assert.throws(() => pool(lot('huge', 'energy', Number.MAX_SAFE_INTEGER), lot('one', 'any')), /safe integer/);
  const safe = pool(lot('x', 'energy', Number.MAX_SAFE_INTEGER));
  assert.equal(payResourceCost(safe, cost([], Number.MAX_SAFE_INTEGER)).pool.sources[0].amount, 0);
});

test('source pool rejects accessors and malformed arrays without evaluating caller code', () => {
  let calls = 0;
  const source = lot('x', 'any');
  Object.defineProperty(source, 'amount', { enumerable: true, get() { calls++; return 1; } });
  assert.throws(() => pool(source), /accessors/);
  assert.equal(calls, 0);
  const sparse = [lot('x', 'any')];
  sparse.length = 2;
  assert.throws(() => restoreResourcePool({ sources: sparse }), /dense/);
  assert.throws(() => prepareResourcePayment(createResourcePool(), cost(), { purpose: { use: 'unknown' } }), /unknown spending purpose/);
});

test('pool clearing expires all unused Universal, colored and restricted Energy lots (167)', () => {
  const initial = pool(lot('wild', 'any', 2), lot('fury', 'Fury'), lot('limited', 'energy', 3, { showdownOnly: true }));
  const before = structuredClone(initial);
  assert.deepEqual(clearResourcePool(initial), { sources: [] });
  assert.deepEqual(initial, before);
  assert.throws(() => payResourceCost(clearResourcePool(initial), cost([req(['Fury'])])), /insufficient matching Power/);
});

// Original card cost IR is passed unmodified to the real cost.modify/cost.pay
// primitives. This proves the payable cost slice, not whole-card executability:
// the source program remains judge-required until Add/Host integration lands.
function cardCost(program, power = ['Mind', 'Mind', 'Mind', 'Mind'], exhausted = false) {
  // The current production lifecycle leaves Legends in chain. Use that real
  // representation only to read Butcher's cost; never place a Legend on the
  // Board to make its unsupported Exhaust payment appear executable.
  const legend = program === butcher;
  const initial = world().player('A', { energy: 4, power }).object('source', {
    cardId: program.canonicalCardId, types: [legend ? 'legend' : 'unit'],
    zone: legend ? 'chain' : 'board', energy: legend ? null : 5, power: null, might: legend ? null : 4,
    location: legend ? null : { type: 'battlefield', id: 'bf-1' }, exhausted
  }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.object(initial.ref('source')) });
  const planned = runInstruction(costModify, { id: 'original-card-cost', cost: originalCost(program, legend ? 0 : 1) }, { world: kernel });
  return { kernel, plan: planned.linked.cost };
}
function payLocked(kernel, plan) {
  return runInstruction(costPay, { cost: constant(plan) }, { world: kernel });
}

test('Butcher original [A][A] cost IR allocates real Universal and restricted source lots', () => {
  const { kernel, plan } = cardCost(butcher);
  const initial = pool(lot('wild', 'universal'), lot('gear', 'Order', 1, { uses: ['play-unit', 'activate-unit'] }), lot('mind', 'Mind'));
  const payment = prepareCostPlanResourcePayment(initial, plan, spend('activate-legend'));
  assert.equal(payment.power.power.reduce((n, entry) => n + entry.amount, 0), 2);
  assert.ok(payment.sources.some(entry => entry.sourceId === 'wild'));
  assert.ok(payment.sources.some(entry => entry.sourceId === 'mind'));
  assert.ok(payment.sources.every(entry => entry.sourceId !== 'gear'));
  const paid = payResourceCost(initial, { energy: plan.total.energy, power: plan.total.power }, {
    ...spend('activate-legend'), sources: payment.sources
  });
  assert.deepEqual(paid.pool.sources.map(source => source.amount), [0, 1, 0]);
  assert.deepEqual(plan.printed, { energy: null, power: null });
  assert.equal(kernel.source.energy, null);
  assert.equal(kernel.source.power, null);
  assert.equal(butcher.status, 'judge-required');
});

test('Renata original cost IR settles actual Energy, Mind Power and Exhaust through production primitives', () => {
  const { kernel, plan } = cardCost(renata);
  const paid = payLocked(kernel, plan);
  assert.equal(paid.result.status, 'executed');
  assert.deepEqual(kernel.player('A').power, []);
  assert.equal(kernel.player('A').energy, 0);
  assert.equal(kernel.object(kernel.ref('source')).exhausted, true);
  assert.deepEqual(paid.events.map(event => event.action), ['pay', 'exhaust']);
  assert.deepEqual(plan.printed, { energy: 5, power: null });
});

test('Renata original cost IR rejects insufficient Power and an already exhausted source without mutation', () => {
  for (const [power, exhausted] of [[['Mind'], false], [['Mind', 'Mind', 'Mind', 'Mind'], true]]) {
    const { kernel, plan } = cardCost(renata, power, exhausted);
    const before = kernel.snapshot();
    assert.throws(() => payLocked(kernel, plan), error => error.reason === 'cannot-pay-cost');
    assert.deepEqual(kernel.snapshot(), before);
  }
});

test('legacy pool overflow remains a cannot-pay assessment rather than escaping as an unclassified TypeError', () => {
  const initial = world().player('A', { energy: Number.MAX_SAFE_INTEGER, power: ['Mind'] }).unit('source', {
    cardId: renata.canonicalCardId, energy: 5, power: null, location: { type: 'battlefield', id: 'bf-1' }
  }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.object(initial.ref('source')) });
  const { linked } = runInstruction(costModify, { id: 'renata-cost', cost: originalCost(renata) }, { world: kernel });
  const before = kernel.snapshot();
  const assessment = assessCostPayment(kernel, linked.cost);
  assert.equal(assessment.payable, false);
  assert.equal(assessment.error.reason, 'cannot-pay-cost');
  assert.match(assessment.error.message, /safe integer/);
  assert.deepEqual(kernel.snapshot(), before);
});

function goldCost() {
  const initial = world().object('source', {
    cardId: gold.canonicalCardId, types: ['gear'], zone: 'board', location: { type: 'base', player: 'A' },
    isToken: true, energy: null, power: null
  }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.object(initial.ref('source')) });
  const { linked } = runInstruction(costModify, { id: 'gold-cost', cost: originalCost(gold) }, { world: kernel });
  return { kernel, plan: linked.cost };
}

test('Gold original Kill/Exhaust cost consumes its source once and rejects the stale reference', () => {
  const { kernel, plan } = goldCost();
  const paid = payLocked(kernel, plan);
  assert.equal(paid.result.status, 'executed');
  assert.equal(kernel.object(kernel.ref('source')).zone, 'trash');
  assert.deepEqual(paid.events.map(event => event.action), ['pay', 'exhaust', 'kill']);
  const before = kernel.snapshot();
  assert.throws(() => payLocked(kernel, plan), error => error.reason === 'cannot-pay-cost');
  assert.deepEqual(kernel.snapshot(), before);
});

test('Gold original costs ordered Kill before Exhaust fail late and roll back the real zone change, events and links', () => {
  const { kernel, plan } = goldCost();
  const before = kernel.snapshot();
  const links = kernel.linkedSnapshot();
  const [exhaust, kill] = plan.total.actions;
  // 357.2 permits choosing an order, but killing first makes the later
  // Exhaust impossible. No replacement hooks or synthetic outcomes are used.
  assert.throws(() => runInstruction(costPay, {
    cost: constant(plan), nonstandardOrder: constant([kill.id, exhaust.id])
  }, { world: kernel }), error => error.reason === 'cannot-pay-cost' && /no longer/.test(error.message));
  assert.deepEqual(kernel.snapshot(), before);
  assert.deepEqual(kernel.linkedSnapshot(), links);
});

test('legacy resource Add/payment serialization retains the old shape and strictly restores without provenance fields', () => {
  const locations = [{ playerId: 'A', locationId: 'base:A' }, { playerId: 'B', locationId: 'base:B' }];
  const paying = { stateOpen: false, priorityPlayerId: null, resourcePaymentPlayerId: 'A' };
  const initial = createDuelResources({ playerIds: ['A', 'B'], baseLocations: locations, runeDecks: [[{ uid: 'r1', cardId: 'rune-fury', domain: 'Fury' }], []] });
  let state = channelDuelRunes(initial, 'A', 1);
  state = activateBasicRunePower(state, 'A', 'r1', paying);
  state = createDuelGoldToken(state, { uid: 'g1', playerId: 'A', locationId: 'base:A', readied: true });
  state = activateDuelGoldPower(state, 'A', 'g1', paying);
  const paid = payDuelRuneCost(state, 'A', cost([req(['Order']), req(['Fury'])]), paying);
  assert.equal(paid.resources.players[0].runePool.power.any, 0);
  assert.equal(paid.resources.players[0].runePool.power.Fury, 0);
  assert.deepEqual(Object.keys(paid.resources.players[0].runePool), ['energy', 'power']);
  const encoded = JSON.stringify(paid.resources);
  assert.equal(JSON.stringify(restoreDuelResources(JSON.parse(encoded), locations)), encoded);
  assert.equal(JSON.stringify(initial), JSON.stringify(createDuelResources({ playerIds: ['A', 'B'], baseLocations: locations, runeDecks: [[{ uid: 'r1', cardId: 'rune-fury', domain: 'Fury' }], []] })));
});
