import assert from 'node:assert/strict';
import test from 'node:test';

import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost, killBatch } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { PIPELINE_DEATH_BOUNDARY_VERSION } from '../../dist/events/pipeline-types.js';
import { EventPipeline } from '../../dist/events/pipeline.js';
import undercoverAgent from '../../../card-dsl/dist/cards/ogn/undercover-agent.js';

const constant = value => ({ kind: 'constant', value });
const body = [{ id: 'deathknell:draw', op: 'effect.draw', args: { amount: constant(1) } }];
const battlefield = { type: 'battlefield', id: 'battlefield-1' };

function admitted(program) { return { ...program, status: 'executable', judgeReason: undefined }; }

function runtime({ objects = ['victim'], typed = false } = {}) {
  let kernel = world().player('A').player('B').deck(['draw-1', 'draw-2'], { owner: 'A' });
  for (const id of objects) kernel = kernel.unit(id, { location: { type: 'battlefield', id: 'battlefield-1' } });
  kernel = kernel.build();
  const checkpoints = [];
  const choose = request => {
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'order') return [...request.options];
    if (request.type === 'optional') return true;
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
    ...kernel.deathBoundaryPort(),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const pipeline = new EventPipeline(host, ['A', 'B'], 'A');
  const observed = [];
  for (const id of objects) {
    pipeline.registerTrigger({
      id: `deathknell:${id}`,
      source: kernel.getObject(id),
      controller: 'A',
      spec: { at: 'object-killed', filter: { event: 'object-killed', object: { objectId: id } } },
      body,
    });
  }
  pipeline.onTrigger = snapshot => observed.push({
    id: snapshot.registration.id,
    eventId: snapshot.event.eventId,
    batchId: snapshot.event.batchId,
    object: snapshot.event.object.ref,
    liveZone: kernel.getObject(snapshot.event.object.ref.id)?.zone,
    liveRef: kernel.getObject(snapshot.event.object.ref.id)?.ref,
    pending: pipeline.events.some(event => event.timingPoint === 'chain-item-pending'),
  });
  const checkpoint = host.checkpoint();
  return { kernel, host, pipeline, observed, checkpoints, checkpoint, typed };
}

function productionRuntime() {
  const program = admitted(undercoverAgent);
  const kernel = world().player('A').player('B')
    .hand('agent', { cardId: program.canonicalCardId, types: ['unit'] })
    .hand('held-a').hand('held-b')
    .deck(['draw-a', 'draw-b', 'draw-c'], { owner: 'A' })
    .build();
  const choose = request => {
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'order') return [...request.options];
    if (request.type === 'optional') return true;
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
    ...kernel.deathBoundaryPort(),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const lifecycle = binding.attachLifecycle(engine);
  assert.equal(engine.commit({ type: 'move-zone', object: kernel.ref('agent'), to: 'chain' }).status, 'done');
  assert.equal(engine.commit({ type: 'move-zone', object: kernel.ref('agent'), to: 'battlefield', location: battlefield }).status, 'done');
  return { kernel, host, engine, lifecycle, checkpoint: host.checkpoint() };
}

test('EG-PIPELINE original Undercover Agent IR queues Pending before its Trash entry', () => {
  const f = productionRuntime();
  const oldRef = f.kernel.ref('agent');
  const beforeRefs = { left: f.kernel.ref('held-a'), right: f.kernel.ref('held-b') };
  let observed = null;
  let pendingDuringBoundary = false;
  const originalOnTrigger = f.engine.pipeline.onTrigger;
  f.engine.pipeline.onTrigger = snapshot => {
    observed = {
      live: f.kernel.getObject(snapshot.event.object.ref.id),
      itemIds: f.engine.items.map(item => item.id),
    };
    pendingDuringBoundary = f.engine.pipeline.events.some(event => event.timingPoint === 'chain-item-pending');
    originalOnTrigger(snapshot);
  };
  assert.equal(f.engine.commit({ type: 'kill', object: oldRef }).status, 'done');
  assert.equal(observed.live.zone, 'board');
  assert.deepEqual(observed.live.ref, oldRef);
  // RIFT-879 binds the printed body to the keyword boundary, so the death is
  // collected by exactly one trigger. Its Pending publication must still
  // precede the Trash entry (CR 808.1.d.2), with the pre-Trash snapshot.
  assert.deepEqual(observed.itemIds, [], 'the single Deathknell trigger is the first one collected');
  assert.equal(pendingDuringBoundary, false);
  const death = f.engine.pipeline.events.find(event => event.timingPoint === 'object-killed');
  const pendingEvent = f.engine.pipeline.events.find(event => event.timingPoint === 'chain-item-pending');
  const trash = f.engine.pipeline.events.find(event => event.timingPoint === 'object-enters-zone' && event.object.zone === 'trash');
  assert.ok(death.eventId < trash.eventId);
  assert.ok(pendingEvent && pendingEvent.eventId < trash.eventId, 'the Pending item is published before the Trash entry');
  assert.equal(f.engine.items.length, 1, 'one printed Deathknell sentence is one Pending item');
  const pending = f.engine.items.find(item => item.body?.[0]?.op === 'trigger.leave' &&
    item.body.some(instruction => instruction.op === 'effect.discard'));
  assert.ok(pending);
  assert.deepEqual(pending.trigger.source.ref, oldRef);
  assert.equal(pending.trigger.source.zone, 'board');
  assert.deepEqual(pending.trigger.event.object.ref, oldRef);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-killed'), true);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-enters-zone' && event.object.ref.id === 'held-a'), false);
  assert.deepEqual(f.kernel.ref('held-a'), beforeRefs.left);
  assert.deepEqual(f.kernel.ref('held-b'), beforeRefs.right);
  f.lifecycle.detach();
  f.host.restore(f.checkpoint);
});

test('EG-PIPELINE death boundary publishes the exact source before Trash', () => {
  const f = runtime();
  const oldRef = f.kernel.ref('victim');
  const outcome = f.pipeline.commit({ type: 'kill', object: oldRef });
  assert.equal(outcome.status, 'done');
  assert.equal(PIPELINE_DEATH_BOUNDARY_VERSION, 'riftbound.pipeline-death-boundary.v1');
  assert.equal(f.observed.length, 1);
  assert.equal(f.observed[0].object.id, 'victim');
  assert.equal(f.observed[0].object.zoneEntryId, oldRef.zoneEntryId);
  assert.equal(f.observed[0].liveZone, 'board', 'the source is still Board at collection');
  assert.deepEqual(f.observed[0].liveRef, oldRef);
  assert.equal(f.kernel.getObject('victim').zone, 'trash');
  assert.notDeepEqual(f.kernel.ref('victim'), oldRef);
  const eventOrder = f.pipeline.events.map(event => event.timingPoint);
  assert.ok(eventOrder.indexOf('object-killed') < eventOrder.indexOf('object-enters-zone'));
  f.host.restore(f.checkpoint);
});

test('EG-PIPELINE death boundary observes the live old incarnation while the source is still Board', () => {
  const f = runtime();
  const oldRef = f.kernel.ref('victim');
  let observedLive = null;
  f.pipeline.onTrigger = snapshot => {
    observedLive = f.kernel.getObject(snapshot.event.object.ref.id);
  };
  assert.equal(f.pipeline.commit({ type: 'kill', object: oldRef }).status, 'done');
  assert.equal(observedLive.zone, 'board');
  assert.deepEqual(observedLive.ref, oldRef);
  const death = f.pipeline.events.find(event => event.timingPoint === 'object-killed');
  const trash = f.pipeline.events.find(event => event.timingPoint === 'object-enters-zone' && event.object.zone === 'trash');
  assert.ok(death.eventId < trash.eventId);
  assert.equal(f.kernel.getObject('victim').zone, 'trash');
  f.host.restore(f.checkpoint);
});

test('EG-PIPELINE typed double Kill is one batch with one pre-Trash scan and independent identities', () => {
  const f = runtime({ objects: ['left', 'right'], typed: true });
  const refs = [f.kernel.ref('left'), f.kernel.ref('right')];
  const outcome = f.pipeline.commitContract(killBatch(refs, 'typed:double-death'));
  assert.equal(outcome.status, 'done');
  assert.equal(f.observed.length, 2);
  assert.deepEqual(f.observed.map(hit => hit.object), refs);
  assert.equal(new Set(f.observed.map(hit => hit.eventId)).size, 2);
  assert.ok(f.observed.every(hit => hit.batchId === 'typed:double-death'));
  assert.ok(f.observed.every(hit => hit.liveZone === 'board'));
  assert.ok(f.observed.every(hit => hit.liveRef.zoneEntryId === refs.find(ref => ref.id === hit.object.id).zoneEntryId));
  const deaths = f.pipeline.events.filter(event => event.timingPoint === 'object-killed');
  assert.deepEqual(deaths.map(event => event.object.ref), refs);
  assert.ok(deaths.every(event => event.batchId === 'typed:double-death'));
  assert.ok(f.pipeline.events.filter(event => event.timingPoint === 'object-enters-zone').every(event => event.batchId === 'typed:double-death'));
  f.host.restore(f.checkpoint);
});

test('EG-PIPELINE replaced and stale Kill actions never cross the death boundary', () => {
  const f = runtime();
  f.pipeline.registerReplacement({
    id: 'save-victim',
    matches: action => action.type === 'kill',
    apply: action => ({ status: 'replace', actions: [{ type: 'move-location', object: action.object, to: { type: 'base', player: 'A' } }] }),
  });
  assert.equal(f.pipeline.commit({ type: 'kill', object: f.kernel.ref('victim') }).status, 'replaced');
  assert.equal(f.observed.length, 0);
  assert.equal(f.kernel.getObject('victim').zone, 'board');
  assert.deepEqual(f.kernel.getObject('victim').location, { type: 'base', player: 'A' });
  assert.equal(f.pipeline.events.some(event => event.timingPoint === 'object-killed'), false);

  const stale = f.kernel.ref('victim');
  f.pipeline.unregisterReplacement('save-victim');
  f.kernel.perform({ type: 'move-zone', object: stale, to: 'hand' });
  assert.equal(f.pipeline.commit({ type: 'kill', object: stale }).status, 'impossible');
  assert.equal(f.observed.length, 0);
  assert.equal(f.pipeline.events.some(event => event.timingPoint === 'object-killed'), false);
  f.host.restore(f.checkpoint);
});

test('EG-PIPELINE late boundary failure rolls back state, events, frequency, and the pending chain', () => {
  const f = runtime();
  const before = { ref: f.kernel.ref('victim'), events: f.pipeline.events.length, deck: f.kernel.player('A').deckSize };
  const original = f.pipeline.onTrigger;
  f.pipeline.onTrigger = () => { throw new Error('late death boundary failure'); };
  assert.throws(() => f.pipeline.commit({ type: 'kill', object: before.ref }), /late death boundary failure/);
  assert.deepEqual(f.kernel.ref('victim'), before.ref);
  assert.equal(f.kernel.getObject('victim').zone, 'board');
  assert.equal(f.pipeline.events.length, before.events);
  assert.equal(f.kernel.player('A').deckSize, before.deck);
  f.pipeline.onTrigger = original;
  assert.equal(f.pipeline.commit({ type: 'kill', object: before.ref }).status, 'done');
  assert.equal(f.observed.length, 1, 'the retry consumes exactly one boundary scan');
  f.host.restore(f.checkpoint);
});

test('EG-PIPELINE unrelated events keep their ordinary event log and no death hook', () => {
  const f = runtime();
  const observed = [];
  f.pipeline.onTrigger = snapshot => observed.push(snapshot);
  assert.equal(f.pipeline.commit({ type: 'draw', player: 'A', amount: 1 }).status, 'done');
  assert.equal(observed.length, 0);
  assert.equal(f.pipeline.events.filter(event => event.timingPoint === 'card-drawn').length, 1);
  assert.equal(f.pipeline.events.some(event => event.timingPoint === 'object-killed'), false);
  f.host.restore(f.checkpoint);
});
