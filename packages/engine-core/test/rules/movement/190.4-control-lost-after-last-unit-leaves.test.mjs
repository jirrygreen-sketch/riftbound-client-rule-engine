// Scenario: movement-control-lost-after-last-unit-leaves (CR v1.5 190.4.c, 323.5)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, settle, timings } from './support.mjs';

test('movement-control-lost-after-last-unit-leaves: the last Unit leaving in an Open state loses Control in the following Cleanup', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'base', player: 'A' })]));
  settle(f.flow);

  const events = timings(f.flow);
  assert.ok(events.indexOf('object-moved') >= 0);
  const cleanup = events.indexOf('cleanup-start');
  const lost = events.indexOf('control-lost');
  assert.ok(cleanup >= 0 && lost > cleanup, 'Control is lost during Cleanup step 4, not during the Move');
  assert.equal(eventsOf(f.flow, 'control-lost').length, 1);
  assert.equal(eventsOf(f.flow, 'control-lost')[0].player, 'A');
  assert.equal(eventsOf(f.flow, 'control-lost')[0].details.battlefieldId, 'bf1');
  assert.equal(f.flow.battlefields[0].controller, null);
  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'base', player: 'A' });
});
