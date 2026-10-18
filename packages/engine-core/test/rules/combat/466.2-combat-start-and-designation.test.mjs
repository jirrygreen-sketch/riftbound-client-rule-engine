// Scenarios blocked on the atomic Combat start task (CR v1.5 466.1, 466.2, 466.2.b,
// 466.2.c, 466.2.c.3, 466.2.c.3.a, 323.2, 323.12, 462, 463.2):
//   combat-showdown-ends-after-all-pass
//   combat-defender-mid-showdown-move-converts-to-combat-showdown
//   combat-new-arrivals-gain-designation-next-cleanup
//   combat-turn-player-chooses-which-combat-first
//   combat-move-to-enemy-stages-combat-opens-combat-showdown   (open + roles half)
//
// Already executed for these scenarios (not repeated here): the entry, Contested
// application, Cleanup staging and Focus handling — see test/combat/flow.test.mjs,
// test/rules/movement/462-combat-staged-when-opposing-units-meet.test.mjs and
// test/rules/movement/323.9-staged-combat-canceled.test.mjs, plus this directory's
// 346.1-… and 463.2-… files.
import test from 'node:test';

test.todo(
  'combat-showdown-ends-after-all-pass (348 / 348.1 / 467.2): a Combat Showdown whose players pass in '
  + 'sequence must close and proceed to the Combat Damage Step (showdown-close then a real damage step). '
  + 'Missing: src/combat/flow.ts can only stage a Combat and throws '
  + 'TurnCombatBlockedError("combat-start-transaction") when opening one, so the YAML `given` (state '
  + 'showdown-open at bf1 with Units of both players, Focus on B) cannot be produced and the '
  + 'Combat Damage Step that follows the close has no module (CR 466.2 / 467.1)',
);

test.todo(
  'combat-defender-mid-showdown-move-converts-to-combat-showdown (323.13 / 466.2.c.1.b): a Combat staged '
  + 'while a Non-Combat Showdown is already ongoing must convert that Showdown into a Combat Showdown and '
  + 'keep the current Focus holder (466.2.c.1.b). Missing: the atomic Combat start transaction in '
  + 'src/combat/flow.ts (CombatFlow.advance throws combat-start-transaction for a staged Combat, and its '
  + 'showdown-conversion block needs the same atomic task) plus start-combat/start-showdown simultaneous '
  + 'emission and Attacker/Defender designation (466.2.b/c)',
);

test.todo(
  'combat-new-arrivals-gain-designation-next-cleanup (466.2.c.3.a / 323.2): a Unit that arrives at the '
  + 'Contested Battlefield AFTER the Combat opened gains its controller\'s designation in the next Cleanup '
  + '(Cleanup step 2) and its attack trigger becomes Pending then. Missing: Attacker/Defender designation '
  + 'assignment for late arrivals — src/combat/flow.ts never assigns a designation, so '
  + 'ObjectSnapshot.combatRole stays null for newcomers and no attack trigger can fire for them',
);

test.todo(
  'combat-turn-player-chooses-which-combat-first (463.1 / 323.12): with two Battlefields holding staged '
  + 'Combats simultaneously, the turn player chooses which one resolves first. Missing: CombatFlow tracks a '
  + 'single engagement and throws combat-start-transaction when opening the chosen Combat, so the '
  + 'simultaneous staging that 463.1 orders cannot be produced (see also '
  + 'test/rules/movement/463.1-turn-player-chooses-staged-combat-order.test.mjs, which records the same gap '
  + 'from the movement chapter)',
);

test.todo(
  'combat-move-to-enemy-stages-combat-opens-combat-showdown (466.2.c.1.a / 466.2.c.3): the OPENING half — '
  + 'the Combat Showdown opening with Attacker A / Defender B and the attacker gaining Focus — needs the '
  + 'atomic simultaneous timing wave plus role assignment. CombatFlow.advance() throws '
  + 'TurnCombatBlockedError("combat-start-transaction") for a staged Combat; the entry, Contested origin and '
  + 'staging half is already executed (test/combat/flow.test.mjs, '
  + 'test/rules/movement/462-combat-staged-when-opposing-units-meet.test.mjs)',
);
