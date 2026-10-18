import assert from 'node:assert/strict';
import test from 'node:test';

import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { runInstruction, world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';

const field = id => ({ type: 'battlefield', id });
const base = player => ({ type: 'base', player });
const one = field('battlefield-1');
const two = field('battlefield-2');
const c = value => ({ kind: 'constant', value });

function fixture({ enemy = false } = {}) {
  const kernel = world()
    .unit('source', { might: 2, location: base('A') })
    .unit('a', { might: 4, damage: 2, exhausted: true, stunned: true, location: one })
    .unit('b', { owner: 'B', might: 3, damage: 1, exhausted: true, location: two })
    .build();
  const choose = request => {
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
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
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'],
    turnPlayer: 'A',
    phase: 'main',
    host,
    cleanup: () => false,
  });
  return { kernel, host, engine, subjectId: enemy ? 'b' : 'a' };
}

function recall(f, id = f.subjectId, player = f.kernel.getObject(id).controller) {
  return { type: 'recall', object: f.kernel.ref(id), player };
}

function swap(transactionId = 'swap:production') {
  return f => ({
    type: 'batch',
    transactionId,
    actions: [
      { type: 'move-location', object: f.kernel.ref('a'), to: two },
      { type: 'move-location', object: f.kernel.ref('b'), to: one },
    ],
  });
}

test('Recall consumes the default ChainEngine bridge without a Move event, Move history, or Move-only trigger', () => {
  const f = fixture();
  const before = f.kernel.getObject('a');
  let moveHits = 0;
  f.kernel.addReplacement(action => action.type === 'move-location' ? 'prevented' : null);
  f.engine.pipeline.registerTrigger({
    id: 'move-only-observer',
    source: before,
    controller: 'A',
    spec: { at: 'object-moved', filter: { event: 'object-moved' } },
    body: [],
  });
  const originalOnTrigger = f.engine.pipeline.onTrigger;
  f.engine.pipeline.onTrigger = snapshot => {
    moveHits += 1;
    originalOnTrigger(snapshot);
  };

  const outcome = f.engine.commit(recall(f));
  assert.equal(outcome.status, 'done');
  assert.equal(outcome.receipt.status, 'committed');
  assert.deepEqual(outcome.receipt.actions, [{ type: 'recall', status: 'done' }]);
  const after = f.kernel.getObject('a');
  assert.deepEqual(after.ref, before.ref);
  assert.deepEqual(after.location, base('A'));
  assert.equal(after.damage, before.damage);
  assert.equal(after.exhausted, before.exhausted);
  assert.equal(after.stunned, before.stunned);
  assert.equal(f.kernel.history({ action: 'move-location', object: before.ref }), 0);
  assert.equal(f.kernel.history({ action: 'recall', object: before.ref }), 1);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-moved').length, 0);
  assert.equal(moveHits, 0);
  assert.equal(f.engine.items.length, 0);
  const observation = outcome.events.find(event => event.action === 'recall');
  assert.ok(observation);
  assert.equal(observation.reason, 'recall');
  assert.deepEqual(observation.details.from, one);
  assert.deepEqual(observation.details.to, base('A'));
});

test('an ordinary Move still consumes and is stopped by the same Move-only rule', () => {
  const f = fixture();
  const before = f.kernel.getObject('a');
  f.kernel.addReplacement(action => action.type === 'move-location' ? 'prevented' : null);
  const outcome = f.engine.commit({ type: 'move-location', object: before.ref, to: two });
  assert.equal(outcome.status, 'prevented');
  assert.deepEqual(f.kernel.getObject('a').location, one);
  assert.equal(f.kernel.history({ action: 'move-location', object: before.ref }), 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-moved').length, 0);
});

test('Recall uses the recalled Permanent controller Base and rejects stale or foreign-controller actions atomically', () => {
  const enemy = fixture({ enemy: true });
  const bBefore = enemy.kernel.getObject('b');
  const recalled = enemy.engine.commit(recall(enemy, 'b', 'B'));
  assert.equal(recalled.status, 'done');
  assert.deepEqual(enemy.kernel.getObject('b').location, base('B'));
  assert.deepEqual(enemy.kernel.getObject('b').ref, bBefore.ref);

  for (const action of [
    { type: 'recall', object: { id: 'a', zoneEntryId: 999 }, player: 'A' },
    { type: 'recall', object: bBefore.ref, player: 'A' },
  ]) {
    const f = fixture();
    const state = f.kernel.stateForTest();
    const outcome = f.engine.commit(action);
    assert.equal(outcome.status, 'impossible');
    assert.equal(outcome.receipt.status, 'rolled-back');
    assert.deepEqual(outcome.receipt.actions, [{ type: 'recall', status: 'impossible' }]);
    assert.deepEqual(f.kernel.stateForTest(), state);
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-moved').length, 0);
  }
});

test('run-instruction context exposes the same contract capability and commits Recall through it', () => {
  const kernel = world()
    .unit('subject', { damage: 2, exhausted: true, location: one })
    .build();
  const instruction = {
    op: 'test.contract-recall',
    argsSchema: { parse: value => value },
    execute(ctx) {
      const outcome = ctx.contractActions.perform({
        type: 'recall',
        object: ctx.source.ref,
        player: ctx.source.controller,
      });
      return outcome.status === 'done'
        ? { status: 'executed', events: [...outcome.events], linkedValues: { receipt: outcome.receipt } }
        : { status: 'negated', reason: outcome.status === 'prevented' ? 'skipped' : 'impossible', events: [...outcome.events] };
    },
  };
  const source = kernel.clone({ sourceSnapshot: kernel.getObject('subject') });
  const result = runInstruction(instruction, {}, { world: source });
  assert.equal(result.result.status, 'executed');
  assert.equal(result.result.linkedValues.receipt.status, 'committed');
  assert.deepEqual(source.getObject('subject').location, base('A'));
  assert.equal(source.getObject('subject').damage, 2);
  assert.equal(source.getObject('subject').exhausted, true);
  assert.equal(source.history({ action: 'move-location' }), 0);
  assert.equal(source.history({ action: 'recall' }), 1);
});

test('a successful Batch commits both relocations, their histories, Move events, simultaneous identity, and one receipt', () => {
  const f = fixture();
  const a = f.kernel.getObject('a');
  const b = f.kernel.getObject('b');
  const action = swap()(f);
  const outcome = f.engine.commit(action);

  assert.equal(outcome.status, 'done');
  assert.equal(outcome.receipt.status, 'committed');
  assert.equal(outcome.receipt.transactionId, action.transactionId);
  assert.deepEqual(outcome.receipt.actions, [
    { type: 'move-location', status: 'done' },
    { type: 'move-location', status: 'done' },
  ]);
  const afterA = f.kernel.getObject('a');
  const afterB = f.kernel.getObject('b');
  assert.deepEqual(afterA.location, two);
  assert.deepEqual(afterB.location, one);
  assert.deepEqual(afterA.ref, a.ref);
  assert.deepEqual(afterB.ref, b.ref);
  assert.equal(afterA.damage, a.damage);
  assert.equal(afterA.exhausted, a.exhausted);
  assert.equal(afterA.stunned, a.stunned);
  assert.equal(f.kernel.history({ action: 'move-location', object: a.ref }), 1);
  assert.equal(f.kernel.history({ action: 'move-location', object: b.ref }), 1);
  const moved = f.engine.pipeline.events.filter(event => event.timingPoint === 'object-moved');
  assert.equal(moved.length, 2);
  assert.ok(moved.every(event => event.batchId === action.transactionId));
  assert.ok(moved.every(event => event.simultaneousGroup === action.transactionId));
  assert.ok(moved.every(event => event.details.cause === 'move'));
});

const rollbackCases = [
  {
    name: 'first-leg rewrite',
    hook: action => action.type === 'move-location' && action.object.id === 'a'
      ? { status: 'rewrite', action: { ...action, to: one } }
      : null,
    statuses: ['impossible', 'impossible'],
  },
  {
    name: 'first-leg prevent',
    hook: action => action.type === 'move-location' && action.object.id === 'a' ? 'prevented' : null,
    statuses: ['prevented', 'impossible'],
  },
  {
    name: 'second-leg rewrite',
    hook: action => action.type === 'move-location' && action.object.id === 'b'
      ? { status: 'rewrite', action: { ...action, to: two } }
      : null,
    statuses: ['done', 'impossible'],
  },
  {
    name: 'second-leg prevent',
    hook: action => action.type === 'move-location' && action.object.id === 'b' ? 'prevented' : null,
    statuses: ['done', 'prevented'],
  },
  {
    name: 'leaf throw',
    hook: action => {
      if (action.type === 'move-location' && action.object.id === 'b') throw new Error('batch leaf failed');
      return null;
    },
    statuses: ['done', 'impossible'],
  },
];

for (const { name, hook, statuses } of rollbackCases) {
  test(`Batch rolls back positions, history, events, and receipt on ${name}`, () => {
    const f = fixture();
    const before = f.kernel.stateForTest();
    f.kernel.addReplacement(hook);
    const outcome = f.engine.commit(swap(`swap:${name}`)(f));

    assert.notEqual(outcome.status, 'done');
    assert.equal(outcome.receipt.status, 'rolled-back');
    assert.deepEqual(outcome.receipt.actions.map(action => action.status), statuses);
    assert.deepEqual(f.kernel.stateForTest(), before);
    assert.deepEqual(f.kernel.getObject('a').location, one);
    assert.deepEqual(f.kernel.getObject('b').location, two);
    assert.equal(f.kernel.history({ action: 'move-location' }), 0);
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-moved').length, 0);
    assert.deepEqual(outcome.events, []);
  });
}

test('Batch rejects a stale second incarnation as impossible without committing the first leg', () => {
  const f = fixture();
  const before = f.kernel.stateForTest();
  const stale = { id: 'b', zoneEntryId: 999 };
  const outcome = f.engine.commit({
    type: 'batch',
    transactionId: 'swap:stale',
    actions: [
      { type: 'move-location', object: f.kernel.ref('a'), to: two },
      { type: 'move-location', object: stale, to: one },
    ],
  });
  assert.equal(outcome.status, 'impossible');
  assert.equal(outcome.receipt.status, 'rolled-back');
  assert.deepEqual(outcome.receipt.actions.map(action => action.status), ['done', 'impossible']);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.kernel.history({ action: 'move-location' }), 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-moved').length, 0);
});

test('unknown contract action types fail closed without changing state or history', () => {
  const f = fixture();
  const before = f.kernel.stateForTest();
  const outcome = f.engine.commit({ type: 'unknown-contract-action' });
  assert.equal(outcome.status, 'impossible');
  assert.equal(outcome.receipt.status, 'rejected');
  assert.deepEqual(outcome.receipt.actions, [{ type: 'unknown-contract-action', status: 'impossible' }]);
  assert.deepEqual(f.kernel.stateForTest(), before);
});
