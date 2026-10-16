// Scenario: movement-move-restriction-blocks-standard-move (CR v1.5 144, 451.1, 054.1)
import test from 'node:test';

test.todo(
  'movement-move-restriction-blocks-standard-move: missing the continuous.movement restriction ' +
  'consumer — DuelReadinessRecord in src/zones/movement.ts carries only readied/hasGanking, and the ' +
  'Ganking keyword file states that zones/movement.ts has no interface reading continuous.movement ' +
  'permissions, so a "cannot move" effect cannot be fed into Standard Move declaration legality',
);
