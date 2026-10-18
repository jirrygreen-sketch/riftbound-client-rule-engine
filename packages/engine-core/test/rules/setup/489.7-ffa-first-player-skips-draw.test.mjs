// Golden test placeholder for the setup chapter FFA first-turn draw scenario
//   setup-ffa-first-player-skips-draw
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 489.7: in FFA3 (and 490.7 FFA4 and 491.7 2v2) the player going first
// does not draw a card during their first Draw Phase of the game; 414.2 gives the
// normal Draw action, and the player going last channels the extra Rune.
//
// The turn driver schedules a mandatory draw for the Turn Player every turn: the
// Draw Phase task in src/turn/flow.ts calls this.draw(player) unconditionally, and
// there is no Mode-of-Play flag to skip the first one. On top of that the driver is
// two-seat only, so there is no "player going first in an FFA" to configure.
import test from 'node:test';

test.todo('setup-ffa-first-player-skips-draw (489.7 / 315.4 / 414.2): the FFA first player skips the first Draw Phase while later seats still draw one — blocked: TurnFlow schedules an unconditional draw for the Turn Player every turn (src/turn/flow.ts Draw Phase task) and its turn order is two seats');
