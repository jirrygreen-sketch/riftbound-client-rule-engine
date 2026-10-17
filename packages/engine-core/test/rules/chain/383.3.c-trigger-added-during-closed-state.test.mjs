// Scenario chain-trigger-added-during-closed-state (CR v1.5 383.3.c, 331.1).
//
// A Triggered Ability may be put on the Chain during a Closed State (383.3.c)
// without Priority or Reaction; it waits on the Chain until the FEPR reaches it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, addEnergyInstruction, damageInstruction, registerTrigger, resolveAll, timings } from './support.mjs';

test('chain-trigger-added-during-closed-state: a Triggered Ability enters the Closed Chain without Priority', () => {
  const f = chainFixture({
    energy: { A: 1, B: 0 },
    cards: [{ id: 's1', owner: 'A', types: ['spell'], energy: 1, power: [] }],
    board: builder => builder.unit('a1', { owner: 'A', might: 4, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  // "When a unit takes damage, add [1]" - controlled by B, not by the turn player.
  registerTrigger(f.engine, f.kernel, {
    id: 'b1-watch', source: 'a1', controller: 'B', spec: { at: 'damage-dealt', filter: {} },
    body: [addEnergyInstruction('add', 'B', 1)],
  });

  f.engine.execute(f.spell('s1', [damageInstruction('hit', 1, 'a1')]));
  assert.equal(f.engine.turnState, 'neutral-closed', '331.1: a Chain exists, so the State is Closed');

  // 383.3.c: the damage Triggered B's ability. It goes on the Chain as Pending
  // without B ever holding Priority for it.
  resolveAll(f.engine);
  assert.equal(f.kernel.player('B').energy, 1);
  assert.equal(f.kernel.getObject('a1').damage, 1);
  assert.equal(f.engine.turnState, 'neutral-open');
  const order = timings(f.engine).filter(id => id.startsWith('chain-item'));
  assert.deepEqual(order, [
    'chain-item-pending', 'chain-item-finalize',
    'chain-item-pending', 'chain-item-resolve',
    'chain-item-finalize', 'chain-item-resolve',
  ], 'the trigger joined the Chain behind the resolving spell and resolved after it');
});
