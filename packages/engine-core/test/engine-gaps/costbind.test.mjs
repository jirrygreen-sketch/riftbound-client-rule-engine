import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCostPlan } from '../../dist/cost/cost-plan.js';
import { finalizeCostPlan } from '../../dist/cost/discounts/index.js';
import { payCostPlan } from '../../dist/cost/payment.js';
import { CostPlanError } from '../../dist/cost/plan-types.js';
import { evaluateCondition } from '../../dist/effects/interpreter/condition.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext } from '../../dist/events/action-adapter.js';
import { createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import clockworkKeeper from '../../../card-dsl/dist/cards/ogn/clockwork-keeper.js';
import cruelPatron from '../../../card-dsl/dist/cards/ogn/cruel-patron.js';
import blazingScorcher from '../../../card-dsl/dist/cards/ogn/blazing-scorcher.js';

const constant = value => ({ kind: 'constant', value });
const executable = program => ({ ...program, status: 'executable', judgeReason: undefined });

function sourceFor(program, values = {}) {
  const kernel = world()
    .player('A', { energy: 20, power: ['Calm', 'Mind', 'Fury'], xp: 5 })
    .player('B')
    .hand('card', {
      cardId: program.canonicalCardId,
      types: ['unit'],
      energy: 2,
      power: null,
      keywords: [],
      ...values,
    })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject('card'), controller: 'A' });
}

function contextFor(source) {
  return bindResolveContext(source, {
    source: source.getObject('card'),
    controller: 'A',
    timingPoint: 'chain-item-finalize',
    choose: request => {
      if (request.id.endsWith(':optional:clockwork-keeper.calm')) return true;
      if (request.id.endsWith(':optional:cruel-patron.kill')) return true;
      if (request.type === 'select-objects' && request.options.length === request.min) return [...request.options];
      throw new Error(`Unexpected choice ${request.id}`);
    },
  });
}

function chainScene(program, builder, answerFor = () => undefined) {
  const kernel = builder.build();
  const asked = [];
  const choose = request => {
    asked.push(request);
    const answer = answerFor(request, kernel);
    if (answer !== undefined) return answer;
    if (request.type === 'select-objects' && request.options.length === request.min) return [...request.options];
    throw new Error(`Unexpected choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  let binding;
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: (action, source) => binding.describePlay(action, source),
  });
  binding = createProgramBinding({
    cardPrograms: [program],
  });
  return { kernel, binding, engine, asked };
}

function settle(engine) {
  for (let count = 0; engine.items.length; count++) {
    assert.ok(count < 20, 'the real Chain must settle');
    engine.pass(engine.priority);
  }
}

test('original Clockwork Keeper IR binds the optional Calm cost and keeps paid when discounted to zero', () => {
  const program = executable(clockworkKeeper);
  const source = sourceFor(program, { power: [] });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const draft = binding.describePlay({ type: 'play', player: 'A', object: source.ref('card') }, source.getObject('card'));

  assert.equal(draft.cost.cost.kind, 'printed');
  assert.deepEqual(draft.cost.optionalAdditional, [{
    id: 'clockwork-keeper.calm',
    kind: 'additional',
    cost: { payments: [{ kind: 'power', amount: constant(1), allowedDomains: ['Calm'] }] },
  }]);
  assert.equal(draft.cost.mandatoryAdditional, undefined);

  const plan = finalizeCostPlan(contextFor(source), {
    ...draft.cost,
    optionalAdditional: draft.cost.optionalAdditional.map(entry => ({ ...entry, selected: true })),
    discounts: [{
      id: 'zero-calm',
      component: 'clockwork-keeper.calm',
      resource: 'power',
      amount: constant(1),
    }],
  });
  const component = plan.components.find(item => item.id === 'clockwork-keeper.calm');
  assert.equal(component.stage, 'optional-additional');
  assert.equal(component.cost.power.length, 0);
  assert.equal(plan.selectedAdditional.length, 1);
  assert.deepEqual(plan.selectedAdditional.map(({ id, kind }) => ({ id, kind })), [{ id: 'clockwork-keeper.calm', kind: 'additional' }]);
  const receipt = payCostPlan(contextFor(source), plan);
  assert.equal(receipt.additional[0].id, component.id);
  assert.equal(receipt.additional[0].paid, true);
  assert.deepEqual(receipt.total, plan.total);
  assert.equal(receipt.total.energy, 2);

  const body = clockworkKeeper.abilities.find(ability => ability.kind === 'play').body[0];
  assert.equal(evaluateCondition(body.condition, {
    context: contextFor(source),
    event: { timingPoint: 'card-played' },
    cost: { plan, receipt },
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false,
  }), true);
});

test('original Cruel Patron IR becomes a mandatory non-target kill component', () => {
  const program = executable(cruelPatron);
  const kernel = world()
    .player('A', { energy: 20 })
    .player('B')
    .hand('card', { cardId: program.canonicalCardId, types: ['unit'], energy: 4, power: null })
    .unit('fodder', { controller: 'A' })
    .unit('enemy', { controller: 'B', owner: 'B' })
    .build();
  const source = kernel.clone({ sourceSnapshot: kernel.getObject('card'), controller: 'A' });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const draft = binding.describePlay({ type: 'play', player: 'A', object: source.ref('card') }, source.getObject('card'));

  assert.equal(draft.cost.optionalAdditional, undefined);
  assert.equal(draft.cost.mandatoryAdditional.length, 1);
  assert.equal(draft.cost.mandatoryAdditional[0].id, 'friendly-unit');
  assert.equal(draft.cost.mandatoryAdditional[0].cost.payments[0].kind, 'kill');

  const context = bindResolveContext(source, {
    source: source.getObject('card'), controller: 'A', timingPoint: 'chain-item-finalize',
    choose: request => {
      if (request.type === 'select-objects') return [source.ref('fodder')];
      throw new Error(`Unexpected choice ${request.id}`);
    },
  });
  const plan = buildCostPlan(context, { ...draft.cost });
  assert.deepEqual(plan.total.actions.map(entry => entry.action), [{ type: 'kill', object: source.ref('fodder') }]);
  assert.equal(plan.total.actions[0].componentId, 'friendly-unit');
  assert.equal(plan.total.actions[0].choiceId, 'friendly-unit');
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.actions[1].action.type, 'kill');
  assert.equal(source.getObject('fodder').zone, 'trash');
  assert.equal(source.getObject('enemy').zone, 'board');
});

test('original Blazing Scorcher Accelerate IR binds its selected additional cost and enters the CostPlan receipt', () => {
  const program = executable(blazingScorcher);
  const source = sourceFor(program, { energy: 5, power: ['Fury'], keywords: [{ id: 'Accelerate' }] });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const draft = binding.describePlay({ type: 'play', player: 'A', object: source.ref('card') }, source.getObject('card'));
  assert.equal(draft.cost.optionalAdditional.length, 1);
  assert.equal(draft.cost.optionalAdditional[0].kind, 'accelerate');
  assert.equal(draft.cost.optionalAdditional[0].selected, undefined);
});

test('printed keyword params reach CostPlan through the default keyword expansion', () => {
  const repeatCost = { kind: 'explicit', energy: constant(2) };
  const program = {
    canonicalCardId: 'test:printed-repeat-params',
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: '[Repeat] 2 Energy. Draw 1.',
    abilities: [{ kind: 'keyword', keyword: 'repeat', params: { cost: repeatCost } }],
  };
  const kernel = world()
    .player('A', { energy: 5 })
    .player('B')
    .hand('spell', { cardId: program.canonicalCardId, types: ['spell'], energy: 1, power: null })
    .build();
  const source = kernel.clone({ sourceSnapshot: kernel.getObject('spell'), controller: 'A' });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const draft = binding.describePlay(
    { type: 'play', player: 'A', object: source.ref('spell') }, source.getObject('spell'));

  assert.equal(draft.cost.optionalAdditional.length, 1);
  assert.equal(draft.cost.optionalAdditional[0].kind, 'repeat');
  assert.deepEqual(draft.cost.optionalAdditional[0].cost, repeatCost);

  const context = bindResolveContext(source, {
    source: source.getObject('spell'),
    controller: 'A',
    timingPoint: 'chain-item-finalize',
    choose: request => request.type === 'optional' ? true : (() => { throw new Error(`Unexpected choice ${request.id}`); })(),
  });
  const plan = buildCostPlan(context, { ...draft.cost });
  assert.equal(plan.selectedAdditional.length, 1);
  assert.equal(plan.selectedAdditional[0].kind, 'repeat');
  assert.equal(plan.components.find(component => component.id === plan.selectedAdditional[0].id).stage, 'optional-additional');
  assert.equal(plan.total.energy, 3);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.additional[0].id, plan.selectedAdditional[0].id);
  assert.deepEqual(receipt.total, plan.total);
  assert.equal(context.player('A').energy, 2);
});

test('default Chain charges Blazing Scorcher Accelerate only when selected', () => {
  const program = executable(blazingScorcher);
  const scene = selected => chainScene(program, world()
    .player('A', { energy: 6, power: ['Fury', 'Fury'] })
    .player('B')
    .hand('unit', { cardId: program.canonicalCardId, types: ['unit'], energy: 5, power: ['Fury'], keywords: [{ id: 'Accelerate' }] }),
  request => request.type === 'optional' ? selected : undefined);

  const paid = scene(true);
  paid.engine.execute(paid.binding.describePlay({ type: 'play', player: 'A', object: paid.kernel.ref('unit') }, paid.kernel.getObject('unit')));
  assert.equal(paid.kernel.player('A').energy, 0);
  assert.deepEqual(paid.kernel.player('A').power, []);
  assert.equal(paid.kernel.getObject('unit').exhausted, false);

  const declined = scene(false);
  declined.engine.execute(declined.binding.describePlay({ type: 'play', player: 'A', object: declined.kernel.ref('unit') }, declined.kernel.getObject('unit')));
  assert.equal(declined.kernel.player('A').energy, 1);
  assert.deepEqual(declined.kernel.player('A').power, ['Fury']);
  assert.equal(declined.kernel.getObject('unit').exhausted, true);
});

test('unknown and conditional additional costs remain fail closed', () => {
  const unknownPayment = {
    canonicalCardId: 'test:unknown-payment', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'As an additional cost, use a mystery cost.',
    abilities: [{ kind: 'play', cost: { kind: 'additional', payments: [{ kind: 'mystery' }] }, body: [] }],
  };
  const source = sourceFor(unknownPayment);
  const binding = createProgramBinding({ cardPrograms: [unknownPayment] });
  const draft = binding.describePlay({ type: 'play', player: 'A', object: source.ref('card') }, source.getObject('card'));
  assert.throws(() => buildCostPlan(contextFor(source), { ...draft.cost }), error =>
    error instanceof CostPlanError && error.reason === 'judge-required');

  const conditional = {
    canonicalCardId: 'test:conditional-cost', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'As an additional cost, discard a card.',
    abilities: [
      { kind: 'static', effect: { kind: 'cost.additional', id: 'conditional', appliesTo: 'self', optional: false, stage: 'mandatory-additional', payments: [{ kind: 'discard' }] }, condition: { kind: 'expression', value: constant('unsupported') } },
      { kind: 'play', body: [] },
    ],
  };
  const conditionalSource = sourceFor(conditional);
  assert.throws(() => createProgramBinding({ cardPrograms: [conditional] }).describePlay(
    { type: 'play', player: 'A', object: conditionalSource.ref('card') }, conditionalSource.getObject('card')),
  error => error.code === 'judge-required' && /unevaluated condition/.test(error.message));
});

test('printed null Energy is not rewritten to zero when binding an additional cost', () => {
  const program = executable(clockworkKeeper);
  const source = sourceFor(program, { energy: null });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const draft = binding.describePlay({ type: 'play', player: 'A', object: source.ref('card') }, source.getObject('card'));
  assert.equal(draft.cost.cost.kind, 'printed');
  assert.equal(Object.hasOwn(draft.cost.cost, 'energy'), false);
  assert.throws(() => buildCostPlan(contextFor(source), { ...draft.cost }), error =>
    error instanceof CostPlanError && error.reason === 'missing-printed-cost');
});

test('default Chain pays or declines original Clockwork Keeper optional cost and gates its body by the receipt', () => {
  const program = executable(clockworkKeeper);
  const paid = chainScene(program, world()
    .player('A', { energy: 2, power: ['Calm'] })
    .player('B')
    .hand('keeper', { cardId: program.canonicalCardId, types: ['unit'], energy: 2, power: null })
    .deck(['A:deck:1', 'A:deck:2'], { owner: 'A' }), request => request.type === 'optional' ? true : undefined);
  paid.engine.execute(paid.binding.describePlay(
    { type: 'play', player: 'A', object: paid.kernel.ref('keeper') }, paid.kernel.getObject('keeper')));
  assert.equal(paid.kernel.player('A').energy, 0);
  assert.deepEqual(paid.kernel.player('A').power, []);
  assert.equal(paid.kernel.player('A').deckCount, 1);
  assert.equal(paid.kernel.getObject('keeper').zone, 'board');

  const declined = chainScene(program, world()
    .player('A', { energy: 2, power: ['Calm'] })
    .player('B')
    .hand('keeper', { cardId: program.canonicalCardId, types: ['unit'], energy: 2, power: null })
    .deck(['A:deck:1', 'A:deck:2'], { owner: 'A' }), request => request.type === 'optional' ? false : undefined);
  declined.engine.execute(declined.binding.describePlay(
    { type: 'play', player: 'A', object: declined.kernel.ref('keeper') }, declined.kernel.getObject('keeper')));
  assert.equal(declined.kernel.player('A').energy, 0);
  assert.deepEqual(declined.kernel.player('A').power, ['Calm']);
  assert.equal(declined.kernel.player('A').deckCount, 2);
});

test('default Chain pays original Cruel Patron mandatory cost, rejects impossible payment, and rolls back late failure', () => {
  const program = executable(cruelPatron);
  const scene = () => world()
    .player('A', { energy: 4 })
    .player('B')
    .hand('patron', { cardId: program.canonicalCardId, types: ['unit'], energy: 4, power: null })
    .unit('fodder', { controller: 'A' })
    .unit('enemy', { controller: 'B', owner: 'B' });

  const paid = chainScene(program, scene());
  paid.engine.execute(paid.binding.describePlay(
    { type: 'play', player: 'A', object: paid.kernel.ref('patron') }, paid.kernel.getObject('patron')));
  assert.equal(paid.kernel.player('A').energy, 0);
  assert.equal(paid.kernel.getObject('fodder').zone, 'trash');
  assert.equal(paid.kernel.getObject('patron').zone, 'board');

  const impossible = chainScene(program, world()
    .player('A', { energy: 4 })
    .player('B')
    .hand('patron', { cardId: program.canonicalCardId, types: ['unit'], energy: 4, power: null })
    .unit('enemy', { controller: 'B', owner: 'B' }));
  const draft = impossible.binding.describePlay(
    { type: 'play', player: 'A', object: impossible.kernel.ref('patron') }, impossible.kernel.getObject('patron'));
  assert.throws(() => impossible.engine.execute(draft), error => error instanceof CostPlanError && error.reason === 'invalid-cost-plan');
  assert.equal(impossible.kernel.player('A').energy, 4);
  assert.equal(impossible.kernel.getObject('patron').zone, 'hand');

  const lateFailure = chainScene(program, scene());
  lateFailure.kernel.addReplacement(action => action.type === 'kill' ? 'prevented' : null);
  const lateDraft = lateFailure.binding.describePlay(
    { type: 'play', player: 'A', object: lateFailure.kernel.ref('patron') }, lateFailure.kernel.getObject('patron'));
  assert.throws(() => lateFailure.engine.execute(lateDraft), error => error instanceof CostPlanError && error.reason === 'cannot-pay-cost');
  assert.equal(lateFailure.kernel.player('A').energy, 4);
  assert.equal(lateFailure.kernel.getObject('fodder').zone, 'board');
  assert.equal(lateFailure.kernel.getObject('patron').zone, 'hand');
});

test('activation location restriction is checked before payment and accepts the battlefield source', () => {
  const program = {
    canonicalCardId: 'test:activation-location', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'Use only while I am at a battlefield.',
    abilities: [{
      kind: 'activated', timing: 'action', restriction: { kind: 'use-only-while-source-at-battlefield' },
      cost: { kind: 'activated', payments: [{ kind: 'exhaust', object: 'self' }] }, body: [],
    }],
  };
  const binding = createProgramBinding({ cardPrograms: [program] });
  const baseKernel = world().player('A').player('B').base('source', { cardId: program.canonicalCardId, exhausted: false }).build();
  const baseScene = chainScene(program, { build: () => baseKernel });
  assert.throws(() => baseScene.engine.execute(baseScene.binding.describeActivate(baseKernel.getObject('source'), 'A')), /Finalize legality failed/);
  assert.equal(baseKernel.getObject('source').exhausted, false);

  const fieldKernel = world().player('A').player('B').unit('source', {
    cardId: program.canonicalCardId, location: { type: 'battlefield', id: 'battlefield-1' }, exhausted: false,
  }).build();
  const fieldScene = chainScene(program, { build: () => fieldKernel });
  fieldScene.engine.execute(fieldScene.binding.describeActivate(fieldKernel.getObject('source'), 'A'));
  assert.equal(fieldKernel.getObject('source').exhausted, true);
});

test('unsupported activation use limits remain judge-required before cost payment', () => {
  const program = {
    canonicalCardId: 'test:usage-limit', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'Use only once each turn.',
    abilities: [{
      kind: 'activated', timing: 'action', restriction: { kind: 'usage-limit', scope: 'once-per-turn' },
      cost: { kind: 'activated', payments: [{ kind: 'exhaust', object: 'self' }] }, body: [],
    }],
  };
  const kernel = world().player('A').unit('source', { cardId: program.canonicalCardId }).build();
  const binding = createProgramBinding({ cardPrograms: [program] });
  assert.throws(() => binding.describeActivate(kernel.getObject('source'), 'A'), error =>
    error.code === 'judge-required' && /usage-limit/.test(error.message));
  assert.equal(kernel.getObject('source').exhausted, false);
});
