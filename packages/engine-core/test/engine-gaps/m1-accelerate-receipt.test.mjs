import assert from 'node:assert/strict';
import test from 'node:test';

import blazingScorcher from '../../../card-dsl/dist/cards/ogn/blazing-scorcher.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { evaluateAcceleratePayment } from '../../dist/effects/keywords/Accelerate.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const program = { ...blazingScorcher, status: 'executable', judgeReason: undefined };

class ReceiptChainEngine extends ChainEngine {
  resolve(item) {
    const source = item.source.ref;
    if (item.kind !== 'unit' || item.costPlan === undefined || item.payment === undefined) return super.resolve(item);
    const pipeline = this.pipeline;
    const originalCommit = pipeline.commit.bind(pipeline);
    pipeline.commit = action => {
      if (action.type !== 'move-zone' || (action.to !== 'base' && action.to !== 'battlefield')) {
        return originalCommit(action);
      }
      const evidence = {
        plan: structuredClone(item.costPlan),
        receipt: structuredClone(item.payment),
        source: structuredClone(source),
        action: structuredClone(action),
      };
      return pipeline.withPlayCostEvidence(evidence, () => originalCommit(action));
    };
    try { return super.resolve(item); }
    finally { pipeline.commit = originalCommit; }
  }
}

function scene({ energy = 6, power = ['Fury', 'Fury'], beforePerform } = {}) {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world()
    .player('A', { energy, power })
    .player('B')
    .hand('unit', {
      cardId: program.canonicalCardId,
      types: ['unit'],
      energy: 5,
      power: ['Fury'],
      might: 5,
      keywords: [{ id: 'Accelerate' }],
    })
    .build();
  const choose = request => {
    if (request.type === 'optional') return false;
    if (request.type === 'mode') throw new Error(`Unexpected mode choice ${request.id}`);
    throw new Error(`Unexpected choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => beforePerform?.(action, host) ?? kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const engine = new ReceiptChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host,
    cleanup: () => false,
    describePlay: (action, source) => binding.describePlay(action, source),
  });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error));
  return { kernel, binding, engine, errors };
}

function play(f) {
  const source = f.kernel.getObject('unit');
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);
  const optional = draft.cost.optionalAdditional?.find(cost => cost.kind === 'accelerate');
  assert.ok(optional, 'the production keyword expansion contributes Accelerate');
  f.engine.execute({
    ...draft,
    cost: {
      ...draft.cost,
      domains: ['Fury'],
      optionalAdditional: [{ ...optional, selected: true }],
    },
  });
  for (let count = 0; f.engine.items.length; count++) {
    assert.ok(count < 20, 'the production Chain must settle');
    f.engine.pass(f.engine.priority);
  }
}

function playDeclined(f) {
  const source = f.kernel.getObject('unit');
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);
  const optional = draft.cost.optionalAdditional?.find(cost => cost.kind === 'accelerate');
  assert.ok(optional);
  f.engine.execute({ ...draft, cost: { ...draft.cost, domains: ['Fury'], optionalAdditional: [{ ...optional, selected: false }] } });
  for (let count = 0; f.engine.items.length; count++) {
    assert.ok(count < 20, 'the production Chain must settle');
    f.engine.pass(f.engine.priority);
  }
}

function playDefaultChainDeclined(f) {
  const source = f.kernel.getObject('unit');
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);
  const optional = draft.cost.optionalAdditional?.find(cost => cost.kind === 'accelerate');
  assert.ok(optional);
  f.engine.execute({ ...draft, cost: { ...draft.cost, domains: ['Fury'], optionalAdditional: [{ ...optional, selected: false }] } });
  for (let count = 0; f.engine.items.length; count++) {
    assert.ok(count < 20, 'the production Chain must settle');
    f.engine.pass(f.engine.priority);
  }
}

function defaultScene() {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world().player('A', { energy: 6, power: ['Fury', 'Fury'] }).player('B')
    .hand('unit', { cardId: program.canonicalCardId, types: ['unit'], energy: 5, power: ['Fury'], might: 5, keywords: [{ id: 'Accelerate' }] })
    .build();
  const choose = request => request.type === 'optional' ? false : (() => { throw new Error(`Unexpected choice ${request.id}`); })();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: (action, source) => binding.describePlay(action, source) });
  binding.attachLifecycle(engine);
  return { kernel, binding, engine };
}

function defaultPaidScene() {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world().player('A', { energy: 6, power: ['Fury', 'Fury'] }).player('B')
    .hand('unit', { cardId: program.canonicalCardId, types: ['unit'], energy: 5, power: ['Fury'], might: 5, keywords: [{ id: 'Accelerate' }] })
    .build();
  const choose = request => request.type === 'optional' ? true : (() => { throw new Error(`Unexpected choice ${request.id}`); })();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: (action, source) => binding.describePlay(action, source) });
  binding.attachLifecycle(engine);
  return { kernel, binding, engine };
}

function playDefaultChainPaid(f) {
  const source = f.kernel.getObject('unit');
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);
  const optional = draft.cost.optionalAdditional?.find(cost => cost.kind === 'accelerate');
  assert.ok(optional);
  f.engine.execute({ ...draft, cost: { ...draft.cost, domains: ['Fury'], optionalAdditional: [{ ...optional, selected: true }] } });
  for (let count = 0; f.engine.items.length; count++) {
    assert.ok(count < 20, 'the production Chain must settle');
    f.engine.pass(f.engine.priority);
  }
}

test('RIFT-947 paid Accelerate enters ready through the real program lifecycle without object-readied', () => {
  const f = scene();
  play(f);
  assert.equal(f.kernel.getObject('unit').exhausted, false);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-readied'), false);
  assert.deepEqual(f.errors, []);
});

test('RIFT-947 failed Accelerate payment rolls back the whole play and leaves no ready evidence', () => {
  const f = scene({ power: ['Calm'] });
  const before = f.kernel.snapshot();
  assert.throws(() => play(f), /insufficient matching Power/);
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.kernel.getObject('unit').zone, 'hand');
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-enters-board'), false);
});

test('RIFT-947 declining Accelerate enters exhausted and emits no object-readied', () => {
  const f = scene();
  playDeclined(f);
  assert.equal(f.kernel.getObject('unit').zone, 'board');
  assert.equal(f.kernel.getObject('unit').exhausted, true);
  assert.equal(f.kernel.player('A').energy, 1);
  assert.deepEqual(f.kernel.player('A').power, ['Fury']);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-readied'), false);
  assert.deepEqual(f.errors, []);
});

test('RIFT-947 a non-Accelerate replacement keeps its unconditional match', () => {
  const f = scene();
  const source = f.kernel.getObject('unit');
  f.engine.pipeline.registerReplacement({
    id: 'test:other-entry-replacement',
    source: { ...source, keywords: [] },
    matches: (action, original) => action.type === 'move-zone' && original.type === 'move-zone',
    apply: () => ({ status: 'rewrite', action: { type: 'move-zone', object: source.ref, to: 'base', location: { type: 'base', player: 'A' } } }),
  });
  const move = { type: 'move-zone', object: source.ref, to: 'base', location: { type: 'base', player: 'A' } };
  const acceleratedSource = { ...source, keywords: [{ id: 'Accelerate' }] };
  const plan = { finalized: true, id: 'cost:other', player: 'A', source: acceleratedSource.ref, selectedAdditional: [], declinedAdditional: ['accelerate'], components: [], total: { energy: 5, power: [], xp: 0, actions: [] } };
  const receipt = { planId: 'cost:other', player: 'A', paid: true, total: { energy: 5, power: [], xp: 0, actions: [] }, additional: [], actions: [] };
  f.engine.pipeline.withPlayCostEvidence({ plan, receipt, source: acceleratedSource.ref, action: move }, () => {
    const registration = f.engine.pipeline.checkpoint().replacements.get('test:other-entry-replacement');
    assert.ok(registration);
    assert.equal(registration.matches(move, move, { cost: { plan, receipt, source: acceleratedSource.ref, action: move }, source: acceleratedSource.ref }), true);
  });
});

test('RIFT-947 the plain production Chain still removes the unpaid ready rewrite', () => {
  const f = defaultScene();
  playDefaultChainDeclined(f);
  assert.equal(f.kernel.getObject('unit').exhausted, true);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-readied'), false);
});

test('RIFT-947 the plain production Chain keeps a paid Accelerate unit ready', () => {
  const f = defaultPaidScene();
  playDefaultChainPaid(f);
  assert.equal(f.kernel.getObject('unit').exhausted, false);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-readied'), false);
});

test('RIFT-947 Accelerate evidence rejects declined, mismatched, and incomplete receipts', () => {
  const f = scene();
  const source = f.kernel.getObject('unit');
  const cost = {
    finalized: true, id: 'cost:other', player: 'A', source: source.ref, selectedAdditional: [],
    declinedAdditional: ['accelerate'], components: [], total: { energy: 5, power: [], xp: 0, actions: [] },
  };
  const partialReceipt = {
    planId: 'cost:other', player: 'A', paid: true,
    total: { energy: 5, power: [], xp: 0, actions: [] }, additional: [],
  };
  const selectedPlan = {
    ...cost, selectedAdditional: [{ id: 'accelerate', kind: 'accelerate' }], total: { ...cost.total, energy: 6 },
  };
  assert.equal(evaluateAcceleratePayment({ plan: cost, receipt: partialReceipt, source: source.ref, action: { type: 'move-zone', object: source.ref, to: 'base' } }), false);
  assert.equal(evaluateAcceleratePayment({ plan: selectedPlan, receipt: partialReceipt, source: source.ref, action: { type: 'move-zone', object: source.ref, to: 'base' } }), false);
  const paidReceipt = {
    ...partialReceipt, total: { ...partialReceipt.total, energy: 6 },
    additional: [{ id: 'accelerate', kind: 'accelerate', paid: true }],
    actions: [{ id: 'cost:other:resources', action: { type: 'pay', player: 'A', plan: {} }, status: 'done' }],
  };
  assert.equal(evaluateAcceleratePayment({ plan: selectedPlan, receipt: paidReceipt, source: source.ref, action: { type: 'move-zone', object: source.ref, to: 'base' } }), true);
  assert.equal(evaluateAcceleratePayment({ plan: selectedPlan, receipt: {
    ...partialReceipt, planId: 'cost:mismatch', total: { ...partialReceipt.total, energy: 6 },
    additional: [{ id: 'accelerate', kind: 'accelerate', paid: true }],
    actions: [{ id: 'cost:mismatch:resources', action: { type: 'pay', player: 'A', plan: {} }, status: 'done' }],
  }, source: source.ref, action: { type: 'move-zone', object: source.ref, to: 'base' } }), false);
});
