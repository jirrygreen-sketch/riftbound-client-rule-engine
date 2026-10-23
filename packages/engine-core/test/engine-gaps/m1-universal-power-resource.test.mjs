import assert from 'node:assert/strict';
import test from 'node:test';

import { ChainEngine } from '../../dist/chain/engine.js';
import { describeAddActivation } from '../../dist/programs/add.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const constant = value => ({ kind: 'constant', value });

const addUniversal = {
  canonicalCardId: 'synthetic:RIFT-958:add-universal',
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'Add one Universal Power.',
  abilities: [{
    kind: 'play',
    cost: { kind: 'printed' },
    body: [{ id: 'add-universal', op: 'effect.resources', args: { power: constant(['universal']) } }],
  }],
};

const namedDemand = {
  canonicalCardId: 'synthetic:RIFT-958:named-demand',
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'Pay one Order Power.',
  abilities: [{
    kind: 'play',
    cost: { kind: 'printed', energy: constant(0), power: constant(['Order']) },
    body: [],
  }],
};

const universalDemand = {
  canonicalCardId: 'synthetic:RIFT-958:universal-demand',
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'Pay one [A] Power.',
  abilities: [{
    kind: 'play',
    cost: { kind: 'printed', energy: constant(0), power: constant(1) },
    body: [],
  }],
};

const twoUniversalDemand = {
  ...universalDemand,
  canonicalCardId: 'synthetic:RIFT-958:two-universal-demand',
  sourceText: 'Pay two [A] Power.',
  abilities: [{
    kind: 'play',
    cost: { kind: 'printed', energy: constant(0), power: constant(2) },
    body: [],
  }],
};

function runtime(builder, programs = [addUniversal, namedDemand, universalDemand, twoUniversalDemand]) {
  const kernel = builder.build();
  const choose = request => {
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
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error));
  return { kernel, binding, engine, errors };
}

function settle(engine) {
  for (let guard = 0; engine.items.length; guard++) {
    assert.ok(guard < 30, 'the production Chain must settle');
    engine.pass(engine.priority);
  }
}

function play(f, id, player = 'A') {
  const source = f.kernel.getObject(id);
  f.engine.execute(f.binding.describePlay({ type: 'play', player, object: source.ref }, source));
  settle(f.engine);
}

test('Universal Power added through a real card pays named and [A] demands exactly once', () => {
  const named = runtime(world()
    .player('A')
    .player('B')
    .hand('add-universal', { cardId: addUniversal.canonicalCardId, types: ['spell'], energy: 0, power: [] })
    .hand('named-demand', { cardId: namedDemand.canonicalCardId, types: ['spell'], energy: 0, power: [] }));
  play(named, 'add-universal');
  assert.deepEqual(named.kernel.player('A').power, ['universal']);
  play(named, 'named-demand');
  assert.deepEqual(named.kernel.player('A').power, [], 'Universal paid the named Order demand without becoming Order');

  const universal = runtime(world()
    .player('A')
    .player('B')
    .hand('add-universal', { cardId: addUniversal.canonicalCardId, types: ['spell'], energy: 0, power: [] })
    .hand('universal-demand', { cardId: universalDemand.canonicalCardId, types: ['spell'], energy: 0, power: [] }));
  play(universal, 'add-universal');
  play(universal, 'universal-demand');
  assert.deepEqual(universal.kernel.player('A').power, [], 'the [A] demand consumed the Universal source exactly once');
  assert.deepEqual(named.errors, [], 'the named-demand lifecycle reported no binding failures');
  assert.deepEqual(universal.errors, [], 'the [A]-demand lifecycle reported no binding failures');
});

test('insufficient Universal Power rejects the finalized play atomically', () => {
  const f = runtime(world()
    .player('A')
    .player('B')
    .hand('add-universal', { cardId: addUniversal.canonicalCardId, types: ['spell'], energy: 0, power: [] })
    .hand('two-universal-demand', { cardId: twoUniversalDemand.canonicalCardId, types: ['spell'], energy: 0, power: [] }));
  play(f, 'add-universal');
  const before = f.kernel.stateForTest();
  const source = f.kernel.getObject('two-universal-demand');
  assert.throws(
    () => f.engine.execute(f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source)),
    error => /cannot-pay-cost|insufficient/i.test(error.message),
  );
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.engine.items.length, 0);
});

test('a Reaction Add receipt preserves Universal Power while its parent consumes it', () => {
  const addProgram = {
    canonicalCardId: 'synthetic:RIFT-958:reaction-add',
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'Exhaust: Add one Universal Power.',
    abilities: [{
      kind: 'activated',
      timing: 'reaction',
      cost: { kind: 'activated', payments: [{ kind: 'exhaust', object: 'self' }] },
      body: [{ id: 'reaction-add', op: 'effect.resources', args: { power: constant(['universal']) } }],
    }],
  };
  const parentProgram = {
    canonicalCardId: 'synthetic:RIFT-958:reaction-parent',
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'Pay one [A] Power.',
    abilities: [{
      kind: 'activated',
      timing: 'action',
      cost: { kind: 'activated', power: constant(1) },
      body: [],
    }],
  };
  const kernel = world()
    .player('A')
    .player('B')
    .base('parent', { cardId: parentProgram.canonicalCardId, types: ['gear'], power: null })
    .base('reaction-source', { cardId: addProgram.canonicalCardId, types: ['gear'], power: null })
    .build();
  let notice;
  const choose = request => {
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: [addProgram, parentProgram] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
    paymentContinuation: { persist: value => { notice = value; return true; } },
  });
  binding.attachLifecycle(engine, error => { throw error; });

  assert.throws(
    () => engine.execute(binding.describeActivate(kernel.getObject('parent'), 'A', 0)),
    error => error.name === 'PaymentContinuationSuspendedError',
  );
  assert.ok(notice);
  const handle = engine.restorePaymentContinuationHandle(notice);
  const add = describeAddActivation(binding.registry, kernel.getObject('reaction-source'), 'A', 0).draft;
  const result = engine.resumePaymentContinuation(handle, { payer: 'A', source: notice.source, add });

  assert.deepEqual(result.add.resources, { energy: 0, power: ['universal'] });
  assert.deepEqual(result.add.receipt.value, { energy: 0, power: ['universal'] });
  assert.equal(result.payment.paid, true);
  assert.deepEqual(result.payment.power.power, [{ requirementIndex: 0, from: 'any', amount: 1 }]);
  assert.deepEqual(kernel.player('A').power, [], 'the parent consumed the exact Universal source the Add created');
  assert.equal(kernel.getObject('reaction-source').exhausted, true);
});

test('TurnFlow clears Universal Power at Main start and turn end through the real pay action', () => {
  const kernel = world()
    .player('A', { power: ['universal'] })
    .player('B', { power: ['any'] })
    .base('source', { might: 4, power: [] })
    .deck(['A:deck:1', 'A:deck:2'], { owner: 'A' })
    .deck(['B:deck:1', 'B:deck:2'], { owner: 'B' })
    .rune(['A:rune:1'], { owner: 'A' })
    .rune(['B:rune:1'], { owner: 'B' })
    .build();
  const choose = request => {
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects, perform: action => kernel.perform(action), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const flow = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
  });
  flow.start();
  assert.deepEqual(kernel.player('A').power, []);
  assert.deepEqual(kernel.player('B').power, []);

  flow.execute({
    id: 'add-again', controller: 'A', source: kernel.getObject('source'), kind: 'activated', speed: 'normal',
    body: [{ id: 'add-again.resources', op: 'effect.resources', args: { energy: constant(0), power: constant(['universal']) } }],
  });
  settle(flow.chain);
  assert.deepEqual(kernel.player('A').power, ['universal']);
  flow.endTurn('A');
  assert.deepEqual(kernel.player('A').power, []);
  assert.deepEqual(kernel.player('B').power, []);
});
