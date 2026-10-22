import assert from 'node:assert/strict';
import test from 'node:test';

import dangerZone from '../../../card-dsl/dist/cards/sfd/danger-zone.js';
import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { CostPlanError } from '../../dist/cost/plan-types.js';
import { buildCostPlan } from '../../dist/cost/cost-plan.js';
import { payCostPlan } from '../../dist/cost/payment.js';
import { DUEL_DOMAINS } from '../../dist/cost/resources.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const constant = value => ({ kind: 'constant', value });
const executable = program => ({ ...program, status: 'executable', judgeReason: undefined });
const cannotPay = error => error instanceof CostPlanError && error.reason === 'cannot-pay-cost';

function runtime(builder, programs) {
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === 'optional') return true;
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  return { kernel, binding, engine, requests };
}

function settle(engine) {
  for (let guard = 0; engine.items.length; guard++) {
    assert.ok(guard < 40, 'the production Chain must settle');
    engine.pass(engine.priority);
  }
}

function play(f, id, player = 'A') {
  const source = f.kernel.getObject(id);
  f.engine.execute(f.binding.describePlay({ type: 'play', player, object: source.ref }, source));
  settle(f.engine);
}

test('Danger Zone pays printed [A] Repeat from actual named Power and repeats once', () => {
  const f = runtime(world()
    .player('A', { energy: 3, power: ['Mind', 'Order'] }).player('B')
    .hand('danger-zone', {
      cardId: dangerZone.canonicalCardId, types: ['spell'], energy: 1, power: ['Fury', 'Mind'],
    })
    .unit('mech', { owner: 'A', controller: 'A', tags: ['Mech'], might: 2 }), [executable(dangerZone)]);

  play(f, 'danger-zone');
  assert.equal(f.kernel.player('A').energy, 1);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.getObject('danger-zone').zone, 'trash');
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref('mech')).might, 4,
    'the paid Repeat executes the original body one additional time');
});

test('Danger Zone rejects insufficient Power and a wrong available domain atomically', () => {
  for (const power of [[], ['Order']]) {
    const f = runtime(world()
      .player('A', { energy: 3, power }).player('B')
      .hand('danger-zone', {
        cardId: dangerZone.canonicalCardId, types: ['spell'], energy: 1, power: ['Fury', 'Mind'],
      })
      .unit('mech', { owner: 'A', controller: 'A', tags: ['Mech'], might: 2 }), [executable(dangerZone)]);
    const before = f.kernel.stateForTest();
    const trace = structuredClone(f.engine.trace);
    const source = f.kernel.getObject('danger-zone');
    const draft = f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);

    assert.throws(() => f.engine.execute(draft), error =>
      error instanceof Error && /insufficient matching Power|cannot-pay-cost/.test(error.message));
    assert.deepEqual(f.kernel.stateForTest(), before);
    assert.deepEqual(f.engine.trace, trace);
    f.engine.layers.setObjects(f.kernel.objects);
    assert.equal(f.engine.layers.evaluate(f.kernel.ref('mech')).might, 2);
  }
});

test('a multi-Domain base [C] is one any-of-Domains requirement through the real binder', () => {
  const program = {
    canonicalCardId: 'synthetic:RIFT-929:multi-domain-c', rulesetVersion: 'core-1.5', status: 'executable',
    sourceText: 'Synthetic multi-Domain base [C] witness.',
    abilities: [{ kind: 'play', cost: { kind: 'activated', power: { kind: 'constant', value: ['Fury', 'Mind'] } }, body: [] }],
  };
  const f = runtime(world().player('A', { energy: 0, power: ['Mind'] }).player('B')
    .hand('spell', { cardId: program.canonicalCardId, types: ['spell'], energy: 0, power: null }), [program]);
  const source = f.kernel.getObject('spell');
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);
  f.engine.execute(draft);

  assert.deepEqual(f.engine.items[0].costPlan.total.power, [{ amount: 1, allowedDomains: ['Fury', 'Mind'] }]);
  assert.deepEqual(f.kernel.player('A').power, []);
});

test('a Domainless [C] becomes [A] and consumes actual Power of any Domain', () => {
  const program = {
    canonicalCardId: 'synthetic:RIFT-929:domainless-c', rulesetVersion: 'core-1.5', status: 'executable',
    sourceText: 'Synthetic Domainless [C] witness.',
    abilities: [{ kind: 'play', cost: { power: constant(1) }, body: [] }],
  };
  const f = runtime(world().player('A', { energy: 0, power: ['Order'] }).player('B')
    .hand('spell', { cardId: program.canonicalCardId, types: ['spell'], energy: 0, power: [] }), [program]);
  const context = f.kernel.clone({
    sourceSnapshot: f.kernel.getObject('spell'), controller: 'A', timingPoint: 'chain-item-finalize',
  });
  const plan = buildCostPlan(context, { id: 'cost:domainless-c', cost: { power: constant(1) }, domains: [] });
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(context.player('A').power, []);
});

test('a domainless any Power source pays a named Order requirement without becoming Order', () => {
  const program = {
    canonicalCardId: 'synthetic:RIFT-929:universal-source', rulesetVersion: 'core-1.5', status: 'executable',
    sourceText: 'Synthetic Universal source witness.',
    abilities: [{ kind: 'play', cost: { power: constant(1) }, body: [] }],
  };
  const f = runtime(world().player('A', { energy: 0, power: ['any'] }).player('B')
    .hand('spell', { cardId: program.canonicalCardId, types: ['spell'], energy: 0, power: [] }), [program]);
  const context = f.kernel.clone({
    sourceSnapshot: f.kernel.getObject('spell'), controller: 'A', timingPoint: 'chain-item-finalize',
  });
  const plan = buildCostPlan(context, {
    id: 'cost:universal-source',
    cost: { payments: [{ kind: 'power', amount: constant(1), allowedDomains: ['Order'] }] },
  });
  const receipt = payCostPlan(context, plan);
  assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: 'any', amount: 1 }]);
  assert.equal(receipt.actions[0].status, 'done');
  assert.deepEqual(receipt.actions[0].action.plan, {
    finalized: true, energy: 0, power: [], universalPower: 1,
    powerSources: [{ source: 'any', amount: 1 }],
  });
  assert.deepEqual(context.player('A').power, []);
});

test('a host that ignores domainless Power fails closed and rolls back the complete resource transaction', () => {
  const kernel = world().player('A', { energy: 0, power: ['any'] }).player('B')
    .hand('spell', { types: ['spell'], energy: 0, power: ['Order'] }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject('spell'), controller: 'A', timingPoint: 'chain-item-finalize' });
  const plan = buildCostPlan(context, {
    id: 'cost:universal-details',
    cost: { payments: [{ kind: 'power', amount: constant(1), allowedDomains: ['Order'] }] },
  });
  const before = context.stateForTest();
  assert.throws(() => payCostPlan(context, plan, {
    transaction(run) {
      const saved = context.snapshot();
      try { return run(); } catch (error) { context.restore(saved); throw error; }
    },
  }), cannotPay);
  assert.deepEqual(context.stateForTest(), before);
});

test('Rumble recycle accepts another friendly Board unit and rejects enemy or non-controlled alternatives atomically', () => {
  const sourceProgram = executable(rumbleHotheaded);
  for (const [name, values, payable] of [
    ['friendly', { owner: 'A', controller: 'A' }, true],
    ['enemy', { owner: 'B', controller: 'B' }, false],
    ['foreign-controlled', { owner: 'B', controller: 'A' }, true],
  ]) {
    const kernel = world().player('A').player('B')
      .unit('rumble', { cardId: sourceProgram.canonicalCardId, owner: 'A', controller: 'A', tags: ['Mech'] })
      .unit(name, values).build();
    const context = kernel.clone({ sourceSnapshot: kernel.getObject('rumble'), controller: 'A', timingPoint: 'chain-item-finalize' });
    const plan = buildCostPlan(context, {
      id: `cost:recycle:${name}`,
      cost: { kind: 'explicit', payments: [{ kind: 'recycle', object: kernel.ref(name) }] },
    });
    const before = context.stateForTest();
    if (!payable) {
      assert.throws(() => payCostPlan(context, plan), cannotPay, name);
      assert.deepEqual(context.stateForTest(), before, name);
      continue;
    }
    const receipt = payCostPlan(context, plan);
    assert.equal(receipt.paid, true, name);
    assert.equal(context.getObject(name).zone, 'deck', name);
    const deckOwner = values.owner ?? 'A';
    assert.deepEqual(context.zone(deckOwner, 'deck').at(-1), context.ref(name), `${name} is placed at its owner's Main Deck bottom`);
  }
});

test('a late illegal recycle after a resource payment rolls back the complete Finalize transaction', () => {
  const kernel = world().player('A', { energy: 2 }).player('B')
    .unit('source', { types: ['gear'] })
    .unit('enemy', { owner: 'B', controller: 'B' })
    .hand('spell', { types: ['spell'], energy: 0, power: [] }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject('spell'), controller: 'A', timingPoint: 'chain-item-finalize' });
  const plan = buildCostPlan(context, {
    id: 'cost:atomic', cost: { energy: constant(2) },
    mandatoryAdditional: [{ id: 'recycle-enemy', cost: { payments: [{ kind: 'recycle', object: kernel.ref('enemy') }] } }],
  });
  const before = context.stateForTest();
  assert.throws(() => payCostPlan(context, plan, {
    transaction(run) {
      const saved = context.snapshot();
      try { return run(); } catch (error) { context.restore(saved); throw error; }
    },
  }), cannotPay);
  assert.deepEqual(context.stateForTest(), before);
});
