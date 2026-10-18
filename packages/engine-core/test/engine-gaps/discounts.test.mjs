import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeCostPlan } from '../../dist/cost/discounts/index.js';
import { buildHiddenCostPlan } from '../../dist/cost/cost-plan.js';
import { payCostPlan } from '../../dist/cost/payment.js';
import { CostPlanError } from '../../dist/cost/plan-types.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world, runInstruction } from '../../dist/effects/testing/index.js';
import continuousCostModification from '../../dist/effects/instructions/continuous.cost-modification.js';
import { ContinuousEffectRegistry } from '../../dist/layers/duration.js';
import poppy from '../../../card-dsl/dist/cards/unl/poppy-defender-of-the-meek.js';
import brazen from '../../../card-dsl/dist/cards/ogn/brazen-buccaneer.js';

const c = value => ({ kind: 'constant', value });
const input = (values = {}) => ({ id: 'cost', cost: { kind: 'printed' }, ...values });
const fail = error => error instanceof CostPlanError && error.reason === 'judge-required';

function context(values = {}, playerValues = {}) {
  const builder = world()
    .player('A', { energy: 20, xp: 5, power: ['Order'], ...playerValues })
    .hand('card', { types: ['unit'], energy: 6, power: ['Order'], ...values })
    .unit('host');
  const kernel = builder.build();
  return kernel.clone({ sourceSnapshot: kernel.getObject('card') });
}

function binding(ctx, id, ability, source = 'card') {
  return { id, source: ctx.ref(source), ability };
}

function staticsFor(ctx, program) {
  return program.abilities.flatMap((ability, ordinal) => ability.kind === 'static'
    ? [binding(ctx, `card:${ordinal}`, ability)] : []);
}

test('RIFT-795: static optional additional costs are selected before grantedBy discounts', () => {
  const ctx = context();
  ctx.setAnswers({ 'cost:optional:poppy-defender-of-the-meek.xp-cost': true });
  const plan = finalizeCostPlan(ctx, input(), { statics: staticsFor(ctx, poppy) });

  assert.equal(plan.total.energy, 3);
  assert.equal(plan.total.xp, 3);
  assert.deepEqual(plan.selectedAdditional.map(entry => entry.id), ['poppy-defender-of-the-meek.xp-cost']);
  assert.equal(plan.selectedAdditional[0].paidAmount.xp, 3);
  assert.equal(plan.discounts[0].grantedBy, 'poppy-defender-of-the-meek.xp-cost');

  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.additional[0].paid, true);
  assert.equal(receipt.additional[0].paidAmount.xp, 3);
  assert.equal(ctx.player('A').xp, 2);
});

test('RIFT-795: declining an optional additional cost removes only its granted discount', () => {
  const ctx = context();
  ctx.setAnswers({ 'cost:optional:poppy-defender-of-the-meek.xp-cost': false });
  const plan = finalizeCostPlan(ctx, input(), { statics: staticsFor(ctx, poppy) });

  assert.equal(plan.total.energy, 6);
  assert.deepEqual(plan.selectedAdditional, []);
  assert.deepEqual(plan.declinedAdditional, ['poppy-defender-of-the-meek.xp-cost']);
  assert.deepEqual(plan.discounts, []);
});

test('RIFT-795: a rejected additional payment leaves the finalized decision and resources untouched', () => {
  const ctx = context({}, { xp: 2 });
  ctx.setAnswers({ 'cost:optional:poppy-defender-of-the-meek.xp-cost': true });
  const plan = finalizeCostPlan(ctx, input(), { statics: staticsFor(ctx, poppy) });
  const before = ctx.snapshot();
  assert.throws(() => payCostPlan(ctx, plan), error => error instanceof CostPlanError && error.reason === 'cannot-pay-cost');
  assert.deepEqual(ctx.snapshot(), before);
  assert.equal(plan.selectedAdditional[0].id, 'poppy-defender-of-the-meek.xp-cost');
});

test('RIFT-795: dynamic non-target payment choices stay judge-required when selected', () => {
  const ctx = context();
  ctx.setAnswers({ 'cost:optional:brazen-buccaneer.discard-cost': true });
  assert.throws(
    () => finalizeCostPlan(ctx, input(), { statics: staticsFor(ctx, brazen) }),
    fail
  );

  const declined = context();
  declined.setAnswers({ 'cost:optional:brazen-buccaneer.discard-cost': false });
  const plan = finalizeCostPlan(declined, input(), { statics: staticsFor(declined, brazen) });
  assert.equal(plan.total.energy, 6);
  assert.deepEqual(plan.declinedAdditional, ['brazen-buccaneer.discard-cost']);
});

test('RIFT-795: ignore-base resources preserves optional and mandatory additions', () => {
  const ctx = context({ energy: 4, power: ['Order'] });
  const plan = buildHiddenCostPlan(ctx, {
    id: 'hidden', mode: 'play',
    optionalAdditional: [{ id: 'optional', kind: 'additional', selected: true, cost: { energy: c(2) } }],
    mandatoryAdditional: [{ id: 'mandatory', cost: { energy: c(1) } }]
  });
  assert.equal(plan.components.find(component => component.id === 'base').cost.energy, 0);
  assert.equal(plan.components.find(component => component.id === 'optional').cost.energy, 2);
  assert.equal(plan.components.find(component => component.id === 'mandatory').cost.energy, 1);
  assert.equal(plan.total.energy, 3);
});

function continuousEntries(ctx) {
  const registry = new ContinuousEffectRegistry();
  for (const entry of ctx.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry.list();
}

test('RIFT-795: next-unit window is consumed by authoritative Finalize history and remains available after rejection', () => {
  const kernel = world()
    .player('A', { energy: 20, power: [] })
    .unit('host')
    .hand('unit-one', { types: ['unit'], energy: 5, power: [] })
    .hand('unit-two', { types: ['unit'], energy: 5, power: [] })
    .hand('spell', { types: ['spell'], energy: 5, power: [] })
    .build();
  const source = kernel.clone({ sourceSnapshot: kernel.getObject('host') });
  runInstruction(continuousCostModification, {
    resource: c('energy'), amount: c(-2), duration: c('next-unit-played-this-turn')
  }, { world: source });

  const history = [];
  const first = id => {
    const play = source.clone({ sourceSnapshot: source.getObject(id) });
    return finalizeCostPlan(play, input({ id }), { continuous: continuousEntries(source), finalizedPlaysThisTurn: history });
  };
  assert.equal(first('unit-one').total.energy, 3);
  // A rejected/replaced Finalize never appends to history, so the ticket is reusable.
  assert.equal(first('unit-one').total.energy, 3);
  history.push({ object: source.getObject('unit-one'), player: 'A' });
  assert.equal(first('unit-two').total.energy, 5);
  const spell = source.clone({ sourceSnapshot: source.getObject('spell') });
  assert.equal(finalizeCostPlan(spell, input({ id: 'spell' }), {
    continuous: continuousEntries(source), finalizedPlaysThisTurn: history
  }).total.energy, 5);
});

test('RIFT-795: unknown grant sources fail closed without mutating the resolve context', () => {
  const ctx = context();
  const before = ctx.snapshot();
  const ability = { kind: 'static', effect: {
    kind: 'cost.modify', appliesTo: 'self', resource: 'energy', amount: c(2), stage: 'discount', grantedBy: 'missing'
  } };
  assert.throws(() => finalizeCostPlan(ctx, input(), { statics: [binding(ctx, 'missing-grant', ability)] }), fail);
  assert.deepEqual(ctx.snapshot(), before);
});

test('RIFT-795: optional choice remains a real Finalize prompt when no answer is available', () => {
  const ctx = context();
  assert.throws(
    () => finalizeCostPlan(ctx, input(), { statics: staticsFor(ctx, poppy) }),
    error => error instanceof AwaitChoice && error.request.id === 'cost:optional:poppy-defender-of-the-meek.xp-cost'
  );
});
