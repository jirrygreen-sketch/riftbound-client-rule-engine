// RIFT-883 -- Equipment Might Bonus through the production layer engine.
// CR v1.5 137.1-137.3, 150.2, 435.1.d, 436.1.e, 718.4.
// Source: https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/
//   5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf (CR v1.5, 2026-10-09).
//
// Equipment currently carries its printed Might Bonus in ObjectSnapshot.might.
// These tests drive both the real Equip activation/attach primitive and a direct
// production LayerEngine so the bonus stays an effective-layer value. The raw
// kernel snapshot is asserted separately and remains unchanged.
//
// Production timeline for Long Sword (canonicalCardId
// card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010):
// card-played -> Quick-Draw target lock -> production Attach -> layer read ->
// production Detach -> next layer read. The remaining cases use snapshots from
// the same kernel adapter to isolate stacking, null, replacement, and layer rules.

import assert from 'node:assert/strict';
import test from 'node:test';

import longSword from '../../../card-dsl/dist/cards/sfd/long-sword.js';

// Long Sword is judge-required until Quick-Draw's Reaction speed is consumed by
// describePlay (RIFT-884); admit only its status metadata so the unchanged
// abilities drive this Might Bonus timeline.
const admittedLongSword = { ...longSword, status: 'executable', judgeReason: undefined };
import { createLayerEngine } from '../../dist/layers/index.js';
import { fixture, settle } from '../rules/keywords/support.mjs';

const battlefield = { type: 'battlefield', id: 'battlefield-1' };
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
const equipment = (id, might, host = null, values = {}) => object(id, {
  cardId: `test:${id}`,
  types: ['gear'],
  tags: ['Equipment'],
  might,
  attachedTo: host,
  ...values,
});
const ref = (value) => value.ref;

function engine(objects, effects = [], options = {}) {
  return createLayerEngine(objects, effects, options);
}

test('RIFT-883 CR 137.3/435.1.d: real Quick-Draw attachment adds and real Detach removes the bonus', () => {
  const f = fixture({
    programs: [admittedLongSword],
    energy: { A: 4 },
    answers: { 'target:quick-draw-unit': ['runner'] },
    setup: w => w.player('A').player('B')
      .hand('quick-draw-gear', { cardId: longSword.canonicalCardId, types: ['gear'], tags: ['Equipment'],
        might: 2, energy: 2, power: [], keywords: [] })
      .unit('runner', { might: 2 })
      .unit('enemy', { owner: 'B', controller: 'B', might: 2 }),
  });
  assert.equal(f.snapshot('runner').might, 2);
  f.play('quick-draw-gear');
  settle(f.engine);
  assert.deepEqual(f.get('quick-draw-gear').attachedTo, f.ref('runner'));
  assert.equal(f.snapshot('runner').might, 4, 'printed Might 2 + Long Sword Might Bonus 2');
  assert.equal(f.get('runner').might, 2, 'the raw authoritative Unit snapshot is unchanged');
  assert.equal(f.snapshot('quick-draw-gear').might, 2, 'the Gear keeps its own bonus characteristic');
  assert.deepEqual(f.snapshot('quick-draw-gear').types, ['gear'], 'Gear is not promoted to a combat Unit');
  assert.equal(f.engine.commit({ type: 'detach', object: f.ref('quick-draw-gear') }).status, 'done');
  assert.equal(f.get('quick-draw-gear').attachedTo, null);
  assert.equal(f.snapshot('runner').might, 2, 'the committed Detach stops the bonus on the next layer read');
});

test('RIFT-883 CR 435.1.d: attached Equipment bonuses stack and +0 contributes without failing', () => {
  const host = object('host', { might: 5 });
  const sword = equipment('sword', 3, ref(host));
  const blade = equipment('blade', 2, ref(host));
  const zero = equipment('zero', 0, ref(host));
  const heron = equipment('heron', 1, ref(host));
  const armor = equipment('armor', 1, ref(host));
  const result = engine([host, sword, blade, zero, heron, armor]).evaluate(host.ref);
  assert.equal(result.might, 12, 'Base 5 + 3 + 2 + 0 + 1 + 1');
  assert.equal(result.types.includes('unit'), true);
  assert.equal(engine([sword]).evaluate(sword.ref).might, 3, 'Gear remains a Gear');
  assert.equal(engine([sword]).evaluate(sword.ref).types.includes('unit'), false);
});

test('RIFT-883 CR 137.3.a/436.1.e: detach and leaving the current attachment graph stop the bonus at once', () => {
  const host = object('host', { might: 2 });
  const gear = equipment('gear', 2, ref(host));
  const layers = engine([host, gear]);
  assert.equal(layers.evaluate(host.ref).might, 4);
  assert.equal(layers.evaluate(host.ref).might, 4, 'cached repeated reads remain stable');

  layers.setObjects([host, { ...gear, attachedTo: null }]);
  assert.equal(layers.evaluate(host.ref).might, 2, 'detach immediately invalidates the cached result');
  assert.equal(layers.evaluate(gear.ref).might, 2, 'the detached Gear keeps its own printed bonus');

  layers.setObjects([host, { ...gear, attachedTo: ref(host), zone: 'trash', location: null }]);
  assert.equal(layers.evaluate(host.ref).might, 2, 'a departing Gear cannot continue modulating from Trash');

  layers.setObjects([host, { ...gear, ref: { id: 'gear', zoneEntryId: 2 }, attachedTo: { id: 'old-host', zoneEntryId: 1 } }]);
  assert.equal(layers.evaluate(host.ref).might, 2, 'a stale host identity does not modulate this Unit');
});

test('RIFT-883 CR 137.3.b: null host Might ignores bonuses; unattached Equipment never changes another Unit', () => {
  const nullHost = object('null-host', { might: null, types: ['unit'] });
  const gear = equipment('gear', 3, ref(nullHost));
  assert.equal(engine([nullHost, gear]).evaluate(nullHost.ref).might, null,
    'a null host characteristic stays null rather than becoming zero');

  const unit = object('unit', { might: 2 });
  assert.equal(engine([unit, equipment('loose', 3)]).evaluate(unit.ref).might, 2);
});

test('RIFT-883 CR 143.5/435.1.h.2: an attached Gear that becomes a Unit detaches and stops granting Might', () => {
  const host = object('host', { might: 2 });
  const gear = equipment('gear', 2, ref(host));
  const layers = engine([host, gear], [permanent({
    id: 'become-unit', layer: 'trait', filter: { objectId: 'gear' }, effect: { kind: 'add-type', type: 'unit' },
  })]);
  const result = layers.evaluate(host.ref);
  assert.equal(result.might, 2, 'the attachment ended as the non-Unit Gear became a Unit');
  assert.equal(layers.evaluate(gear.ref).attachedTo, null);
  assert.deepEqual(layers.evaluate(gear.ref).types, ['gear', 'unit']);
});

test('RIFT-883 arithmetic layering and LKI: bonuses participate in effective Might, not raw snapshots', () => {
  const host = object('host', { might: 2 });
  const gear = equipment('gear', 3, ref(host));
  const layers = engine([host, gear], [
    permanent({ id: 'set-to-five', layer: 'arithmetic', filter: { objectId: 'host' },
      effect: { kind: 'set-might', value: 5 } }),
    permanent({ id: 'increase', layer: 'arithmetic', filter: { objectId: 'host' },
      effect: { kind: 'increase', amount: 1 } }),
  ]);
  const result = layers.evaluate(host.ref);
  assert.equal(result.might, 9, 'the arithmetic effects and Equipment bonus both contribute once');
  assert.equal(result.printed.might, 2, 'printed/base Might remains available for LKI and replay');
  assert.equal(layers.evaluate(host.ref).might, 9, 'repeated evaluation does not double-apply the bonus');
  assert.equal(host.might, 2, 'raw snapshot remains authoritative input');
});

test('RIFT-883 CR 482: bonus starts with the attachment and refreshes after re-attachment to another host', () => {
  const first = object('first', { might: 2 });
  const second = object('second', { might: 4 });
  const gear = equipment('gear', 2, ref(first));
  const layers = engine([first, second, gear]);
  assert.deepEqual([layers.evaluate(first.ref).might, layers.evaluate(second.ref).might], [4, 4]);
  layers.setObjects([first, second, { ...gear, attachedTo: ref(second) }]);
  assert.deepEqual([layers.evaluate(first.ref).might, layers.evaluate(second.ref).might], [2, 6]);
});

