// Scenario: movement-conquer-after-noncombat-showdown (CR v1.5 348.2.a, 348.2.a.1, 471.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, settle, timings } from './support.mjs';

test('movement-conquer-after-noncombat-showdown: closing a Non-Combat Showdown establishes Control and Conquers', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }),
  });
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'battlefield', id: 'bf1' })]));
  settle(f.flow);
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.equal(f.flow.chain.focus, 'A');

  f.flow.pass('A');
  f.flow.pass('B');

  const events = timings(f.flow);
  const opened = events.indexOf('showdown-open');
  const closed = events.indexOf('showdown-close');
  const established = events.indexOf('control-established');
  const conquer = events.indexOf('conquer');
  const score = events.indexOf('score');
  assert.ok(opened < closed && closed < established && established < conquer && conquer < score);
  assert.equal(eventsOf(f.flow, 'control-established')[0].details.battlefieldId, 'bf1');
  assert.equal(eventsOf(f.flow, 'conquer')[0].player, 'A');
  assert.equal(f.flow.battlefields[0].controller, 'A');
  assert.equal(f.flow.battlefields[0].contestedBy, null);
  assert.equal(f.flow.chain.focus, null);
  assert.equal(f.kernel.player('A').score, 1);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
});
