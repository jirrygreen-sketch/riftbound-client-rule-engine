// Scenario: movement-staged-combat-canceled-when-opponent-units-gone (CR v1.5 323.9, 463.2)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, settle, timings } from './support.mjs';

test('movement-staged-combat-canceled-when-opponent-units-gone: losing one side before it opens turns the staged Combat back into a Showdown', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 3 }).unit('v1', { owner: 'B', might: 2, location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();
  f.flow.execute(f.activated('in-and-out', [
    moveInstruction('in', 'u1', { type: 'battlefield', id: 'bf1' }),
    moveInstruction('out', 'v1', { type: 'base', player: 'B' }),
  ]));
  settle(f.flow);

  assert.equal(eventsOf(f.flow, 'object-moved').length, 2);
  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'battlefield', id: 'bf1' });
  assert.deepEqual(f.kernel.getObject('v1').location, { type: 'base', player: 'B' });
  assert.equal(eventsOf(f.flow, 'contested-applied').length, 1);
  assert.equal(f.flow.battlefields[0].contestedBy, 'A', 'the applier still holds the Battlefield');
  assert.equal(
    timings(f.flow).filter(timingPoint => timingPoint === 'combat-start').length,
    0,
    '323.9: no Combat opens once the opposing side is gone',
  );
  assert.equal(eventsOf(f.flow, 'showdown-open').length, 1, '323.11 opens a Non-Combat Showdown instead');
  assert.equal(f.flow.chain.focus, 'A');
});
