// Scenario: movement-no-double-contested (CR v1.5 190.3.a.1, 190.3.b)
// The scene's `contestedBy` assertion is marked UNCERTAIN in the spec; the frozen
// engine exposes it on CombatFlow, so the reinforcement case is asserted directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, moveInstruction, resolveChainOnly, settle, timings } from './support.mjs';

test('movement-no-double-contested: an already Contested Battlefield is not contested again and keeps its Contested player', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }).base('u2', { owner: 'B', might: 2 }).hand('rx', { owner: 'B', types: ['spell'] }),
  });
  f.flow.start();
  f.flow.execute(f.activated('first', [moveInstruction('first', 'u1', { type: 'battlefield', id: 'bf1' })]));
  settle(f.flow);
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.equal(f.flow.battlefields[0].contestedBy, 'A');
  const applied = timings(f.flow).filter(timingPoint => timingPoint === 'contested-applied').length;

  // B reinforces with a Reaction while holding Focus; 190.3.a.1 requires the
  // Battlefield not to be Contested already, so the Contested player must not change.
  f.flow.pass('A');
  f.flow.execute(f.reaction('rx', [moveInstruction('reinforce', 'u2', { type: 'battlefield', id: 'bf1' })]));
  resolveChainOnly(f.flow);

  assert.deepEqual(f.kernel.getObject('u2').location, { type: 'battlefield', id: 'bf1' });
  assert.equal(timings(f.flow).filter(timingPoint => timingPoint === 'contested-applied').length, applied);
  assert.equal(f.flow.battlefields[0].contestedBy, 'A');
  // 316.8.b.1.a / 323.13 would convert an ongoing non-combat Showdown in the next
  // Cleanup; that conversion is a separate mechanism, so the stage itself is unchanged.
  assert.equal(f.flow.battlefields[0].staged, 'showdown');
});
