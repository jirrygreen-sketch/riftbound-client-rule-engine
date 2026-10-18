import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCostModifications, finalizeCostPlan } from '../../../dist/cost/discounts/index.js';
import { payCostPlan } from '../../../dist/cost/payment.js';
import { CostPlanError } from '../../../dist/cost/plan-types.js';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { world } from '../../../dist/effects/testing/index.js';
import { bindResolveContext } from '../../../dist/events/action-adapter.js';
import { fixture as chainFixture, resolveAll } from '../../chain/helpers.mjs';
import { fixture as turnFixture } from '../../turn/helpers.mjs';
import eager from '../../../../card-dsl/dist/cards/ogn/eager-apprentice.js';
import herald from '../../../../card-dsl/dist/cards/ogn/herald-of-scales.js';
import rhasa from '../../../../card-dsl/dist/cards/ogn/rhasa-the-sunderer.js';
import surge from '../../../../card-dsl/dist/cards/sfd/production-surge.js';
import drone from '../../../../card-dsl/dist/cards/sfd/void-drone.js';
import irelia from '../../../../card-dsl/dist/cards/sfd/irelia-graceful.js';
import ezreal from '../../../../card-dsl/dist/cards/sfd/ezreal-prodigy.js';
import ram from '../../../../card-dsl/dist/cards/sfd/battering-ram.js';
import crasher from '../../../../card-dsl/dist/cards/rad/party-crasher.js';
import forge from '../../../../card-dsl/dist/cards/sfd/ornns-forge.js';

const c = value => ({ kind: 'constant', value });
const energy = value => ({ energy: c(value) });
const input = (values = {}) => ({ id: 'cost', cost: { kind: 'printed' }, ...values });
const fail = error => error instanceof CostPlanError && error.reason === 'judge-required';
const staticAbility = (effect, condition) => ({ kind: 'static', effect, ...(condition ? { condition } : {}) });
const modify = (amount, fields = {}) => staticAbility({ kind: 'continuous.cost-modification', resource: 'energy', amount, ...fields });
function ctxFrom(builder, id = 'card') {
  const kernel = builder.build();
  return kernel.clone({ sourceSnapshot: kernel.getObject(id) });
}
const basic = (values = {}) => ctxFrom(world().player('A', { energy: 20 }).hand('card', { types: ['spell'], energy: 8, power: [], ...values }).unit('host'));
const binding = (ctx, id, ability, host = 'host') => ({ id, source: ctx.ref(host), ability });
const staticsFor = (ctx, program, host, prefix = host) => program.abilities.flatMap((ability, ordinal) => ability.kind === 'static' ? [binding(ctx, `${prefix}:${ordinal}`, ability, host)] : []);
const build = (ctx, statics, values = {}, options = {}) => finalizeCostPlan(ctx, input(values), { statics, ...options });

test('RIFT-709: Eager Apprentice checks its current battlefield and the payer; frozen cost pays through real actions', () => {
  const ctx = basic();
  const sources = staticsFor(ctx, eager, 'host');
  const plan = build(ctx, sources);
  assert.equal(plan.total.energy, 7);
  assert.equal(plan.printed.energy, 8);
  assert.equal(payCostPlan(ctx, plan).paid, true);
  assert.equal(ctx.player('A').energy, 13);
  assert.equal(ctx.perform({ type: 'move-location', object: ctx.ref('host'), to: { type: 'base', player: 'A' } }).status, 'done');
  assert.equal(build(ctx, sources).total.energy, 8);
  assert.equal(plan.total.energy, 7);
  const opponent = basic({ controller: 'B', owner: 'B' });
  assert.equal(build(opponent, staticsFor(opponent, eager, 'host')).total.energy, 8);
});

test('Herald of Scales discounts Dragon cards by tag and honors only its own minimum', () => {
  const ctx = basic({ tags: ['Dragon'], energy: 2 });
  assert.equal(build(ctx, staticsFor(ctx, herald, 'host')).total.energy, 1);
  const other = basic();
  assert.equal(build(other, staticsFor(other, herald, 'host')).total.energy, 8);
});

test('Production Surge uses a real friendly Mech predicate and does not count an enemy Mech', () => {
  const ctx = ctxFrom(world().hand('card', { types: ['spell'], energy: 3, power: [] }).unit('mech', { tags: ['Mech'] }));
  const sources = staticsFor(ctx, surge, 'card');
  assert.equal(build(ctx, sources).total.energy, 1);
  assert.equal(ctx.perform({ type: 'take-control', object: ctx.ref('mech'), player: 'B' }).status, 'done');
  assert.equal(build(ctx, sources).total.energy, 3);
});

test('Rhasa locks variable trash counts at Finalize and preserves null printed Power', () => {
  const ctx = ctxFrom(world().hand('card', { energy: 10, power: null }).card('trash1', { zone: 'trash' }).card('trash2', { zone: 'trash' }).card('enemy', { zone: 'trash', owner: 'B' }));
  const sources = staticsFor(ctx, rhasa, 'card');
  const plan = build(ctx, sources);
  assert.equal(plan.total.energy, 8);
  assert.equal(plan.printed.power, null);
  assert.equal(ctx.perform({ type: 'recycle', object: ctx.ref('trash1') }).status, 'done');
  assert.equal(build(ctx, sources).total.energy, 9);
  assert.equal(plan.total.energy, 8);
});

test('Party Crasher counts exhausted friendly units using the strict filter', () => {
  const ctx = ctxFrom(world().hand('card', { energy: 9, power: [] }).unit('tired', { exhausted: true }).unit('ready').unit('enemy', { owner: 'B', exhausted: true }));
  assert.equal(build(ctx, staticsFor(ctx, crasher, 'card')).total.energy, 8);
  assert.equal(ctx.perform({ type: 'ready', object: ctx.ref('tired') }).status, 'done');
  assert.equal(build(ctx, staticsFor(ctx, crasher, 'card')).total.energy, 9);
});

test('Void Drone requires the saved play origin; current chain zone is not an origin substitute', () => {
  const ctx = basic({ energy: 2 });
  const sources = staticsFor(ctx, drone, 'card');
  assert.throws(() => build(ctx, sources), fail);
  assert.equal(build(ctx, sources, {}, { originZone: 'hand' }).total.energy, 2);
  assert.equal(build(ctx, sources, {}, { originZone: 'trash' }).total.energy, 0);
});

test('multiple increases precede discounts and all discounts stop at zero (356.3/356.6)', () => {
  const ctx = basic({ energy: 1 });
  const sources = [binding(ctx, 'reduce', modify(-10)), binding(ctx, 'increase2', modify(2)), binding(ctx, 'increase3', modify(3))];
  const plan = build(ctx, sources, { optionalAdditional: [{ id: 'repeat', kind: 'repeat', selected: true, cost: energy(2) }] });
  assert.equal(plan.components.filter(component => component.stage === 'increase').length, 2);
  assert.equal(plan.discounts[0].before, 8);
  assert.equal(plan.total.energy, 0);
  assert.equal(plan.selectedAdditional[0].id, 'repeat');
});

test('the payer chooses observable minimum ordering; invalid choices fail closed (356.4.e)', () => {
  const ctx = basic();
  const sources = [binding(ctx, 'minimum', modify(-1, { minimum: 1 })), binding(ctx, 'large', modify(-7))];
  const before = ctx.snapshot();
  assert.throws(() => build(ctx, sources), error => error instanceof AwaitChoice && error.request.id === 'cost:discount-order:0');
  assert.deepEqual(ctx.snapshot(), before);
  ctx.setAnswers({ 'cost:discount-order:0': 'minimum:0:total' });
  const plan = build(ctx, sources);
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.discounts.map(discount => [discount.before, discount.after]), [[8, 7], [7, 0]]);
  assert.equal(build(ctx, sources, { discountOrder: ['large:0:total', 'minimum:0:total'] }).total.energy, 1);
  ctx.setAnswers({ 'cost:discount-order:0': 'invented' });
  assert.throws(() => build(ctx, sources), fail);
});

test('Ezreal chooses one resource for each selected optional component before total discounts', () => {
  const ctx = basic({ energy: 0 });
  const sources = staticsFor(ctx, ezreal, 'host');
  const ability = sources[0];
  const values = { optionalAdditional: [
    { id: 'first', kind: 'repeat', selected: true, cost: { energy: c(1), payments: [{ kind: 'power', allowedDomains: ['Fury'] }] } },
    { id: 'second', kind: 'repeat', selected: true, cost: energy(1) },
    { id: 'declined', kind: 'repeat', selected: false, cost: energy(10) }
  ], discounts: [{ id: 'total', resource: 'energy', amount: c(1) }] };
  ctx.setAnswers({
    [`cost:modifier:${ability.id}:0:first:resource`]: 'alternative',
    [`cost:modifier:${ability.id}:0:second:resource`]: 'primary'
  });
  const plan = build(ctx, sources, values);
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.components.map(component => component.cost.energy), [0, 1, 0]);
  assert.deepEqual(plan.discounts.map(discount => discount.component), ['first', 'second', null]);
  assert.deepEqual(plan.declinedAdditional, ['declined']);
  assert.deepEqual(plan.selectedAdditional.map(component => component.id), ['first', 'second']);
});

test('Irelia target relation uses exact locked identity and one Energy OR any Power reduction', () => {
  const ctx = basic({ energy: 1, power: ['Mind'] });
  const sources = staticsFor(ctx, irelia, 'host');
  assert.throws(() => build(ctx, sources), fail);
  assert.equal(build(ctx, sources, {}, { targets: [] }).total.energy, 1);
  assert.equal(build(ctx, sources, {}, { targets: [{ ...ctx.ref('host'), zoneEntryId: 99 }] }).total.energy, 1);
  ctx.setAnswers({ [`cost:modifier:${sources[0].id}:0:total:resource`]: 'alternative' });
  const plan = build(ctx, sources, {}, { targets: [ctx.ref('host')] });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, []);
});

test('Power increases use all six domains and Power reductions can remove any requirement', () => {
  const ctx = basic({ energy: 0, power: [] });
  const sources = [binding(ctx, 'power', staticAbility({ kind: 'continuous.cost-modification', stage: 'increase', resource: 'power', amount: 1, universal: true }))];
  const plan = build(ctx, sources);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] }]);
  const reducer = binding(ctx, 'reduce', staticAbility({ kind: 'continuous.cost-modification', stage: 'discount', resource: 'power', amount: 10, universal: true }));
  assert.deepEqual(build(ctx, [...sources, reducer]).total.power, []);
});

test('leaving/reentering a static host invalidates the old binding without rebinding its card id', () => {
  const ctx = basic();
  const sources = [binding(ctx, 'a', modify(-2))];
  assert.equal(build(ctx, sources).total.energy, 6);
  assert.equal(ctx.perform({ type: 'return-to-hand', object: ctx.ref('host') }).status, 'done');
  assert.equal(build(ctx, sources).total.energy, 8);
  assert.equal(ctx.perform({ type: 'move-zone', object: ctx.ref('host'), to: 'base' }).status, 'done');
  assert.equal(build(ctx, sources).total.energy, 8);
});

test('first qualifying gear each turn: real Finalize history, token/opponent filters, real turn reset', () => {
  const f = turnFixture({ setup(builder) {
    builder.base('forge');
    for (const id of ['first', 'second', 'third']) builder.hand(id, { types: ['gear'], energy: 2, power: [] });
  } });
  f.flow.start();
  f.flow.execute({ id: 'seed', controller: 'A', source: f.kernel.getObject('forge'), kind: 'activated', speed: 'normal', cost: undefined, body: [{ id: 'seed-energy', op: 'effect.resources', args: { energy: c(3), player: c('A') } }] });
  while (f.flow.chain.items.length) f.flow.pass(f.flow.chain.priority);
  const cardIds = new Set(['first', 'second', 'third']);
  const history = () => {
    const events = f.flow.chain.pipeline.events;
    const start = events.findLastIndex(event => event.timingPoint === 'turn-start');
    return events.slice(start + 1).filter(event => event.timingPoint === 'chain-item-finalize' && cardIds.has(event.object?.ref.id))
      .map(event => ({ object: event.object, player: event.player }));
  };
  function context(id) { return bindResolveContext(f.kernel, { source: f.kernel.getObject(id), controller: 'A' }); }
  function sources(id) { return { statics: staticsFor(context(id), forge, 'forge'), finalizedPlaysThisTurn: history() }; }
  const before = f.kernel.player('A').energy;
  for (const [id, expected] of [['first', 1], ['second', 2]]) {
    const ctx = context(id);
    const cost = collectCostModifications(ctx, input(), sources(id));
    assert.equal(finalizeCostPlan(ctx, cost).total.energy, expected);
    f.flow.execute({ id, controller: 'A', source: f.kernel.getObject(id), kind: 'gear', speed: 'normal', body: [], cost });
  }
  assert.equal(f.kernel.player('A').energy, before - 3);
  assert.equal(history().length, 2);
  f.flow.endTurn('A');
  while (f.flow.chain.items.length) f.flow.pass(f.flow.chain.priority);
  f.flow.advance();
  f.flow.endTurn('B');
  assert.equal(f.flow.turn, 3);
  assert.equal(history().length, 0);
  assert.equal(finalizeCostPlan(context('third'), input(), sources('third')).total.energy, 1);
});

test('Battering Ram counts a genuinely finalized, subsequently countered spell (420.4.b)', () => {
  const f = chainFixture({ cards: [{ id: 'earlier', types: ['spell'] }, { id: 'card', types: ['unit'], energy: 5 }] });
  f.engine.execute(f.card('earlier', { body: [] }));
  const earlier = f.engine.items.find(item => item.id === 'earlier');
  assert.equal(f.engine.commit({ type: 'counter', object: earlier.object }).status, 'done');
  f.engine.advance();
  const events = f.engine.pipeline.events.filter(event => event.timingPoint === 'chain-item-finalize' && event.object?.ref.id === 'earlier');
  const ctx = bindResolveContext(f.kernel, { source: f.kernel.getObject('card'), controller: 'A' });
  assert.throws(() => build(ctx, staticsFor(ctx, ram, 'card')), fail);
  assert.equal(build(ctx, staticsFor(ctx, ram, 'card'), {}, { finalizedPlaysThisTurn: events.map(event => ({ object: event.object, player: event.player })) }).total.energy, 4);
});

test('unsupported predicates, usage windows, filters and counts never become executable discounts', () => {
  const ctx = basic();
  for (const ability of [
    modify(-1, { once: 'per-turn' }),
    modify(-1, { when: c('self-in-combat') }),
    modify(-1, { filter: { madeUpCondition: true } }),
    modify({ kind: 'count', subject: 'unknown-history' }),
    modify(-1, { per: 'points-scored-from-holding-this-turn' }),
    modify(-1, {}, { kind: 'always' })
  ].slice(0, 5)) assert.throws(() => build(ctx, [binding(ctx, 'unsupported', ability)]), fail);
  assert.throws(() => build(ctx, [binding(ctx, 'missing-history', modify(-1, { duration: 'per-turn-first-play' }))]), fail);
  assert.throws(() => build(ctx, [], { optionalAdditional: [{ id: 'unselected', kind: 'repeat', cost: energy(1) }] }), fail);
});

test('null printed Energy stays missing even when a static discount would cover a cost', () => {
  const ctx = basic({ energy: null, power: null });
  assert.throws(() => build(ctx, [binding(ctx, 'discount', modify(-99))]), error => error instanceof CostPlanError && error.reason === 'missing-printed-cost');
  assert.equal(ctx.source.energy, null);
});
