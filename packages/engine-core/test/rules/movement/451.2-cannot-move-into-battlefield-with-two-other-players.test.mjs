// Scenario: movement-cannot-move-into-battlefield-with-two-other-players (CR v1.5 451.2, 144.4.a.1)
import test from 'node:test';

test.todo(
  'movement-cannot-move-into-battlefield-with-two-other-players: multiplayer is not implemented — ' +
  'the src/zones/movement.ts board model is two-player (DuelBoard playerIds length 2) and its ' +
  'header declares multi-player destination restrictions out of scope, so "units from 2 other ' +
  'players" (451.2) cannot be represented or enforced',
);
