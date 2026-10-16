// Scenario: movement-unit-played-to-enemy-battlefield-rejected (CR v1.5 355.2.a, 355.2.b)
import test from 'node:test';

test.todo(
  'movement-unit-played-to-enemy-battlefield-rejected: missing the Finalize Play-Destination ' +
  'validator (continuous.location consumer) — src/chain/engine.ts resolves a Unit to whatever ' +
  '`location` the draft carries without checking 355.2.a default locations, so the illegal ' +
  'destination is not rejected before cost payment',
);
