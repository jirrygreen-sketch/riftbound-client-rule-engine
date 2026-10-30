import assert from 'node:assert/strict';
import test from 'node:test';

import { createLayerEngine } from '../../dist/layers/index.js';

const field = Object.freeze({ type: 'battlefield', id: 'field' });

function object(id, values = {}) {
  return Object.freeze({
    ref: Object.freeze({ id, zoneEntryId: 1 }),
    cardId: `test:${id}`,
    name: id,
    types: Object.freeze(['unit']),
    tags: Object.freeze([]),
    keywords: Object.freeze([]),
    owner: 'A',
    controller: 'A',
    zone: 'board',
    location: field,
    might: 2,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...values,
  });
}

test('RIFT-1149 immutable snapshot reuse preserves cache-on/off results', () => {
  const objects = Object.freeze([object('subject')]);
  const effect = Object.freeze({
    effect: Object.freeze({ id: 'might', layer: 'arithmetic', source: objects[0].ref,
      filter: Object.freeze({ objectId: 'subject' }),
      effect: Object.freeze({ kind: 'increase', amount: 2 }) }),
    duration: Object.freeze({ type: 'permanent' }),
  });
  const enabled = createLayerEngine(objects, [effect]);
  const disabled = createLayerEngine(objects, [effect]);
  disabled.setImmutableSnapshotReuseEnabled(false);
  const first = enabled.evaluateAll();
  const second = enabled.evaluateAll();
  const reference = disabled.evaluateAll();

  assert.deepEqual(second, first);
  assert.deepEqual(first, reference);
  assert.notStrictEqual(second[0], first[0], 'public wrappers remain per read');
  assert.equal(Object.isFrozen(second[0]), true);
  assert.equal(Object.isFrozen(second[0].printed), true);
  assert.equal(first[0].might, 4);
});

test('RIFT-1149 attachment, departure, and expiration refresh immutable snapshots', () => {
  const host = object('host');
  const gear = object('gear', {
    types: Object.freeze(['gear']), tags: Object.freeze(['Equipment']), attachedTo: host.ref,
  });
  const layers = createLayerEngine(Object.freeze([host, gear]));
  assert.equal(layers.evaluate(host.ref).might, 4);
  layers.setObjects(Object.freeze([host, object('gear', { types: Object.freeze(['gear']), tags: Object.freeze(['Equipment']) })]));
  assert.equal(layers.evaluate(host.ref).might, 2);

  const source = object('source');
  const target = object('target');
  layers.setObjects(Object.freeze([source, target]));
  layers.addContinuous({
    id: 'source-aura', layer: 'arithmetic', source: source.ref,
    filter: Object.freeze({ objectId: 'target' }), effect: Object.freeze({ kind: 'increase', amount: 1 }),
  }, Object.freeze({ type: 'while-source-in-zone', source: source.ref }));
  assert.equal(layers.evaluate(target.ref).might, 3);
  layers.setObjects(Object.freeze([target]));
  assert.equal(layers.evaluate(target.ref).might, 2);

  layers.addContinuous({
    id: 'turn-bonus', layer: 'arithmetic', source: target.ref,
    filter: Object.freeze({ objectId: 'target' }), effect: Object.freeze({ kind: 'increase', amount: 1 }),
  }, Object.freeze({ type: 'end-of-turn' }));
  assert.equal(layers.evaluate(target.ref).might, 3);
  assert.deepEqual(new Set(layers.advance(Object.freeze({ id: 'turn-end', player: 'A' }))),
    new Set(['turn-bonus', 'source-aura']));
  assert.equal(layers.evaluate(target.ref).might, 2);
});
