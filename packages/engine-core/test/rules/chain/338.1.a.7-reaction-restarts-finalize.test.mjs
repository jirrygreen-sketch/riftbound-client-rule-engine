// Scenario chain-reaction-added-restarts-finalize (CR v1.5 338.1.a.7, 340.3).
//
// A Reaction played by the responding player joins the Chain as a new Pending
// item; the FEPR loop returns to Step 1 and Finalizes it before anything resolves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, drawInstruction, stages, resolveAll } from './support.mjs';

test('chain-reaction-added-restarts-finalize: a new Pending item is Finalized before resolution', () => {
  const f = chainFixture({
    energy: { A: 1, B: 1 },
    cards: [
      { id: 's1', types: ['spell'], energy: 1, power: [] },
      { id: 's2', owner: 'B', types: ['spell'], energy: 1, power: [] },
    ],
  });

  f.engine.execute(f.spell('s1', [drawInstruction('d1')]));
  f.engine.pass('A');
  f.engine.execute(f.spell('s2', [drawInstruction('d2')], { controller: 'B', speed: 'reaction' }));

  // 338.1.a.7: B's Reaction is Finalized immediately while the older item waits.
  assert.deepEqual(stages(f.engine), ['pending:s1', 'finalized:s1', 'pending:s2', 'finalized:s2']);
  assert.deepEqual(f.engine.items.map(item => item.id + ':' + item.status), ['s1:finalized', 's2:finalized']);
  assert.equal(f.kernel.player('A').handSize, 0, 'nothing resolved while a Pending item existed');

  resolveAll(f.engine);

  // 340.3: s2 resolves first; the FEPR then resolves the remaining Finalized item s1.
  assert.deepEqual(
    stages(f.engine).filter(stage => stage.startsWith('resolved')),
    ['resolved:s2', 'resolved:s1'],
  );
  assert.equal(f.kernel.player('A').handSize, 1);
  assert.equal(f.kernel.player('B').handSize, 1);
  assert.deepEqual(f.kernel.objectsInZone('A', 'trash').map(ref => ref.id), ['s1']);
  assert.deepEqual(f.kernel.objectsInZone('B', 'trash').map(ref => ref.id), ['s2']);
  assert.equal(f.engine.turnState, 'neutral-open');
});
