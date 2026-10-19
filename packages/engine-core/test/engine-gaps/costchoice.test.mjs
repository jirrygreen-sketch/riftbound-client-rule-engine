import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCostPlan } from '../../dist/cost/cost-plan.js';
import { finalizeCostChoiceLock, costChoiceLocks } from '../../dist/cost/plan-values.js';
import { payCostPlan } from '../../dist/cost/payment.js';
import { CostPlanError } from '../../dist/cost/plan-types.js';
import costPayAny from '../../dist/effects/instructions/cost.pay-any.js';
import costPayAnyPower from '../../dist/effects/instructions/cost.pay-any-power.js';
import { runInstruction, world } from '../../dist/effects/testing/index.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import ironRevenant from '../../../card-dsl/dist/cards/rad/iron-revenant.js';
import ancientHenge from '../../../card-dsl/dist/cards/sfd/ancient-henge.js';
import { runAbilityBody } from '../../dist/effects/interpreter.js';
import { instructionDefinitionsById } from '../../dist/effects/instructions/registry.generated.js';

const literal = value => ({ kind: 'constant', value });
const failure = reason => error => error instanceof CostPlanError && error.reason === reason;

function withSource(builder, id = 'source') {
  const context = builder.build();
  return context.clone({ sourceSnapshot: context.object(context.ref(id)) });
}

function chainScene(builder, options = {}) {
  const kernel = builder.build();
  const objects = () => options.stripEmpowered
    ? kernel.objects.map(({ empowered, empoweredCount, ...object }) => object)
    : kernel.objects;
  const answers = new Map(Object.entries(options.answers ?? {}));
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const decide = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    return choose(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide })
  });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false
  });
  return { kernel, engine, answers, asked };
}

test('Finalize binds a non-target cost choice to current controller and zone', () => {
  const context = withSource(
    world()
      .player('A', { energy: 0 })
      .hand('source', { types: ['spell'], energy: 0, power: [] })
      .hand('gear-a', { types: ['gear'] })
      .hand('unit-a', { types: ['unit'] })
      .hand('gear-b', { owner: 'B', types: ['gear'] })
  );
  const cost = {
    payments: [{
      kind: 'discard',
      amount: literal(1),
      choice: {
        id: 'discard-gear',
        options: ['gear-in-controller-hand'],
        filter: { type: 'gear', zone: 'hand', owner: 'controller' },
        selection: 'up-to',
        min: 0,
        max: null
      }
    }]
  };
  let asked;
  try { buildCostPlan(context, { id: 'play', cost }); }
  catch (error) { asked = error; }
  assert.equal(asked?.name, 'AwaitChoice');
  assert.deepEqual(asked.request.options, [context.ref('gear-a')]);
  assert.equal(asked.request.min, 0);
  assert.equal(asked.request.max, 1);

  context.setPicks('discard-gear', [context.ref('gear-a')]);
  const selectedRef = context.ref('gear-a');
  const plan = buildCostPlan(context, { id: 'play', cost });
  assert.deepEqual(plan.total.choices, [{
    id: 'discard-gear', kind: 'discard', min: 0, max: 1, count: 1,
    objects: [selectedRef]
  }]);
  assert.equal(plan.total.actions[0].action.type, 'discard');
  const receipt = payCostPlan(context, plan);
  assert.deepEqual(receipt.choices[0].objects, [selectedRef]);
  assert.equal(context.object(selectedRef), null);
});

test('Finalize consumes the authored zone/type/owner cost-choice fields', () => {
  const context = withSource(
    world()
      .player('A')
      .unit('source', { types: ['legend'], exhausted: false })
      .card('unit-a', { zone: 'trash', types: ['unit'] })
      .card('gear-a', { zone: 'trash', types: ['gear'] })
      .card('unit-b', { owner: 'B', zone: 'trash', types: ['unit'] })
  );
  const cost = ironRevenant.abilities[0].cost;
  assert.throws(() => buildCostPlan(context, { id: 'iron-revenant', cost }), error => error?.name === 'AwaitChoice');
  context.setPicks('iron-revenant.banished-card', [context.ref('gear-a')]);
  const plan = buildCostPlan(context, { id: 'iron-revenant', cost });
  assert.deepEqual(plan.total.choices[0].objects, [context.ref('gear-a')]);
  payCostPlan(context, plan);
  assert.equal(context.object(context.ref('gear-a')).zone, 'banishment');
  assert.equal(context.object(context.ref('source')).exhausted, true);
});

test('dynamic cost choices reject an unavailable required selection before payment', () => {
  const context = withSource(world().player('A', { energy: 2 }).hand('source', { types: ['spell'], energy: 2, power: [] }));
  assert.throws(() => buildCostPlan(context, {
    id: 'required',
    cost: { payments: [{ kind: 'discard', choice: {
      id: 'missing', options: ['card-in-hand'], filter: { type: 'gear', zone: 'hand', owner: 'controller' }, min: 1, max: 1
    } }] }
  }), failure('invalid-cost-plan'));
  assert.equal(context.player('A').energy, 2);
});

test('banish uses current control and disempower consumes exactly one authoritative status', () => {
  const context = withSource(world().player('A').unit('source', { types: ['unit'] }), 'source');
  context.perform({ type: 'empower', object: context.ref('source'), amount: 2 });
  const disempower = buildCostPlan(context, { id: 'disempower', cost: { payments: [{ kind: 'disempower', object: 'self' }] } });
  assert.equal(disempower.total.actions[0].action.type, 'disempower');
  const banish = buildCostPlan(context, { id: 'banish', cost: { payments: [{ kind: 'banish', object: 'self' }] } });
  assert.equal(banish.total.actions[0].action.type, 'banish');
  payCostPlan(context, disempower);
  assert.equal(context.object(context.ref('source')).empowered, 1);
  assert.equal(context.object(context.ref('source')).buffs, 0);
  payCostPlan(context, buildCostPlan(context, {
    id: 'disempower-last', cost: { payments: [{ kind: 'disempower', object: 'self' }] }
  }));
  assert.equal(context.object(context.ref('source')).empowered, 0);
  assert.throws(() => payCostPlan(context, buildCostPlan(context, {
    id: 'disempower-zero', cost: { payments: [{ kind: 'disempower', object: 'self' }] }
  })), failure('cannot-pay-cost'));
  payCostPlan(context, banish);
  assert.equal(context.object(context.ref('source')).zone, 'banishment');
});

test('cost.pay-any publishes the selected amount and payment receipt', () => {
  const context = withSource(world().player('A', { energy: 4 }).hand('source', { types: ['spell'], energy: 0, power: [] }));
  const asked = runInstruction(costPayAny, {
    resource: literal('energy'), amount: literal('any'), linkKey: literal('spent')
  }, { world: context });
  assert.equal(asked.asked.request.max, 4);
  const paid = runInstruction(costPayAny, {
    resource: literal('energy'), amount: literal('any'), linkKey: literal('spent')
  }, { world: context, answers: { 'source:cost-pay-any': 3 } });
  assert.equal(paid.result.status, 'executed');
  assert.equal(paid.linked.spent, 3);
  assert.equal(paid.linked['spent.amount'], 3);
  assert.equal(paid.linked['spent.receipt'].total.energy, 3);
  assert.equal(context.player('A').energy, 1);
});

test('the authored Ancient Henge IR reaches cost.pay-any through the default registry', () => {
  const instruction = ancientHenge.abilities[0].body[0];
  const context = withSource(world().player('A', { energy: 4 }).hand('source', { types: ['gear'], energy: 0, power: [] }));
  assert.throws(() => runAbilityBody([instruction], context, instructionDefinitionsById), error => error?.name === 'AwaitChoice');
  context.setAnswers({ 'ancient-henge.pay-any-energy/source%3Acost-pay-any': 3 });
  const outcome = runAbilityBody([instruction], context, instructionDefinitionsById);
  assert.equal(outcome.status, 'executed');
  assert.equal(outcome.linkedValues['ancient-henge.pay-any-energy.paid'], 3);
  assert.equal(context.player('A').energy, 1);
});

test('cost.pay-any keeps Universal Power judge-required instead of spending named domains', () => {
  const context = withSource(world().player('A', { power: ['Fury', 'Mind'] }).hand('source', { types: ['spell'], energy: 0, power: [] }));
  assert.throws(() => runInstruction(costPayAny, {
    resource: literal('power'), domain: literal('rainbow'), amount: literal('any')
  }, { world: context, answers: { 'source:cost-pay-any': 1 } }), failure('judge-required'));
  assert.deepEqual(context.player('A').power, ['Fury', 'Mind']);
});

test('the authored Ancient Henge body reaches cost.pay-any through the default Chain', () => {
  const f = chainScene(world().player('A', { energy: 4 }).player('B').unit('source', { types: ['gear'], energy: 0, power: [] }), {
    answers: { 'ancient-henge.pay-any-energy/source%3Acost-pay-any': 3 }
  });
  const ability = ancientHenge.abilities[0];
  f.engine.execute({
    id: 'ancient-henge', controller: 'A', source: f.kernel.getObject('source'), kind: 'activated', speed: 'reaction', body: ability.body,
    cost: { id: 'cost:ancient-henge', cost: ability.cost }
  });
  assert.equal(f.kernel.player('A').energy, 4);
  f.engine.pass('A'); f.engine.pass('B');
  assert.equal(f.kernel.player('A').energy, 1);
  assert.equal(f.engine.items.length, 0);
});

test('an invalid arbitrary payment negates and does not execute its dependent body', () => {
  const f = chainScene(world().player('A', { energy: 2 }).player('B')
    .hand('source', { types: ['spell'], energy: 0, power: [] })
    .deck(['A:deck:1', 'A:deck:2'], { owner: 'A' }), {
    answers: { 'ancient-henge.pay-any-energy/source%3Acost-pay-any': 3 }
  });
  const body = [
    ancientHenge.abilities[0].body[0],
    { id: 'dependent-draw', op: 'effect.draw', args: { amount: literal(1) }, linkedTo: 'ancient-henge.pay-any-energy' }
  ];
  f.engine.execute({ id: 'pay-first', controller: 'A', source: f.kernel.getObject('source'), kind: 'spell', speed: 'normal', body, cost: { id: 'cost:pay-first', cost: { energy: literal(0) } } });
  f.engine.pass('A'); f.engine.pass('B');
  assert.equal(f.kernel.player('A').energy, 2);
  assert.equal(f.kernel.player('A').deckSize, 1, 'exactly one dependent draw would leave one deck card');
});

test('cost.pay-any rejects an impossible amount without publishing a zero receipt', () => {
  const context = withSource(world().player('A', { energy: 2 }).hand('source', { types: ['spell'], energy: 0, power: [] }));
  const result = runInstruction(costPayAny, {
    resource: literal('energy'), amount: literal('any'), linkKey: literal('spent')
  }, { world: context, answers: { 'source:cost-pay-any': 3 } });
  assert.deepEqual(result.result, { status: 'negated', reason: 'impossible', events: [] });
  assert.equal(context.linked('spent'), undefined);
  assert.equal(context.player('A').energy, 2);
});

test('cost.pay-any-power selects zero through all available named domains', () => {
  const context = withSource(world().player('A', { power: ['Fury', 'Mind'] }).hand('source', { types: ['spell'], energy: 0, power: [] }));
  const paid = runInstruction(costPayAnyPower, { linkKey: literal('paidPower') }, {
    world: context, answers: { 'source:cost-pay-any-power': 2 }
  });
  assert.equal(paid.result.status, 'executed');
  assert.equal(paid.linked.paidPower, 2);
  assert.deepEqual(paid.linked['paidPower.receipt'].total.power, [{ amount: 2, allowedDomains: ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] }]);
});

test('unsupported pseudo costs remain judge-required', () => {
  const context = withSource(world().player('A').hand('source', { types: ['spell'], energy: 0, power: [] }));
  for (const kind of ['equip', 'empower']) {
    assert.throws(() => buildCostPlan(context, { id: kind, cost: { payments: [{ kind }] } }), failure('judge-required'));
  }
  assert.throws(() => buildCostPlan(context, {
    id: 'universal', cost: { payments: [{ kind: 'power', universal: true }] }
  }), failure('judge-required'));
});

test('Finalize choice locks are serializable, stable, and reject a changed incarnation', () => {
  const context = withSource(world().player('A').unit('source', { types: ['spell'] }).unit('victim'));
  const choice = {
    id: 'locked-victim', options: ['victim'], filter: { zone: 'board', type: 'unit', controller: 'self' }, min: 1, max: 1
  };
  context.setPicks(choice.id, [context.ref('victim')]);
  const lock = finalizeCostChoiceLock(context, choice, 'play', 'kill');
  const locks = costChoiceLocks([lock]);
  const input = { id: 'play', cost: { payments: [{ kind: 'kill', choice }] }, costChoices: locks };
  assert.deepEqual(buildCostPlan(context, input).total.choices[0], lock.receipt);
  assert.deepEqual(buildCostPlan(context, input).total.choices[0], lock.receipt, 'a retry must return the same receipt');
  context.perform({ type: 'move-zone', object: lock.receipt.objects[0], to: 'hand' });
  assert.throws(() => buildCostPlan(context, input), failure('invalid-cost-plan'));
});

test('cost payment rejects a stale locked source before charging and preserves energy', () => {
  const f = chainScene(world().player('A', { energy: 5 }).player('B')
    .hand('source', { types: ['spell'], energy: 0, power: [] }).hand('victim', { types: ['spell'] }));
  const context = f.kernel.clone({ sourceSnapshot: f.kernel.getObject('source') });
  const plan = buildCostPlan(context, { id: 'cost:stale-source', cost: { energy: literal(1) } });
  const lockedSource = context.ref('source');
  context.perform({ type: 'move-zone', object: lockedSource, to: 'trash' });
  assert.notEqual(context.getObject('source').ref.zoneEntryId, lockedSource.zoneEntryId);
  const before = context.snapshot();
  assert.throws(() => payCostPlan(context, plan), error => error instanceof CostPlanError && error.reason === 'cannot-pay-cost' && /Finalize incarnation/.test(error.message));
  assert.deepEqual(context.snapshot(), before);
  assert.equal(context.player('A').energy, 5);
  assert.equal(context.getObject('victim').zone, 'hand');
});

test('cost payment rejects a stale locked object with exact diagnostics and no charge', () => {
  const f = chainScene(world().player('A', { energy: 5 }).player('B')
    .hand('source', { types: ['spell'], energy: 0, power: [] }).unit('victim', { types: ['unit'] }));
  f.answers.set('cost:stale-object:pick:pick', [f.kernel.ref('victim')]);
  const context = f.kernel.clone({ sourceSnapshot: f.kernel.getObject('source') });
  context.setAnswers({ 'cost:stale-object:pick:pick': [f.kernel.ref('victim')] });
  const plan = buildCostPlan(context, { id: 'cost:stale-object', cost: { energy: literal(1), payments: [{ kind: 'kill', choice: {
    id: 'pick', options: ['placeholder'], filter: { zone: 'board', type: 'unit', controller: 'self' }, min: 1, max: 1
  } }] } });
  const locked = plan.total.choices[0].objects[0];
  context.perform({ type: 'move-zone', object: locked, to: 'hand' });
  const before = context.snapshot();
  assert.throws(() => payCostPlan(context, plan), error => error instanceof CostPlanError && /Locked cost object/.test(error.message) && /Finalize incarnation/.test(error.message));
  assert.deepEqual(context.snapshot(), before);
  assert.equal(context.player('A').energy, 5);
});

test('default Chain rechecks each locked cost object immediately before its action', () => {
  const f = chainScene(world().player('A', { energy: 5 }).player('B')
    .unit('source', { types: ['unit'], energy: 0, power: [] }).unit('first', { types: ['unit'] }).unit('second', { types: ['unit'] }));
  const locked = [f.kernel.ref('first'), f.kernel.ref('second')];
  f.answers.set('cost:stale-object:pick:pick', locked);
  const before = f.kernel.snapshot();
  f.kernel.addReplacement((action, transaction) => {
    if (action.type === 'kill' && action.object.id === 'first') transaction.perform({ type: 'move-zone', object: locked[1], to: 'hand' });
    return null;
  });
  assert.throws(() => f.engine.execute({
    id: 'stale-object', controller: 'A', source: f.kernel.getObject('source'), kind: 'activated', speed: 'reaction', body: [],
    cost: { id: 'cost:stale-object', cost: { energy: literal(1), payments: [{ kind: 'kill', choice: {
      id: 'pick', options: ['placeholder'], filter: { zone: 'board', type: 'unit', controller: 'self' }, min: 2, max: 2
    } }] } }
  }), error => error instanceof CostPlanError && /Locked cost object second:1/.test(error.message) && /Finalize incarnation/.test(error.message));
  assert.deepEqual({ ...f.kernel.snapshot(), replacements: [] }, before);
  assert.equal(f.kernel.player('A').energy, 5);
  assert.equal(f.kernel.getObject('first').zone, 'board');
  assert.equal(f.kernel.getObject('second').zone, 'board');
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.length, 0);
});

test('banish checks the current controller while preserving owner differences', () => {
  const kernel = world().player('A').player('B')
    .unit('source', { types: ['unit'] })
    .unit('foreign-owned', { owner: 'B', controller: 'A' })
    .unit('foreign-controlled', { owner: 'A', controller: 'B' })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject('source') });
  const ownPlan = buildCostPlan(context, { id: 'own', cost: { payments: [{ kind: 'banish', object: kernel.ref('foreign-owned') }] } });
  payCostPlan(context, ownPlan);
  assert.equal(context.getObject('foreign-owned').zone, 'banishment');
  const foreignPlan = buildCostPlan(context, { id: 'foreign', cost: { payments: [{ kind: 'banish', object: kernel.ref('foreign-controlled') }] } });
  assert.throws(() => payCostPlan(context, foreignPlan), failure('cannot-pay-cost'));
  assert.equal(context.getObject('foreign-controlled').zone, 'board');
});

test('default Chain handles optional additional acceptance and decline', () => {
  for (const selected of [true, false]) {
    const f = chainScene(world().player('A', { energy: 4 }).player('B').unit('source', { types: ['unit'], energy: 0, power: [] }), {
      answers: { 'cost:optional-choice:optional:extra': selected }
    });
    f.engine.execute({
      id: 'optional-choice', controller: 'A', source: f.kernel.getObject('source'), kind: 'activated', speed: 'reaction', body: [],
      cost: { id: 'cost:optional-choice', cost: { energy: literal(1) }, optionalAdditional: [{ id: 'extra', kind: 'additional', cost: { energy: literal(2) } }] }
    });
    assert.equal(f.kernel.player('A').energy, selected ? 1 : 3);
    assert.deepEqual(f.engine.items[0].costPlan.selectedAdditional.map(cost => cost.id), selected ? ['extra'] : []);
    assert.deepEqual(f.engine.items[0].costPlan.declinedAdditional, selected ? [] : ['extra']);
  }
});

test('default Chain accepts or declines a Disempower additional cost without touching Buffs', () => {
  for (const selected of [true, false]) {
    const builder = world().player('A', { energy: 2 }).player('B')
      .unit('source', { types: ['unit'], energy: 0, power: [] });
    const f = chainScene(builder);
    f.kernel.addObject({ ...f.kernel.getObject('source'), ref: { id: 'target', zoneEntryId: 1 }, name: 'target', zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, buffs: 3 }, 'board');
    f.kernel.perform({ type: 'empower', object: f.kernel.ref('target'), amount: 2 });
    const draft = {
      id: 'disempower-extra', controller: 'A', source: f.kernel.getObject('source'), kind: 'activated', speed: 'reaction', body: [],
      cost: {
        id: 'cost:disempower-extra', cost: { energy: literal(1) },
        optionalAdditional: [{ id: 'disempower', kind: 'additional', cost: { payments: [{ kind: 'disempower', object: f.kernel.ref('target') }] } }]
      }
    };
    f.answers.set('cost:disempower-extra:optional:disempower', selected);
    f.engine.execute(draft);
    assert.equal(f.kernel.player('A').energy, 1);
    assert.equal(f.kernel.getObject('target').empowered, selected ? 1 : 2);
    assert.equal(f.kernel.getObject('target').buffs, 3);
  }
});

test('default Chain rejects zero or missing Empowered state before charging', () => {
  for (const stripEmpowered of [false, true]) {
    const f = chainScene(world().player('A', { energy: 2 }).player('B')
      .unit('source', { types: ['unit'], energy: 0, power: [] })
      .unit('target', { types: ['unit'] }), { stripEmpowered });
    const before = f.kernel.snapshot();
    assert.throws(() => f.engine.execute({
      id: 'disempower-zero', controller: 'A', source: f.kernel.getObject('source'), kind: 'activated', speed: 'reaction', body: [],
      cost: { id: 'cost:disempower-zero', cost: { energy: literal(1), payments: [{ kind: 'disempower', object: f.kernel.ref('target') }] } }
    }), error => error instanceof CostPlanError || error?.name === 'ChainContractBlockedError');
    assert.deepEqual(f.kernel.snapshot(), before);
    assert.equal(f.kernel.player('A').energy, 2);
  }
});

test('default Chain rolls back resources and earlier actions when Disempower loses its status', () => {
  const f = chainScene(world().player('A', { energy: 2 }).player('B')
    .hand('source', { types: ['spell'], energy: 0, power: [] })
    .unit('target', { types: ['unit'], buffs: 2 }));
  f.kernel.perform({ type: 'empower', object: f.kernel.ref('target'), amount: 1 });
  const target = f.kernel.ref('target');
  const before = f.kernel.snapshot();
  assert.throws(() => f.engine.execute({
    id: 'disempower-late-failure', controller: 'A', source: f.kernel.getObject('source'), kind: 'spell', speed: 'normal', body: [],
    cost: { id: 'cost:disempower-late-failure', cost: { energy: literal(1), payments: [
      { kind: 'disempower', object: target },
      { kind: 'disempower', object: target }
    ] } }
  }), error => error instanceof CostPlanError && error.reason === 'cannot-pay-cost');
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.kernel.player('A').energy, 2);
  assert.equal(f.kernel.getObject('target').empowered, 1);
  assert.equal(f.kernel.getObject('target').buffs, 2);
});

test('cost.pay-any does not ask when no Energy is available', () => {
  const context = withSource(world().player('A', { energy: 0 }).hand('source', { types: ['spell'], energy: 0, power: [] }));
  const paid = runInstruction(costPayAny, { resource: literal('energy'), amount: literal('any'), linkKey: literal('spent') }, { world: context });
  assert.equal(paid.asked, null);
  assert.equal(paid.result.status, 'executed');
  assert.equal(paid.linked.spent, 0);
  assert.equal(paid.linked['spent.receipt'], undefined);
});

test('default Chain rejects a duplicate Resolve after the item is removed', () => {
  const f = chainScene(world().player('A', { energy: 2 }).player('B').hand('source', { types: ['spell'], energy: 0, power: [] }));
  f.engine.execute({ id: 'one-shot', controller: 'A', source: f.kernel.getObject('source'), kind: 'spell', speed: 'normal', body: [], cost: { id: 'cost:one-shot', cost: { energy: literal(1) } } });
  f.engine.pass('A'); f.engine.pass('B'); f.engine.advance();
  assert.equal(f.kernel.player('A').energy, 1);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.priority, 'A');
  assert.throws(() => f.engine.pass('B'), /Player cannot pass now/);
  assert.equal(f.kernel.player('A').energy, 1);
});

test('default Chain rolls back resources and prior cost actions when a later payment fails', () => {
  const f = chainScene(world().player('A', { energy: 2 }).player('B')
    .hand('source', { types: ['spell'], energy: 0, power: [] })
    .hand('victim', { types: ['spell'] })
    .unit('second', { types: ['unit'] }));
  f.engine.pipeline.registerReplacement({
    id: 'prevent-late-exhaust',
    matches: action => action.type === 'exhaust' && action.object.id === 'second',
    apply: () => ({ status: 'prevent' })
  });
  const before = f.kernel.snapshot();
  assert.throws(() => f.engine.execute({
    id: 'late-failure', controller: 'A', source: f.kernel.getObject('source'), kind: 'spell', speed: 'normal', body: [],
    cost: { id: 'cost:late-failure', cost: { energy: literal(1), payments: [
      { kind: 'discard', object: f.kernel.ref('victim') },
      { kind: 'exhaust', object: f.kernel.ref('second') }
    ] } }
  }), error => error instanceof CostPlanError && error.reason === 'cannot-pay-cost');
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.kernel.player('A').energy, 2);
  assert.equal(f.kernel.getObject('victim').zone, 'hand');
  assert.equal(f.kernel.getObject('second').exhausted, false);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.length, 0);
});
