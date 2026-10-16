// Scenario: movement-deploy-gear-not-recalled-in-cleanup (CR v1.5 830.1.b.3, 323.6)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, settle } from './support.mjs';

test('movement-deploy-gear-not-recalled-in-cleanup: a Deploy Gear at a Battlefield survives the Cleanup that follows an unrelated Move', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }),
  });
  f.kernel.addObject({
    ref: { id: 'g1', zoneEntryId: 1 }, cardId: 'card:g1', name: 'g1', types: ['gear'], tags: [],
    keywords: [{ id: 'Deploy' }], owner: 'A', controller: 'A', zone: 'board',
    location: { type: 'battlefield', id: 'bf1' }, might: null, energy: 1, power: [], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  }, 'board');
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'battlefield', id: 'bf2' })]));
  settle(f.flow);

  assert.ok(eventsOf(f.flow, 'cleanup-start').length >= 1);
  assert.deepEqual(f.kernel.getObject('g1').location, { type: 'battlefield', id: 'bf1' });
  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'battlefield', id: 'bf2' });
  assert.equal(eventsOf(f.flow, 'object-moved').filter(event => event.object.ref.id === 'g1').length, 0);
});
