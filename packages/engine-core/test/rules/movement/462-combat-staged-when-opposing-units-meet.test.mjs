// Scenario: movement-move-onto-enemy-occupied-stages-combat
// (CR v1.5 323.8, 462, 454, 466.2.c.1)
// The scene's combat.attack-declared assertion needs the atomic Combat start, which is
// not merged; the four assertions that the merged layers do own (Move, Contested,
// Cleanup, staged Combat) are executed for real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOf, fixture, moveInstruction, resolveChainOnly, timings } from './support.mjs';

test('movement-move-onto-enemy-occupied-stages-combat: opposing Units present stage a Combat in Cleanup step 7', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 3 }).unit('v1', { owner: 'B', might: 2, location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'battlefield', id: 'bf1' })]));
  resolveChainOnly(f.flow);

  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'battlefield', id: 'bf1' });
  assert.equal(eventsOf(f.flow, 'contested-applied').length, 1);
  assert.equal(eventsOf(f.flow, 'contested-applied')[0].player, 'A', '466.2.c.1: the Contested player is the Attacker');
  assert.ok(timings(f.flow).includes('cleanup-start'));
  assert.equal(f.flow.battlefields[0].contestedBy, 'A');
  assert.equal(f.flow.battlefields[0].staged, 'combat');
  assert.equal(f.flow.chain.turnState, 'neutral-open', 'Combat opens in the next Open state, not inside Cleanup');
});

test.todo(
  'movement-move-onto-enemy-occupied-stages-combat: the complete scene needs CombatFlow.advance() ' +
  'to open the Combat Showdown and designate Attacker A / Defender B (CR 462/466.2); ' +
  'combat-start-transaction is blocked pending an atomic simultaneous timing wave and role assignment',
);
