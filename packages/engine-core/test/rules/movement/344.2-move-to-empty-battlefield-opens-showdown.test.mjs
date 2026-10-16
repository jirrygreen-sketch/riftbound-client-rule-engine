// Scenario: movement-move-to-empty-battlefield-opens-noncombat-showdown
// (CR v1.5 344.2, 323.11, 453, 345)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, settle, timings } from './support.mjs';

test('movement-move-to-empty-battlefield-opens-noncombat-showdown: Contested in Cleanup stages then opens a Non-Combat Showdown for the Contested player', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }),
  });
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'battlefield', id: 'bf1' })]));
  settle(f.flow);

  const events = timings(f.flow);
  const applied = events.indexOf('contested-applied');
  const opened = events.indexOf('showdown-open');
  assert.ok(events.indexOf('object-moved') < applied);
  // 453/323.11: the Showdown only opens in a later Cleanup, after the Contested status was applied.
  assert.ok(applied < events.lastIndexOf('cleanup-start', opened));
  assert.ok(events.lastIndexOf('cleanup-start', opened) < opened);
  assert.equal(eventsOf(f.flow, 'showdown-open').length, 1);
  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'battlefield', id: 'bf1' });
  assert.equal(f.flow.battlefields[0].staged, 'showdown');
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.equal(f.flow.chain.focus, 'A', '345: the player who applied Contested gains Focus');
  assert.equal(f.flow.chain.priority, 'A');
});
