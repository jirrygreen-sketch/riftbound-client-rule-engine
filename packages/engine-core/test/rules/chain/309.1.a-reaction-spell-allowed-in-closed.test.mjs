// Scenario chain-reaction-spell-allowed-in-closed (CR v1.5 309.1.a, 338.1.a.2).
//
// A Reaction spell can be played in a Closed State; its only legal Chain-Item
// targets are Finalized items.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, counterInstruction, drawInstruction, stages, resolveAll } from './support.mjs';

test('chain-reaction-spell-allowed-in-closed: a Reaction spell plays normally into a Closed State', () => {
  const f = chainFixture({
    energy: { A: 2, B: 1 },
    cards: [
      { id: 's1', owner: 'A', types: ['spell'], energy: 1, power: [] },
      { id: 's2', owner: 'B', types: ['spell'], energy: 1, power: [] },
    ],
  });

  f.engine.execute(f.spell('s1', [drawInstruction('d1')]));
  assert.equal(f.engine.turnState, 'neutral-closed');

  // 312.2.d: A passes, then B may respond with a Reaction (309.1.a).
  f.engine.pass('A');
  const item = f.engine.items[0];
  assert.equal(item.status, 'finalized');
  f.engine.execute(f.spell('s2', [counterInstruction('cnt', item.object.id)], { controller: 'B', speed: 'reaction' }));
  assert.deepEqual(f.engine.items.map(entry => entry.id + ':' + entry.status), ['s1:finalized', 's2:finalized']);
  resolveAll(f.engine);

  // 426.1.a: the countered spell went to its owner's Trash without resolving.
  assert.deepEqual(stages(f.engine).slice(0, 5), [
    'pending:s1', 'finalized:s1', 'pending:s2', 'finalized:s2', 'removed:s1(countered)',
  ]);
  assert.deepEqual(f.kernel.objectsInZone('A', 'trash').map(ref => ref.id), ['s1']);
  assert.deepEqual(f.kernel.objectsInZone('B', 'trash').map(ref => ref.id), ['s2']);
  assert.equal(f.kernel.player('A').handSize, 0, 's1 never resolved its draw');
});
