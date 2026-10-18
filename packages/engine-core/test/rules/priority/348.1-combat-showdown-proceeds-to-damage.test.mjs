// Scenario: priority-combat-showdown-proceeds-to-damage (CR v1.5 348.1, 467.1-467.3)
import test from 'node:test';

// Executing this scene requires the atomic Combat start, which is not merged:
// `CombatFlow.advance()` throws TurnCombatBlockedError('combat-start-transaction')
// as soon as a Battlefield is staged as Combat, so neither `showdown-close` nor
// the damage step can be produced from a legal position. The follow-up damage
// orchestration is blocked as well (`CombatFlow.dealDamage()` throws
// 'simultaneous-damage-transaction'). No partial assertion is written, because
// that would only assert that Combat is absent.
test.todo(
  'priority-combat-showdown-proceeds-to-damage: after every player passes Focus in a Combat Showdown the remaining Combat steps '
  + 'run (damage assignment then simultaneous damage) instead of a Conquer — blocked, missing the atomic Combat start '
  + '(src/combat/flow.ts CombatFlow.advance(): combat-start-transaction needs one simultaneous timing wave plus Attacker/Defender '
  + 'designation, CR 466.2) and the simultaneous-damage transaction (CombatFlow.dealDamage(): 467.2.c.1.a / 467.3) with its '
  + 'combat-damage timing point (the frozen enum has combat-damage-before / combat-damage-after; the scenario name combat-damage-step '
  + 'does not exist)',
);
