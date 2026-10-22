import assert from 'node:assert/strict';
import test from 'node:test';

import frigidTouch from '../../../card-dsl/dist/cards/sfd/frigid-touch.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { paidRepeatInstanceIds } from '../../dist/effects/instructions/effect.repeat.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { CostPlanError } from '../../dist/cost/plan-types.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const constant = value => ({ kind: 'constant', value });
const executableView = program => ({ ...program, status: 'executable', judgeReason: undefined });

function scene(program, { paid = false, energy = 4, repeatedCosts = 1 } = {}) {
  const spell = executableView(program);
  const kernel = world()
    .player('A', { energy, power: ['Mind'] })
    .player('B')
    .hand('spell', {
      cardId: spell.canonicalCardId,
      types: ['spell'],
      energy: 2,
      power: ['Mind'],
    })
    .unit('victim', {
      cardId: 'fixture:unit',
      owner: 'B',
      controller: 'B',
      might: 8,
    })
    .build();
  const asked = [];
  let optionalAnswer = paid;
  let transactionGate = false;
  const choose = request => {
    asked.push(request);
    if (request.type === 'optional' && request.id.includes(':optional:')) return optionalAnswer;
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'select-objects' &&
        request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => {
      if (transactionGate && action.type === 'pay') return { status: 'prevented', events: [] };
      return kernel.perform(action);
    },
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose,
    }),
  });
  const binding = createProgramBinding({ cardPrograms: [spell] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'],
    turnPlayer: 'A',
    phase: 'main',
    host,
    cleanup: () => false,
    describePlay: binding.describePlay,
  });
  return {
    kernel,
    binding,
    engine,
    asked,
    repeatedCosts,
    answerRepeat(value) { optionalAnswer = value; },
    failNextPayment(value = true) { transactionGate = value; },
  };
}

function play(runtime) {
  const source = runtime.kernel.getObject('spell');
  runtime.engine.execute(runtime.binding.describePlay({
    type: 'play',
    player: 'A',
    object: source.ref,
  }, source));
}

function settle(runtime) {
  runtime.engine.pass('A');
  runtime.engine.pass('B');
}

function repeatEffects(runtime) {
  return runtime.engine.layers.registry.list().filter(entry =>
    entry.effect.effect.kind === 'continuous.might');
}

function resolveTrace(runtime) {
  return structuredClone({
    value: runtime.kernel.snapshot(),
    links: runtime.kernel.linkedSnapshot(),
    effects: runtime.engine.layers.registry.list().map(entry => entry.effect.id),
    trace: runtime.engine.trace.map(entry => ({ ...entry, item: entry.item?.replace(/:\d+$/, ':<instance>') })),
  });
}

test('original Frigid Touch IR binds its printed Repeat cost as an optional Finalize component', () => {
  const runtime = scene(frigidTouch, { paid: false, energy: 4 });
  const source = runtime.kernel.getObject('spell');
  const draft = runtime.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);

  // This engine test exercises the Repeat cost binding, not the card's shipped
  // status (the card task owns that); it only requires a real program state.
  assert.ok(['judge-required', 'executable'].includes(frigidTouch.status), `unexpected status ${frigidTouch.status}`);
  assert.equal(draft.cost.cost.kind, 'printed');
  assert.equal(draft.cost.optionalAdditional.length, 1);
  assert.equal(draft.cost.optionalAdditional[0].kind, 'repeat');
  assert.deepEqual(draft.cost.optionalAdditional[0].cost.payments, [
    { kind: 'energy', amount: constant(2) },
  ]);
  assert.equal(draft.cost.optionalAdditional[0].cost.payments[0].choice, undefined,
    'the optional component decision is not reinterpreted as an object/cost choice');
});

test('default Chain resolves original Frigid Touch once when Repeat is declined', () => {
  const runtime = scene(frigidTouch, { paid: false, energy: 4 });
  play(runtime);
  const [item] = runtime.engine.items;
  const repeatId = item.costPlan.selectedAdditional[0]?.id;
  assert.equal(repeatId, undefined);
  assert.equal(item.costPlan.declinedAdditional.length, 1);
  assert.equal(runtime.kernel.player('A').energy, 2);

  settle(runtime);
  assert.equal(runtime.engine.items.length, 0);
  assert.equal(runtime.kernel.getObject('spell').zone, 'trash');
  assert.equal(repeatEffects(runtime).length, 1);
  assert.equal(runtime.repeatedCosts, 1);
  assert.equal(runtime.engine.layers.evaluate(runtime.kernel.ref('victim')).might, 6);
  assert.equal(runtime.kernel.getObject('victim').buffs, 0,
    'the repeated source effect is continuous.might, never effect.buff');
  assert.equal(runtime.engine.pipeline.events.filter(event => event.timingPoint === 'card-played').length, 1,
    'CR 820.3.a: Repeat does not play the card again');
});

test('default Chain charges one paid Repeat once and re-executes the original effect exactly once', () => {
  const runtime = scene(frigidTouch, { paid: true, energy: 4 });
  play(runtime);
  const [item] = runtime.engine.items;
  const repeat = item.costPlan.selectedAdditional[0];
  assert.equal(repeat.kind, 'repeat');
  assert.deepEqual(item.payment.additional, [{ id: repeat.id, kind: 'repeat', paid: true }]);
  assert.equal(runtime.kernel.player('A').energy, 0);
  assert.equal(runtime.asked.filter(request => request.type === 'optional').length, 1);

  settle(runtime);
  assert.equal(repeatEffects(runtime).length, 2);
  assert.equal(new Set(repeatEffects(runtime).map(entry => entry.effect.id)).size, 2);
  assert.equal(runtime.engine.layers.evaluate(runtime.kernel.ref('victim')).might, 4);
  assert.equal(runtime.kernel.getObject('victim').buffs, 0);
  assert.equal(runtime.engine.trace.filter(entry => entry.step === 'resolved').length, 1);
  assert.equal(runtime.engine.pipeline.events.filter(event => event.timingPoint === 'card-played').length, 1);

  const effectIds = repeatEffects(runtime).map(entry => entry.effect.id);
  runtime.engine.advance();
  assert.deepEqual(repeatEffects(runtime).map(entry => entry.effect.id), effectIds,
    'a completed replay does not resettle the same receipt');
});

test('two separately paid Repeat instances each add exactly one execution', () => {
  const playAbility = frigidTouch.abilities.find(ability => ability.kind === 'play');
  assert.ok(playAbility);
  const program = executableView({
    ...frigidTouch,
    canonicalCardId: 'synthetic:frigid-touch-two-repeat-instances',
    abilities: [{
      ...playAbility,
      cost: {
        kind: 'additional-cost',
        keyword: 'repeat',
        costs: [
          { energy: constant(2) },
          { energy: constant(2) },
        ],
      },
    }],
  });
  const runtime = scene(program, { paid: true, energy: 6 });
  play(runtime);
  const [item] = runtime.engine.items;
  assert.equal(item.costPlan.selectedAdditional.length, 2);
  assert.equal(item.payment.additional.length, 2);
  assert.notEqual(item.costPlan.selectedAdditional[0].id, item.costPlan.selectedAdditional[1].id);
  assert.equal(runtime.kernel.player('A').energy, 0);

  settle(runtime);
  assert.equal(repeatEffects(runtime).length, 3, 'one original execution plus two paid instances');
  assert.equal(runtime.engine.layers.evaluate(runtime.kernel.ref('victim')).might, 2);
});

test('an unpayable Repeat is rejected atomically before the card leaves Hand', () => {
  const runtime = scene(frigidTouch, { paid: true, energy: 3 });
  assert.throws(() => play(runtime), error =>
    error instanceof CostPlanError && error.reason === 'cannot-pay-cost');
  assert.equal(runtime.kernel.player('A').energy, 3);
  assert.deepEqual(runtime.kernel.player('A').power, ['Mind']);
  assert.equal(runtime.kernel.getObject('spell').zone, 'hand');
  assert.equal(runtime.engine.items.length, 0);
  assert.equal(repeatEffects(runtime).length, 0);
  assert.equal(runtime.engine.pipeline.events.filter(event => event.timingPoint === 'card-played').length, 0);
});

test('a late payment failure rolls back the entire Finalize and a retry pays once', () => {
  const runtime = scene(frigidTouch, { paid: true, energy: 4 });
  runtime.failNextPayment();
  assert.throws(() => play(runtime), error =>
    error instanceof CostPlanError && error.reason === 'cannot-pay-cost');
  assert.equal(runtime.kernel.player('A').energy, 4);
  assert.deepEqual(runtime.kernel.player('A').power, ['Mind']);
  assert.equal(runtime.kernel.getObject('spell').zone, 'hand');
  assert.equal(runtime.engine.items.length, 0);
  assert.equal(repeatEffects(runtime).length, 0);

  runtime.failNextPayment(false);
  play(runtime);
  assert.equal(runtime.kernel.player('A').energy, 0);
  assert.equal(runtime.engine.items[0].payment.paid, true);
  settle(runtime);
  assert.equal(repeatEffects(runtime).length, 2);
  assert.equal(runtime.engine.layers.evaluate(runtime.kernel.ref('victim')).might, 4);
});

test('identical original-card commands replay to the same paid execution result', () => {
  const run = async () => {
    const runtime = scene(frigidTouch, { paid: true, energy: 4 });
    play(runtime);
    settle(runtime);
    return resolveTrace(runtime);
  };
  return Promise.all([run(), run()]).then(([left, right]) => {
    assert.deepEqual(left, right);
    assert.equal(left.effects.length, 2);
  });
});

test('paid Repeat ids require an exact frozen plan and receipt match', () => {
  const plan = {
    id: 'cost:frigid',
    selectedAdditional: [{ id: 'repeat-one', kind: 'repeat' }, { id: 'repeat-two', kind: 'repeat' }],
  };
  assert.deepEqual(paidRepeatInstanceIds({
    plan,
    receipt: {
      planId: 'cost:frigid',
      paid: true,
      additional: [
        { id: 'repeat-one', kind: 'repeat', paid: true },
        { id: 'repeat-two', kind: 'repeat', paid: true },
      ],
    },
  }), ['repeat-one', 'repeat-two']);
  assert.throws(() => paidRepeatInstanceIds({
    plan,
    receipt: {
      planId: 'cost:frigid',
      paid: true,
      additional: [{ id: 'repeat-one', kind: 'repeat', paid: true }],
    },
  }), /do not match/);
  assert.throws(() => paidRepeatInstanceIds({
    plan,
    receipt: {
      planId: 'cost:other',
      paid: true,
      additional: [
        { id: 'repeat-one', kind: 'repeat', paid: true },
        { id: 'repeat-two', kind: 'repeat', paid: true },
      ],
    },
  }), /not bound/);
});
