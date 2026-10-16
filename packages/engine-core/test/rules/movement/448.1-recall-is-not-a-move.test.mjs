// Scenario: movement-recall-is-not-a-move (CR v1.5 457, 458, 458.1)
import test from 'node:test';

test.todo(
  'movement-recall-is-not-a-move: missing a Recall game action distinct from move-location ' +
  '(effect.move mode:"recall" is blocked with blockedReason "Recall requires an action distinct ' +
  'from Move (CR v1.5 457-460)" in src/effects/instructions/effect.move.ts) and missing the ' +
  'Recall timing point (events/timing-points.ts has no recalled event; 458.1 needs "no ' +
  'object-moved")',
);
