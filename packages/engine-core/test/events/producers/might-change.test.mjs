import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveMightChangedEmissions } from '../../../dist/events/producers/might-change.js';

const object = (id, might, types = ['unit']) => ({
  ref: { id, zoneEntryId: 1 }, cardId: id, name: id, types, tags: [], keywords: [], owner: 'A', controller: 'A',
  zone: 'board', location: { type: 'base', player: 'A' }, might, energy: null, power: null, exhausted: false,
  damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
});

test('might producer emits a layer delta and preserves null as null', () => {
  const events = deriveMightChangedEmissions([object('u', null)], [object('u', 0)], { cause: 'layer-recompute' });
  assert.equal(events.length, 1);
  assert.equal(events[0].timingPoint, 'might-changed');
  assert.deepEqual({ ...events[0].details, before: undefined, after: undefined }, {
    previousMight: null, currentMight: 0, cause: 'layer-recompute', before: undefined, after: undefined,
  });
  assert.equal(events[0].details.before.might, null);
  assert.equal(events[0].details.after.might, 0);
  assert.deepEqual(events[0].it.ref, { id: 'u', zoneEntryId: 1 });
  assert.deepEqual(events[0].details.before.ref, { id: 'u', zoneEntryId: 1 });
  assert.deepEqual(events[0].details.after.ref, { id: 'u', zoneEntryId: 1 });
});

test('might producer emits nothing for unchanged, non-unit, or new incarnations', () => {
  const unchanged = object('same', 2);
  const nonUnitBefore = object('card', 2, ['spell']);
  const nonUnitAfter = object('card', 3, ['spell']);
  const newIncarnation = { ...object('new', 4), ref: { id: 'new', zoneEntryId: 2 } };
  assert.deepEqual(deriveMightChangedEmissions(
    [unchanged, nonUnitBefore, object('new', 1)], [structuredClone(unchanged), nonUnitAfter, newIncarnation]
  ), []);
});

test('might producer identifies the affected Unit rather than the effect source or Fiora', () => {
  const fiora = object('fiora', 3);
  const source = object('effect-source', 2);
  const previous = object('affected', 4);
  const current = { ...previous, might: 5 };
  const [event] = deriveMightChangedEmissions([fiora, source, previous], [fiora, source, current], {
    source: fiora,
    batchId: 'layer-batch',
    effectController: 'A',
  });
  assert.deepEqual(event.object.ref, { id: 'affected', zoneEntryId: 1 });
  assert.deepEqual(event.it.ref, { id: 'affected', zoneEntryId: 1 });
  assert.deepEqual(event.source.ref, { id: 'fiora', zoneEntryId: 1 });
  assert.deepEqual(event.details.before.ref, event.it.ref);
  assert.deepEqual(event.details.after.ref, event.it.ref);
});

test('might producer preserves source LKI separately and never pairs snapshots across incarnations', () => {
  const source = object('effect-source', 2);
  const previous = object('affected', 3);
  const replacement = { ...object('affected', 6), ref: { id: 'affected', zoneEntryId: 2 } };
  assert.deepEqual(deriveMightChangedEmissions([source, previous], [source, replacement], { source }), []);
});
