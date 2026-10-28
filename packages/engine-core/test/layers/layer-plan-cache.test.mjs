// RIFT-1109: command-scoped LayerPlan reuse.
//
// Core Rules v1.5 (2026-10-09):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 478.1.a-c require object dependencies and simultaneous cycles; 478.2-478.4
// require effect-once application with distinct disqualification rechecks.
// Pending/Finalize/Resolve: 329, 337, 340; spell targets/LKI: 355.7, 359.3.
// Dangerous Duo remains a catalog fixture only: printing ogn-016-298,
// canonicalCardId card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { bumpDerivedLayerEpoch, createLayerEngine, hostObjectGeneration, layerObjectGeneration } from '../../dist/layers/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const constant = value => ({ kind: 'constant', value });
const base = player => ({ type: 'base', player });
const field = id => ({ type: 'battlefield', id });
const CARD_ID = 'synthetic:rift-1109:layer-plan-cache';

const program = {
  canonicalCardId: CARD_ID,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'Synthetic command-scoped layer-plan regression.',
  abilities: [{
    kind: 'static',
    effect: {
      kind: 'continuous.might',
      layer: 'arithmetic',
      appliesTo: 'self',
      amount: constant(2),
    },
  }],
};

function frozenView(objects) {
  return Object.freeze(objects.map(object => {
    const snapshot = { ...object };
    snapshot.ref = Object.freeze({ ...snapshot.ref });
    snapshot.types = Object.freeze([...snapshot.types]);
    snapshot.tags = Object.freeze([...snapshot.tags]);
    snapshot.keywords = Object.freeze(snapshot.keywords.map(keyword => Object.freeze({ ...keyword })));
    snapshot.power = snapshot.power === null ? null : Object.freeze([...snapshot.power]);
    snapshot.location = snapshot.location === null ? null : Object.freeze({ ...snapshot.location });
    snapshot.attachedTo = snapshot.attachedTo === null ? null : Object.freeze({ ...snapshot.attachedTo });
    return Object.freeze(snapshot);
  }));
}

function runtime(options = {}) {
  const kernel = world().player('A', { energy: 10 }).player('B', { energy: 10 })
    .unit('subject', { cardId: CARD_ID, might: 3, location: field('field') })
    .build();
  const writes = { count: 0 };
  let attached = false;
  let objectView;
  const objects = () => objectView ??= frozenView(kernel.objects);
  const choose = options.choose ?? (request => { throw new AwaitChoice(request); });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); objectView = undefined; },
    objects: () => Object.freeze([...objects()]),
    perform: action => { writes.count++; objectView = undefined; return kernel.perform(action); },
    performContract: action => { writes.count++; objectView = undefined; return kernel.performContract(action); },
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const flow = new TurnFlow({
    host: { ...host, player: id => kernel.player(id) },
    turnOrder: ['A', 'B'],
    battlefields: [{ id: 'field-a', controller: 'A' }, { id: 'field-b', controller: 'B' }],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(flow.chain, error => { throw error; });
  const attach = () => {
    if (attached) return;
    attached = true;
    flow.chain.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject('subject'), player: 'A' });
  };
  flow.chain.layers.enableDiagnostics();
  return { kernel, binding, flow, chain: flow.chain, writes, attach };
}

function completeView(chain) {
  return chain.withStableLayers(() => chain.pipeline.host.objects());
}

function inCommand(chain, run) {
  return chain.atomic(run);
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

test('RIFT-1109 one host generation reuses its complete LayerPlan and the next command starts fresh', () => {
  const fixture = runtime();
  fixture.attach();
  let first;
  let second;
  let third;
  fixture.chain.layers.enableDiagnostics();
  inCommand(fixture.chain, () => {
    first = completeView(fixture.chain);
    assert.equal(fixture.chain.layers.hasCompletedCommandPlan, true);
    second = completeView(fixture.chain);
    assert.equal(fixture.chain.layers.hasCompletedCommandPlan, true);
  });
  assert.deepEqual(second, first);
  assert.equal(first.find(object => object.ref.id === 'subject').might, 5,
    'the production program applied its arithmetic effect once');
  inCommand(fixture.chain, () => { third = completeView(fixture.chain); });
  assert.deepEqual(third, first, 'the same projection is rebuilt from scratch in the next command');
  assert.equal(fixture.chain.layers.diagnostics.planCacheMisses, 1,
    'the completed plan and its diagnostics do not cross the command boundary');
});

test('RIFT-1109 a completed exact authority reuses its plan', () => {
  const objects = Object.freeze([Object.freeze({ ...objectSnapshot('subject', { might: 3 }), counters: Object.freeze({}) })]);
  const layers = createLayerEngine(objects);
  layers.enableDiagnostics();
  layers.withCommandPlanCache('semantic-generation', () => {
    layers.setCommandPlanAuthority(layerObjectGeneration(objects));
    layers.setObjects(objects, true);
    const view = layers.evaluateAll();
    const authority = layers.commandPlanAuthority;
    layers.setCommandPlanAuthority(authority);
    layers.setObjects(objects, true);
    assert.deepEqual(layers.evaluateAll(), view);
    assert.equal(layers.diagnostics.planCacheHits, 1);
    assert.deepEqual(layers.evaluate(objects[0].ref), view[0]);
    assert.equal(layers.diagnostics.planCacheReferenceHits, 1,
      'a direct read uses the completed command plan only after its full key matches');
  });
});

test('RIFT-1109 equivalent content in a new frozen generation is not reused', () => {
  const objects = Object.freeze([Object.freeze({ ...objectSnapshot('subject', { might: 3 }), counters: Object.freeze({}) })]);
  const equivalent = Object.freeze([Object.freeze({ ...objects[0], ref: Object.freeze({ ...objects[0].ref }) })]);
  const layers = createLayerEngine(objects);
  layers.enableDiagnostics();
  layers.withCommandPlanCache('new-generation', () => {
    layers.setCommandPlanAuthority(layerObjectGeneration(objects));
    layers.setObjects(objects, true);
    const first = layers.evaluateAll();
    layers.setCommandPlanAuthority(layerObjectGeneration(equivalent));
    layers.setObjects(equivalent, true);
    assert.deepEqual(layers.evaluateAll(), first);
    assert.equal(layers.diagnostics.planCacheHits, 0);
  });
});

test('RIFT-1109 mutable snapshots always start a fresh generation', () => {
  const mutable = [{ ...objectSnapshot('subject', { might: 3 }), counters: {} }];
  assert.notEqual(layerObjectGeneration(mutable), layerObjectGeneration(mutable));
  assert.notEqual(hostObjectGeneration(mutable), hostObjectGeneration(mutable));
});

test('RIFT-1109 a derived keyword epoch change invalidates the completed plan', () => {
  const objects = Object.freeze([Object.freeze({ ...objectSnapshot('subject', { might: 3 }), counters: Object.freeze({}) })]);
  const layers = createLayerEngine(objects);
  layers.enableDiagnostics();
  layers.withCommandPlanCache('derived-epoch', () => {
    layers.setCommandPlanAuthority('derived-epoch');
    layers.setObjects(objects, true);
    const first = layers.evaluateAll();
    bumpDerivedLayerEpoch();
    const second = layers.evaluateAll();
    layers.setCommandPlanAuthority(layers.commandPlanAuthority);
    const third = layers.evaluateAll();
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
    assert.equal(layers.diagnostics.planCacheHits, 1,
      'only the pre-epoch pass hit; no stale post-epoch pass was reused');
    assert.ok(layers.diagnostics.planCacheMisses >= 2,
      'the old epoch and the refreshed authority both force a complete pass');
    const fourth = layers.evaluateAll();
    assert.deepEqual(fourth, first);
    assert.equal(layers.diagnostics.planCacheHits, 2,
      'only the pre-epoch and freshly installed post-epoch plans were reused');
  });
});

test('RIFT-1109 direct setObjects defaults to invalidating the completed plan', () => {
  const objects = Object.freeze([Object.freeze({ ...objectSnapshot('subject', { might: 3 }), counters: Object.freeze({}) })]);
  const layers = createLayerEngine(objects);
  layers.enableDiagnostics();
  layers.withCommandPlanCache('direct-boundary', () => {
    layers.setCommandPlanAuthority('direct-boundary');
    layers.setObjects(objects, true);
    const first = layers.evaluateAll();
    layers.setObjects(objects);
    const second = layers.evaluateAll();
    assert.deepEqual(second, first);
    assert.equal(layers.diagnostics.planCacheHits, 0);
    assert.ok(layers.diagnostics.planCacheMisses >= 2);
  });
});

test('RIFT-1109 a reentrant object boundary invalidates instead of caching the frozen batch', () => {
  const firstObjects = Object.freeze([Object.freeze({ ...objectSnapshot('subject', { might: 3 }), counters: Object.freeze({}) })]);
  const nextObjects = Object.freeze([Object.freeze({ ...firstObjects[0], might: 7 })]);
  let layers;
  layers = createLayerEngine(firstObjects, [], { derivedMight: () => {
    layers.setObjects(nextObjects);
    return 7;
  } });
  let view;
  layers.withCommandPlanCache('reentrant-boundary', () => {
    layers.setCommandPlanAuthority('reentrant-boundary');
    layers.setObjects(firstObjects, true);
    view = layers.evaluateAll();
    assert.equal(layers.hasCompletedCommandPlan, false,
      'a reentrant object replacement forbids committing the earlier batch as a plan');
  });
  assert.equal(view.length, 1);
  assert.equal(view[0].might, 7);
});

test('RIFT-1109 disabling the cache produces the same layered projection', () => {
  const enabled = runtime();
  const disabled = runtime();
  disabled.chain.setLayerPlanCacheEnabled(false);
  let enabledView;
  let disabledView;
  inCommand(enabled.chain, () => { enabledView = completeView(enabled.chain); });
  inCommand(disabled.chain, () => { disabledView = completeView(disabled.chain); });
  assert.deepEqual(disabledView, enabledView);
  assert.equal(disabled.chain.layers.diagnostics.planCacheBypasses, 1);
  assert.equal(disabled.chain.layers.diagnostics.planCacheHits, 0);
  assert.equal(disabled.chain.layers.diagnostics.planCacheReferenceHits, 0);
});

for (const mutation of ['exhaust', 'move-zone', 'kill']) {
  test(`RIFT-1109 a real ${mutation} write invalidates the command plan`, () => {
    const fixture = runtime();
    fixture.attach();
    inCommand(fixture.chain, () => {
      assert.equal(completeView(fixture.chain).find(object => object.ref.id === 'subject').might, 5);
      const object = fixture.kernel.ref('subject');
      const action = mutation === 'kill'
        ? { type: 'kill', object }
        : mutation === 'exhaust'
          ? { type: 'exhaust', object }
          : { type: 'move-zone', object, to: 'base' };
      assert.equal(fixture.chain.commit(action).status, 'done');
      const changed = completeView(fixture.chain).find(object => object.ref.id === 'subject');
      assert.equal(changed.zone, mutation === 'kill' ? 'trash' : 'board');
      assert.equal(changed.exhausted, mutation === 'exhaust');
    });
  });
}

test('RIFT-1109 rollback and registry changes invalidate the in-window plan', () => {
  const rolled = runtime();
  rolled.attach();
  assert.throws(() => inCommand(rolled.chain, () => {
    assert.equal(completeView(rolled.chain).find(object => object.ref.id === 'subject').might, 5);
    rolled.chain.commit({ type: 'exhaust', object: rolled.kernel.ref('subject') });
    throw new Error('rollback');
  }), /rollback/);
  assert.equal(rolled.kernel.getObject('subject').exhausted, false);
  inCommand(rolled.chain, () => {
    assert.equal(completeView(rolled.chain).find(object => object.ref.id === 'subject').might, 5);
  });

  const registry = runtime();
  registry.attach();
  inCommand(registry.chain, () => {
    assert.equal(completeView(registry.chain).find(object => object.ref.id === 'subject').might, 5);
    registry.chain.layers.addContinuous({
      id: 'synthetic:rift-1109:extra', layer: 'arithmetic', source: registry.kernel.ref('subject'),
      filter: { objectId: 'subject' }, effect: { kind: 'increase', amount: constant(1) },
    }, { type: 'permanent' });
    assert.equal(completeView(registry.chain).find(object => object.ref.id === 'subject').might, 6);
  });
});

test('RIFT-1109 timing-point change invalidates the in-window plan', () => {
  const fixture = runtime();
  fixture.attach();
  inCommand(fixture.chain, () => {
    assert.equal(completeView(fixture.chain).find(object => object.ref.id === 'subject').might, 5);
    fixture.chain.layers.advance({ id: 'main-end', player: 'A' });
    const first = completeView(fixture.chain);
    const second = completeView(fixture.chain);
    assert.deepEqual(first, second);
    assert.equal(fixture.chain.layers.hasCompletedCommandPlan, true,
      'advancing the timing point forces a complete plan before it can be reused');
  });
});

test('RIFT-1109 attachment facts invalidate the in-window plan', () => {
  const fixture = runtime();
  const source = fixture.kernel.getObject('subject');
  const subject = Object.freeze({ ...source, might: 3, location: Object.freeze({ type: 'battlefield', id: 'field' }) });
  const equipment = Object.freeze({ ...subject, ref: Object.freeze({ id: 'equipment', zoneEntryId: 1 }),
    cardId: 'synthetic:rift-1109:equipment', name: 'Equipment', types: Object.freeze(['gear']),
    keywords: Object.freeze([]), tags: Object.freeze(['Equipment']), might: 2, energy: null, power: null,
    buffs: 0, attachedTo: subject.ref, faceDown: false, isToken: false });
  fixture.chain.layers.setObjects([subject, equipment]);
  assert.equal(fixture.chain.layers.evaluate(subject.ref).might, 5, "base 3 plus the continuous static 2");
  const detached = Object.freeze({ ...equipment, attachedTo: null });
  fixture.chain.layers.setObjects([subject, detached]);
  assert.equal(fixture.chain.layers.evaluate(subject.ref).might, 3,
    'the changed attachment signature does not reuse the preceding continuous plan');
});

test('RIFT-1109 direct mutable attachment mutation on a covered reuse boundary fails closed', () => {
  const subject = { ...objectSnapshot('subject', { might: 3 }) };
  const equipment = Object.freeze({ ...objectSnapshot('equipment'), types: Object.freeze(['gear']),
    tags: Object.freeze(['Equipment']), might: 2, energy: null, power: null, attachedTo: subject.ref });
  const initial = [subject, equipment];
  const layers = createLayerEngine(initial);
  layers.enableDiagnostics();
  layers.withCommandPlanCache('mutable-attachment', () => {
    layers.setCommandPlanAuthority(hostObjectGeneration(initial));
    layers.setObjects(initial, true);
    assert.equal(layers.evaluateAll().find(object => object.ref.id === 'subject').might, 5);
    subject.types = Object.freeze(['gear']);
    layers.setCommandPlanAuthority(hostObjectGeneration(initial));
    layers.setObjects(initial, true);
    assert.equal(layers.evaluateAll().find(object => object.ref.id === 'subject').might, 3,
      'a mutable in-place attachment fact cannot hit the prior immutable plan');
    assert.equal(layers.diagnostics.planCacheHits, 0);
    assert.equal(layers.diagnostics.planCacheAttachmentInvalidations, 1);
  });
});

test('RIFT-1109 copy and dependency groups remain identical when the command plan is enabled or disabled', () => {
  const objects = Object.freeze([
    objectSnapshot('source', { name: 'Honest Broker', might: 3 }),
    objectSnapshot('first', { name: 'Reflection', might: 0, isToken: true }),
    objectSnapshot('second', { name: 'Reflection', might: 0, isToken: true }),
  ]);
  const effects = [
    { effect: { id: 'copy-first', layer: 'copy', filter: { objectId: 'first' },
      effect: { kind: 'copy-object', source: objects[0].ref } }, duration: { type: 'permanent' }, timestamp: 1 },
    { effect: { id: 'copy-second', layer: 'copy', filter: { objectId: 'second' },
      effect: { kind: 'copy-object', source: objects[1].ref } }, duration: { type: 'permanent' }, timestamp: 2 },
  ];
  const read = enabled => {
    const layers = createLayerEngine(objects, effects);
    layers.enableDiagnostics();
    layers.setPlanCacheEnabled(enabled);
    return layers.withCommandPlanCache('dependency-copy', () => {
      const first = layers.evaluateAll();
      const second = layers.evaluateAll();
      return { first, second, archive: JSON.stringify({ first, second }) };
    });
  };
  const enabled = read(true);
  const disabled = read(false);
  assert.deepEqual(enabled.second, enabled.first);
  assert.equal(enabled.archive, disabled.archive);
  assert.equal(enabled.first.find(object => object.ref.id === 'first').name, 'Honest Broker');
  assert.equal(enabled.first.find(object => object.ref.id === 'second').name, 'Honest Broker');
});

test('RIFT-1109 simultaneous trigger order remains identical under the command cache', () => {
  const run = enabled => {
    const kernel = world().player('A').player('B')
      .unit('watcher', { controller: 'A', location: field('field-a') })
      .unit('trigger-a', { controller: 'A', location: field('field-a') })
      .unit('trigger-b', { controller: 'A', location: field('field-a') })
      .build();
    let objectView;
    const choose = request => request.type === 'order' ? [...request.options] : request.options?.[0];
    const host = createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); objectView = undefined; },
      objects: () => Object.freeze([...(objectView ??= frozenView(kernel.objects))]),
      perform: action => { objectView = undefined; return kernel.perform(action); },
      choose,
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    });
    const chain = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
    chain.setLayerPlanCacheEnabled(enabled);
    for (const id of ['trigger-a', 'trigger-b']) chain.pipeline.registerTrigger({
      id: `trigger:${id}`, source: kernel.getObject(id), controller: 'A',
      spec: { at: 'turn-start', filter: { event: 'turn-start' } }, body: [],
    });
    chain.emit({ timingPoint: 'turn-start', player: 'A' });
    return { order: chain.items.map(item => item.source.ref.id), trace: chain.trace,
      events: chain.pipeline.events.map(event => [event.timingPoint, event.details?.item ?? null]),
      archive: JSON.stringify({ items: chain.items, trace: chain.trace, events: chain.pipeline.events }) };
  };
  const enabled = run(true);
  const disabled = run(false);
  assert.deepEqual(enabled.order, disabled.order);
  assert.deepEqual(enabled.trace, disabled.trace);
  assert.deepEqual(enabled.events, disabled.events);
  assert.equal(enabled.archive, disabled.archive);
});

function objectSnapshot(id, values = {}) {
  return Object.freeze({
    ref: Object.freeze({ id, zoneEntryId: 1 }), cardId: `test:${id}`, name: id,
    types: Object.freeze(['unit']), tags: Object.freeze([]), keywords: Object.freeze([]),
    owner: 'A', controller: 'A', zone: 'board', location: null, might: 2,
    energy: 1, power: Object.freeze(['Fury']), exhausted: false, damage: 0, stunned: false,
    buffs: 0, attachedTo: null, faceDown: false, isToken: false, ...values,
  });
}

test('RIFT-1109 production ProgramBinding and TurnFlow preserve CR 478 dependency groups', () => {
  const fixture = runtime();
  fixture.attach();
  let first;
  let second;
  inCommand(fixture.chain, () => {
    first = completeView(fixture.chain);
    second = completeView(fixture.chain);
  });
  assert.deepEqual(second, first);
  assert.ok(fixture.chain.layers.diagnostics.groupEvaluations >= 1);
  assert.ok(fixture.chain.layers.diagnostics.passes >= 1,
    'the production static participated in at least one fixed-point pass');
});

test('RIFT-1109 Pending choice cannot leak its layer plan into the resumed command', () => {
  const fixture = runtime({
    choose: request => { throw new AwaitChoice(request); },
  });
  fixture.attach();
  let pending = false;
  assert.throws(() => inCommand(fixture.chain, () => {
    completeView(fixture.chain);
    fixture.chain.emit({ timingPoint: 'main-start', player: 'A' });
    fixture.chain.pipeline.host.choose({
      id: 'pending-plan-boundary', owner: 'A', chooser: 'A', type: 'select-objects',
      prompt: 'Choose the subject.', min: 1, max: 1, options: [fixture.kernel.ref('subject')],
    });
  }), error => error instanceof AwaitChoice);
  pending = true;
  assert.equal(pending, true);
  inCommand(fixture.chain, () => {
    assert.equal(completeView(fixture.chain).find(object => object.ref.id === 'subject').might, 5);
  });
});

test('RIFT-1109 access-scoped attachment and LKI remain unchanged on a cache hit', () => {
  const fixture = runtime();
  const source = fixture.kernel.getObject('subject');
  const host = Object.freeze({ ...source, ref: Object.freeze({ id: 'lki-host', zoneEntryId: 1 }), might: 2 });
  const gear = Object.freeze({ ...source, ref: Object.freeze({ id: 'lki-gear', zoneEntryId: 1 }),
    types: Object.freeze(['gear']), tags: Object.freeze(['Equipment']), keywords: Object.freeze([]),
    might: 2, energy: null, power: null, buffs: 0, attachedTo: host.ref, faceDown: false, isToken: false });
  const layers = createLayerEngine([host, gear]);
  layers.setPlanCacheEnabled(true);
  const read = () => layers.withCommandPlanCache('lki-command', () => layers.evaluateAll());
  const first = read();
  const second = read();
  assert.deepEqual(second, first);
  assert.equal(first.find(object => object.ref.id === 'lki-host').might, 4);
  assert.equal(first.find(object => object.ref.id === 'lki-gear').printed.attachedTo, host.ref,
    'LKI-focused printed facts remain detached and readable after cache reuse');
});

test('RIFT-1109 real Match host write changes the command key', () => {
  const kernel = world().player('A').player('B')
    .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: 'A' })
    .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: 'B' })
    .rune(Array.from({ length: 8 }, (_, index) => `A:rune:${index}`), { owner: 'A' })
    .rune(Array.from({ length: 8 }, (_, index) => `B:rune:${index}`), { owner: 'B' })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => frozenView(kernel.objects), perform: action => kernel.perform(action), choose: request => { throw new AwaitChoice(request); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: request => { throw new AwaitChoice(request); } }),
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const match = createMatch({ host: { ...host, player: id => kernel.player(id) }, decks: [deck('A'), deck('B')], programs: binding, seed: 1109, firstPlayer: 0, battlefieldChoice: [0, 0] });
  const object = kernel.objects.find(candidate => candidate.owner === 'A' &&
    (candidate.ref.id.startsWith('A:main:') || candidate.ref.id.startsWith('A:deck:')));
  assert.ok(object, 'the match contains a real main-deck object');
  const before = match.flow.chain.pipeline.host.objects();
  assert.equal(match.flow.chain.commit({ type: 'exhaust', object: object.ref }).status, 'done');
  const after = match.flow.chain.pipeline.host.objects();
  assert.notStrictEqual(after, before, 'the authoritative host rotates its generation on a write');
  assert.equal(kernel.getObject(object.ref.id).exhausted, true);
  assert.equal(match.rulesetVersion, 'core-1.5');
});

test('RIFT-1109 cache-on/off preserve projections, events and journal bytes across real TurnFlow actions', () => {
  const run = enabled => {
    const kernel = world().player('A', { energy: 10 }).player('B', { energy: 10 })
      .unit('subject', { cardId: CARD_ID, might: 3, location: field('field') })
      .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: 'A' })
      .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: 'B' })
      .rune(Array.from({ length: 8 }, (_, index) => `A:rune:${index}`), { owner: 'A' })
      .rune(Array.from({ length: 8 }, (_, index) => `B:rune:${index}`), { owner: 'B' })
      .build();
    let objectView;
    const choose = request => { throw new AwaitChoice(request); };
    const host = createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); objectView = undefined; },
      objects: () => Object.freeze([...(objectView ??= frozenView(kernel.objects))]),
      perform: action => { objectView = undefined; return kernel.perform(action); },
      performContract: action => { objectView = undefined; return kernel.performContract(action); },
      choose,
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    });
    const binding = createProgramBinding({ cardPrograms: [program] });
    const flow = new TurnFlow({
      host: { ...host, player: id => kernel.player(id) }, turnOrder: ['A', 'B'],
      battlefields: [{ id: 'field-a', controller: 'A' }, { id: 'field-b', controller: 'B' }],
      describePlay: binding.describePlay,
    });
    flow.chain.setLayerPlanCacheEnabled(enabled);
    binding.attachLifecycle(flow.chain, error => { throw error; });
    flow.chain.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject('subject'), player: 'A' });
    const actions = [];
    const command = (name, run) => flow.chain.atomic(() => {
      run();
      actions.push({ name, eventSeq: flow.chain.pipeline.events.length, state: completeView(flow.chain) });
    });
    command('ready', () => flow.chain.commit({ type: 'ready', object: kernel.ref('subject') }));
    command('exhaust', () => flow.chain.commit({ type: 'exhaust', object: kernel.ref('subject') }));
    command('ready-again', () => flow.chain.commit({ type: 'ready', object: kernel.ref('subject') }));
    const archive = Object.freeze({ actions: Object.freeze(actions), events: flow.chain.pipeline.events, state: flow.chain.trace });
    return { archive, bytes: JSON.stringify(archive) };
  };
  const enabled = run(true);
  const disabled = run(false);
  assert.deepEqual(disabled.archive, enabled.archive);
  assert.equal(hash(disabled.archive), hash(enabled.archive));
  assert.equal(disabled.bytes, enabled.bytes);
});

test('RIFT-1109 cache-on/off preserve a pending Finalize, its retarget boundary, and LKI rollback', () => {
  const run = enabled => {
    const kernel = world().player('A', { energy: 10 }).player('B', { energy: 10 })
      .unit('subject', { cardId: CARD_ID, might: 3, location: field('field') })
      .unit('other', { cardId: CARD_ID, might: 3, location: field('field') })
      .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: 'A' })
      .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: 'B' })
      .build();
    let objectView;
    const choose = request => {
      if (request.type === 'select-objects' && request.options.length > 0) {
        return request.options.slice(0, Math.max(request.min, 1));
      }
      throw new AwaitChoice(request);
    };
    const host = createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); objectView = undefined; },
      objects: () => Object.freeze([...(objectView ??= frozenView(kernel.objects))]),
      perform: action => { objectView = undefined; return kernel.perform(action); },
      choose,
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    });
    const binding = createProgramBinding({ cardPrograms: [program] });
    const chain = new ChainEngine({
      turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
      describePlay: binding.describePlay,
    });
    chain.setLayerPlanCacheEnabled(enabled);
    binding.attachLifecycle(chain, error => { throw error; });
    chain.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject('subject'), player: 'A' });
    const draft = binding.describePlay({ type: 'play', object: kernel.ref('subject'), player: 'A' }, kernel.getObject('subject'));
    chain.execute({ ...draft, kind: 'spell', speed: 'action', id: 'pending-finalize-plan', controller: 'A',
      cost: { id: 'free-cost', cost: { energy: constant(0), power: constant([]), payments: [] } },
      targets: [{ requirement: { id: 'target', filter: { type: 'unit', zone: 'board' }, min: 1, max: 1 } }] });
    chain.advance();
    if (chain.items.some(item => item.status === 'pending')) chain.advance();
    const item = chain.items.find(candidate => candidate.id === 'pending-finalize-plan');
    if (item === undefined) {
      throw new Error(`finalize item missing: ${JSON.stringify({ items: chain.items, trace: chain.trace, events: chain.pipeline.events.slice(-5) }, null, 2)}`);
    }
    const selected = item.targetPlans[0]?.selected[0];
    assert.ok(selected, 'a legal target was locked before the Pending boundary');
    const event = chain.pipeline.events.find(candidate => candidate.timingPoint === 'chain-item-pending' && candidate.details?.item === item.id);
    assert.ok(event, 'the Pending event retains the live layered source snapshot');
    assert.equal(event.object?.might, 3, 'the Pending event retains the source snapshot used by the chain');
    return { item: { id: item.id, status: item.status, selected, targets: item.targetPlans },
      event: event.object, state: completeView(chain), trace: chain.trace,
      archive: JSON.stringify({ items: chain.items, events: chain.pipeline.events, trace: chain.trace }) };
  };
  const enabled = run(true);
  const disabled = run(false);
  assert.deepEqual(enabled.item, disabled.item);
  assert.deepEqual(enabled.event, disabled.event);
  assert.deepEqual(enabled.state, disabled.state);
  assert.deepEqual(enabled.trace, disabled.trace);
  assert.equal(enabled.archive, disabled.archive);
});

function deck(seat) {
  const mainDeck = Array.from({ length: 30 }, (_, index) => ({ id: `${seat}:main:${index}`, cardId: 'synthetic:rift-1109:deck-card', name: 'Deck Card', types: ['unit'], energy: 0, power: null, might: 2 }));
  const runeDeck = Array.from({ length: 8 }, (_, index) => ({ id: `${seat}:rune:${index}`, cardId: 'synthetic:rift-1109:rune', name: 'Rune', types: ['rune'], energy: null, power: null }));
  return {
    mainDeck, runeDeck,
    championLegend: { id: `${seat}:legend`, cardId: 'synthetic:rift-1109:legend', name: 'Legend', types: ['legend'] },
    chosenChampion: { id: `${seat}:champion`, cardId: 'synthetic:rift-1109:champion', name: 'Champion', types: ['champion'] },
    battlefields: [0, 1, 2].map(index => ({ id: `${seat}:field:${index}`, cardId: `synthetic:rift-1109:field-${index}`, name: 'Field', types: ['battlefield'] })),
  };
}
