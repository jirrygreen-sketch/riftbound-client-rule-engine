// Scenario: movement-recall-bypasses-move-restriction (CR v1.5 458.3)
import test from 'node:test';

test.todo(
  'movement-recall-bypasses-move-restriction: missing the Recall action (src/effects/instructions/' +
  'effect.move.ts blocks mode:"recall") and missing the continuous.movement restriction consumer in ' +
  'src/zones/movement.ts, so "cannot be prevented by move restrictions" (458.3) cannot be executed',
);
