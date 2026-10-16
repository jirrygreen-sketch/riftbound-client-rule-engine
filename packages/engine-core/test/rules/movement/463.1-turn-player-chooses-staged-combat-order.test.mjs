// Scenario: movement-turn-player-chooses-staged-combat-order (CR v1.5 463.1, 323.12)
import test from 'node:test';

// CR 455/323.12 open the first Combat before a second Standard Move could occur.
// A legal version needs the two entries during one resolving effect/Chain, so
// both Combats are Staged together before the turn player chooses their order.
test.todo(
  'movement-turn-player-chooses-staged-combat-order: CombatFlow.advance() does prompt the turn ' +
  'player to order staged engagements, but opening the chosen Combat throws ' +
  'TurnCombatBlockedError("combat-start-transaction", "Combat start needs an atomic simultaneous ' +
  'timing wave + roles (CR 466.2)"), so combat.attack-declared on the chosen Battlefield (323.12) ' +
  'cannot be executed yet',
);
