// Scenario chain-priority-after-resolve-newest-controller (CR v1.5 340.4, 340.2).
//
// 340.4: when an item resolves but does not empty the Chain and no item is
// Pending, the controller of the newest remaining item receives Priority.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, drawInstruction, stages } from './support.mjs';

test('chain-priority-after-resolve-newest-controller: Priority returns to the newest item controller', () => {
  const f = chainFixture({
    energy: { A: 1, B: 1 },
    cards: [
      { id: 's1', owner: 'A', types: ['spell'], energy: 1, power: [] },
      { id: 's2', owner: 'B', types: ['spell'], energy: 1, power: [] },
    ],
  });

  f.engine.execute(f.spell('s1', [drawInstruction('d1')]));
  f.engine.pass('A');
  f.engine.execute(f.spell('s2', [drawInstruction('d2')], { controller: 'B', speed: 'reaction' }));
  f.engine.pass('B');
  f.engine.pass('A');

  // s2 resolved; s1 remains and its controller A holds Priority again (340.4).
  assert.deepEqual(f.engine.items.map(item => item.id), ['s1']);
  assert.equal(f.engine.priority, 'A');
  assert.deepEqual(
    f.engine.trace.filter(event => ['resolved', 'priority-granted'].includes(event.step)).map(event => event.step + (event.item ? ':' + event.item : '') + (event.player ? ':' + event.player : '')),
    ['priority-granted:A', 'priority-granted:A', 'priority-granted:B', 'priority-granted:B', 'priority-granted:A', 'resolved:s2', 'priority-granted:A'],
  );
  assert.equal(f.engine.turnState, 'neutral-closed', 'the Chain is not empty yet');
  assert.equal(f.kernel.player('B').handSize, 1, 's2 resolved its draw');
  assert.equal(f.kernel.player('A').handSize, 0, 's1 has not resolved yet');

  // A and B pass again to resolve the remaining item (340.2: the Chain then empties).
  f.engine.pass('A');
  f.engine.pass('B');
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.turnState, 'neutral-open');
  assert.deepEqual(
    stages(f.engine).filter(stage => stage.startsWith('resolved')),
    ['resolved:s2', 'resolved:s1'],
  );
});
