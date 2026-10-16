// Scenario: movement-conquer-only-once-per-battlefield-per-turn (CR v1.5 472, 471.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, settle } from './support.mjs';

test('movement-conquer-only-once-per-battlefield-per-turn: re-establishing Control on the same turn scores no second point', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }),
  });
  f.flow.start();
  f.flow.execute(f.activated('enter', [moveInstruction('enter', 'u1', { type: 'battlefield', id: 'bf1' })]));
  settle(f.flow);
  f.flow.pass('A');
  f.flow.pass('B');
  assert.equal(f.flow.battlefields[0].controller, 'A');
  assert.equal(f.kernel.player('A').score, 1);
  assert.equal(eventsOf(f.flow, 'conquer').length, 1);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);

  f.flow.execute(f.activated('leave', [moveInstruction('leave', 'u1', { type: 'base', player: 'A' })]));
  settle(f.flow);
  assert.equal(f.flow.battlefields[0].controller, null);

  f.flow.execute(f.activated('re-enter', [moveInstruction('re-enter', 'u1', { type: 'battlefield', id: 'bf1' })]));
  settle(f.flow);
  f.flow.pass('A');
  f.flow.pass('B');

  assert.equal(f.flow.battlefields[0].controller, 'A', 'Control is still re-established');
  assert.equal(eventsOf(f.flow, 'conquer').length, 1, '472: already scored this Battlefield this turn');
  assert.equal(eventsOf(f.flow, 'score').length, 1);
  assert.equal(f.kernel.player('A').score, 1);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
});
