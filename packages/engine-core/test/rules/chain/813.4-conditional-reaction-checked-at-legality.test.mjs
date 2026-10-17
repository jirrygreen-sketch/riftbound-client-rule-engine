// Scenario chain-conditional-reaction-checked-at-legality (CR v1.5 813.4, 813.4.b, 358.4).
//
// A card that gains Reaction under a condition can be played in a Closed State
// while that condition holds (813.4); the timing permission is verified at
// Check Legality (358.4). The chain-item case is chain-conditional-reaction-lost-before-legality.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, drawInstruction, stages, resolveAll } from './support.mjs';

test('chain-conditional-reaction-checked-at-legality: a conditional Reaction is admitted while its condition holds', () => {
  const f = chainFixture({
    energy: { A: 0, B: 1 },
    cards: [
      { id: 's1', owner: 'A', types: ['spell'], energy: 0, power: [] },
      { id: 's2', owner: 'B', types: ['spell'], energy: 1, power: [] },
    ],
    board: builder => builder.unit('a1', { owner: 'A', might: 4, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });

  f.engine.execute(f.spell('s1', [drawInstruction('d1')]));
  f.engine.pass('A');
  assert.equal(f.engine.canAct('B', 'reaction'), true);

  // The conditional Reaction is admitted; Finalize witnesses the timing permission.
  f.engine.execute(f.spell('s2', [drawInstruction('d2')], {
    controller: 'B', speed: 'normal', conditionalReaction: { kind: 'always' },
  }));
  assert.deepEqual(stages(f.engine), ['pending:s1', 'finalized:s1', 'pending:s2', 'finalized:s2']);
  resolveAll(f.engine);
  assert.equal(f.kernel.player('B').handSize, 1);
  assert.deepEqual(f.kernel.objectsInZone('B', 'trash').map(ref => ref.id), ['s2']);
});
