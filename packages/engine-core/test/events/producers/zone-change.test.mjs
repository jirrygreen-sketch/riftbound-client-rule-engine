import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveZoneChangeEmissions } from '../../../dist/events/producers/zone-change.js';

const object = (id, zone, zoneEntryId = 1, location = null) => ({
  ref: { id, zoneEntryId }, cardId: id, name: id, types: ['unit'], tags: [], keywords: [], owner: 'A', controller: 'A',
  zone, location, might: 2, energy: null, power: null, exhausted: false, damage: 0, stunned: false, buffs: 0,
  attachedTo: null, faceDown: false, isToken: false
});

test('zone producer emits generic and destination aliases for a committed move', () => {
  const before = [object('u', 'hand')];
  const after = [object('u', 'board', 2, { type: 'battlefield', id: 'bf1' })];
  const events = deriveZoneChangeEmissions(before, after, { player: 'A', cause: 'play' });
  assert.deepEqual(events.map(event => event.timingPoint), [
    'object-leaves-zone', 'object-leaves-hand', 'object-enters-zone', 'object-enters-board', 'object-enters-battlefield'
  ]);
  assert.equal(events[0].object.zone, 'hand');
  assert.equal(events.at(-1).object.location.id, 'bf1');
  assert.equal(events.at(-1).details.cause, 'play');
});

test('zone producer emits nothing when the same incarnation remains in place', () => {
  const snapshot = object('u', 'board', 3, { type: 'base', player: 'A' });
  assert.deepEqual(deriveZoneChangeEmissions([snapshot], [structuredClone(snapshot)]), []);
});
