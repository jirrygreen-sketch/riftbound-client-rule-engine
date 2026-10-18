import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { runInstruction, world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { EventPipeline } from '../../dist/events/pipeline.js';

const typeProbeSource = `
import type {
  ContractGameAction,
  GameAction,
} from "../../src/effects/contract.js";
import {
  bindResolveContext,
  createActionPipelineHost,
  type ContractActionPipelineHost,
} from "../../src/events/action-adapter.js";
import type { ActionExecution, PipelineHost } from "../../src/events/pipeline-types.js";
import { world } from "../../src/effects/testing/index.js";

const kernel = world().unit("unit").build();
const host = createActionPipelineHost({
  checkpoint: () => kernel.snapshot(),
  restore: checkpoint => kernel.restore(checkpoint as ReturnType<typeof kernel.snapshot>),
  objects: () => kernel.objects,
  perform: action => kernel.perform(action),
  choose: request => {
    throw new Error(request.id);
  },
  context: (source, controller, timingPoint) => bindResolveContext(kernel, {
    source,
    controller,
    timingPoint,
  }),
});

const recall: ContractGameAction = {
  type: "recall",
  object: { id: "unit", zoneEntryId: 1 },
  player: "A",
};
const batch: ContractGameAction = {
  type: "batch",
  transactionId: "typed:static",
  actions: [{ type: "kill", object: { id: "unit", zoneEntryId: 1 } }],
};

const execution: ActionExecution = host.executeContract(recall);
const contractHost: ContractActionPipelineHost = host;
const legacyHost: PipelineHost = host;
const legacyMove: GameAction = {
  type: "move-location",
  object: { id: "unit", zoneEntryId: 1 },
  to: { type: "base", player: "A" },
};
const legacyExecution: ActionExecution = host.executeContract(legacyMove);

// @ts-expect-error Recall remains outside the legacy GameAction union.
const invalidLegacyRecall: GameAction = recall;
// @ts-expect-error The legacy execute seam remains closed to contract-only actions.
const invalidLegacyExecution = host.execute(recall);

void [execution, contractHost, legacyHost, batch, legacyExecution, invalidLegacyRecall, invalidLegacyExecution];
`;

test('the typed contract execution seam stays assignable without widening legacy actions', async () => {
  const { default: typescript } = await import('typescript');
  const options = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: typescript.ScriptTarget.ES2022,
    module: typescript.ModuleKind.NodeNext,
    moduleResolution: typescript.ModuleResolutionKind.NodeNext,
  };
  const virtualPath = fileURLToPath(new URL('./recall-batch-action-bridge.virtual-types.ts', import.meta.url));
  const compilerHost = typescript.createCompilerHost(options);
  const getSourceFile = compilerHost.getSourceFile.bind(compilerHost);
  compilerHost.fileExists = fileName => fileName === virtualPath || typescript.sys.fileExists(fileName);
  compilerHost.readFile = fileName => fileName === virtualPath ? typeProbeSource : typescript.sys.readFile(fileName);
  compilerHost.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === virtualPath
      ? typescript.createSourceFile(fileName, typeProbeSource, languageVersion, true)
      : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const compiled = typescript.createProgram(
    [virtualPath],
    options,
    compilerHost,
  );
  const diagnostics = typescript.getPreEmitDiagnostics(compiled);
  assert.deepEqual(
    diagnostics.map(diagnostic => typescript.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    [],
  );
});

const field = id => ({ type: 'battlefield', id });
const base = player => ({ type: 'base', player });
const one = field('battlefield-1');
const two = field('battlefield-2');

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
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
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

test('typed executeContract returns the real same-wave emissions without publishing or double-executing', () => {
  const f = fixture();
  const checkpoint = f.host.checkpoint();
  const action = {
    type: 'batch',
    transactionId: 'typed:kill-wave',
    actions: [
      { type: 'kill', object: f.kernel.ref('a') },
      { type: 'kill', object: f.kernel.ref('b') },
    ],
  };
  const execution = f.host.executeContract(action);
  assert.equal(execution.outcome.status, 'done');
  assert.equal(execution.outcome.receipt.status, 'committed');
  assert.equal(execution.emissions.filter(event => event.timingPoint === 'object-killed').length, 2);
  assert.ok(execution.emissions.every(event => event.simultaneousGroup === 'typed:kill-wave'));
  assert.equal(f.engine.pipeline.events.length, 0);
  assert.equal(f.kernel.history({ action: 'kill' }), 2);

  f.host.restore(checkpoint);
  assert.equal(f.kernel.getObject('a').zone, 'board');
  assert.equal(f.kernel.getObject('b').zone, 'board');
  assert.equal(f.kernel.history({ action: 'kill' }), 0);
  assert.equal(f.engine.pipeline.events.length, 0);
});

test('typed executeContract hands one atomic wave to EventPipeline for a single trigger scan', () => {
  const f = fixture();
  const observed = [];
  const pipeline = new EventPipeline(f.host, ['A', 'B'], 'A');
  pipeline.registerTrigger({
    id: 'typed-death-observer',
    source: f.kernel.getObject('a'),
    controller: 'A',
    spec: { at: 'object-killed', filter: { event: 'object-killed' }, once: 'per-batch' },
    body: [],
  });
  pipeline.onTrigger = snapshot => observed.push({
    snapshot,
    bothInTrash: f.kernel.getObject('a').zone === 'trash' && f.kernel.getObject('b').zone === 'trash',
  });
  const execution = f.host.executeContract({
    type: 'batch',
    transactionId: 'typed:scan-wave',
    actions: [
      { type: 'kill', object: f.kernel.ref('a') },
      { type: 'kill', object: f.kernel.ref('b') },
    ],
  });
  const published = pipeline.emitBatch(execution.emissions);
  assert.equal(published.length, execution.emissions.length);
  assert.ok(published.every(event => event.batchId === 'typed:scan-wave'));
  assert.equal(observed.length, 1);
  assert.equal(observed[0].bothInTrash, true);
  assert.equal(pipeline.events.filter(event => event.timingPoint === 'object-killed').length, 2);
});

test('typed executeContract rollback leaves no emissions and restores the host checkpoint', () => {
  const f = fixture();
  f.kernel.addReplacement(action => action.type === 'kill' && action.object.id === 'b' ? 'prevented' : null);
  const checkpoint = f.host.checkpoint();
  const execution = f.host.executeContract({
    type: 'batch',
    transactionId: 'typed:rollback',
    actions: [
      { type: 'kill', object: f.kernel.ref('a') },
      { type: 'kill', object: f.kernel.ref('b') },
    ],
  });
  assert.equal(execution.outcome.status, 'prevented');
  assert.equal(execution.outcome.receipt.status, 'rolled-back');
  assert.deepEqual(execution.emissions, []);
  assert.equal(f.kernel.getObject('a').zone, 'board');
  assert.equal(f.kernel.getObject('b').zone, 'board');
  assert.equal(f.kernel.history({ action: 'kill' }), 0);
  f.host.restore(checkpoint);
  assert.equal(f.kernel.getObject('a').zone, 'board');
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

test('Recall capability replay is deterministic across identical kernels', () => {
  const instruction = {
    op: 'test.contract-recall-replay',
    argsSchema: { parse: value => value },
    execute(ctx) {
      const outcome = ctx.contractActions.perform({
        type: 'recall',
        object: ctx.source.ref,
        player: ctx.source.controller,
      });
      return outcome.status === 'done'
        ? { status: 'executed', events: [...outcome.events], linkedValues: { receipt: outcome.receipt } }
        : { status: 'negated', reason: 'impossible', events: [...outcome.events] };
    },
  };
  const run = () => {
    const kernel = world().unit('subject', { damage: 2, exhausted: true, stunned: true, location: one }).build();
    return runInstruction(instruction, {}, {
      world: kernel.clone({ sourceSnapshot: kernel.getObject('subject') }),
    });
  };
  const first = run();
  const second = run();
  assert.deepEqual(first.result, second.result);
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(first.world.stateForTest(), second.world.stateForTest());
  assert.deepEqual(first.linked, second.linked);
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
    name: 'first-leg replace',
    hook: action => action.type === 'move-location' && action.object.id === 'a' ? 'replaced' : null,
    statuses: ['replaced', 'impossible'],
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

test('Batch Kill fails closed without a batch-aware leaf consumer', () => {
  const kernel = world().unit('a').unit('b').build();
  let checkpoints = 0;
  const host = createActionPipelineHost({
    checkpoint: () => { checkpoints += 1; return kernel.snapshot(); },
    restore: checkpoint => kernel.restore(checkpoint),
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error('unexpected choice'); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
  });
  const outcome = host.execute({
    type: 'batch',
    transactionId: 'kill:missing-consumer',
    actions: [
      { type: 'kill', object: kernel.ref('a') },
      { type: 'kill', object: kernel.ref('b') },
    ],
  }).outcome;
  assert.equal(outcome.status, 'impossible');
  assert.equal(outcome.receipt.status, 'rejected');
  assert.equal(checkpoints, 0);
  assert.equal(kernel.getObject('a').zone, 'board');
  assert.equal(kernel.getObject('b').zone, 'board');
});

test('an empty Batch is rejected before checkpoint or action submission', () => {
  const f = fixture();
  let checkpoints = 0;
  const host = createActionPipelineHost({
    checkpoint: () => { checkpoints += 1; return f.kernel.snapshot(); },
    restore: checkpoint => f.kernel.restore(checkpoint),
    objects: () => f.kernel.objects,
    perform: action => f.kernel.perform(action),
    choose: () => { throw new Error('unexpected choice'); },
    context: (source, controller, timingPoint) => bindResolveContext(f.kernel, { source, controller, timingPoint }),
  });
  const outcome = host.execute({ type: 'batch', actions: [] }).outcome;
  assert.equal(outcome.status, 'impossible');
  assert.equal(outcome.receipt.status, 'rejected');
  assert.equal(checkpoints, 0);
});

test('Batch Kill commits simultaneous deaths with one identity before trigger scanning', () => {
  const f = fixture();
  const a = f.kernel.getObject('a');
  const b = f.kernel.getObject('b');
  const action = {
    type: 'batch',
    transactionId: 'kill:simultaneous',
    actions: [
      { type: 'kill', object: a.ref },
      { type: 'kill', object: b.ref },
    ],
  };
  const observed = [];
  f.engine.pipeline.registerTrigger({
    id: 'death-observer',
    source: a,
    controller: 'A',
    spec: { at: 'object-killed', filter: { event: 'object-killed' }, once: 'per-batch' },
    body: [],
  });
  const previousOnTrigger = f.engine.pipeline.onTrigger;
  f.engine.pipeline.onTrigger = snapshot => {
    observed.push({ event: snapshot.event, bothInTrash: f.kernel.getObject('a').zone === 'trash' && f.kernel.getObject('b').zone === 'trash' });
    previousOnTrigger(snapshot);
  };
  const outcome = f.engine.commit(action);

  assert.equal(outcome.status, 'done');
  assert.equal(outcome.receipt.status, 'committed');
  assert.deepEqual(outcome.receipt.actions, [
    { type: 'kill', status: 'done' },
    { type: 'kill', status: 'done' },
  ]);
  assert.equal(f.kernel.getObject('a').zone, 'trash');
  assert.equal(f.kernel.getObject('b').zone, 'trash');
  const killed = f.engine.pipeline.events.filter(event => event.timingPoint === 'object-killed');
  assert.equal(killed.length, 2);
  assert.ok(killed.every(event => event.batchId === 'kill:simultaneous'));
  assert.ok(killed.every(event => event.simultaneousGroup === 'kill:simultaneous'));
  assert.equal(observed.length, 1);
  assert.equal(observed[0].bothInTrash, true);
  assert.equal(f.kernel.history({ action: 'kill', object: a.ref }), 1);
  assert.equal(f.kernel.history({ action: 'kill', object: b.ref }), 1);
});

test('Batch Kill applies a bound same-object rewrite exactly once and remains atomic', () => {
  const f = fixture();
  let applications = 0;
  f.kernel.addReplacement(action => {
    if (action.type !== 'kill' || action.object.id !== 'b') return null;
    applications += 1;
    return { status: 'rewrite', action: { ...action } };
  });
  const outcome = f.engine.commit({
    type: 'batch',
    transactionId: 'kill:rewrite-once',
    actions: [
      { type: 'kill', object: f.kernel.ref('a') },
      { type: 'kill', object: f.kernel.ref('b') },
    ],
  });
  assert.equal(outcome.status, 'done');
  assert.equal(applications, 1);
  assert.equal(f.kernel.getObject('a').zone, 'trash');
  assert.equal(f.kernel.getObject('b').zone, 'trash');
});

test('Batch Kill rejects a rewrite to another action before any death commits', () => {
  const f = fixture();
  const before = f.kernel.stateForTest();
  f.kernel.addReplacement(action => action.type === 'kill' && action.object.id === 'b'
    ? { status: 'rewrite', action: { type: 'gain-energy', player: 'A', amount: 1 } }
    : null);
  const outcome = f.engine.commit({
    type: 'batch',
    transactionId: 'kill:foreign-rewrite',
    actions: [
      { type: 'kill', object: f.kernel.ref('a') },
      { type: 'kill', object: f.kernel.ref('b') },
    ],
  });
  assert.equal(outcome.status, 'impossible');
  assert.equal(outcome.receipt.status, 'rolled-back');
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-killed'), false);
});

for (const [name, hook, expectedStatus] of [
  ['replacement', action => action.type === 'kill' && action.object.id === 'b' ? 'replaced' : null, 'replaced'],
  ['prevention', action => action.type === 'kill' && action.object.id === 'b' ? 'prevented' : null, 'prevented'],
  ['throw', action => { if (action.type === 'kill' && action.object.id === 'b') throw new Error('kill leaf failed'); return null; }, 'impossible'],
]) {
  test(`Batch Kill rolls back all deaths and events on ${name}`, () => {
    const f = fixture();
    const before = f.kernel.stateForTest();
    f.kernel.addReplacement(hook);
    const outcome = f.engine.commit({
      type: 'batch',
      transactionId: `kill:${name}`,
      actions: [
        { type: 'kill', object: f.kernel.ref('a') },
        { type: 'kill', object: f.kernel.ref('b') },
      ],
    });
    assert.equal(outcome.status, expectedStatus);
    assert.equal(outcome.receipt.status, 'rolled-back');
    assert.equal(outcome.receipt.actions[0].status, 'done');
    assert.notEqual(outcome.receipt.actions[1].status, 'done');
    assert.deepEqual(f.kernel.stateForTest(), before);
    assert.equal(f.kernel.getObject('a').zone, 'board');
    assert.equal(f.kernel.getObject('b').zone, 'board');
    assert.equal(f.kernel.history({ action: 'kill' }), 0);
    assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-killed'), false);
    assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-enters-trash'), false);
  });
}

test('the reference kernel disempowers exactly one status and treats zero as no transition', () => {
  const kernel = world().unit('subject').build();
  const ref = kernel.ref('subject');
  assert.equal(kernel.perform({ type: 'empower', object: ref, amount: 1, multiple: true, limit: 3 }).status, 'done');
  assert.equal(kernel.perform({ type: 'empower', object: ref, amount: 1, multiple: true, limit: 3 }).status, 'done');
  assert.equal(kernel.getObject('subject').empowered, 2);
  assert.equal(kernel.perform({ type: 'disempower', object: ref }).status, 'done');
  assert.equal(kernel.getObject('subject').empowered, 1);
  assert.equal(kernel.perform({ type: 'disempower', object: ref }).status, 'done');
  assert.equal(kernel.getObject('subject').empowered, 0);
  const before = kernel.getObject('subject');
  assert.equal(kernel.perform({ type: 'disempower', object: ref }).status, 'prevented');
  assert.deepEqual(kernel.getObject('subject'), before);
});
