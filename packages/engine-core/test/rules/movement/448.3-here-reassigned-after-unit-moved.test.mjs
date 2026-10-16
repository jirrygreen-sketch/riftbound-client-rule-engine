// Scenario: movement-here-reassigned-after-unit-moved (CR v1.5 448.3.b, 053.3)
import test from 'node:test';

test.todo(
  'movement-here-reassigned-after-unit-moved: missing the attack-declared trigger pipeline and ' +
  'the "here" anchor re-resolution at trigger resolution — CombatFlow throws ' +
  'TurnCombatBlockedError("combat-start-transaction") before any attack trigger is registered, ' +
  'and layers/filter.ts has no `here`/Battlefield anchor for a resolving triggered ability',
);
