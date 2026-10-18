// Scenario: combat-staged-combat-fizzles-when-side-leaves
// CR v1.5 463.2, 323.9, 323.10, 323.7.a, 462, 345.
//
// Executed: a Combat staged at bf1 is cancelled by the real Cleanup once the
// opposing Units are gone — no Combat opens at that Battlefield and the staged
// engagement falls back to a Non-Combat Showdown for the still-present Contested
// player. The kill comes from a real spell the Focus holder plays during an
// already-open Showdown; every entry, Contested application, staging and Cleanup
// step runs through the merged TurnFlow/ChainEngine path.
//
// API mapping (recorded instead of a rule deviation): the frozen TimingPoint
// enumeration has no `combat.unstaged` id, so CombatFlow.cleanup() downgrades the
// stage silently; the golden asserts the observable `staged: 'showdown'` state.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  c, drainChain, eventsAt, flowFixture, killInstruction, moveInstruction, timingsAfter,
} from './harness.mjs';

test('combat-staged-combat-fizzles-when-side-leaves (463.2 / 323.9): a staged Combat whose opposing side leaves never opens', () => {
  const f = flowFixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 })
      .base('u2', { might: 2 })
      .hand('removal', { types: ['spell'], energy: 0 })
      .unit('d1', { owner: 'B', might: 2, location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.flow.start();

  // A first moves u2 into the empty bf2: a real Non-Combat Showdown opens there,
  // which is what keeps bf1's staging from opening while the chain is idle.
  f.flow.execute(f.activated('enter-bf2', [moveInstruction('m2', 'u2', { type: 'battlefield', id: 'bf2' })]));
  drainChain(f);
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.equal(f.flow.chain.focus, 'A');

  // A then moves u1 onto B's Battlefield: 452 applies Contested and the Cleanup
  // that follows stages the Combat (323.8 / 462) without opening it (462: one
  // Combat at a time, and bf2's Showdown already holds the turn's engagement).
  f.flow.execute(f.activated('enter-bf1', [moveInstruction('m1', 'u1', { type: 'battlefield', id: 'bf1' })]));
  drainChain(f);
  assert.equal(f.flow.battlefields[0].staged, 'combat', '323.8 / 462: opposing Units stage a Combat');
  assert.equal(f.flow.battlefields[0].contestedBy, 'A', '466.2.c.1: the entering player applied Contested');
  assert.equal(eventsAt(f, 'combat-start').length, 0, 'no Combat has opened yet');
  assert.equal(f.flow.chain.focus, 'B', '347.1.b: A\'s own chain handed Focus to B');

  // B (now the Focus holder) plays a real removal spell on its own defender.
  const before = f.flow.chain.pipeline.events.length;
  f.flow.execute(f.spell('removal', [killInstruction('kill', 'd1')], {
    controller: 'B', speed: 'action', cost: { id: 'cost:removal', cost: { energy: c(0), power: c([]) } },
  }));
  drainChain(f);

  assert.equal(f.kernel.getObject('d1').zone, 'trash', 'the spell really killed the defending Unit');
  assert.ok(timingsAfter(f, before).includes('object-killed'));
  assert.equal(eventsAt(f, 'combat-start').length, 0, '463.2: the Combat that stopped being staged never opens');
  assert.equal(f.flow.battlefields[0].contestedBy, 'A', '323.9: Contested stays while its applier holds a Unit here');
  assert.equal(f.flow.battlefields[0].staged, 'showdown',
    '323.9: Combat is no longer staged; only the Non-Combat Showdown stays staged (323.7.a)');
  assert.equal(f.flow.battlefields[0].controller, null, '323.8: the cancelled Combat establishes no Control');
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.equal(f.kernel.player('A').score, 0, 'no Conquer happened (471.1)');
  assert.equal(f.kernel.getObject('u1').zone, 'board', 'A keeps its Unit at bf1');
  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'battlefield', id: 'bf1' });
});

test.todo(
  'combat-staged-combat-fizzles-when-side-leaves (323.9 / 316.8.b.1.a): the YAML `given` has TWO '
  + 'staged engagements at the same moment (bf1 staged [showdown, combat] while the Showdown at bf2 '
  + 'runs, Focus on B). The merged TurnFlow/CombatFlow drives one engagement at a time and opening a '
  + 'Combat needs the not-yet-merged atomic Combat start '
  + '(TurnCombatBlockedError("combat-start-transaction"), CR 466.2), so the simultaneously-staged '
  + 'variant of this Cleanup sequence cannot be driven yet — the executed test above reaches the same '
  + '323.9 cancellation through a legal in-Chain route',
);
