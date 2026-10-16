// Scenario: movement-effect-move-between-battlefields-allowed (CR v1.5 451, 451.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, settle } from './support.mjs';

test('movement-effect-move-between-battlefields-allowed: effect Destination legality is not the Standard Move restriction', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: 'A' }],
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' } })
      .unit('u2', { location: { type: 'battlefield', id: 'bf2' } }),
  });
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'battlefield', id: 'bf2' })]));
  settle(f.flow);

  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'battlefield', id: 'bf2' });
  assert.equal(eventsOf(f.flow, 'object-moved').length, 1);
  assert.deepEqual(f.kernel.query({ zone: 'board', location: { type: 'battlefield', id: 'bf1' } }), []);
  assert.deepEqual(f.kernel.query({ zone: 'board', location: { type: 'battlefield', id: 'bf2' } }).map(object => object.ref.id).sort(), ['u1', 'u2']);
});
