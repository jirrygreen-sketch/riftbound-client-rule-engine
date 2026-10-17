import assert from 'node:assert/strict';
import test from 'node:test';
import instruction from '../../../dist/effects/instructions/continuous.cost-modification.js';
import { instructionDefinitionsById } from '../../../dist/effects/instructions/registry.generated.js';
import { world, runInstruction } from '../../../dist/effects/testing/index.js';
import { resolveChainBody } from '../../../dist/chain/interpreter-adapter.js';
import { ContinuousEffectRegistry } from '../../../dist/layers/duration.js';
import { LayerEngine } from '../../../dist/layers/engine.js';
import { finalizeCostPlan } from '../../../dist/cost/discounts/index.js';
import { CostPlanError } from '../../../dist/cost/plan-types.js';

const c = value => ({ kind: 'constant', value });
const args = (values = {}) => ({ resource: c('energy'), amount: c(-2), ...values });
const fail = error => error instanceof CostPlanError && error.reason === 'judge-required';
function setup() {
  const kernel = world().player('A', { energy: 10, power: ['Order'] })
    .unit('host').hand('card', { types: ['spell'], energy: 3, power: [] }).hand('enemy', { owner: 'B', types: ['spell'], energy: 3, power: [] }).build();
  return kernel.clone({ sourceSnapshot: kernel.getObject('host') });
}
function registryOf(ctx) {
  const registry = new ContinuousEffectRegistry();
  for (const entry of ctx.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
}
function plan(ctx, registry, card = 'card') {
  const payment = ctx.clone({ sourceSnapshot: ctx.getObject(card), controller: ctx.getObject(card).controller });
  return finalizeCostPlan(payment, { id: 'play', cost: { kind: 'printed' } }, { continuous: registry.list() });
}

test('continuous.cost-modification is generated into the real registry and runs through the interpreter', () => {
  assert.equal(instructionDefinitionsById.has('continuous.cost-modification'), true);
  const ctx = setup();
  const result = resolveChainBody([{ id: 'discount', op: instruction.op, args: args({ duration: c('this-turn'), appliesTo: c({ type: 'spell', controller: 'controller' }) }) }], ctx);
  assert.equal(result.results[0].result.status, 'executed');
  assert.equal(ctx.continuousEffects.length, 1);
  assert.equal(ctx.continuousEffects[0].effect.layer, 'arithmetic');
  const registry = registryOf(ctx);
  assert.equal(plan(ctx, registry).total.energy, 1);
  assert.equal(plan(ctx, registry, 'enemy').total.energy, 3);
  assert.deepEqual(registry.expireAt({ id: 'turn-end' }, ref => ctx.object(ref)), [ctx.continuousEffects[0].effect.id]);
  assert.equal(plan(ctx, registry).total.energy, 3);
});

test('lifetimes: this combat, explicit until/player, permanent, and while-source-in-zone', () => {
  for (const [duration, event, expires] of [
    ['this-combat', { id: 'combat-end' }, true],
    [{ type: 'until', at: 'turn-start', player: 'B' }, { id: 'turn-start', player: 'A' }, false],
    [{ type: 'until', at: 'turn-start', player: 'B' }, { id: 'turn-start', player: 'B' }, true],
    ['permanent', { id: 'turn-end' }, false]
  ]) {
    const ctx = setup();
    runInstruction(instruction, args({ duration: c(duration) }), { world: ctx });
    const registry = registryOf(ctx);
    assert.equal(registry.expireAt(event, ref => ctx.object(ref)).length, expires ? 1 : 0);
    assert.equal(plan(ctx, registry).total.energy, expires ? 3 : 1);
  }
  const ctx = setup();
  runInstruction(instruction, args({ duration: c('while-source-in-zone') }), { world: ctx });
  const registry = registryOf(ctx);
  assert.equal(ctx.perform({ type: 'return-to-hand', object: ctx.ref('host') }).status, 'done');
  assert.equal(plan(ctx, registry).total.energy, 3);
  assert.equal(registry.expireInactive(ref => ctx.object(ref)).length, 1);
});

test('a resolved duration persists using source LKI after its host leaves', () => {
  const ctx = setup();
  runInstruction(instruction, args({ duration: c('this-turn') }), { world: ctx });
  const registry = registryOf(ctx);
  assert.equal(ctx.perform({ type: 'return-to-hand', object: ctx.ref('host') }).status, 'done');
  assert.equal(plan(ctx, registry).total.energy, 1);
});

test('target filtering retains zone-entry identity across leave and reentry', () => {
  const ctx = setup();
  const selected = ctx.ref('card');
  const run = runInstruction(instruction, args({ target: c('chosen') }), { world: ctx, targets: { chosen: [selected] } });
  assert.equal(run.result.status, 'executed');
  const registry = registryOf(ctx);
  assert.equal(plan(ctx, registry).total.energy, 1);
  assert.equal(plan(ctx, registry, 'enemy').total.energy, 3);
  assert.equal(ctx.perform({ type: 'move-zone', object: ctx.ref('card'), to: 'trash' }).status, 'done');
  assert.equal(ctx.perform({ type: 'return-to-hand', object: ctx.ref('card') }).status, 'done');
  assert.equal(plan(ctx, registry).total.energy, 3);
});

test('all stale targets are ignored; partial staleness only registers the remaining targets', () => {
  const ctx = setup();
  const stale = { id: 'missing', zoneEntryId: 9 };
  const ignored = runInstruction(instruction, args({ target: c('chosen') }), { world: ctx, targets: { chosen: [stale] } });
  assert.deepEqual(ignored.result, { status: 'ignored', reason: 'mistargeted' });
  assert.equal(ctx.continuousEffects.length, 0);
  const partial = runInstruction(instruction, args({ target: c('chosen') }), { world: ctx, targets: { chosen: [stale, ctx.ref('card')] } });
  assert.equal(partial.result.status, 'executed');
  assert.equal(plan(ctx, registryOf(ctx)).total.energy, 1);
});

test('repeated registrations get distinct deterministic identities and stack with a zero floor', () => {
  const ctx = setup();
  const other = setup();
  for (const kernel of [ctx, other]) {
    runInstruction(instruction, args(), { world: kernel });
    runInstruction(instruction, args(), { world: kernel });
  }
  assert.notEqual(ctx.continuousEffects[0].effect.id, ctx.continuousEffects[1].effect.id);
  assert.deepEqual(ctx.continuousEffects, other.continuousEffects);
  assert.equal(plan(ctx, registryOf(ctx)).total.energy, 0);
});

test('Power [A] increases accept all Domains; explicit discount stage uses a positive magnitude', () => {
  const ctx = setup();
  runInstruction(instruction, args({ resource: c('power'), amount: c(2), stage: c('increase'), universal: c(true) }), { world: ctx });
  assert.deepEqual(plan(ctx, registryOf(ctx)).total.power, [{ amount: 2, allowedDomains: ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] }]);
  runInstruction(instruction, args({ resource: c('power'), amount: c(9), stage: c('discount'), domain: c('any') }), { world: ctx });
  assert.deepEqual(plan(ctx, registryOf(ctx)).total.power, []);
});

test('registering a cost modifier leaves printed characteristics unchanged in the layer engine', () => {
  const ctx = setup();
  runInstruction(instruction, args(), { world: ctx });
  const engine = new LayerEngine(ctx.objects, { effects: registryOf(ctx).list() });
  assert.equal(engine.snapshot(ctx.ref('card')).energy, 3);
  assert.equal(plan(ctx, registryOf(ctx)).total.energy, 1);
});

test('zero is skipped; invalid resources, amounts, filters, scopes, domains and durations fail closed', () => {
  const ctx = setup();
  const zero = runInstruction(instruction, args({ amount: c(0) }), { world: ctx });
  assert.deepEqual(zero.result, { status: 'negated', reason: 'skipped', events: [] });
  const before = ctx.snapshot();
  for (const fields of [
    { amount: c(null) }, { resource: c('xp') }, { amount: c(1.5) },
    { duration: c('next-card') }, { minimum: c(-1) },
    { filter: c({ unsupported: true }) }, { appliesTo: c('whatever') },
    { resource: c('power'), domain: c('Universal') },
    { resource: c('power'), universal: c(true), domains: c(['Mind']) },
    { amount: c(-1), stage: c('discount') }
  ]) assert.throws(() => runInstruction(instruction, args(fields), { world: ctx }), fail);
  assert.throws(() => runInstruction(instruction, args({ extra: c(true) }), { world: ctx }), /Unsupported/);
  assert.deepEqual(ctx.snapshot(), before);
});
