// Scenarios whose full expectation needs the Finalize play-destination validator
// or a multi-player board (CR v1.5 355.2, 355.2.a, 355.2.b, 190.3.a.1, 464,
//  464.1, 316.7.d):
//   combat-negative-unit-cannot-be-played-to-enemy-battlefield
//   combat-negative-move-into-ongoing-combat-battlefield
//   combat-negative-attach-unit-noop                          (see 143.5-… file)
import test from 'node:test';

test.todo(
  'combat-negative-unit-cannot-be-played-to-enemy-battlefield (355.2.a / 190.3.a.1): playing a Unit to a '
  + 'Battlefield its controller does not control must be refused at Finalize, before any cost is paid. '
  + 'Missing: the Finalize Play-Destination validator — src/chain/engine.ts playDestinationIsLegal() only '
  + 'consults explicit continuous.location permissions/restrictions and otherwise leaves placement to the '
  + 'host, so a Unit draft carrying `location: { type: "battlefield", id: ... }` reaches the board with no '
  + '355.2.a default check (same gap recorded as movement-unit-played-to-enemy-battlefield-rejected)',
);

test.todo(
  'combat-negative-move-into-ongoing-combat-battlefield (464.1 / 316.7.d): in a Mode of Play with more than '
  + 'two players, a Battlefield with a staged Combat or a Combat in progress is an Invalid Destination for any '
  + 'Move by a player not involved in that Combat. Missing: the merged driver is 1v1 only — TurnFlow\'s '
  + 'constructor rejects anything but exactly two Battlefields and two players, so the YAML `given` with a '
  + 'third player C cannot be built (the related case is registered as '
  + 'movement-cannot-move-third-party-into-staged-combat)',
);
