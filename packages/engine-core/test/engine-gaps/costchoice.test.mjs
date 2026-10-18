import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCostPlan } from '../../dist/cost/cost-plan.js';
import { payCostPlan } from '../../dist/cost/payment.js';
import { CostPlanError } from '../../dist/cost/plan-types.js';
import costPayAny from '../../dist/effects/instructions/cost.pay-any.js';
import costPayAnyPower from '../../dist/effects/instructions/cost.pay-any-power.js';
import { runInstruction, world } from '../../dist/effects/testing/index.js';
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

test('banish and disempower are real nonstandard cost actions', () => {
  const context = withSource(world().player('A').unit('source', { types: ['unit'] }), 'source');
  context.perform({ type: 'empower', object: context.ref('source') });
  const disempower = buildCostPlan(context, { id: 'disempower', cost: { payments: [{ kind: 'disempower', object: 'self' }] } });
  assert.equal(disempower.total.actions[0].action.type, 'disempower');
  const banish = buildCostPlan(context, { id: 'banish', cost: { payments: [{ kind: 'banish', object: 'self' }] } });
  assert.equal(banish.total.actions[0].action.type, 'banish');
  payCostPlan(context, disempower);
  assert.equal(context.object(context.ref('source')).empowered, 0);
  assert.throws(() => payCostPlan(context, disempower), failure('cannot-pay-cost'));
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

test('cost.pay-any rejects an impossible amount without publishing a zero receipt', () => {
  const context = withSource(world().player('A', { energy: 2 }).hand('source', { types: ['spell'], energy: 0, power: [] }));
  const result = runInstruction(costPayAny, {
    resource: literal('energy'), amount: literal('any'), linkKey: literal('spent')
  }, { world: context, answers: { 'source:cost-pay-any': 3 } });
  assert.deepEqual(result.result, { status: 'negated', reason: 'impossible', events: [] });
  assert.equal(result.linked?.spent, undefined);
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
