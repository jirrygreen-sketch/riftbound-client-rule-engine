// Scenario: movement-effect-move-does-not-exhaust (CR v1.5 144.2, 451)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, settle } from './support.mjs';

test('movement-effect-move-does-not-exhaust: Exhaust is the Standard Move cost and never part of a Move effect', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'battlefield', id: 'bf2' })]));
  settle(f.flow);

  assert.equal(eventsOf(f.flow, 'object-moved').length, 1);
  assert.equal(
    eventsOf(f.flow, 'object-exhausted').filter(event => event.object.ref.id === 'u1').length,
    0,
    'no Exhaust timing point may be emitted for the moved Unit',
  );
  assert.equal(f.kernel.getObject('u1').exhausted, false);
});
