// RIFT-1094: layer snapshot structure sharing and diagnostic counts.
//
// Official evidence: Core Rules v1.5 (2026-10-09),
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/
//   5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 478.1.a pauses a dependent object and resolves its referenced object.
// - 478.1.c evaluates the minimum object cycle simultaneously, layer by layer.
// - 478.2-478.4 apply each effect once and re-check disqualifications separately.
//
// The scenarios use the production ChainEngine + createProgramBinding +
// attachLifecycle path. The synthetic programs only isolate these general rules;
// no unknown official card behavior is promoted or approximated.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ChainEngine } from '../../dist/chain/engine.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import {
  createLayerEngine,
} from '../../dist/layers/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const c = value => ({ kind: 'constant', value });
const at = id => ({ type: 'battlefield', id });
const permanent = effect => ({ effect, duration: { type: 'permanent' } });

function unit(id, values = {}) {
  return {
    ref: { id, zoneEntryId: 1 }, cardId: `test:${id}`, name: id,
    types: ['unit'], tags: [], keywords: [], owner: 'A', controller: 'A',
    zone: 'board', location: at('field'), might: 2, energy: null, power: null,
    exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null,
    faceDown: false, isToken: false, ...values,
  };
}

function deepFrozenView(objects) {
  return Object.freeze(objects.map(object => {
    const current = { ...object };
    current.ref = Object.freeze({ ...current.ref });
    current.types = Object.freeze([...current.types]);
    current.tags = Object.freeze([...current.tags]);
    current.keywords = Object.freeze(current.keywords.map(keyword => Object.freeze({ ...keyword })));
    current.power = current.power === null ? null : Object.freeze([...current.power]);
    current.location = current.location === null ? null : Object.freeze({ ...current.location });
    current.attachedTo = current.attachedTo === null ? null : Object.freeze({ ...current.attachedTo });
    return Object.freeze(current);
  }));
}

function productionRuntime(programs, builder) {
  const kernel = builder.build();
  const choose = request => { throw new Error(`Unexpected choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  binding.attachLifecycle(engine, error => { throw error; });
  for (const object of kernel.objects) {
    if (object.zone === 'board') engine.pipeline.emit({
      timingPoint: 'object-enters-board', object, player: object.controller,
    });
  }
  const snapshot = id => engine.layers.snapshot(kernel.ref(id));
  return { kernel, engine, binding, snapshot };
}

test('RIFT-1094 immutable nested fields are shared while every public object is detached', () => {
  const assertSelfMust = {
    effect: {
      id: 'self-might', layer: 'arithmetic', source: { id: 'unit', zoneEntryId: 1 },
      filter: { objectId: 'unit' },
      effect: {
        kind: 'increase', amount: { kind: 'object-property', object: 'self', property: 'might' },
        condition: {
          kind: 'compare', left: { kind: 'object-property', object: 'self', property: 'might' },
          operator: 'gte', right: c(2),
        },
      },
    },
    duration: { type: 'permanent' },
  };
  const layers = createLayerEngine(deepFrozenView([unit('unit')]), [assertSelfMust]);
  layers.resetDiagnostics();
  const first = layers.evaluate({ id: 'unit', zoneEntryId: 1 });
  const second = layers.evaluate({ id: 'unit', zoneEntryId: 1 });
  assert.equal(first.might, 4);
  assert.deepEqual(second, first);
  assert.notEqual(second, first, 'the public wrapper is still per read');
  assert.strictEqual(second.types, first.types);
  assert.strictEqual(second.tags, first.tags);
  assert.strictEqual(second.keywords, first.keywords);
  assert.strictEqual(second.printed, first.printed);
  assert.strictEqual(second.movement, first.movement);
  assert.equal(Object.isFrozen(second), true);
  assert.equal(Object.isFrozen(second.types), true);
  const before = layers.diagnostics;
  layers.evaluate({ id: 'unit', zoneEntryId: 1 });
  assert.equal(layers.diagnostics.dependencyCacheHits, before.dependencyCacheHits + 1);
  assert.equal(layers.diagnostics.effectApplications, before.effectApplications,
    'a cached read does not apply the effect again');
});

test('RIFT-1094 production ChainEngine invalidates conditional layer effects after a real action', () => {
  const cardId = 'synthetic:rift-1094:conditional-mechanical-dependency';
  const program = {
    canonicalCardId: cardId,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'Synthetic layer dependency regression.',
    abilities: [{
      kind: 'static',
      condition: { kind: 'compare', left: { kind: 'object-property', object: 'self', property: 'exhausted' },
        operator: 'eq', right: c(false) },
      effect: { kind: 'continuous.might', layer: 'arithmetic', appliesTo: 'self', amount: c(3) },
    }],
  };
  const f = productionRuntime([program], world().player('A').player('B')
    .unit('subject', { cardId, might: 2, exhausted: false, location: at('field') }));
  f.engine.layers.enableDiagnostics();
  assert.equal(f.snapshot('subject').might, 5);
  assert.equal(f.engine.commit({ type: 'exhaust', object: f.kernel.ref('subject') }).status, 'done');
  assert.equal(f.snapshot('subject').might, 2, 'the committed host change is visible to the layer engine');
  assert.equal(f.snapshot('subject').keywords.some(keyword => keyword.id === 'Deadly'), false,
    'the false conditional effect is absent from the authoritative layered result');
  assert.equal(f.engine.commit({ type: 'ready', object: f.kernel.ref('subject') }).status, 'done');
  assert.equal(f.snapshot('subject').might, 5, 'CR 478.3 re-applies the effect after eligibility returns');
});

test('RIFT-1094 object cycles form deterministic simultaneous groups and count once', () => {
  const first = unit('first', { might: 2 });
  const second = unit('second', { might: 2 });
  const layers = createLayerEngine([first, second], [
    permanent({ id: 'first-reads-second', layer: 'arithmetic', source: first.ref,
      filter: { objectId: 'first' },
      effect: { kind: 'increase', amount: { kind: 'object-property', object: second.ref, property: 'might' } } }),
    permanent({ id: 'second-reads-first', layer: 'arithmetic', source: second.ref,
      filter: { objectId: 'second' },
      effect: { kind: 'increase', amount: { kind: 'object-property', object: first.ref, property: 'might' } } }),
  ]);
  layers.resetDiagnostics();
  const firstResult = layers.evaluate(first.ref);
  assert.ok(firstResult !== null);
  const cycle = layers.diagnostics;
  assert.ok(cycle.dependencyRestarts >= 1, 'discovering the object cycle restarts layer evaluation');
  assert.ok(cycle.dependencyCycleGroups >= 1);
  assert.ok(cycle.multiObjectGroups >= 1);
  assert.ok(cycle.passes >= 1);
  assert.equal(cycle.effectApplications, 2, 'one application per independent effect across the cycle');
  assert.equal(layers.evaluate(second.ref).might, firstResult.might,
    'the complete SCC is cached and both members finalize from the same simultaneous pass');
  assert.equal(layers.diagnostics.dependencyCacheHits, cycle.dependencyCacheHits + 1,
    'reading the other cached cycle member does not apply an effect twice');
});

test('RIFT-1094 repeated production evaluateAll reuses layer cache without another snapshot copy', () => {
  const cardId = 'synthetic:rift-1094:cached-production-layer';
  const program = {
    canonicalCardId: cardId,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'Synthetic cached production layer regression.',
    abilities: [{ kind: 'static', effect: {
      kind: 'continuous.might', layer: 'arithmetic', appliesTo: 'self', amount: c(2),
    } }],
  };
  const f = productionRuntime([program], world().player('A').player('B')
    .unit('subject', { cardId, might: 2, location: at('field') }));
  f.engine.layers.enableDiagnostics();
  const first = f.engine.layers.evaluateAll();
  const groups = f.engine.layers.diagnostics.groupEvaluations;
  const applications = f.engine.layers.diagnostics.effectApplications;
  const second = f.engine.layers.evaluateAll();
  assert.deepEqual(second, first);
  assert.notStrictEqual(second[0], first[0], 'public wrappers remain detached across reads');
  assert.equal(f.engine.layers.diagnostics.groupEvaluations, groups,
    'a repeated top-level pass reuses the completed layer cache');
  assert.equal(f.engine.layers.diagnostics.effectApplications, applications,
    'effect-once survives the repeated top-level pass');
});

test('RIFT-1094 attachment signature skips content serialization across frozen top-level reads', () => {
  const host = unit('host', { might: 2 });
  const gear = unit('gear', { types: ['gear'], tags: ['Equipment'], might: 2, attachedTo: host.ref });
  const layers = createLayerEngine(deepFrozenView([host, gear]));
  layers.resetDiagnostics();
  assert.equal(layers.evaluate(host.ref).might, 4);
  const first = layers.diagnostics.attachmentSignatureCalls;
  assert.equal(layers.evaluate(host.ref).might, 4);
  assert.equal(layers.diagnostics.attachmentSignatureCalls, first);
  assert.ok(layers.diagnostics.attachmentSignatureReuses >= 1);
  layers.setObjects(deepFrozenView([host, { ...gear, attachedTo: null }]));
  assert.equal(layers.diagnostics.attachmentSignatureCalls, first + 1,
    'an explicit boundary refreshes the attachment signature immediately');
  assert.equal(layers.evaluate(host.ref).might, 2, 'detachment invalidates the prior bonus');
});

test('RIFT-1094 mutable in-place attachment changes are re-signed on every top-level read', () => {
  const host = unit('host', { might: 2 });
  const mutableGear = { ...unit('gear', { types: ['gear'], tags: ['Equipment'], might: 2, attachedTo: host.ref }) };
  const layers = createLayerEngine([host, mutableGear]);
  layers.resetDiagnostics();
  assert.equal(layers.evaluate(host.ref).might, 4);
  const first = layers.diagnostics.attachmentSignatureCalls;
  mutableGear.attachedTo = null;
  assert.equal(layers.evaluate(host.ref).might, 2, 'in-place host changes are visible immediately');
  assert.ok(layers.diagnostics.attachmentSignatureCalls > first,
    'mutable raw snapshots cannot reuse a cached attachment revision');
});

test('RIFT-1094 layer diagnostics are opt-in and do not enter normal production reads', () => {
  const host = unit('host', { might: 2 });
  const layers = createLayerEngine(deepFrozenView([host]));
  assert.equal(layers.evaluate(host.ref).might, 2);
  assert.equal(layers.diagnostics.evaluateCalls, 0);
  layers.resetDiagnostics();
  assert.equal(layers.evaluate(host.ref).might, 2);
  assert.equal(layers.diagnostics.evaluateCalls, 1);
});
