// Scenario chain-pass-not-resolve-if-item-added (CR v1.5 339.1, 339.2, 338.1.b.1).
//
// 339.2: after a Pending item is added, the Execute/Pass loop restarts, so the
// consecutive-Pass count never carries over the added item. A pass given before
// the item was added cannot be combined with one given after it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, drawInstruction, stages } from './support.mjs';

test('chain-pass-not-resolve-if-item-added: the pass count restarts for a newly added item', () => {
  const f = chainFixture({
    energy: { A: 1, B: 1 },
    cards: [
      { id: 's1', owner: 'A', types: ['spell'], energy: 1, power: [] },
      { id: 's2', owner: 'B', types: ['spell'], energy: 1, power: [] },
    ],
  });

  f.engine.execute(f.spell('s1', [drawInstruction('d1')]));
  f.engine.pass('A');
  assert.equal(f.engine.items.length, 1, 'B has not passed yet');

  // B adds a Reaction instead of passing: the pass count resets with the new item.
  f.engine.execute(f.spell('s2', [drawInstruction('d2')], { controller: 'B', speed: 'reaction' }));
  assert.deepEqual(stages(f.engine), ['pending:s1', 'finalized:s1', 'pending:s2', 'finalized:s2']);
  assert.equal(f.kernel.player('A').handSize, 0, 'nothing resolved when the new item was added');
  assert.equal(f.engine.priority, 'B', 'the controller of the newest item holds Priority (340.4)');

  // B's pass alone is not a consecutive pair any more: the counter restarted.
  f.engine.pass('B');
  assert.equal(f.engine.items.length, 2, 'one pass after the added item does not resolve anything');
  assert.deepEqual(stages(f.engine).filter(stage => stage.startsWith('resolved')), []);

  // Only the second consecutive pass resolves an item, and only the newest one.
  f.engine.pass('A');
  assert.deepEqual(stages(f.engine).filter(stage => stage.startsWith('resolved')), ['resolved:s2']);
  assert.equal(f.kernel.player('B').handSize, 1, 'B drew from the Reaction that resolved');

  // 340.4: A controls the remaining item, so A and B pass again for s1.
  f.engine.pass('A');
  f.engine.pass('B');
  assert.deepEqual(
    stages(f.engine).filter(stage => stage.startsWith('resolved')),
    ['resolved:s2', 'resolved:s1'],
  );
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.kernel.player('A').handSize, 1, 'A drew from its own resolved spell');
  assert.equal(f.engine.turnState, 'neutral-open');
});
