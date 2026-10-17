// docs/rules/scenarios/keywords.yaml — Flow (CR v1.5 829.1.b, 829.1.b.2, 829.1.c.1).
//
// Flow expands to a `flow.cost` static declaration (an alternate cost from Trash) plus a
// replacement that banishes the spell instead of letting it return to Trash. The
// merged cost layer already supports the “alternate replaces the base cost only when
// playing a spell from Trash” rule (`{ kind: 'flow' }` in src/cost/cost-plan.ts), and
// the replacement binder can register the authored `object-leaves-chain` body; the
// declaration is asserted below and the end-to-end Play is a todo.
import assert from 'node:assert/strict';
import test from 'node:test';
import flow from '../../../dist/effects/keywords/Flow.js';
import { buildCostPlan } from '../../../dist/cost/cost-plan.js';
import { assessCostPayment, payCostPlan } from '../../../dist/cost/payment.js';
import { bindResolveContext } from '../../../dist/events/action-adapter.js';
import { createEngineStaticBinder } from '../../../dist/programs/statics.js';
import { c, fixture } from './support.mjs';

const FLOW_CARD = 'test:flow-spell';

const program = {
  canonicalCardId: FLOW_CARD,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'Flow [3][E]. Deal 3 to a unit.',
  abilities: [{
    kind: 'play',
    cost: { kind: 'printed' },
    body: [{ id: 'hit', op: 'effect.damage', args: { amount: c(3), target: c('victim') }, targets: [{ id: 'victim', filter: { type: 'unit', zone: 'board' }, min: 1, max: 1 }] }]
  }]
};

test('keywords-flow-play-from-trash-for-flow-cost: Flow expands to a Trash alternate cost plus a chain-leave banish replacement (CR 829.1.b, 829.1.c.1)', () => {
  assert.equal(flow.keyword, 'Flow');
  assert.equal(flow.valued, false);
  // 829.1.c.3: separate instances with different costs stay selectable.
  assert.equal(flow.stacking, 'separate');
  assert.ok(flow.ruleRefs.includes('829.1.b'));
  assert.ok(flow.ruleRefs.includes('829.1.c.1'));

  const abilities = flow.expand({ host: { canonicalCardId: FLOW_CARD }, cost: { kind: 'explicit', energy: c(3) } });
  assert.equal(abilities.length, 2);
  const [costEffect, replacement] = abilities;
  assert.equal(costEffect.kind, 'static');
  assert.equal(costEffect.effect.kind, 'flow.cost');
  assert.equal(costEffect.effect.appliesTo, 'self');
  assert.equal(costEffect.effect.host, 'self');
  assert.equal(costEffect.effect.sourceZone, 'trash');
  assert.equal(costEffect.effect.cost.kind, 'explicit');
  assert.equal(costEffect.effect.cost.energy.value, 3);

  assert.equal(replacement.kind, 'replacement');
  assert.equal(replacement.replaces.event, 'object-leaves-chain');
  assert.deepEqual(replacement.replaces.filter, { source: 'self', zone: 'chain', leavingInstruction: false });
  assert.deepEqual(replacement.with.map(instruction => instruction.op), ['effect.banish']);
  assert.deepEqual(replacement.with[0].args.objects, { kind: 'constant', value: 'source' });
});

test('keywords-flow-play-from-trash-for-flow-cost: the merged cost planner replaces the base cost with the Flow cost when playing from Trash (CR 829.1.b)', () => {
  const kernel = world().player('A', { energy: 3 }).player('B')
    .object('spell', { cardId: FLOW_CARD, types: ['spell'], zone: 'trash', energy: 5, power: null, keywords: [{ id: 'Flow' }] })
    .unit('victim', { owner: 'B', controller: 'B', might: 3 })
    .deck(['A:deck:1'], { owner: 'A' }).deck(['B:deck:1'], { owner: 'B' }).build();
  const context = bindResolveContext(kernel.clone({ sourceSnapshot: kernel.getObject('spell'), controller: 'A' }), { controller: 'A' });

  const plan = buildCostPlan(context, {
    id: 'cost:flow',
    cost: { kind: 'printed' },
    baseModifications: [{ kind: 'flow', id: 'flow', cost: { kind: 'explicit', energy: c(3) } }]
  });
  assert.equal(plan.total.energy, 3, 'the Flow cost replaces the printed 5 Energy');
  // The plan keeps the printed cost on `base` for provenance while the charged base
  // component is the alternate cost, which is what the total and the receipt use.
  assert.equal(plan.base.energy, 5, 'the printed cost stays readable');
  assert.deepEqual(plan.components.map(component => [component.id, component.kind, component.cost.energy]), [['base', 'printed', 3]]);
  assert.equal(assessCostPayment(context, plan).payable, true);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.equal(context.player('A').energy, 0);
});

test('keywords-flow-timing-unchanged: the planner refuses a Flow base modification for a spell that is not in Trash (CR 829.1.b.2)', () => {
  const kernel = world().player('A', { energy: 3 }).player('B')
    .hand('spell', { cardId: FLOW_CARD, types: ['spell'], energy: 5, power: null, keywords: [{ id: 'Flow' }] })
    .deck(['A:deck:1'], { owner: 'A' }).deck(['B:deck:1'], { owner: 'B' }).build();
  const context = bindResolveContext(kernel.clone({ sourceSnapshot: kernel.getObject('spell'), controller: 'A' }), { controller: 'A' });

  assert.throws(
    () => buildCostPlan(context, {
      id: 'cost:flow',
      cost: { kind: 'printed' },
      baseModifications: [{ kind: 'flow', id: 'flow', cost: { kind: 'explicit', energy: c(3) } }]
    }),
    /Flow replaces the base cost only when playing a spell from Trash/
  );
  assert.equal(context.player('A').energy, 3, 'nothing was paid');
});

test('keywords-flow-play-from-trash-for-flow-cost: the production static binder refuses the Flow declaration (CR 829.1.b)', () => {
  const f = fixture({
    programs: [program],
    setup: w => w.object('spell', { cardId: FLOW_CARD, types: ['spell'], zone: 'trash', energy: 5, power: null, keywords: [{ id: 'Flow' }] })
  });
  const binder = createEngineStaticBinder(f.engine);
  const ability = f.binding.inspect(f.get('spell')).abilities.find(candidate => candidate.kind === 'static');
  assert.equal(ability.effect.kind, 'flow.cost');
  assert.throws(
    () => binder.bindStatic(ability, f.get('spell')),
    error => error.code === 'judge-required' && /has no layer mapping/.test(error.message)
  );
});

test.todo('keywords-flow-play-from-trash-for-flow-cost (829.1.b/829.1.c.1 execution): the end-to-end Play from Trash needs a Finalize consumer that turns the `flow.cost` declaration into the `{ kind: \'flow\' }` base modification — src/programs/play.ts `translateCost()` rejects the `keyword`/`optional` cost fields and no merged code reads static `flow.cost` declarations, so a Flow spell’s Play plan still charges the printed cost; the merged planner rule and the authored declaration are asserted above');

test.todo('keywords-flow-play-from-trash-for-flow-cost (829.1.c.1 banish): the authored replacement body is `effect.banish` on an `object-leaves-chain` event, but the replacement planner resolves the replaced event’s object through bindings the merged `planReplacementBody` expects and the banish primitive requires a concrete list, so the return-to-Trash rewrite cannot be run end-to-end yet; the declaration is asserted above');

// The world helper is imported lazily to keep the cost-layer tests first.
import { world } from '../../../dist/effects/testing/index.js';
