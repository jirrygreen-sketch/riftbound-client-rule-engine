import assert from 'node:assert/strict';
import test from 'node:test';

import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { cardProgram, fixture, settle } from '../rules/keywords/support.mjs';

const field = id => ({ type: 'battlefield', id });
const base = player => ({ type: 'base', player });

function runtime({ choose = request => { throw new AwaitChoice(request); } } = {}) {
  const program = cardProgram('test:perf-event-copies', [{
    id: 'perf-event-copies.draw',
    op: 'effect.draw',
    args: { amount: { kind: 'constant', value: 1 } },
  }]);
  const kernel = world().player('A').player('B')
    .hand('spell', {
      cardId: program.canonicalCardId, types: ['spell'], energy: 0, power: null,
    })
    .unit('unit', {
      owner: 'A', controller: 'A', zone: 'board', location: base('A'),
    })
    .deck(['draw-a', 'draw-b'], { owner: 'A' })
    .deck(['draw-c', 'draw-d'], { owner: 'B' })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host,
    cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine);
  return { kernel, binding, engine };
}

test('published event history is a frozen stable view and appends in exact sequence', () => {
  const { kernel, engine } = runtime();
  const initial = engine.pipeline.events;
  assert.equal(Object.isFrozen(initial), true);
  assert.equal(engine.pipeline.events, initial, 'an unchanged history reuses its immutable array view');
  assert.throws(() => { initial.push({}); }, TypeError);

  const source = kernel.getObject('unit');
  engine.pipeline.emit({ timingPoint: 'main-start', object: source, player: 'A' });
  const afterFirst = engine.pipeline.events;
  assert.notEqual(afterFirst, initial, 'publication advances the cached view');
  assert.deepEqual(afterFirst.map(event => event.eventId), [1]);
  assert.equal(Object.isFrozen(afterFirst[0]), true);
  assert.deepEqual(afterFirst[0].object.ref, source.ref);
  assert.equal(Object.isFrozen(afterFirst[0].object), true);

  engine.pipeline.emitBatch([
    { timingPoint: 'combat-start', object: source, player: 'A', details: { battlefieldId: 'bf' } },
    { timingPoint: 'attack-declared', object: source, player: 'A' },
  ], undefined, 'batch:perf');
  const history = engine.pipeline.events;
  assert.deepEqual(history.map(event => event.timingPoint), [
    'main-start', 'combat-start', 'attack-declared',
  ]);
  assert.deepEqual(history.map(event => event.eventId), [1, 2, 3]);
  assert.deepEqual(history.map(event => event.batchId).slice(1), ['batch:perf', 'batch:perf']);
  assert.deepEqual(history.map(event => event.batchIndex).slice(1), [0, 1]);
  assert.equal(engine.pipeline.events, history, 'reads between mutations do not clone');
});

test('failed transaction restores event membership and the immutable view', () => {
  const { kernel, engine } = runtime();
  assert.equal(engine.pipeline.emit({ timingPoint: 'main-start', object: kernel.getObject('unit'), player: 'A' }).eventId, 1);
  const before = engine.pipeline.events;
  const expected = structuredClone(before);

  engine.pipeline.onTrigger = () => { throw new Error('event append rollback probe'); };
  engine.pipeline.registerTrigger({
    id: 'rollback-trigger',
    source: kernel.getObject('unit'),
    controller: 'A',
    spec: { at: 'combat-start', filter: {} },
    body: [],
  });
  const beforeCheckpoint = engine.pipeline.checkpoint();
  assert.throws(() => engine.pipeline.emit({ timingPoint: 'combat-start', object: kernel.getObject('unit'), player: 'A' }), /rollback probe/);
  engine.pipeline.restore(beforeCheckpoint);
  const restored = engine.pipeline.events;
  assert.notEqual(restored, before, 'restore never reuses a pre-restore mutable membership view');
  assert.deepEqual(restored, expected);
  assert.equal(Object.isFrozen(restored), true);
  assert.equal(engine.pipeline.events, restored, 'restored history is cached read-only');
  assert.equal(beforeCheckpoint.sequence, 1);
  assert.equal(beforeCheckpoint.log.length, 1);
});

test('payload snapshots stay isolated while event copies are avoided in the production binding path', () => {
  const { kernel, binding, engine } = runtime();
  const source = kernel.getObject('spell');
  const draft = binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);
  engine.execute(draft);
  engine.pass('A');
  engine.pass('B');
  settle(engine);

  const history = engine.pipeline.events;
  const drawn = history.filter(event => event.timingPoint === 'card-drawn');
  assert.equal(drawn.length, 1);
  const [event] = drawn;
  assert.equal(Object.isFrozen(history), true);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.details), true);
  assert.equal(Object.isFrozen(event.payload), true);
  assert.equal(event.details.before, event.before, 'payload fields share the one per-build snapshot');
  assert.notEqual(event.before, kernel.getObject(event.before.ref.id), 'event evidence is isolated from live authority');
  assert.equal(event.before.zone, 'deck');
  assert.equal(event.after.zone, 'hand');
  assert.notEqual(event.before, event.after);
  assert.deepEqual(history.map(candidate => candidate.eventId), history.map((_, index) => index + 1));
});

test('the real program binding preserves the pending retry event prefix and order', () => {
  const program = cardProgram('test:perf-event-order', [{
    id: 'perf-event-order.choose',
    op: 'effect.damage',
    args: {
      amount: { kind: 'constant', value: 1 },
      target: { kind: 'constant', value: 'perf-event-order:move-target' },
    },
    targets: [{
      id: 'perf-event-order:move-target',
      filter: { type: 'unit', zone: 'board', controller: 'opponent' },
      min: 1,
      max: 1,
      selection: 'one',
    }],
  }]);
  const f = fixture({
    programs: [program],
    setup(builder) {
      builder.hand('spell', {
        cardId: program.canonicalCardId, types: ['spell'], energy: 0, power: null,
      });
      builder.unit('unit', {
        owner: 'B', controller: 'B', zone: 'board', location: field('evidence-field'),
      });
      builder.unit('other', {
        owner: 'B', controller: 'B', zone: 'board', location: field('evidence-field'),
      });
    },
  });
  const source = f.get('spell');
  assert.throws(() => {
    f.engine.execute(f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source));
  }, error => error instanceof AwaitChoice &&
    error.request.id === 'target:perf-event-order:move-target');
  const afterPending = f.engine.pipeline.events;
  assert.equal(afterPending.length, 0, 'an unresolved Finalize publishes no partial event history');
  assert.deepEqual(f.asked.map(request => request.id), ['target:perf-event-order:move-target']);

  f.answers.set('target:perf-event-order:move-target', ['unit']);
  f.engine.execute(f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source));
  f.engine.pass('A');
  f.engine.pass('B');
  settle(f.engine);
  const final = f.engine.pipeline.events;
  assert.deepEqual(final.slice(0, afterPending.length), afterPending, 'retry retains the committed Pending event prefix');
  assert.deepEqual(final.map(event => event.eventId), final.map((_, index) => index + 1));
  assert.deepEqual(final.filter(event => event.timingPoint === 'chain-item-pending').length, 1);
  assert.deepEqual(f.asked.map(request => request.id), [
    'target:perf-event-order:move-target',
    'target:perf-event-order:move-target',
  ], 'the aborted and retried Finalize each issue the same request');
  assert.equal(f.get('spell').zone, 'trash');
  f.lifecycle.detach();
});
