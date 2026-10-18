import assert from 'node:assert/strict';
import test from 'node:test';

import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost, killBatch } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { ProgramBindingError } from '../../dist/programs/errors.js';

const constant = value => ({ kind: 'constant', value });
const card = (id, abilities) => ({ canonicalCardId: id, rulesetVersion: 'core-1.5', status: 'executable', sourceText: id, abilities });
const battlefield = { type: 'battlefield', id: 'battlefield-1' };

function runtime(cards, programs) {
  const builder = world().player('A', { energy: 20 }).player('B', { energy: 20 });
  for (const entry of cards) {
    const zone = entry.zone ?? 'board';
    const options = { cardId: entry.cardId, types: entry.types ?? ['unit'], might: entry.might ?? 2, ...(zone === 'board' ? { location: battlefield } : {}) };
    if (zone === 'board') builder.unit(entry.id, options);
    else if (zone === 'hand') builder.hand(entry.id, options);
    else throw new Error(`Unsupported test zone ${zone}`);
  }
  const kernel = builder.build();
  const choose = request => {
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  const binding = createProgramBinding({ cardPrograms: programs });
  return { kernel, engine, binding };
}

test('emitBatch installs one program registration before a real same-wave trigger scan', () => {
  const trigger = card('drake', [{ kind: 'triggered', trigger: { at: 'card-played', filter: { self: true } }, optional: false,
    body: [{ id: 'draw', op: 'effect.draw', args: { amount: constant(1) } }] }]);
  const f = runtime([{ id: 'drake', cardId: 'drake', zone: 'hand', types: ['unit'] }], [trigger]);
  const lifecycle = f.binding.attachLifecycle(f.engine);
  const object = f.kernel.getObject('drake');
  f.engine.commit({ type: 'move-zone', object: object.ref, to: 'chain' });
  const onChain = f.kernel.getObject('drake');
  const batch = [
    { timingPoint: 'object-enters-board', object: { ...onChain, zone: 'board', location: battlefield }, batchId: 'entry-wave' },
    { timingPoint: 'card-played', object: { ...onChain, zone: 'board', location: battlefield }, batchId: 'entry-wave' },
  ];
  const events = f.engine.pipeline.emitBatch(batch);
  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.batchId === 'entry-wave'));
  assert.equal(f.engine.items.length, 1, 'one trigger scan sees the newly installed program');
  assert.equal(f.engine.items[0].trigger.batchId, 'entry-wave');
  lifecycle.detach();
});

test('emit routes a single event through the same lifecycle boundary exactly once', () => {
  const trigger = card('single', [{ kind: 'triggered', trigger: { at: 'card-played', filter: { self: true } }, optional: false,
    body: [{ id: 'draw', op: 'effect.draw', args: { amount: constant(1) } }] }]);
  const f = runtime([{ id: 'single', cardId: 'single' }], [trigger]);
  const lifecycle = f.binding.attachLifecycle(f.engine);
  const object = f.kernel.getObject('single');
  f.engine.pipeline.emit({ timingPoint: 'object-enters-board', object });
  f.engine.pipeline.emit({ timingPoint: 'card-played', object });
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-enters-board').length, 1);
  lifecycle.detach();
});

test('a real atomic Kill batch runs one leave detach and leaves no stale program registration', () => {
  const f = runtime([
    { id: 'a', cardId: 'observer' },
    { id: 'b', cardId: 'observer' },
  ], [card('observer', [{ kind: 'triggered', trigger: { at: 'object-killed', filter: {} }, optional: false,
    body: [{ id: 'draw', op: 'effect.draw', args: { amount: constant(1) } }] }])]);
  const lifecycle = f.binding.attachLifecycle(f.engine);
  const outcome = f.engine.commit(killBatch([f.kernel.ref('a'), f.kernel.ref('b')], 'kill-wave'));
  assert.equal(outcome.status, 'done');
  const deaths = f.engine.pipeline.events.filter(event => event.timingPoint === 'object-killed');
  assert.equal(deaths.length, 2);
  assert.ok(deaths.every(event => event.batchId === 'kill-wave'));
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
  lifecycle.detach();
});

test('invalid static binding is reported and rolls back without retaining registrations or layers', () => {
  const errors = [];
  const f = runtime([{ id: 'bad', cardId: 'bad' }], [card('bad', [{ kind: 'static', effect: { kind: 'continuous.unsupported' } }])]);
  const lifecycle = f.binding.attachLifecycle(f.engine, error => errors.push(error));
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof ProgramBindingError);
  assert.equal(f.engine.layers.registry.list().length, 0);
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
  lifecycle.detach();
});

test('failed batch scanning restores callback registrations and a retry binds once', () => {
  let calls = 0;
  const program = card('callback', [{ kind: 'static', effect: { kind: 'continuous.might', layer: 'arithmetic', appliesTo: 'self', amount: constant(1) } }]);
  const f = runtime([{ id: 'callback', cardId: 'callback' }], [program]);
  const lifecycle = f.binding.attachLifecycle(f.engine);
  const before = f.engine.layers.registry.list().map(entry => entry.effect.id);
  const object = f.kernel.getObject('callback');
  const originalEmitBatch = f.engine.pipeline.emitBatch;
  f.engine.pipeline.emitBatch = function failingBatch(emissions, action, batchId) {
    originalEmitBatch.call(this, emissions, action, batchId);
    calls += 1;
    throw new Error('synthetic scanner failure after entry binding');
  };
  assert.throws(() => f.engine.pipeline.emitBatch([{ timingPoint: 'object-enters-board', object }], undefined, 'bad-batch'), /synthetic scanner failure/);
  f.engine.pipeline.emitBatch = originalEmitBatch;
  assert.deepEqual(f.engine.layers.registry.list().map(entry => entry.effect.id), before);
  f.engine.pipeline.emitBatch([{ timingPoint: 'object-enters-board', object }], undefined, 'good-batch');
  assert.equal(f.engine.layers.registry.list().length, 1);
  assert.equal(calls, 1);
  lifecycle.detach();
});
