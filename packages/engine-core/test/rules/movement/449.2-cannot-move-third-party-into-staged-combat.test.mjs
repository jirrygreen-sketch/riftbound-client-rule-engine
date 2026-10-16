// Scenario: movement-cannot-move-third-party-into-staged-combat (CR v1.5 449.2.a, 464.1)
import test from 'node:test';

test.todo(
  'movement-cannot-move-third-party-into-staged-combat: multiplayer is not implemented — ' +
  'src/turn/flow.ts accepts a 1v1 driver only ("This driver supports 1v1 only") and the ' +
  'src/zones/movement.ts header lists "multi-player or team destination restrictions ' +
  '(144.4.a.1 / 447.2)" as out of scope, so an ffa3 third-party destination check has no mechanism',
);
