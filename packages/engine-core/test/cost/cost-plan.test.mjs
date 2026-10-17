import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCostPlan, buildHiddenCostPlan } from '../../dist/cost/cost-plan.js';
import { payCostPlan, prepareCostPayment } from '../../dist/cost/payment.js';
import { CostPlanError } from '../../dist/cost/plan-types.js';
import {
  DUEL_DOMAINS, activateBasicRunePower, channelDuelRunes, createDuelResources,
  clearAllDuelRunePools, payDuelRuneCost, planDuelRunePayment
} from '../../dist/cost/resources.js';
import { world, runInstruction, AwaitChoice } from '../../dist/effects/testing/index.js';

const literal = value => ({ kind: 'constant', value });
const energy = amount => ({ energy: literal(amount) });
const power = (amount = 1, allowedDomains = ['Fury']) => ({ payments: [{ kind: 'power', amount: literal(amount), allowedDomains }] });
const printed = (values = {}) => ({ id: 'source', cardType: 'Spell', energy: 3, power: 0, domains: ['Fury'], ...values });
const input = (values = {}) => ({ id: 'play', cost: { kind: 'printed' }, printed: printed(), ...values });
const discount = (id, amount, values = {}) => ({ id, resource: 'energy', amount: literal(amount), ...values });
const payment = (kind, object, values = {}) => ({ payments: [{ kind, object, ...values }] });
const build = (ctx, values = {}) => buildCostPlan(ctx, input(values));
function withSource(builder, id) {
  const ctx = builder.build();
  return ctx.clone({ sourceSnapshot: ctx.object(ctx.ref(id)) });
}
const fixture = (energyAmount = 20, values = {}) => withSource(world().player('A', { energy: energyAmount, ...values }).hand('source', { types: ['spell'], energy: 3, power: [] }), 'source');
const failure = reason => error => error instanceof CostPlanError && error.reason === reason;

function finalize(ctx, values, options) {
  let receipt;
  const definition = {
    op: 'cost.pay',
    argsSchema: { parse: value => value },
    execute(transaction, args) {
      receipt = payCostPlan(transaction, buildCostPlan(transaction, args), options);
      return { status: 'executed', events: [...receipt.events] };
    }
  };
  const result = runInstruction(definition, input(values), { world: ctx });
  assert.equal(result.asked, null);
  return receipt;
}

test('costs-basic-energy-payment: printed base pays the exact Energy total', () => {
  const ctx = fixture(3);
  const receipt = finalize(ctx, {});
  assert.equal(ctx.player('A').energy, 0);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 3);
  assert.equal(receipt.actions[0].action.type, 'pay');
});

test('costs-basic-energy-insufficient: Finalize rejects before any action', () => {
  const ctx = fixture(2);
  const before = ctx.snapshot();
  assert.throws(() => finalize(ctx, {}), failure('cannot-pay-cost'));
  assert.deepEqual(ctx.snapshot(), before);
});

test('costs-basic-power-domain-match: resources choose exactly the matching Power', () => {
  const ctx = fixture(3, { power: ['Calm', 'Fury'] });
  const prepared = prepareCostPayment(ctx, build(ctx, { printed: printed({ power: 1 }) }));
  assert.deepEqual(prepared.actions[0].action.plan.power, ['Fury']);
  assert.deepEqual(prepared.power.power, [{ requirementIndex: 0, from: 'Fury', amount: 1 }]);
});

test('costs-basic-power-wrong-domain: wrong Power cannot pay a domain cost', () => {
  const ctx = fixture(3, { power: ['Calm'] });
  assert.throws(() => prepareCostPayment(ctx, build(ctx, { printed: printed({ power: 1 }) })), failure('cannot-pay-cost'));
  assert.equal(ctx.events.length, 0);
});

test('costs-symbol-c-own-domain: explicit numeric Power uses source domains', () => {
  const ctx = fixture();
  const plan = build(ctx, { cost: { power: literal(2) } });
  assert.deepEqual(plan.total.power, [{ allowedDomains: ['Fury'], amount: 2 }]);
});

test('costs-symbol-c-domainless-becomes-a: no domains permits all six domains', () => {
  const ctx = fixture(0, { power: ['Order'] });
  const plan = build(ctx, { printed: printed({ energy: 0, power: 1, domains: [] }) });
  assert.deepEqual(plan.total.power[0].allowedDomains, DUEL_DOMAINS);
  assert.deepEqual(prepareCostPayment(ctx, plan).actions[0].action.plan.power, ['Order']);
});

test('costs-symbol-c-multidomain-either: one hybrid symbol is a single requirement', () => {
  const ctx = fixture(3, { power: ['Calm'] });
  const plan = build(ctx, { printed: printed({ power: 1, domains: ['Fury', 'Calm'] }) });
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ['Fury', 'Calm'] }]);
  assert.deepEqual(prepareCostPayment(ctx, plan).actions[0].action.plan.power, ['Calm']);
});

test('costs-symbol-a-any-domain-payment: universal requirements consume actual domain Power', () => {
  const ctx = fixture(0, { power: ['Mind', 'Order'] });
  const plan = build(ctx, { cost: power(2, DUEL_DOMAINS) });
  assert.deepEqual(prepareCostPayment(ctx, plan).actions[0].action.plan.power, ['Mind', 'Order']);
});

test('overlapping Power uses the existing max-flow allocator without greedy rejection', () => {
  const ctx = fixture(0, { power: ['Fury', 'Calm'] });
  const plan = build(ctx, { cost: { payments: [
    { kind: 'power', allowedDomains: ['Fury', 'Calm'] },
    { kind: 'power', allowedDomains: ['Fury'] }
  ] } });
  assert.deepEqual(prepareCostPayment(ctx, plan).power.power, [
    { requirementIndex: 1, from: 'Fury', amount: 1 },
    { requirementIndex: 0, from: 'Calm', amount: 1 }
  ]);
});

test('costs-activated-multi-base-choice: choose one activated base cost', () => {
  const ctx = fixture(0, { power: ['Fury'] });
  const plan = build(ctx, { cost: { kind: 'activated' }, baseChoices: [
    { id: 'energy', cost: energy(1) }, { id: 'power', cost: power() }
  ], baseChoice: 'power' });
  assert.equal(plan.total.energy, 0);
  assert.equal(prepareCostPayment(ctx, plan).actions[0].action.plan.power[0], 'Fury');
});

test('activated base choice suspends with a stable public choice id', () => {
  const ctx = fixture();
  const before = ctx.snapshot();
  assert.throws(() => build(ctx, { baseChoices: [{ id: 'energy', cost: energy(1) }] }), error => error instanceof AwaitChoice && error.request.id === 'play:base');
  assert.deepEqual(ctx.snapshot(), before);
});

test('costs-mandatory-additional-kill: nonstandard payment follows combined resources', () => {
  const ctx = world().player('A', { energy: 3 }).unit('unit').build();
  const receipt = finalize(ctx, { mandatoryAdditional: [{ id: 'sacrifice', cost: payment('kill', ctx.ref('unit')) }] });
  assert.deepEqual(receipt.actions.map(value => value.action.type), ['pay', 'kill']);
  assert.equal(ctx.objectsInZone('A', 'trash')[0].id, 'unit');
});

test('costs-mandatory-additional-impossible: missing object rolls back Finalize', () => {
  const ctx = fixture();
  const before = ctx.snapshot();
  assert.throws(() => finalize(ctx, { mandatoryAdditional: [{ id: 'kill', cost: payment('kill', { id: 'missing', zoneEntryId: 0 }) }] }), failure('cannot-pay-cost'));
  assert.deepEqual(ctx.snapshot(), before);
});

test('costs-deflect-mandatory-power: mandatory Power adds to the printed requirement', () => {
  const ctx = fixture(3, { power: ['Fury', 'Calm'] });
  const plan = build(ctx, { printed: printed({ power: 1 }), mandatoryAdditional: [{ id: 'deflect', cost: power(1, DUEL_DOMAINS) }] });
  assert.equal(prepareCostPayment(ctx, plan).actions[0].action.plan.power.length, 2);
});

test('costs-deflect-unpaid-fails: paying only printed Power cannot omit Deflect', () => {
  const ctx = fixture(3, { power: ['Fury'] });
  const plan = build(ctx, { printed: printed({ power: 1 }), mandatoryAdditional: [{ id: 'deflect', cost: power(1, DUEL_DOMAINS) }] });
  assert.throws(() => prepareCostPayment(ctx, plan), failure('cannot-pay-cost'));
});

test('costs-accelerate-optional-pay: Accelerate adds [1][C] once', () => {
  const ctx = fixture(4, { power: ['Fury'] });
  const receipt = finalize(ctx, { optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: true }] });
  assert.equal(receipt.total.energy, 4);
  assert.deepEqual(receipt.actions[0].action.plan.power, ['Fury']);
  assert.deepEqual(receipt.additional, [{ id: 'accelerate', kind: 'accelerate', paid: true }]);
});

test('costs-accelerate-declined-exhausted: declining Accelerate records no payment', () => {
  const ctx = fixture(3);
  const receipt = finalize(ctx, { optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: false }] });
  assert.equal(receipt.total.energy, 3);
  assert.deepEqual(receipt.additional, []);
});

test('costs-accelerate-power-domain-match: Accelerate cannot spend off-domain Power', () => {
  const ctx = fixture(4, { power: ['Calm'] });
  assert.throws(() => finalize(ctx, { optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: true }] }), failure('cannot-pay-cost'));
});

test('costs-repeat-second-execution: selecting Repeat adds its fee and a paid flag', () => {
  const ctx = fixture(5);
  const receipt = finalize(ctx, { optionalAdditional: [{ id: 'repeat', kind: 'repeat', cost: energy(2), selected: true }] });
  assert.equal(receipt.total.energy, 5);
  assert.equal(receipt.additional[0].kind, 'repeat');
});

test('costs-repeat-declined-single: declining Repeat keeps the base total', () => {
  assert.equal(build(fixture(), { optionalAdditional: [{ id: 'repeat', kind: 'repeat', cost: energy(2), selected: false }] }).total.energy, 3);
});

test('costs-repeat-each-cost-once: independent Repeat instances each contribute once', () => {
  const plan = build(fixture(), { optionalAdditional: [
    { id: 'repeat-1', kind: 'repeat', cost: energy(2), selected: true },
    { id: 'repeat-2', kind: 'repeat', cost: energy(4), selected: true }
  ] });
  assert.equal(plan.total.energy, 9);
  assert.equal(plan.selectedAdditional.length, 2);
  assert.throws(() => build(fixture(), { optionalAdditional: [{ id: 'repeat', kind: 'repeat', cost: energy(2), selected: 2 }] }), failure('invalid-cost-plan'));
});

test('costs-printed-cost-check-ignores-discount: printed base stays separate from total', () => {
  const plan = build(fixture(), { discounts: [discount('reduce', 2)] });
  assert.equal(plan.printed.energy, 3);
  assert.equal(plan.base.energy, 3);
  assert.equal(plan.total.energy, 1);
});

test('costs-printed-cost-target-repeat-ignored: Repeat does not change printed cost', () => {
  const plan = build(fixture(), { optionalAdditional: [{ id: 'repeat', kind: 'repeat', cost: energy(4), selected: true }] });
  assert.equal(plan.printed.energy, 3);
  assert.equal(plan.total.energy, 7);
});

test('costs-ability-base-cost-check-ignores-alteration: activated base survives an increase', () => {
  const plan = build(fixture(), { cost: { kind: 'activated', energy: literal(1) }, increases: [{ id: 'tax', cost: energy(2) }] });
  assert.equal(plan.base.energy, 1);
  assert.equal(plan.total.energy, 3);
});

test('costs-increase-then-discount-order: increases are summed before total discounts', () => {
  const plan = build(fixture(), { increases: [{ id: 'tax', cost: energy(2) }], discounts: [discount('reduce', 4)] });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.stages, ['base', 'alternate', 'optional-additional', 'mandatory-additional', 'increase', 'discount', 'total']);
});

test('costs-component-discount-before-total: component discounts cannot consume other fees', () => {
  const plan = build(fixture(), {
    optionalAdditional: [{ id: 'repeat', kind: 'repeat', cost: energy(1), selected: true }],
    increases: [{ id: 'tax', cost: energy(2) }],
    discounts: [discount('global', 1), discount('repeat-only', 5, { component: 'repeat' })]
  });
  assert.deepEqual(plan.discounts.map(value => value.id), ['repeat-only', 'global']);
  assert.equal(plan.components[1].cost.energy, 0);
  assert.equal(plan.total.energy, 4);
});

test('costs-discount-floor-zero: excess discounts never create resources', () => {
  const ctx = fixture(0);
  const receipt = finalize(ctx, { discounts: [discount('large', 10)] });
  assert.equal(receipt.total.energy, 0);
  assert.equal(ctx.player('A').energy, 0);
});

test('costs-discount-minimum-per-discount: minimum belongs only to its own discount', () => {
  const options = { printed: printed({ energy: 8 }), discounts: [discount('eager', 1, { minimum: literal(1) }), discount('splitter', 7)] };
  assert.equal(build(fixture(), options).total.energy, 0);
  assert.equal(build(fixture(), { ...options, discountOrder: ['splitter', 'eager'] }).total.energy, 1);
});

test('a discount minimum cannot increase a component already below that minimum', () => {
  const plan = build(fixture(), { cost: energy(0), discounts: [discount('minimum', 1, { minimum: literal(2) })] });
  assert.equal(plan.total.energy, 0);
});

test('costs-optional-additional-reduced-to-zero: selecting a zeroed fee still counts as paid', () => {
  const ctx = fixture(2);
  const receipt = finalize(ctx, { printed: printed({ energy: 2 }), optionalAdditional: [
    { id: 'keeper', kind: 'additional', cost: power(), selected: true }
  ], discounts: [{ id: 'power-discount', resource: 'power', amount: literal(1) }] });
  assert.deepEqual(receipt.total.power, []);
  assert.equal(receipt.additional[0].paid, true);
});

test('costs-variable-discount-checked-at-finalize: a later Trash change cannot alter the locked plan', () => {
  const ctx = world().player('A', { energy: 3 }).card('trash', { zone: 'trash' }).hand('discard').build();
  const plan = build(ctx, { discounts: [{ id: 'trash-count', resource: 'energy', amount: { kind: 'count', filter: { owner: 'A', zone: 'trash' } } }] });
  ctx.perform({ type: 'discard', object: ctx.ref('discard') });
  assert.equal(ctx.objectsInZone('A', 'trash').length, 2);
  assert.equal(plan.total.energy, 2);
  assert.equal(payCostPlan(ctx, plan).total.energy, 2);
});

test('costs-alternate-replaces-base: alternative base preserves the original printed values', () => {
  const plan = build(fixture(), { baseModifications: [{ id: 'alternate', kind: 'alternate', cost: energy(1) }] });
  assert.equal(plan.printed.energy, 3);
  assert.equal(plan.base.energy, 3);
  assert.equal(plan.total.energy, 1);
});

test('Flow replaces the base cost with resource and nonstandard payments', () => {
  const ctx = withSource(world().player('A', { energy: 1 }).card('flow', { zone: 'trash', types: ['spell'] }).card('fuel', { zone: 'trash' }), 'flow');
  const plan = build(ctx, { baseModifications: [{ id: 'flow', kind: 'flow', cost: { energy: literal(1), payments: [{ kind: 'recycle', object: ctx.ref('fuel') }] } }] });
  const receipt = payCostPlan(ctx, plan);
  assert.deepEqual(receipt.actions.map(value => value.action.type), ['pay', 'recycle']);
  assert.equal(ctx.objectsInZone('A', 'deck')[0].id, 'fuel');
});

test('Flow cannot silently grant permission to play a hand card from Trash', () => {
  assert.throws(() => build(fixture(), { baseModifications: [{ id: 'flow', kind: 'flow', cost: energy(1) }] }), failure('invalid-cost-plan'));
});

test('costs-ignore-base-but-accelerate-still-added: ignoring base retains optional fees', () => {
  const plan = build(fixture(), { baseModifications: [{ kind: 'ignore-base', ignore: 'resources' }], optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', selected: true }] });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, [{ allowedDomains: ['Fury'], amount: 1 }]);
});

test('costs-ignore-energy-only-power-remains: only the selected base resource is ignored', () => {
  const plan = build(fixture(), { printed: printed({ power: 1 }), baseModifications: [{ kind: 'ignore-base', ignore: 'energy' }] });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [{ allowedDomains: ['Fury'], amount: 1 }]);
});

test('costs-ignore-all-costs-includes-nonstandard: ignoring all clears every payment dimension', () => {
  const ctx = fixture(0);
  const plan = build(ctx, { mandatoryAdditional: [{ id: 'impossible', cost: payment('kill', 'self') }], ignoreAllCosts: true });
  assert.deepEqual(plan.total, { energy: 0, power: [], xp: 0, actions: [] });
  assert.equal(payCostPlan(ctx, plan).paid, true);
});

test('ignoring all costs does not require objects for a waived nonstandard fee', () => {
  const ctx = fixture(0);
  const plan = build(ctx, { mandatoryAdditional: [{ id: 'discard', cost: { discard: { id: 'unavailable', options: [], min: 1, max: 1 } } }], ignoreAllCosts: true });
  assert.equal(payCostPlan(ctx, plan).paid, true);
  assert.equal(ctx.player('A').energy, 0);
});

test('costs-countered-no-refund: countering after payment does not refund resources or discard costs', () => {
  const ctx = world().player('A', { energy: 3 }).card('spell', { zone: 'chain', types: ['spell'] }).hand('fuel').build();
  const receipt = finalize(ctx, { mandatoryAdditional: [{ id: 'discard', cost: payment('discard', ctx.ref('fuel')) }] });
  assert.equal(ctx.perform({ type: 'counter', object: ctx.ref('spell') }).status, 'done');
  assert.equal(ctx.player('A').energy, 0);
  assert.deepEqual(ctx.objectsInZone('A', 'trash').map(value => value.id), ['fuel', 'spell']);
  assert.equal(receipt.paid, true);
});

test('costs-replaced-cost-action-still-paid: replacement counts as paid without synthesizing the original action', () => {
  const ctx = world().player('A', { energy: 3 }).unit('protected').build();
  const original = ctx.ref('protected');
  ctx.addReplacement((action, transaction) => {
    if (action.type !== 'kill') return null;
    assert.equal(transaction.perform({ type: 'return-to-hand', object: action.object }).status, 'done');
    return 'replaced';
  });
  const receipt = finalize(ctx, { mandatoryAdditional: [{ id: 'kill', cost: payment('kill', original) }] });
  assert.equal(receipt.actions[1].status, 'replaced');
  assert.equal(receipt.paid, true);
  assert.equal(ctx.object(original), null);
  assert.equal(ctx.object(ctx.ref('protected')).zone, 'hand');
  assert.equal(ctx.player('A').energy, 0);
});

for (const outcome of ['impossible', 'prevented']) {
  test(`${outcome} late payment rolls back Energy and previous nonstandard payments`, () => {
    const ctx = world().player('A', { energy: 3 }).hand('fuel').unit('unit').build();
    ctx.addReplacement(action => action.type === 'kill' ? outcome : null);
    const before = ctx.snapshot();
    assert.throws(() => finalize(ctx, { mandatoryAdditional: [
      { id: 'discard', cost: payment('discard', ctx.ref('fuel')) },
      { id: 'kill', cost: payment('kill', ctx.ref('unit')) }
    ] }), error => failure('cannot-pay-cost')(error) && error.outcome.status === outcome);
    assert.deepEqual(ctx.snapshot(), before);
  });
}

test('costs-nonstandard-costs-any-order: caller locks an exact permutation of nonstandard actions', () => {
  const ctx = world().player('A', { energy: 3 }).hand('fuel').unit('unit').build();
  const receipt = finalize(ctx, { mandatoryAdditional: [
    { id: 'discard', cost: payment('discard', ctx.ref('fuel')) },
    { id: 'kill', cost: payment('kill', ctx.ref('unit')) }
  ] }, { nonstandardOrder: ['kill:payment:0:0', 'discard:payment:0:0'] });
  assert.deepEqual(receipt.actions.map(value => value.action.type), ['pay', 'kill', 'discard']);
});

test('an incomplete payment order cannot drop a mandatory cost', () => {
  const ctx = world().player('A', { energy: 3 }).unit('unit').build();
  assert.throws(() => finalize(ctx, { mandatoryAdditional: [{ id: 'exhaust', cost: payment('exhaust', ctx.ref('unit')) }] }, { nonstandardOrder: [] }), failure('invalid-cost-plan'));
  assert.equal(ctx.player('A').energy, 3);
});

test('costs-printed-null-not-zero: missing printed Energy cannot become a free printed cost', () => {
  assert.throws(() => build(fixture(), { printed: printed({ energy: null }) }), failure('missing-printed-cost'));
  const plan = build(fixture(), { printed: printed({ energy: null, power: null }), baseModifications: [{ id: 'explicit', kind: 'alternate', cost: energy(1) }] });
  assert.deepEqual(plan.printed, { energy: null, power: null });
  assert.equal(plan.base, null);
  assert.equal(plan.total.energy, 1);
});

test('null printed Power remains null when no Power payment is due', () => {
  const plan = build(fixture(), { printed: printed({ power: null }) });
  assert.equal(plan.printed.power, null);
  assert.deepEqual(plan.total.power, []);
});

test('exhaust costs use the exact ready controlled object and never edit its snapshot', () => {
  const ctx = withSource(world().player('A', { energy: 0 }).unit('unit'), 'unit');
  const receipt = finalize(ctx, { cost: { kind: 'activated', payments: [{ kind: 'exhaust', object: 'self' }] } });
  assert.equal(ctx.object(ctx.ref('unit')).exhausted, true);
  assert.equal(receipt.actions[1].action.type, 'exhaust');
});

test('an exhausted source cannot pay an exhaust cost', () => {
  const ctx = withSource(world().player('A', { energy: 3 }).unit('unit', { exhausted: true }), 'unit');
  assert.throws(() => finalize(ctx, { mandatoryAdditional: [{ id: 'exhaust', cost: payment('exhaust', 'self') }] }), failure('cannot-pay-cost'));
  assert.equal(ctx.player('A').energy, 3);
});

test('recycle costs place the selected Trash cards on the bottom in payment order', () => {
  const ctx = world().player('A', { energy: 0 }).card('one', { zone: 'trash' }).card('two', { zone: 'trash' }).deck('top').build();
  const receipt = finalize(ctx, { cost: { payments: [{ kind: 'recycle', objects: [ctx.ref('one'), ctx.ref('two')], amount: literal(2) }] } });
  assert.equal(receipt.actions.filter(value => value.action.type === 'recycle').length, 2);
  assert.deepEqual(ctx.objectsInZone('A', 'deck').map(value => value.id), ['top', 'one', 'two']);
});

test('XP and Buff costs use the existing GameActions and deduct exactly once', () => {
  const ctx = withSource(world().player('A', { energy: 0, xp: 4 }).unit('unit', { buffs: 2 }), 'unit');
  const receipt = finalize(ctx, { cost: { payments: [{ kind: 'xp', amount: literal(3) }, { kind: 'spend-buff', object: 'self', amount: literal(2) }] } });
  assert.equal(ctx.player('A').xp, 1);
  assert.equal(ctx.object(ctx.ref('unit')).buffs, 0);
  assert.deepEqual(receipt.actions.map(value => value.action.type), ['pay', 'spend-buff', 'spend-xp']);
});

test('insufficient XP fails without spending Energy', () => {
  const ctx = fixture(3);
  assert.throws(() => finalize(ctx, { cost: { energy: literal(3), payments: [{ kind: 'xp', amount: literal(1) }] } }), failure('cannot-pay-cost'));
  assert.equal(ctx.player('A').energy, 3);
});

test('a stale zoneEntryId cannot identify a new incarnation of a payment card', () => {
  const ctx = world().player('A', { energy: 3 }).hand('fuel').build();
  const old = ctx.ref('fuel');
  const plan = build(ctx, { mandatoryAdditional: [{ id: 'discard', cost: payment('discard', old) }] });
  ctx.perform({ type: 'discard', object: old });
  ctx.perform({ type: 'return-to-hand', object: ctx.ref('fuel') });
  assert.throws(() => prepareCostPayment(ctx, plan), failure('cannot-pay-cost'));
});

test('Hidden hide costs [A] while retaining the card’s printed cost metadata', () => {
  const ctx = fixture(0, { power: ['Body'] });
  const plan = buildHiddenCostPlan(ctx, { id: 'hide', mode: 'hide', printed: printed() });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
  assert.equal(plan.printed.energy, 3);
  assert.deepEqual(prepareCostPayment(ctx, plan).actions[0].action.plan.power, ['Body']);
});

test('Hidden play ignores base resources but keeps additional costs', () => {
  const ctx = fixture(1);
  const plan = buildHiddenCostPlan(ctx, { id: 'hidden-play', mode: 'play', printed: printed({ power: 2 }), mandatoryAdditional: [{ id: 'tax', cost: energy(1) }] });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, []);
});

test('unknown costs stay judge-required instead of silently becoming free', () => {
  const ctx = fixture();
  for (const cost of [{ rune: literal(1) }, { kind: 'future-cost' }, { payments: [{ kind: 'future-cost' }] }, { payments: [{ kind: 'recycle', from: 'anywhere' }] }]) {
    assert.throws(() => build(ctx, { cost }), failure('judge-required'));
  }
});

test('malformed payment containers fail as invalid plans before any payment', () => {
  for (const cost of [
    { payments: null },
    { payments: [{}] },
    { payments: [{ kind: 1 }] },
    { discard: null },
    { payments: [{ kind: 'discard', choice: { id: 'bad', options: null } }] }
  ]) {
    assert.throws(() => build(fixture(), { cost }), failure('invalid-cost-plan'));
  }
});

test('negative, fractional, unsafe and null cost expressions are not numeric zero', () => {
  for (const amount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, '1']) assert.throws(() => build(fixture(), { cost: energy(amount) }), failure('invalid-cost-plan'));
});

test('duplicate cost IDs and forged Repeat answers cannot double-charge a fee', () => {
  assert.throws(() => build(fixture(), { optionalAdditional: [
    { id: 'repeat', kind: 'repeat', cost: energy(1), selected: true },
    { id: 'repeat', kind: 'repeat', cost: energy(1), selected: true }
  ] }), failure('invalid-cost-plan'));
});

test('optional additional choice suspends before any payment and replays with an answer', () => {
  const ctx = fixture(4);
  const options = input({ optionalAdditional: [{ id: 'repeat', kind: 'repeat', cost: energy(1) }] });
  assert.throws(() => buildCostPlan(ctx, options), error => error instanceof AwaitChoice && error.request.id === 'play:optional:repeat');
  assert.equal(ctx.player('A').energy, 4);
  ctx.setAnswers({ 'play:optional:repeat': true });
  assert.equal(payCostPlan(ctx, buildCostPlan(ctx, options)).total.energy, 4);
});

test('discard picks are private choices and must match the exact listed references', () => {
  const ctx = world().player('A', { energy: 0 }).hand('fuel').hand('other').build();
  const cost = { discard: { id: 'discard', options: [ctx.ref('fuel')], min: 1, max: 1 } };
  assert.throws(() => build(ctx, { cost }), error => error instanceof AwaitChoice && error.request.visibility === 'chooser-only');
  ctx.setPicks('discard', [ctx.ref('other')]);
  assert.throws(() => build(ctx, { cost }), failure('invalid-cost-plan'));
  ctx.setPicks('discard', [ctx.ref('fuel')]);
  assert.equal(payCostPlan(ctx, build(ctx, { cost })).actions[1].action.type, 'discard');
});

test('plans are immutable snapshots and do not freeze or alias input data', () => {
  const ctx = fixture();
  const options = input({ printed: printed({ domains: ['Fury', 'Calm'], power: 1 }) });
  const plan = buildCostPlan(ctx, options);
  options.printed.domains.push('Mind');
  assert.deepEqual(plan.total.power[0].allowedDomains, ['Fury', 'Calm']);
  assert.throws(() => { plan.total.energy = 0; }, TypeError);
  assert.equal(Object.isFrozen(plan.total.power[0].allowedDomains), true);
});

test('explicit Power allocations cannot overspend or omit requirements', () => {
  const ctx = fixture(0, { power: ['Fury', 'Calm'] });
  const plan = build(ctx, { cost: power(1, DUEL_DOMAINS) });
  const prepared = prepareCostPayment(ctx, plan, { power: { power: [{ requirementIndex: 0, from: 'Calm', amount: 1 }] } });
  assert.deepEqual(prepared.actions[0].action.plan.power, ['Calm']);
  assert.throws(() => prepareCostPayment(ctx, plan, { power: { power: [] } }), failure('cannot-pay-cost'));
});

test('cost plan payment reuses the migrated resource kernel on real channeled runes', () => {
  const baseLocations = [{ playerId: 'A', locationId: 'base:A' }, { playerId: 'B', locationId: 'base:B' }];
  const state = createDuelResources({ playerIds: ['A', 'B'], baseLocations, runeDecks: [[{ uid: 'rune', cardId: 'fury', domain: 'Fury' }], []] });
  const timing = { stateOpen: false, priorityPlayerId: null, resourcePaymentPlayerId: 'A' };
  const ready = channelDuelRunes(state, 'A', 1);
  const powered = activateBasicRunePower(ready, 'A', 'rune', timing);
  const pool = powered.players[0].runePool;
  const cost = { energy: 0, power: [{ allowedDomains: ['Fury'], amount: 1 }] };
  const allocation = planDuelRunePayment(pool, cost);
  const paid = payDuelRuneCost(powered, 'A', cost, timing, allocation);
  assert.equal(paid.resources.players[0].runePool.power.Fury, 0);
  assert.equal(powered.players[0].runePool.power.Fury, 1);
  const cleared = clearAllDuelRunePools(powered);
  assert.throws(() => planDuelRunePayment(cleared.players[0].runePool, cost), /insufficient matching Power/);
});

test('costs-mana-ability-during-payment (payment slice): payment reads resources added after planning', () => {
  const ctx = fixture(0);
  const plan = build(ctx);
  assert.throws(() => prepareCostPayment(ctx, plan), failure('cannot-pay-cost'));
  assert.equal(ctx.perform({ type: 'gain-energy', player: 'A', amount: 3 }).status, 'done');
  assert.equal(payCostPlan(ctx, plan).paid, true);
});

test('costs-power-universal-any-domain: migrated resources support universal Power sources', () => {
  const pool = { energy: 0, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 1 } };
  const allocation = planDuelRunePayment(pool, { energy: 0, power: [{ amount: 1, allowedDomains: ['Order'] }] });
  assert.deepEqual(allocation.power, [{ requirementIndex: 0, from: 'any', amount: 1 }]);
  assert.equal(pool.power.any, 1);
});

test('Power discounts honor the chosen requirement order instead of greedily stranding a hybrid cost', () => {
  const ctx = fixture(0, { power: ['Calm'] });
  const plan = build(ctx, { cost: { payments: [...power(1, ['Fury', 'Calm']).payments, ...power().payments] }, discounts: [
    { id: 'reduce-power', resource: 'power', amount: literal(1), powerOrder: [1, 0] }
  ] });
  assert.deepEqual(plan.total.power, [{ allowedDomains: ['Fury', 'Calm'], amount: 1 }]);
  assert.deepEqual(prepareCostPayment(ctx, plan).actions[0].action.plan.power, ['Calm']);
});

test('ambiguous Power discount allocation asks the controller before locking a total', () => {
  const ctx = fixture(0, { power: ['Calm'] });
  const options = { cost: { payments: [...power(1, ['Fury', 'Calm']).payments, ...power().payments] }, discounts: [{ id: 'reduce', resource: 'power', amount: literal(1) }] };
  const id = 'play:discount:reduce:total:power:0';
  assert.throws(() => build(ctx, options), error => error instanceof AwaitChoice && error.request.id === id);
  ctx.setAnswers({ [id]: 1 });
  assert.deepEqual(prepareCostPayment(ctx, build(ctx, options)).actions[0].action.plan.power, ['Calm']);
});

test('domain-specific reductions of unresolved hybrid symbols stay judge-required', () => {
  assert.throws(() => build(fixture(), { cost: power(1, ['Fury', 'Calm']), discounts: [{ id: 'reduce-fury', resource: 'power', amount: literal(1), domains: ['Fury'] }] }), failure('judge-required'));
});

test('a payment invalidated by an earlier nonstandard payment aborts the whole transaction', () => {
  const ctx = world().player('A', { energy: 3 }).unit('unit').build();
  const before = ctx.snapshot();
  assert.throws(() => finalize(ctx, { mandatoryAdditional: [
    { id: 'kill', cost: payment('kill', ctx.ref('unit')) },
    { id: 'exhaust', cost: payment('exhaust', ctx.ref('unit')) }
  ] }), failure('cannot-pay-cost'));
  assert.deepEqual(ctx.snapshot(), before);
});

test('CostSpec cannot silently discard contradictory object selection fields', () => {
  const ctx = fixture();
  assert.throws(() => build(ctx, { cost: payment('discard', 'self', { objects: [ctx.source.ref] }) }), failure('invalid-cost-plan'));
  assert.throws(() => build(ctx, { cost: payment('energy', 'self') }), failure('invalid-cost-plan'));
});

test('all-object picks cannot pay a subset of the required cost', () => {
  const ctx = world().player('A', { energy: 0 }).hand('one').hand('two').build();
  const cost = { discard: { id: 'all', options: [ctx.ref('one'), ctx.ref('two')], selection: 'all' } };
  ctx.setPicks('all', [ctx.ref('one')]);
  assert.throws(() => build(ctx, { cost }), failure('invalid-cost-plan'));
});

test('payment receipts copy events without freezing objects owned by the context', () => {
  const ctx = fixture(3);
  const receipt = payCostPlan(ctx, build(ctx));
  assert.equal(Object.isFrozen(receipt.events[0]), true);
  assert.equal(Object.isFrozen(ctx.events[0]), false);
});

test('costs-finalize-action-check-after-control-change (receipt slice): payment remains true after source control changes', () => {
  const ctx = withSource(world().player('A', { energy: 3 }).unit('unit'), 'unit');
  const receipt = finalize(ctx, { optionalAdditional: [{ id: 'optional', kind: 'additional', cost: energy(0), selected: true }] });
  assert.equal(ctx.perform({ type: 'take-control', object: ctx.ref('unit'), player: 'B' }).status, 'done');
  assert.equal(receipt.player, 'A');
  assert.equal(receipt.additional[0].paid, true);
});
