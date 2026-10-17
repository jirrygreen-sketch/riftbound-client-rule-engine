// Scenario chain-focus-passes-after-showdown-chain (CR v1.5 346, 340.2.a, 347.1.b).
//
// When a Chain that was opened by playing a card closes during a Showdown, Focus
// passes to the next player in Turn Order and that player receives Priority.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, damageInstruction, resolveAll } from './support.mjs';

test('chain-focus-passes-after-showdown-chain: Focus moves to the next player when the Chain closes', () => {
  const f = chainFixture({
    energy: { A: 1 },
    cards: [{ id: 's1', owner: 'A', types: ['spell'], energy: 1, power: [] }],
    board: builder => builder.unit('b1', { owner: 'B', might: 3, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.engine.openShowdown('A');
  assert.equal(f.engine.focus, 'A');
  assert.equal(f.engine.turnState, 'showdown-open');

  f.engine.execute(f.spell('s1', [damageInstruction('hit', 2, 'b1')], { speed: 'action' }));
  assert.equal(f.engine.turnState, 'showdown-closed');
  resolveAll(f.engine);

  // 340.2.a / 346: back to the Showdown Open State with Focus passed in Turn Order.
  assert.equal(f.engine.turnState, 'showdown-open');
  assert.equal(f.engine.focus, 'B');
  assert.equal(f.engine.priority, 'B');
  assert.equal(f.kernel.getObject('b1').damage, 2);
});
