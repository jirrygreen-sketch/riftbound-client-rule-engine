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
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'order') return [request.options[0]];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
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
  assert.equal(f.engine.commit({ type: 'move-zone', object: f.kernel.ref('drake'), to: 'battlefield', location: battlefield }).status, 'done');
  const onBoard = f.kernel.getObject('drake');
  assert.deepEqual(onBoard.ref, { id: 'drake', zoneEntryId: 2 });
  const batch = [
    { timingPoint: 'card-played', object: onBoard, batchId: 'play-wave' },
    { timingPoint: 'card-played', object: onBoard, batchId: 'play-wave' },
  ];
  const events = f.engine.pipeline.emitBatch(batch);
  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.batchId === 'play-wave'));
  assert.equal(f.engine.items.length, 2, 'one batch scan preserves both same-wave instances');
  assert.ok(f.engine.items.every(item => item.trigger.batchId === 'play-wave'));
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

test('typed commitContract runs the same one-wave death triggers and LKI as commit', () => {
  const observer = card('observer', [{ kind: 'triggered', trigger: { at: 'object-killed', filter: {} }, optional: false,
    body: [{ id: 'draw', op: 'effect.draw', args: { amount: constant(1) } }] }]);
  const f = runtime([{ id: 'a', cardId: 'observer' }, { id: 'b', cardId: 'observer' }], [observer]);
  const lifecycle = f.binding.attachLifecycle(f.engine);
  const outcome = f.engine.pipeline.commitContract(killBatch([f.kernel.ref('a'), f.kernel.ref('b')], 'typed-kill-wave'));
  assert.equal(outcome.status, 'done');
  const deaths = f.engine.pipeline.events.filter(event => event.timingPoint === 'object-killed');
  assert.equal(deaths.length, 2);
  assert.ok(deaths.every(event => event.batchId === 'typed-kill-wave'));
  assert.deepEqual(deaths.map(event => event.object.ref.id).sort(), ['a', 'b']);
  assert.equal(f.engine.items.length, 2);
  assert.deepEqual(f.engine.items.map(item => item.trigger.source.ref.id).sort(), ['a', 'b']);
  assert.ok(f.engine.items.every(item => item.trigger.event.batchId === 'typed-kill-wave'));
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
  lifecycle.detach();
});

test('typed commitContract failure rolls back and retries the same incarnation without duplicate bindings', () => {
  const observer = card('observer', [{ kind: 'triggered', trigger: { at: 'object-killed', filter: {} }, optional: false,
    body: [{ id: 'draw', op: 'effect.draw', args: { amount: constant(1) } }] }]);
  const f = runtime([{ id: 'a', cardId: 'observer' }, { id: 'b', cardId: 'observer' }], [observer]);
  const lifecycle = f.binding.attachLifecycle(f.engine);
  const originalOnTrigger = f.engine.pipeline.onTrigger;
  f.engine.pipeline.onTrigger = () => { throw new Error('typed trigger failure'); };
  assert.throws(() => f.engine.pipeline.commitContract(killBatch([f.kernel.ref('a'), f.kernel.ref('b')], 'typed-fail')), /typed trigger failure/);
  assert.equal(f.kernel.getObject('a').zone, 'board');
  assert.equal(f.kernel.getObject('b').zone, 'board');
  assert.equal(f.engine.pipeline.events.length, 0);
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
  f.engine.pipeline.onTrigger = originalOnTrigger;
  const outcome = f.engine.pipeline.commitContract(killBatch([f.kernel.ref('a'), f.kernel.ref('b')], 'typed-retry'));
  assert.equal(outcome.status, 'done');
  assert.equal(f.engine.items.length, 2);
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
  lifecycle.detach();
});

test('deferTriggerScan retains a leaving source until the whole deferred wave is scanned', () => {
  const f = runtime([{ id: 'source', cardId: 'observer', zone: 'hand' }, { id: 'victim', cardId: 'plain' }], [
    card('observer', [{ kind: 'triggered', trigger: { at: 'object-killed', filter: { self: true } }, optional: false,
      body: [{ id: 'draw', op: 'effect.draw', args: { amount: constant(1) } }] }]),
    card('plain', []),
  ]);
  const lifecycle = f.binding.attachLifecycle(f.engine);
  assert.equal(f.engine.commit({ type: 'move-zone', object: f.kernel.ref('source'), to: 'battlefield', location: battlefield }).status, 'done');
  f.engine.pipeline.deferTriggerScan(() => {
    assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('source') }).status, 'done');
    assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('victim') }).status, 'done');
    assert.ok(f.engine.pipeline.checkpoint().triggers.has('program:source:2:0'), 'leave registration remains during the deferred transaction');
  });
  assert.equal(f.engine.items.length, 1, 'the leaving source still scans its own death');
  assert.equal(f.engine.items[0].trigger.event.object.ref.id, 'source');
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
  lifecycle.detach();
});

test('one batch installs every entrant and keeps death LKI for multiple sources before detach', () => {
  const observer = card('observer', [{ kind: 'triggered', trigger: { at: 'object-killed', filter: {} }, optional: false,
    body: [{ id: 'draw', op: 'effect.draw', args: { amount: constant(1) } }] }]);
  const f = runtime([
    { id: 'first', cardId: 'observer' },
    { id: 'second', cardId: 'observer' },
    { id: 'doomed-a', cardId: 'plain' },
    { id: 'doomed-b', cardId: 'plain' },
  ], [observer, card('plain', [])]);
  const lifecycle = f.binding.attachLifecycle(f.engine);
  const first = f.kernel.getObject('first');
  const second = f.kernel.getObject('second');
  const a = f.kernel.getObject('doomed-a');
  const b = f.kernel.getObject('doomed-b');
  const events = f.engine.pipeline.emitBatch([
    { timingPoint: 'object-enters-board', object: first, batchId: 'mixed-wave' },
    { timingPoint: 'object-enters-board', object: second, batchId: 'mixed-wave' },
    { timingPoint: 'object-killed', object: a, batchId: 'mixed-wave' },
    { timingPoint: 'object-killed', object: b, batchId: 'mixed-wave' },
  ]);
  assert.equal(events.length, 4);
  assert.equal(f.engine.pipeline.events.filter(event => event.batchId === 'mixed-wave').length, 4);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-killed').length, 2);
  assert.deepEqual(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-killed').map(event => event.object.ref.id).sort(), ['doomed-a', 'doomed-b']);
  assert.ok(f.engine.pipeline.checkpoint().triggers.has('program:first:1:0'));
  assert.ok(f.engine.pipeline.checkpoint().triggers.has('program:second:1:0'));
  lifecycle.detach();
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
});

test('invalid static binding is reported and rolls back without retaining registrations or layers', () => {
  const errors = [];
  const f = runtime([{ id: 'bad', cardId: 'bad', zone: 'hand' }], [card('bad', [{ kind: 'static', effect: { kind: 'continuous.unsupported' } }])]);
  const lifecycle = f.binding.attachLifecycle(f.engine, error => errors.push(error));
  assert.equal(f.engine.commit({ type: 'move-zone', object: f.kernel.ref('bad'), to: 'battlefield', location: battlefield }).status, 'done');
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof ProgramBindingError);
  assert.equal(f.engine.layers.registry.list().length, 0);
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
  lifecycle.detach();
});

test('a failed first installation restores callback state and the same incarnation retries once', () => {
  let calls = 0;
  let failureArmed = true;
  const program = card('callback', [{ kind: 'static', effect: { kind: 'continuous.might', layer: 'arithmetic', appliesTo: 'self', amount: constant(1) } }]);
  const f = runtime([{ id: 'callback', cardId: 'callback', zone: 'hand' }], [program]);
  const lifecycle = f.binding.attachLifecycle(f.engine, error => { calls += 1; if (failureArmed) throw error; });
  const failingOnEvent = f.engine.pipeline.onEvent;
  f.engine.pipeline.onEvent = event => {
    failingOnEvent(event);
    if (event.timingPoint === 'object-enters-board') throw new Error('synthetic trigger failure after first installation');
  };
  assert.throws(() => f.engine.commit({ type: 'move-zone', object: f.kernel.ref('callback'), to: 'battlefield', location: battlefield }), /synthetic trigger failure/);
  assert.equal(f.kernel.getObject('callback').zone, 'hand');
  assert.deepEqual(f.engine.layers.registry.list(), []);
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
  failureArmed = false;
  f.engine.pipeline.onEvent = failingOnEvent;
  assert.equal(f.engine.commit({ type: 'move-zone', object: f.kernel.ref('callback'), to: 'battlefield', location: battlefield }).status, 'done');
  assert.equal(f.kernel.getObject('callback').zone, 'board');
  const retriedEffects = f.engine.layers.registry.list().map(entry => entry.effect.id);
  assert.equal(retriedEffects.length, 1);
  assert.match(retriedEffects[0], /^program-static:callback:2:/);
  lifecycle.detach();
});
