// Golden test placeholder for the setup chapter FFA4 scenario
//   setup-battlefield-first-player-removes-ffa4
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 490.4: the FFA4 Battlefield Count is three while four players provide
// three Battlefields each. 490.4.b: the player who is taking the first turn
// removes their Battlefields; they will not be used. 490.5: every player who is
// not going first randomly selects one of their three, the other two are removed,
// and the selected ones are placed simultaneously before play.
//
// Same blocker as FFA3: the merged layer has no four-seat seating or turn queue,
// and createMatch's battlefield selection is a fixed two-seat duel pick with no
// "the first-turn player contributes nothing" branch.
import test from 'node:test';

test.todo('setup-battlefield-first-player-removes-ffa4 (490.4 / 490.4.b / 490.5): the first-turn player removes all three of their Battlefields and the other three select one each — blocked: TurnFlow is 1v1 only and createMatch has no FFA4 seating or per-seat first-player battlefield removal');
