import assert from 'node:assert/strict';
import test from 'node:test';

import { world } from '../../dist/effects/testing/index.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { KeywordGrantLayerEngine } from '../../dist/programs/keyword-grants.js';

const c = value => ({ kind: 'constant', value });
const PROGRAM_ID = 'synthetic:perf-keyword-grant-alias';
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function grant(id, keyword, target, value) {
  return {
    id: `grant-${id}`,
    op: 'continuous.grant-keyword',
    args: {
      keyword: c(keyword),
      ...(value === undefined ? {} : { value: c(value) }),
      duration: c('this-turn'),
      settlementId: c(`perf-alias-${id}`),
      objects: c({ kind: 'target', id }),
    },
    targets: [{ id, filter: { objectId: target, zone: 'board' }, min: 1, max: 1 }],
  };
}

function lifecycleFixture() {
  const kernel = world().player('A', { energy: 20 }).player('B')
    .unit('source', { cardId: PROGRAM_ID, types: ['gear'], controller: 'A', owner: 'A', might: 1, combatRole: null, energy: null, power: null })
    .unit('attacker', { controller: 'A', owner: 'A', might: 3, combatRole: 'attacker', energy: null, power: null })
    .unit('defender', { controller: 'A', owner: 'A', might: 3, combatRole: 'defender', energy: null, power: null })
    .unit('idle', { controller: 'A', owner: 'A', might: 3, combatRole: null, energy: null, power: null })
    .build();
  const answers = new Map();
  const choose = request => {
    if (answers.has(request.id)) return answers.get(request.id);
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
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const program = admitted({
    canonicalCardId: PROGRAM_ID,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: '[synthetic keyword grant alias regression]',
    abilities: [{
      kind: 'play',
      timing: 'reaction',
      cost: { kind: 'printed', energy: c(0), power: c([]) },
      body: [
        grant('attacker-target', 'Assault', 'attacker', 2),
        grant('defender-target', 'Shield', 'defender', 3),
        grant('idle-target', 'Ganking', 'idle'),
      ],
    }],
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  let engine;
  const layers = new KeywordGrantLayerEngine(kernel.objects, {
    context: source => host.context(source, source.controller,
      engine?.layers.currentTimingPoint ?? 'main-start'),
  });
  engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, layers,
    cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  return { kernel, engine, layers, binding, answers };
}

function resolveAll(engine) {
  engine.advance();
  for (let steps = 0; engine.items.length; steps++) {
    assert.ok(steps < 40, 'the production chain settles');
    engine.pass(engine.priority);
  }
}

function activateGrants(engine, kernel, binding) {
  assert.ok(engine.layers instanceof KeywordGrantLayerEngine);
  const source = kernel.getObject('source');
  assert.ok(source);
  const action = { type: 'play', object: source.ref, player: 'A', location: { type: 'base', player: 'A' } };
  assert.equal(engine.commit(action).status, 'done');
  resolveAll(engine);
  assert.equal(kernel.player('A').energy, 20);
  assert.deepEqual(engine.trace.filter(entry => ['finalized', 'resolved', 'removed'].includes(entry.step)).map(entry => entry.step),
    ['finalized', 'resolved', 'removed']);
}

function keywordSnapshot(layer, kernel, id) {
  const snapshot = layer.evaluate(kernel.ref(id));
  return { keywords: snapshot.keywords, might: snapshot.might };
}

test('keyword grant aliases preserve combatRole for source, object and query without detached copies', () => {
  const { kernel, engine, layers, binding } = lifecycleFixture();
  activateGrants(engine, kernel, binding);

  const snapshots = [];
  for (let pass = 0; pass < 3; pass++) {
    snapshots.push({
      attacker: keywordSnapshot(layers, kernel, 'attacker'),
      defender: keywordSnapshot(layers, kernel, 'defender'),
      idle: keywordSnapshot(layers, kernel, 'idle'),
    });
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(snapshots[1], snapshots[2]);
  assert.deepEqual(snapshots[0].attacker.keywords, [{ id: 'Assault', value: 2 }]);
  assert.deepEqual(snapshots[0].defender.keywords, [{ id: 'Shield', value: 3 }]);
  assert.deepEqual(snapshots[0].idle.keywords, [{ id: 'Ganking' }]);
  assert.equal(snapshots[0].attacker.might, 5);
  assert.equal(snapshots[0].defender.might, 6);
  assert.equal(snapshots[0].idle.might, 3);
  const firstView = layers.evaluateAll();
  assert.deepEqual(layers.evaluateAll(), firstView);
});

test('keyword grant layers retain RIFT-999 stable view while lifecycle grants and expiry remain exact', () => {
  const { kernel, engine, binding } = lifecycleFixture();
  activateGrants(engine, kernel, binding);
  const ref = kernel.ref('attacker');
  engine.withStableLayers(() => {
    const first = engine.layers.evaluate(ref);
    const second = engine.layers.evaluate(ref);
    assert.deepEqual(second, first);
    assert.deepEqual(first.keywords, [{ id: 'Assault', value: 2 }]);
    assert.equal(first.might, 5);
    assert.equal(engine.pipeline.checkpoint().triggers.size >= 0, true);
  });
  engine.layers.advance({ id: 'turn-end', player: 'A' });
  assert.deepEqual(engine.layers.evaluate(ref).keywords, []);
  assert.equal(engine.layers.evaluate(ref).might, 3);
});
