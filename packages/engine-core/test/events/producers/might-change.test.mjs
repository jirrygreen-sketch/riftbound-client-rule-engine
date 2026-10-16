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
  assert.deepEqual(events[0].details, { previousMight: null, currentMight: 0, cause: 'layer-recompute' });
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
