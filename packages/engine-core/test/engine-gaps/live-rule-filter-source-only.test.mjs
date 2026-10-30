import assert from 'node:assert/strict';
import test from 'node:test';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { world } from '../../dist/effects/testing/index.js';

// RIFT-1156: a static rule whose filter is anchored only to its own source
// (Quick-Draw's source-scoped Reaction timing) resolved its live target by
// scanning the pipeline host. Inside a layer evaluation that scan started a
// complete layered pass for every layer read, so every board object appeared
// to depend on every other one: each restart added one object to a single
// dependency group, and a late-game Ending Step took 20+ seconds. The filter
// can match nothing but the bound incarnation, so it must not read the board.

const c = value => ({ kind: 'constant', value });

const sourceTiming = {
  canonicalCardId: 'synthetic:rift-1156:source-timing',
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'synthetic source-scoped timing',
  abilities: [{
    kind: 'static',
    effect: { kind: 'continuous.timing', value: c('reaction'), scope: 'source', permissions: ['play'] },
  }],
};

function setup(count) {
  let builder = world().player('A').player('B')
    .unit('source', { cardId: sourceTiming.canonicalCardId, might: 2, location: { type: 'base', player: 'A' } });
  for (let index = 0; index < count; index++) {
    const player = index % 2 === 0 ? 'A' : 'B';
    builder = builder.unit(`unit-${index}`, {
      might: 1 + index, controller: player, owner: player, location: { type: 'base', player },
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
  const binding = createProgramBinding({ cardPrograms: [sourceTiming] });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  binding.attachLifecycle(engine, error => { throw error; });
  engine.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject('source'), player: 'A' });
  return { engine, kernel, reads };
}

test('RIFT-1156: a source-only rule filter adds no board-wide dependency group', () => {
  const { engine, kernel, reads } = setup(12);
  engine.layers.resetDiagnostics();
  reads.count = 0;
  // Turn and Combat cleanup install raw host objects and evaluate the layer
  // engine directly, outside a ChainEngine layered pass.
  engine.layers.setObjects(kernel.objects);
  const view = engine.layers.evaluateAll();
  const diagnostics = engine.layers.diagnostics;
  assert.equal(diagnostics.dependencyRestarts, 0);
  assert.equal(diagnostics.multiObjectGroups, 0);
  assert.equal(reads.count, 0, 'the filter does not re-read the host during the evaluation');
  assert.equal(view.length, 13);
});

test('RIFT-1156: the source-only timing still applies to the source and nothing else', () => {
  const { engine, kernel } = setup(6);
  engine.layers.setObjects(kernel.objects);
  const timings = new Map(engine.layers.evaluateAll().map(object => [object.ref.id, object.actionTimings]));
  assert.deepEqual(timings.get('source'), ['reaction']);
  for (let index = 0; index < 6; index++) assert.deepEqual(timings.get(`unit-${index}`), []);
  const layered = new Map(engine.pipeline.host.objects().map(object => [object.ref.id, object.actionTimings]));
  assert.deepEqual(layered, timings);
});

test('RIFT-1156: the source-only filter follows the live incarnation', () => {
  const { engine, kernel } = setup(2);
  const entry = engine.layers.registry.list().find(item => item.effect.id.startsWith('program-static:source:'));
  assert.ok(entry, 'the static timing rule is registered');
  assert.equal(entry.effect.filter.objectId, 'source');
  kernel.perform({ type: 'kill', object: kernel.ref('source') });
  assert.deepEqual(entry.effect.filter.objectId, [], 'a departed incarnation matches nothing');
});
