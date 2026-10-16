// Scenario: movement-control-kept-while-units-present (CR v1.5 190.4.a, 323.5)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, moveInstruction, settle, timings } from './support.mjs';

test('movement-control-kept-while-units-present: a controller with units still at the Battlefield keeps Control through Cleanup', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }).unit('u2', { location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'battlefield', id: 'bf2' })]));
  settle(f.flow);

  // The Move completed, so 455 required a Cleanup; 323.5 only takes Control of
  // Battlefields without the controller's Units, and u2 is still at bf1.
  assert.ok(timings(f.flow).includes('cleanup-start'));
  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'control-lost').length, 0);
  assert.equal(f.flow.battlefields[0].controller, 'A');
  assert.equal(f.flow.battlefields[1].controller, null);
  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'battlefield', id: 'bf2' });
});
