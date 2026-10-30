import assert from 'node:assert/strict';
import test from 'node:test';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { KeywordGrantLayerEngine } from '../../dist/programs/keyword-grants.js';
import { world } from '../../dist/effects/testing/index.js';
import { LayerEngine, bumpDerivedLayerEpoch } from '../../dist/layers/engine.js';
import { bindFilterAnchor } from '../../dist/layers/relative/filter.js';

// RIFT-1162: every write to a KeywordGrantLayerEngine's derived state bumps a
// module-level epoch, and ChainEngine's stable layered view was keyed on it.
// The production keyword re-expansion runs in engines of its own, so each
// grant condition it tested inside a statics sweep discarded the main view and
// started another whole-board pass (57 of them in one seeded M1 play). A plain
// layer engine sees grants only through its registry, so only an engine that
// reads derived state keys its stable view on that epoch.

const c = value => ({ kind: 'constant', value });

const menace = {
  canonicalCardId: 'synthetic:rift-1162:mech-shield',
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'synthetic "Your Mechs have [Shield]"',
  abilities: [{
    kind: 'static',
    effect: {
      kind: 'grant-keyword',
      keyword: 'shield',
      value: c(1),
      filter: { type: 'unit', tag: 'Mech', controller: 'controller', zone: 'board' },
    },
  }],
};

function setup(layers) {
  const kernel = world().player('A').player('B')
    .base('legend', { cardId: menace.canonicalCardId, owner: 'A', controller: 'A', might: 1 })
    .base('mech', { owner: 'A', controller: 'A', might: 2, tags: ['Mech'] })
    .base('other', { owner: 'B', controller: 'B', might: 3, tags: ['Mech'] })
    .build();
  const choose = request => { throw new Error(`Unexpected choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    ...(layers === undefined ? {} : { layers: layers(kernel.objects) }),
  });
  if (layers === undefined) {
    createProgramBinding({ cardPrograms: [menace] }).attachLifecycle(engine, error => { throw error; });
    engine.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject('legend'), player: 'A' });
  }
  return { engine, kernel };
}

const hasShield = (view, id) => view.find(object => object.ref.id === id).keywords
  .some(keyword => keyword.id.toLowerCase() === 'shield');

test('RIFT-1162: derived keyword-grant writes elsewhere keep a plain stable view', () => {
  const { engine } = setup();
  assert.equal(engine.layers.readsDerivedLayerState, false);
  engine.withStableLayers(() => {
    const first = engine.pipeline.host.objects();
    bumpDerivedLayerEpoch();
    assert.strictEqual(engine.pipeline.host.objects(), first, 'one whole-board pass serves the sweep');
  });
});

test('RIFT-1162: a grant changed in the middle of a sweep is visible at once', () => {
  const { engine } = setup();
  const grant = engine.layers.registry.list().find(entry => entry.effect.source?.id === 'legend' &&
    JSON.stringify(entry.effect).includes('"Mech"'));
  assert.ok(grant, 'the static grant is registered');
  engine.withStableLayers(() => {
    const before = engine.pipeline.host.objects();
    assert.ok(hasShield(before, 'mech'));
    assert.ok(!hasShield(before, 'other'), 'only your Mechs');
    assert.ok(!hasShield(before, 'legend'));

    engine.layers.removeContinuous(grant.effect.id);
    bumpDerivedLayerEpoch();
    const removed = engine.pipeline.host.objects();
    assert.notStrictEqual(removed, before);
    assert.ok(!hasShield(removed, 'mech'), 'a removed grant leaves the view immediately');

    engine.layers.addContinuous(grant.effect, grant.duration);
    const restored = engine.pipeline.host.objects();
    assert.ok(hasShield(restored, 'mech'), 'a re-added grant reaches the view immediately');
    assert.ok(!hasShield(restored, 'other'));
    bumpDerivedLayerEpoch();
    assert.strictEqual(engine.pipeline.host.objects(), restored);
  });
});

test('RIFT-1162: layers that read derived keyword-grant state still key on it', () => {
  class DerivedLayers extends LayerEngine {
    get readsDerivedLayerState() { return true; }
  }
  const { engine } = setup(objects => new DerivedLayers(objects));
  engine.withStableLayers(() => {
    const first = engine.pipeline.host.objects();
    assert.strictEqual(engine.pipeline.host.objects(), first);
    bumpDerivedLayerEpoch();
    assert.notStrictEqual(engine.pipeline.host.objects(), first, 'a derived write discards the view');
  });
  const keywordLayers = new KeywordGrantLayerEngine([], {
    registry: new LayerEngine([]).registry,
    context: () => { throw new Error('not read'); },
  });
  assert.equal(keywordLayers.readsDerivedLayerState, true);
});

test('RIFT-1162: a keyword-grant query with an empty filter returns the whole view', () => {
  const kernel = world().player('A').player('B')
    .base('mine', { owner: 'A', controller: 'A', might: 2, tags: ['Mech'] })
    .base('theirs', { owner: 'B', controller: 'B', might: 3 })
    .card('deck', { owner: 'A', controller: 'A', zone: 'deck' })
    .build();
  const choose = request => { throw new Error(`Unexpected choice ${request.id}`); };
  const layers = new KeywordGrantLayerEngine(kernel.objects, {
    registry: new LayerEngine([]).registry,
    context: source => bindResolveContext(kernel, { source, controller: source.controller, timingPoint: 'cleanup-start', choose }),
  });
  const view = layers.evaluateAll();
  const query = layers.environment(view.find(object => object.ref.id === 'mine')).context.query;
  const ids = objects => objects.map(object => object.ref.id).sort();
  assert.deepEqual(ids(query({})), ids(view));
  assert.deepEqual(ids(query({ zone: 'deck' })), ['deck']);
  assert.deepEqual(ids(query({ controller: 'B' })), ['theirs']);
  // A bound `{}` still resolves its host: one that is gone matches nothing.
  assert.deepEqual(query(bindFilterAnchor({}, () => null)), []);
});
