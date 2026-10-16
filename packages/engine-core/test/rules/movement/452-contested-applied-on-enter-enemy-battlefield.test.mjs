// Scenario: movement-contested-applied-on-enter-enemy-battlefield (CR v1.5 190.3.a, 190.3.a.1, 452)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, resolveChainOnly, timings } from './support.mjs';

test('movement-contested-applied-on-enter-enemy-battlefield: entering a Battlefield its controller does not control applies Contested', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }).unit('v1', { owner: 'B', might: 3, location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'battlefield', id: 'bf1' })]));
  // Resolve through the real pass path but stop before opening the staged Combat
  // (the atomic Combat start is a separate, still-blocked contract).
  resolveChainOnly(f.flow);

  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'battlefield', id: 'bf1' });
  const events = timings(f.flow);
  assert.ok(events.indexOf('object-moved') < events.indexOf('contested-applied'));
  assert.equal(eventsOf(f.flow, 'contested-applied').length, 1);
  assert.deepEqual(eventsOf(f.flow, 'contested-applied')[0].details, { battlefieldId: 'bf1' });
  assert.equal(f.flow.battlefields[0].contestedBy, 'A');
  assert.equal(f.flow.battlefields[0].staged, 'combat', '323.8 stages the Combat for the next Open Cleanup step');
  assert.equal(events.includes('combat-start'), false);
});
