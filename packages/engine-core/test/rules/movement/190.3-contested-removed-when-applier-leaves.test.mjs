// Scenario: movement-contested-removed-when-applier-leaves (CR v1.5 190.3.b.1, 323.10)
// The engine exposes no dedicated contested-removed timing point yet and CombatFlow's
// 323.10 pass is silent, so the state assertions the merged layer does own are executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, settle, timings } from './support.mjs';

test('movement-contested-removed-when-applier-leaves: Contested clears when its applier controls no Units there', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }).unit('v1', { owner: 'B', might: 3, location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();
  f.flow.execute(f.activated('in-and-out', [
    moveInstruction('in', 'u1', { type: 'battlefield', id: 'bf1' }),
    moveInstruction('out', 'u1', { type: 'base', player: 'A' }),
  ]));
  settle(f.flow);

  assert.equal(eventsOf(f.flow, 'contested-applied').length, 1, 'the entry still applied Contested (190.3.a.1 / 452)');
  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'object-moved').length, 2);
  assert.equal(f.flow.battlefields[0].contestedBy, null, '190.3.b.1: the applier controls no Units there');
  assert.equal(f.flow.battlefields[0].staged, 'none');
  assert.equal(f.flow.battlefields[0].controller, 'B', 'the existing controller is unaffected');
  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'base', player: 'A' });
});
