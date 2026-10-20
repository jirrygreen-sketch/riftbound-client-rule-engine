// RIFT-888 - Buff counters are intrinsic +1 Might increases (CR v1.5 701-705).
// Rules evidence: /root/swarm-rift/shared/rules/CR-v1.5.txt lines 4566-4585:
// 702.2.b spend, 702.3 one Buff per Unit, 703 effective Might increase, and
// 705 removal on leaving play. Layer ordering is CR 478.3/478.4 and 479.4.e.1.
// The real card path below uses Pit Rookie's canonical program
// (card.hash-e2638655ff5ed3a1e60a501be3c23d74e46ef7f1900bed31b436f1a579b316ed).

import assert from 'node:assert/strict';
import test from 'node:test';

import pitRookie from '../../../card-dsl/dist/cards/ogn/pit-rookie.js';
import buff from '../../dist/effects/instructions/effect.buff.js';
import { runInstruction, world } from '../../dist/effects/testing/index.js';
import { createLayerEngine } from '../../dist/layers/index.js';
import { fixture, settle } from '../rules/keywords/support.mjs';

const battlefield = { type: 'battlefield', id: 'buff-might-field' };
const permanent = effect => ({ effect, duration: { type: 'permanent' } });

const object = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: `test:${id}`,
  name: id,
  types: ['unit'],
  tags: [],
  keywords: [],
  owner: 'A',
  controller: 'A',
  zone: 'board',
  location: battlefield,
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

const equipment = (id, might, host) => object(id, {
  types: ['gear'],
  tags: ['Equipment'],
  might,
  attachedTo: host.ref,
});

test('RIFT-888 CR 703: a Buff raises effective Might and a matching Unit without one does not', () => {
  const kernel = world().player('A')
    .base('buffed', { might: 2, buffs: 1 })
    .base('plain', { might: 2 })
    .build();
  const layers = createLayerEngine(kernel.objects);

  assert.equal(layers.evaluate(kernel.ref('buffed')).might, 3);
  assert.equal(layers.evaluate(kernel.ref('plain')).might, 2);
  assert.equal(layers.evaluate(kernel.ref('buffed')).might, 3, 'cached repeated reads do not add the Buff twice');
  assert.equal(kernel.getObject('buffed').might, 2, 'the authoritative raw characteristic remains printed Might');
  assert.equal(kernel.getObject('buffed').buffs, 1, 'the counter remains a counter');
});

test('RIFT-888 CR 702.2.b: the real effect.buff primitive raises then immediately restores Might when spent', () => {
  const kernel = world().player('A').unit('unit', { might: 2, buffs: 0 }).build();
  const layers = createLayerEngine(kernel.objects);
  const target = () => ({ buffTarget: [kernel.ref('unit')] });
  const args = { mode: 'buff', target: 'buffTarget' };

  assert.equal(layers.evaluate(kernel.ref('unit')).might, 2);
  const added = runInstruction(buff, args, {
    world: kernel, targets: target(), controller: 'A', timingPoint: 'chain-item-resolve',
  });
  assert.equal(added.result.status, 'executed');
  assert.equal(kernel.getObject('unit').buffs, 1);
  layers.setObjects(kernel.objects);
  assert.equal(layers.evaluate(kernel.ref('unit')).might, 3);

  const spent = runInstruction(buff, { mode: 'spend', target: 'buffTarget' }, {
    world: kernel, targets: target(), controller: 'A', timingPoint: 'chain-item-resolve',
  });
  assert.equal(spent.result.status, 'executed');
  assert.equal(kernel.getObject('unit').buffs, 0);
  layers.setObjects(kernel.objects);
  assert.equal(layers.evaluate(kernel.ref('unit')).might, 2);

  const again = runInstruction(buff, { mode: 'spend', target: 'buffTarget' }, {
    world: kernel, targets: target(), controller: 'A', timingPoint: 'chain-item-resolve',
  });
  assert.equal(again.result.status, 'negated');
  assert.equal(again.result.reason, 'skipped');
  assert.equal(kernel.getObject('unit').buffs, 0);
  assert.equal(layers.evaluate(kernel.ref('unit')).might, 2);
});

test('RIFT-888 CR 478.4/703: Buff enters arithmetic, then Fiora-style Mighty checks re-run', () => {
  const fiora = object('fiora', { might: 4, buffs: 1 });
  const mighty = current => (current.might ?? 0) >= 5;
  const layers = createLayerEngine([fiora], [
    permanent({ id: 'deflect', layer: 'ability', filter: { objectId: 'fiora' },
      effect: { kind: 'grant-keyword', keyword: 'Deflect', condition: mighty } }),
    permanent({ id: 'ganking', layer: 'ability', filter: { objectId: 'fiora' },
      effect: { kind: 'grant-keyword', keyword: 'Ganking', condition: mighty } }),
    permanent({ id: 'shield', layer: 'ability', filter: { objectId: 'fiora' },
      effect: { kind: 'grant-keyword', keyword: 'Shield', condition: mighty } }),
  ]);
  const upgraded = layers.evaluate(fiora.ref);
  assert.equal(upgraded.might, 5);
  assert.deepEqual(upgraded.keywords.map(keyword => keyword.id), ['Deflect', 'Ganking', 'Shield']);

  layers.setObjects([{ ...fiora, buffs: 0 }]);
  const removed = layers.evaluate(fiora.ref);
  assert.equal(removed.might, 4);
  assert.deepEqual(removed.keywords, []);
});

test('RIFT-888 CR 479.4.e.1: Buff uses the established set/double ordering and contributes once', () => {
  const setUnit = object('set-unit', { might: 2, buffs: 1 });
  const setLayers = createLayerEngine([setUnit], [
    permanent({ id: 'set-five', layer: 'arithmetic', filter: { objectId: 'set-unit' },
      effect: { kind: 'set-might', value: 5 } }),
  ]);
  assert.equal(setLayers.evaluate(setUnit.ref).might, 6, '(2 + Buff 1), then set +5 is included');

  const doubleUnit = object('double-unit', { might: 2, buffs: 1 });
  const doubleLayers = createLayerEngine([doubleUnit], [
    permanent({ id: 'double', layer: 'arithmetic', filter: { objectId: 'double-unit' },
      effect: { kind: 'double', amount: 2 } }),
  ]);
  assert.equal(doubleLayers.evaluate(doubleUnit.ref).might, 5,
    'legacy non-additive double uses printing 2 first, then the intrinsic Buff increase is added once');
});

test('RIFT-888 published continuous.might set snapshots the pre-Buff current total and leaves Buff additive', () => {
  const unit = object('production-set', { might: 2, buffs: 1 });
  const layers = createLayerEngine([unit], [
    permanent({ id: 'production-set-five', layer: 'arithmetic', filter: { objectId: 'production-set' },
      effect: { kind: 'set-might', value: 5, snapshotDelta: 3 } }),
  ]);

  assert.equal(layers.evaluate(unit.ref).might, 6,
    'the production set snapshots 2 -> 5, then the intrinsic Buff increase applies once');
  assert.equal(unit.might, 2, 'the printed characteristic remains unchanged');
});

test('RIFT-888 CR 479.4.d/718.4: Buff and attached Equipment Might Bonus coexist once each', () => {
  const host = object('host', { might: 2, buffs: 1 });
  const gear = equipment('gear', 2, host);
  const layers = createLayerEngine([host, gear]);

  assert.equal(layers.evaluate(host.ref).might, 5, 'printed 2 + Buff 1 + Equipment 2');
  assert.equal(layers.evaluate(host.ref).might, 5, 'repeated layer reads remain stable');
  layers.setObjects([host, { ...gear, attachedTo: null }]);
  assert.equal(layers.evaluate(host.ref).might, 3, 'removing Equipment leaves the Buff contribution');
});

test('RIFT-888 CR 705/124.1: Buff contributes only to a Unit currently on the board', () => {
  const gone = object('gone', { might: 2, buffs: 1, zone: 'trash', location: null });
  const gear = object('gear', { types: ['gear'], might: null, buffs: 1 });
  const nullUnit = object('null-unit', { might: null, buffs: 1 });
  const layers = createLayerEngine([gone, gear, nullUnit]);

  assert.equal(layers.evaluate(gone.ref).might, 2, 'a non-board snapshot receives no Buff Might increase');
  assert.equal(layers.evaluate(gear.ref).might, null, 'a non-Unit has no Might to increase');
  assert.equal(layers.evaluate(nullUnit.ref).might, null, 'null printed Might remains null');
});

test('RIFT-888 derivedMight and public caching include Buff without losing current self reads', () => {
  const unit = object('unit', { might: 2, buffs: 1 });
  const observations = [];
  let layers;
  layers = createLayerEngine([unit], [], { derivedMight(snapshot) {
    const current = layers.evaluate(snapshot.ref);
    assert.notEqual(current, null, 'the current Unit remains readable during derivation');
    observations.push([snapshot.might, current.might]);
    return current.might;
  } });

  assert.equal(layers.evaluate(unit.ref).might, 3);
  assert.deepEqual(observations, [[3, 3]]);
  assert.equal(layers.evaluate(unit.ref).printed.might, 2, 'LKI retains printed Might rather than the derived total');
});

test('RIFT-888 real Pit Rookie adds one Buff to another friendly Unit and exposes the new effective Might', () => {
  const f = fixture({
    programs: [pitRookie],
    energy: { A: 2 },
    answers: { 'target:other-unit': ['ally'] },
    setup: w => w.player('A').player('B')
      .hand('pit', { cardId: pitRookie.canonicalCardId, types: ['unit'], might: 2, energy: 1, power: [] })
      .unit('ally', { might: 2 })
      .unit('enemy', { owner: 'B', controller: 'B', might: 2 }),
  });

  f.play('pit');
  settle(f.engine);
  assert.equal(f.get('ally').buffs, 1);
  assert.equal(f.snapshot('ally').might, 3, 'the real card-played trigger raises target Might through the layer engine');
  assert.equal(f.get('enemy').buffs, 0);
  assert.equal(f.get('enemy').might, 2);
  assert.deepEqual(f.errors, []);

  assert.equal(f.engine.commit({ type: 'spend-buff', object: f.ref('ally'), amount: 1 }).status, 'done');
  assert.equal(f.get('ally').buffs, 0);
  assert.equal(f.snapshot('ally').might, 2, 'spending the real counter removes the intrinsic +1 immediately');
});
