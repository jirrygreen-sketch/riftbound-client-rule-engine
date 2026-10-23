import assert from 'node:assert/strict';
import test from 'node:test';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { world } from '../../dist/effects/testing/index.js';

// RIFT-927: bound statics resolve their live source through the pipeline host,
// which is ChainEngine's layered view. A layered pass that re-entered that view
// re-set and re-evaluated the whole board at every nesting level, so passes grew
// exponentially with the number of bound statics (engine-core tests hung for
// tens of minutes). A nested read during an in-flight pass must reuse that
// pass's host input; the layered results themselves must not change.

const c = value => ({ kind: 'constant', value });

const conditionalMight = id => ({
  canonicalCardId: `synthetic:rift-927:${id}`,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'synthetic conditional static',
  abilities: [{
    kind: 'static',
    effect: { kind: 'continuous.might', layer: 'arithmetic', appliesTo: 'self', amount: c(3) },
    condition: {
      kind: 'compare',
      left: { kind: 'object-property', object: 'self', property: 'exhausted' },
      operator: 'eq',
      right: c(false),
    },
  }],
});

function setup(count) {
  const programs = Array.from({ length: count }, (_, index) => conditionalMight(`unit-${index}`));
  let builder = world().player('A').player('B');
  for (let index = 0; index < count; index++) {
    builder = builder.unit(`unit-${index}`, {
      cardId: programs[index].canonicalCardId, might: 2, exhausted: index === 0,
      location: { type: 'base', player: 'A' },
    });
  }
  const kernel = builder.build();
  const reads = { count: 0 };
  const choose = request => { throw new Error(`Unexpected choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => { reads.count++; return kernel.objects; },
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  binding.attachLifecycle(engine, error => { throw error; });
  for (let index = 0; index < count; index++) {
    engine.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject(`unit-${index}`), player: 'A' });
  }
  return { engine, kernel, reads };
}

test('RIFT-927: one layered pass reads the host once even when bound statics resolve live sources', () => {
  const { engine, reads } = setup(6);
  reads.count = 0;
  const objects = engine.pipeline.host.objects();
  assert.equal(reads.count, 1, 'nested live-source reads reuse the in-flight pass input');
  assert.equal(objects.length, 6);
});

test('RIFT-927: conditional statics still evaluate against the live source state', () => {
  const { engine } = setup(6);
  const might = new Map(engine.pipeline.host.objects().map(object => [object.ref.id, object.might]));
  // unit-0 is exhausted, so its "while I am ready" +3 does not apply.
  assert.equal(might.get('unit-0'), 2);
  for (let index = 1; index < 6; index++) assert.equal(might.get(`unit-${index}`), 5);
});

test('RIFT-927: a later pass sees host changes made after the previous pass', () => {
  const { engine, kernel } = setup(3);
  assert.equal(engine.pipeline.host.objects().find(object => object.ref.id === 'unit-1').might, 5);
  kernel.perform({ type: 'exhaust', object: kernel.ref('unit-1') });
  assert.equal(engine.pipeline.host.objects().find(object => object.ref.id === 'unit-1').might, 2);
});

// RIFT-927 review: a nested read must still see layered characteristics. The
// first static lifts the source from 2 to 5 Might; the second grants Showdown
// timing only to units with 5+ Might. Returning raw host objects to the nested
// read lost the Showdown grant; the in-flight layer engine keeps it.
test('RIFT-927: a nested read keeps layered Might for a mightGte timing filter', () => {
  const program = {
    canonicalCardId: 'synthetic:rift-927:timing-filter',
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'synthetic layered timing filter',
    abilities: [
      { kind: 'static', effect: { kind: 'continuous.might', layer: 'arithmetic', appliesTo: 'self', amount: c(3) } },
      { kind: 'static', effect: { kind: 'continuous.timing', layer: 'ability', filter: { type: 'unit', zone: 'board', mightGte: 5 }, timings: ['showdown'] } },
    ],
  };
  const kernel = world().player('A').player('B')
    .unit('subject', { cardId: program.canonicalCardId, might: 2, location: { type: 'base', player: 'A' } })
    .build();
  const choose = request => { throw new Error(`Unexpected choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  binding.attachLifecycle(engine, error => { throw error; });
  engine.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject('subject'), player: 'A' });
  const subject = engine.pipeline.host.objects().find(object => object.ref.id === 'subject');
  assert.equal(subject.might, 5);
  assert.deepEqual(subject.actionTimings, ['showdown']);
});

// RIFT-999: ChainEngine.withStableLayers reuses one layered view across a
// synchronous sweep. Every host write routed through the engine (ordinary
// execution, death-boundary Kill, batch Kill, rollback, and direct writes
// through a host-provided ResolveContext) must discard that view.
function stableWindowSetup() {
  const kernel = world().player('A').player('B')
    .unit('victim', { might: 2, location: { type: 'base', player: 'A' } })
    .unit('bystander', { might: 3, location: { type: 'base', player: 'A' } })
    .build();
  const choose = request => { throw new Error(`Unexpected choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    ...kernel.deathBoundaryPort(),
  });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  const read = id => engine.pipeline.host.objects().find(object => object.ref.id === id);
  return { kernel, engine, read };
}

test('RIFT-999: a stable layered view is discarded after an ordinary host write', () => {
  const { kernel, engine, read } = stableWindowSetup();
  engine.withStableLayers(() => {
    assert.equal(read('victim').exhausted, false);
    assert.equal(engine.commit({ type: 'exhaust', object: kernel.ref('victim') }).status, 'done');
    assert.equal(read('victim').exhausted, true);
  });
});

test('RIFT-999: a stable layered view is discarded after a death-boundary Kill', () => {
  const { kernel, engine, read } = stableWindowSetup();
  engine.withStableLayers(() => {
    assert.equal(read('victim').zone, 'board');
    assert.equal(engine.commit({ type: 'kill', object: kernel.ref('victim') }).status, 'done');
    assert.equal(kernel.getObject('victim').zone, 'trash');
    assert.equal(read('victim').zone, 'trash');
  });
});

test('RIFT-999: a stable layered view is discarded after a batch Kill', () => {
  const { kernel, engine, read } = stableWindowSetup();
  engine.withStableLayers(() => {
    assert.equal(read('victim').zone, 'board');
    const outcome = engine.commit({ type: 'batch', transactionId: 'rift-999-kills', actions: [{ type: 'kill', object: kernel.ref('victim') }] });
    assert.equal(outcome.status, 'done');
    assert.equal(kernel.getObject('victim').zone, 'trash');
    assert.equal(read('victim').zone, 'trash');
  });
});

test('RIFT-999: a stable layered view is discarded after an atomic rollback', () => {
  const { kernel, engine, read } = stableWindowSetup();
  engine.withStableLayers(() => {
    assert.equal(read('victim').exhausted, false);
    assert.throws(() => engine.atomic(() => {
      engine.commit({ type: 'exhaust', object: kernel.ref('victim') });
      assert.equal(read('victim').exhausted, true);
      throw new Error('rollback');
    }), /rollback/);
    assert.equal(kernel.getObject('victim').exhausted, false);
    assert.equal(read('victim').exhausted, false);
  });
});

test('RIFT-999: a stable layered view is discarded after a direct ResolveContext write', () => {
  const { kernel, engine, read } = stableWindowSetup();
  engine.withStableLayers(() => {
    assert.equal(read('bystander').exhausted, false);
    const context = engine.pipeline.host.context(read('bystander'), 'A', 'main');
    context.perform({ type: 'exhaust', object: kernel.ref('bystander') });
    assert.equal(kernel.getObject('bystander').exhausted, true);
    assert.equal(read('bystander').exhausted, true);
  });
});
