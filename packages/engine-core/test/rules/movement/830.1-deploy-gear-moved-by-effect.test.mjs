// Scenario: movement-deploy-gear-moved-by-effect (CR v1.5 830.1.b.2)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, settle } from './support.mjs';

test('movement-deploy-gear-moved-by-effect: an effect that names Gear may Move a Deploy Gear to another Battlefield', () => {
  const f = fixture({ fields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }] });
  f.kernel.addObject({
    ref: { id: 'g1', zoneEntryId: 1 }, cardId: 'card:g1', name: 'g1', types: ['gear'], tags: [],
    keywords: [{ id: 'Deploy' }], owner: 'A', controller: 'A', zone: 'board',
    location: { type: 'battlefield', id: 'bf1' }, might: null, energy: 1, power: [], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  }, 'board');
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'g1', { type: 'battlefield', id: 'bf2' })]));
  settle(f.flow);

  assert.deepEqual(f.kernel.getObject('g1').location, { type: 'battlefield', id: 'bf2' });
  assert.equal(eventsOf(f.flow, 'object-moved').length, 1, '830.1.b.2: a real Move, not a Recall');
  assert.equal(f.kernel.query({ zone: 'board', location: { type: 'battlefield', id: 'bf1' } }).length, 0);
  assert.deepEqual(f.kernel.query({ zone: 'board', location: { type: 'battlefield', id: 'bf2' } }).map(object => object.ref.id), ['g1']);
});
