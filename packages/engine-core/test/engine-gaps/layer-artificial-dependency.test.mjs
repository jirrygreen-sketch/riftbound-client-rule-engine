import assert from 'node:assert/strict';
import test from 'node:test';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { world } from '../../dist/effects/testing/index.js';
import { createLayerEngine, matchesObjectFilter } from '../../dist/layers/index.js';
import { bindFilterAnchor } from '../../dist/layers/relative/filter.js';

// RIFT-1160: a bound static filter resolved its live source before checking
// the target's own zone, type and tags, and a source-only static kept its
// "only me" restriction in a condition that also read the source. Inside a
// layer evaluation each such read is a dependency edge. A Deck card tested
// against "your Mechs have Shield", and every object tested against a Mech's
// "I have +1 Might", therefore joined one dependency group with the Legend
// and the Mech, and every layered pass of a seeded M1 game restarted about a
// dozen times. Neither read can change whether the effect applies.

const c = value => ({ kind: 'constant', value });

const menace = {
  canonicalCardId: 'synthetic:rift-1160:mech-shield',
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

const selfMight = {
  canonicalCardId: 'synthetic:rift-1160:self-might',
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'synthetic "I have +1 Might"',
  abilities: [{ kind: 'static', effect: { kind: 'continuous.might', amount: c(1), appliesTo: c('self') } }],
};

function setup(deckCards) {
  let builder = world().player('A').player('B')
    .base('legend', { cardId: menace.canonicalCardId, owner: 'A', controller: 'A', might: 1 })
    .base('mech', { cardId: selfMight.canonicalCardId, owner: 'A', controller: 'A', might: 2, tags: ['Mech'] })
    .base('other', { owner: 'B', controller: 'B', might: 3 });
  for (let index = 0; index < deckCards; index++) {
    const player = index % 2 === 0 ? 'A' : 'B';
    builder = builder.card(`deck-${index}`, { owner: player, controller: player, zone: 'deck', tags: ['Mech'] });
  }
  const kernel = builder.build();
  const choose = request => { throw new Error(`Unexpected choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: [menace, selfMight] });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  binding.attachLifecycle(engine, error => { throw error; });
  for (const id of ['legend', 'mech']) {
    engine.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject(id), player: 'A' });
  }
  return { engine, kernel };
}

test('RIFT-1160: bound and source-only statics add no dependency group', () => {
  const { engine, kernel } = setup(10);
  engine.layers.resetDiagnostics();
  engine.layers.setObjects(kernel.objects);
  const view = new Map(engine.layers.evaluateAll().map(object => [object.ref.id, object]));
  assert.equal(engine.layers.diagnostics.dependencyRestarts, 0);
  assert.equal(engine.layers.diagnostics.multiObjectGroups, 0);
  assert.equal(view.size, 13);
  // The effects themselves are unchanged.
  assert.equal(view.get('mech').might, 3);
  assert.ok(view.get('mech').keywords.some(keyword => keyword.id.toLowerCase() === 'shield'));
  for (const id of ['legend', 'other', 'deck-0', 'deck-1']) {
    assert.ok(!view.get(id).keywords.some(keyword => keyword.id.toLowerCase() === 'shield'), id);
  }
  assert.equal(view.get('legend').might, 1);
  assert.equal(view.get('other').might, 3);
});

test('RIFT-1160: a bound filter resolves its host only for a target it can still match', () => {
  const object = (id, values) => Object.freeze({ ref: Object.freeze({ id, zoneEntryId: 1 }), cardId: id, name: id,
    types: ['unit'], tags: [], keywords: [], owner: 'A', controller: 'A', zone: 'board', location: null,
    might: 1, energy: null, power: null, exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null,
    faceDown: false, ...values });
  const host = object('host', {});
  let reads = 0;
  const bound = filter => bindFilterAnchor(filter, () => { reads++; return host; });
  const filter = bound({ zone: 'board', type: 'unit', tags: ['Mech'], controller: 'self' });

  assert.equal(matchesObjectFilter(filter, object('deck', { zone: 'deck', tags: ['Mech'] })), false);
  assert.equal(matchesObjectFilter(filter, object('gear', { types: ['gear'], tags: ['Mech'] })), false);
  assert.equal(matchesObjectFilter(filter, object('plain', {})), false);
  assert.equal(reads, 0, 'zone, type and tag mismatches never read the host');

  assert.equal(matchesObjectFilter(filter, object('mine', { tags: ['Mech'] })), true);
  assert.equal(matchesObjectFilter(filter, object('theirs', { tags: ['Mech'], controller: 'B' })), false);
  assert.equal(reads, 2, 'a target that passes them still resolves the host');

  // A field spelled as an accessor is never read early.
  const accessor = bound({ type: 'unit' });
  let zoneReads = 0;
  Object.defineProperty(accessor, 'zone', { enumerable: true, get: () => { zoneReads++; return 'board'; } });
  reads = 0;
  assert.equal(matchesObjectFilter(accessor, object('deck', { zone: 'deck' })), false);
  assert.equal(reads, 1);
  assert.equal(zoneReads, 1);
});

test('RIFT-1160: reused base snapshots follow every host change', () => {
  const object = values => ({ ref: { id: 'u', zoneEntryId: 1 }, cardId: 'u', name: 'u', types: ['unit'], tags: [],
    keywords: [], owner: 'A', controller: 'A', zone: 'board', location: null, might: 2, energy: null, power: null,
    exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, ...values });
  const deepFreeze = value => {
    if (value !== null && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  };
  const frozen = deepFreeze(object({}));
  const layers = createLayerEngine([frozen]);
  const first = layers.evaluateAll()[0];
  const again = layers.evaluateAll()[0];
  assert.deepEqual(again, first);
  assert.notStrictEqual(again, first, 'public snapshots stay detached');

  layers.setObjects([deepFreeze(object({ might: 5, tags: ['Mech'] }))]);
  const replaced = layers.evaluateAll()[0];
  assert.equal(replaced.might, 5);
  assert.deepEqual(replaced.tags, ['Mech']);

  // A mutable fixture changed in place is never served from the reuse cache.
  const mutable = object({});
  const fixture = createLayerEngine([mutable]);
  assert.equal(fixture.evaluateAll()[0].might, 2);
  mutable.might = 7;
  fixture.setObjects([mutable]);
  assert.equal(fixture.evaluateAll()[0].might, 7);
});
