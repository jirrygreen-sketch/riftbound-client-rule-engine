// Scenario: movement-here-reassigned-after-unit-moved (CR v1.5 448.3.b, 359.3.f.2)
// 053.3 describes Battlefield self-reference; the execution-time "here" rule is
// 359.3.f.2. The YAML's u2 is already at Base and cannot be chosen as a Unit
// "here" at the original Battlefield; a legal version needs u2 there at Finalize.
import test from 'node:test';

test.todo(
  'movement-here-reassigned-after-unit-moved: missing the attack-declared trigger pipeline and ' +
  'the "here" anchor re-resolution at trigger resolution — CombatFlow throws ' +
  'TurnCombatBlockedError("combat-start-transaction") before any attack trigger is registered, ' +
  'and layers/filter.ts has no `here`/Battlefield anchor for a resolving triggered ability',
);
